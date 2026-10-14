import fs from "node:fs";
import path from "node:path";
import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  transcribe,
  type WhisperModel,
} from "@remotion/install-whisper-cpp";
import { config } from "../config";

/**
 * whisper.cpp via @remotion/install-whisper-cpp.
 *
 * Version 1.5.5: the release the Remotion docs use in their examples and the only one Remotion mirrors
 * for Windows (prebuilt whisper-bin-x64 with main.exe; supports --dtw token timestamps).
 * Installed lazily into config.whisper.dir on first need (or already present). If a newer build
 * (>= 1.7.4, build/bin/whisper-cli.exe) is found in the dir instead, it is used as-is.
 *
 * Models (each downloaded into config.whisper.dir on first use):
 *  - config.whisper.model (default "base.en"): English — Piper word timing and recorded English lines.
 *  - config.whisper.multilingualModel (default "small"): recorded Japanese lines (language "ja").
 */
export const WHISPER_CPP_VERSION = "1.5.5";
const NEWER_LAYOUT_VERSION = "1.7.6"; // any >= 1.7.4 maps to build/bin/whisper-cli.exe in Remotion

const MODELS: readonly WhisperModel[] = [
  "tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en",
  "large-v1", "large-v2", "large-v3", "large-v3-turbo",
];

export type WordTiming = { text: string; startSec: number; endSec: number };
/** One transcribed segment: full text + the (approximate) start time of each character (same length as [...text]). */
export type TimedSegment = { text: string; charStarts: number[] };

/** Which configured model: "en" = config.whisper.model, "multi" = config.whisper.multilingualModel. */
export type ModelRole = "en" | "multi";

function modelName(role: ModelRole): string {
  return role === "en" ? config.whisper.model : config.whisper.multilingualModel;
}

function model(role: ModelRole): WhisperModel {
  const name = modelName(role);
  const m = name as WhisperModel;
  if (!MODELS.includes(m)) throw new Error(`Unsupported whisper model "${name}" (use one of ${MODELS.join(", ")})`);
  if (role === "multi" && name.endsWith(".en")) {
    throw new Error(`whisper.multilingualModel "${name}" is English-only; use a multilingual model (e.g. "small")`);
  }
  return m;
}

function installedVersion(): string | null {
  const dir = config.whisper.dir;
  if (fs.existsSync(path.join(dir, "main.exe"))) return WHISPER_CPP_VERSION;
  if (fs.existsSync(path.join(dir, "build", "bin", "whisper-cli.exe"))) return NEWER_LAYOUT_VERSION;
  return null;
}

function modelFile(name: string): string {
  return path.join(config.whisper.dir, `ggml-${name}.bin`);
}

function statusOf(role: ModelRole): { ok: boolean; model: string; error?: string } {
  const m = modelName(role);
  const when = role === "en" ? "first English synthesis" : "first Japanese recorded line";
  try {
    model(role);
  } catch (e) {
    return { ok: false, model: m, error: (e as Error).message };
  }
  if (!installedVersion()) return { ok: false, model: m, error: `whisper.cpp is not installed in ${config.whisper.dir} (installed automatically on ${when})` };
  if (!fs.existsSync(modelFile(m))) return { ok: false, model: m, error: `Model file missing: ${modelFile(m)} (downloaded automatically on ${when})` };
  return { ok: true, model: m };
}

/** Side-effect free check for GET /api/tts/status (v3: + multilingual model for recorded ja lines). */
export function whisperStatus(): {
  ok: boolean;
  model: string;
  error?: string;
  multilingual: { ok: boolean; model: string; error?: string };
} {
  return { ...statusOf("en"), multilingual: statusOf("multi") };
}

let installing: Promise<string> | null = null;
const downloading = new Map<string, Promise<void>>();

function ensureWhisperCpp(): Promise<string> {
  installing ??= (async () => {
    let version = installedVersion();
    if (!version) {
      if (fs.existsSync(config.whisper.dir) && fs.readdirSync(config.whisper.dir).some((f) => !f.endsWith(".bin"))) {
        throw new Error(`${config.whisper.dir} exists but contains no whisper.cpp executable; delete it to reinstall`);
      }
      console.log(`[tts] installing whisper.cpp ${WHISPER_CPP_VERSION} into ${config.whisper.dir} ...`);
      await installWhisperCpp({ to: config.whisper.dir, version: WHISPER_CPP_VERSION, printOutput: false });
      version = installedVersion();
      if (!version) throw new Error(`whisper.cpp install finished but no executable was found in ${config.whisper.dir}`);
    }
    return version;
  })().catch((e: unknown) => {
    installing = null; // allow a retry later
    throw e;
  });
  return installing;
}

function ensureModel(role: ModelRole): Promise<void> {
  const m = model(role);
  if (fs.existsSync(modelFile(m))) return Promise.resolve();
  let p = downloading.get(m);
  if (!p) {
    p = (async () => {
      console.log(`[tts] downloading whisper model ${m} into ${config.whisper.dir} ...`);
      await downloadWhisperModel({ model: m, folder: config.whisper.dir, printOutput: false });
      console.log(`[tts] whisper model ${m} downloaded`);
    })().finally(() => downloading.delete(m));
    downloading.set(m, p);
  }
  return p;
}

/** Installs whisper.cpp + the model of `role` if missing (concurrent callers share it). Returns the version in use. */
export async function ensureWhisper(role: ModelRole = "en"): Promise<string> {
  const version = await ensureWhisperCpp();
  await ensureModel(role);
  return version;
}

/** The DTW token time is ~0.07–0.15 s after the token's actual onset (measured on VOICEVOX / Piper speech). */
const DTW_LEAD_SEC = 0.1;
const DTW_TRUST_SEC = 0.15;

/**
 * Start time (s) of a token: whisper's own token timestamp (offsets.from) is usually exact but sometimes far off
 * (first tokens of a segment, words after a pause); then the DTW time (minus its typical lead) is used.
 */
export function tokenStart(fromMs: number, dtwMs: number | null): number {
  const off = fromMs / 1000;
  if (dtwMs === null || dtwMs < 0) return off;
  const dtw = Math.max(0, dtwMs / 1000 - DTW_LEAD_SEC);
  return Math.abs(off - dtw) > DTW_TRUST_SEC ? dtw : off;
}

// transcribe() always writes "<process.cwd()>/tmp.json" -> never run two at once.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const job = queue.then(fn);
  queue = job.catch(() => undefined);
  return job;
}

/**
 * Word timings of a 16 kHz mono WAV (seconds) with the English model. tokenLevelTimestamps + DTW, one word per item;
 * words are re-joined from sub-word tokens (an item whose text does not start with a space continues the word).
 * Text keeps whisper's punctuation ("Hello," "world.").
 */
export function whisperWords(wav16k: string): Promise<WordTiming[]> {
  return serial(async () => {
    const version = await ensureWhisper("en");
    const m = model("en");
    const json = await transcribe({
      inputPath: path.resolve(wav16k),
      whisperPath: config.whisper.dir,
      whisperCppVersion: version,
      model: m,
      modelFolder: config.whisper.dir,
      tokenLevelTimestamps: true,
      splitOnWord: true,
      language: "en",
      printOutput: false,
    });
    const { captions } = toCaptions({ whisperCppOutput: json });
    const words: WordTiming[] = [];
    for (const c of captions) {
      const text = c.text;
      if (!text.trim() || /^\s*\[.*\]\s*$/.test(text)) continue; // [BLANK_AUDIO], [Music] ...
      const startSec = tokenStart(c.startMs, c.timestampMs);
      const endSec = Math.max(c.endMs / 1000, startSec);
      const prev = words[words.length - 1];
      if (prev && !/^\s/.test(text)) {
        prev.text += text;
        prev.endSec = Math.max(prev.endSec, endSec);
      } else {
        words.push({ text: text.trim(), startSec, endSec });
      }
    }
    return words;
  });
}

const SPECIAL_TOKEN = /^\s*\[_[A-Z]+_?\d*\]\s*$|^\s*\[_[A-Z_]+\]\s*$|^<\|.*\|>$/;

/**
 * Japanese (multilingual model, language "ja") transcription of a 16 kHz mono WAV as segments with per-character
 * start times. whisper.cpp runs with --max-len 0 so each segment's text is intact (single tokens can hold partial
 * UTF-8 bytes, printed as U+FFFD); token times (DTW, minus a small lead) are mapped onto the segment's characters
 * by walking the token texts; characters of broken tokens are interpolated between their neighbours.
 */
export function whisperJaSegments(wav16k: string): Promise<TimedSegment[]> {
  return serial(async () => {
    const version = await ensureWhisper("multi");
    const json = await transcribe({
      inputPath: path.resolve(wav16k),
      whisperPath: config.whisper.dir,
      whisperCppVersion: version,
      model: model("multi"),
      modelFolder: config.whisper.dir,
      tokenLevelTimestamps: true,
      language: "ja",
      printOutput: false,
      additionalArgs: [["--max-len", "0"]], // overrides the forced "--max-len 1": whole segments
    });
    const out: TimedSegment[] = [];
    for (const item of json.transcription) {
      const text = item.text.trim();
      // [音楽], (拍手), ♪~ ...
      if (!text || /^\s*[[(（【].*[\])）】]\s*$/.test(text) || !/[\p{L}\p{N}]/u.test(text)) continue;
      const tokens = item.tokens
        .filter((t) => !SPECIAL_TOKEN.test(t.text) && t.text !== "")
        .map((t) => ({
          text: t.text.trim(),
          t: tokenStart(t.offsets.from, t.t_dtw >= 0 ? t.t_dtw * 10 : null),
        }));
      out.push({ text, charStarts: mapTokenTimes([...text], tokens, item.offsets.from / 1000, item.offsets.to / 1000) });
    }
    return out;
  });
}

/** Per-char start times of `chars` from tokens (text may contain U+FFFD for partial bytes). Pure. */
export function mapTokenTimes(chars: string[], tokens: { text: string; t: number }[], segStart: number, segEnd: number): number[] {
  const times: number[] = new Array(chars.length).fill(NaN);
  let p = 0;
  for (let k = 0; k < tokens.length && p < chars.length; k++) {
    const tok = tokens[k]!;
    const tc = [...tok.text];
    if (!tc.length) continue;
    if (tok.text.includes("�")) {
      // broken bytes: the char(s) at p belong to this run of tokens; time = first token of the run
      if (Number.isNaN(times[p]!)) times[p] = tok.t;
      // advance past the char only when the next token is a valid one (it starts at the next char)
      const next = tokens[k + 1];
      if (!next || !next.text.includes("�")) {
        // find where the next valid token starts (normally p + 1)
        const nt = next ? [...next.text.trim()][0] : undefined;
        let q = p + 1;
        if (nt) {
          const found = chars.indexOf(nt, p + 1);
          if (found >= 0 && found - p <= 3) q = found;
        }
        p = q;
      }
      continue;
    }
    // valid token: locate it at (or just after) p
    let at = p;
    const first = tc[0]!;
    if (chars[at] !== first) {
      const found = chars.indexOf(first, p);
      if (found >= 0 && found - p <= 4) at = found;
    }
    for (let i = 0; i < tc.length && at + i < chars.length; i++) {
      if (Number.isNaN(times[at + i]!)) times[at + i] = tok.t + (i * 0.08);
    }
    p = at + tc.length;
  }
  // fill gaps by interpolation; enforce monotonic
  let last = segStart;
  for (let i = 0; i < times.length; i++) {
    if (!Number.isNaN(times[i]!)) {
      last = times[i]!;
      continue;
    }
    let j = i;
    while (j < times.length && Number.isNaN(times[j]!)) j++;
    const t1 = j < times.length ? times[j]! : Math.max(segEnd, last);
    for (let k = i; k < j; k++) times[k] = last + ((t1 - last) * (k - i + 1)) / (j - i + 1);
    i = j - 1;
  }
  for (let i = 1; i < times.length; i++) if (times[i]! < times[i - 1]!) times[i] = times[i - 1]!;
  return times;
}
