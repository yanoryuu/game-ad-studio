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
 */
export const WHISPER_CPP_VERSION = "1.5.5";
const NEWER_LAYOUT_VERSION = "1.7.6"; // any >= 1.7.4 maps to build/bin/whisper-cli.exe in Remotion

const MODELS: readonly WhisperModel[] = [
  "tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en",
  "large-v1", "large-v2", "large-v3", "large-v3-turbo",
];

export type WordTiming = { text: string; startSec: number; endSec: number };

function model(): WhisperModel {
  const m = config.whisper.model as WhisperModel;
  if (!MODELS.includes(m)) throw new Error(`Unsupported whisper model "${config.whisper.model}" (use one of ${MODELS.join(", ")})`);
  return m;
}

function installedVersion(): string | null {
  const dir = config.whisper.dir;
  if (fs.existsSync(path.join(dir, "main.exe"))) return WHISPER_CPP_VERSION;
  if (fs.existsSync(path.join(dir, "build", "bin", "whisper-cli.exe"))) return NEWER_LAYOUT_VERSION;
  return null;
}

function modelFile(): string {
  return path.join(config.whisper.dir, `ggml-${config.whisper.model}.bin`);
}

/** Side-effect free check for GET /api/tts/status. */
export function whisperStatus(): { ok: boolean; model: string; error?: string } {
  const m = config.whisper.model;
  if (!MODELS.includes(m as WhisperModel)) return { ok: false, model: m, error: `Unsupported model "${m}"` };
  if (!installedVersion()) return { ok: false, model: m, error: `whisper.cpp is not installed in ${config.whisper.dir} (installed automatically on first English synthesis)` };
  if (!fs.existsSync(modelFile())) return { ok: false, model: m, error: `Model file missing: ${modelFile()} (downloaded automatically on first English synthesis)` };
  return { ok: true, model: m };
}

let installing: Promise<string> | null = null;

/** Installs whisper.cpp + model if missing (once; concurrent callers share it). Returns the version in use. */
export function ensureWhisper(): Promise<string> {
  installing ??= (async () => {
    let version = installedVersion();
    if (!version) {
      if (fs.existsSync(config.whisper.dir) && fs.readdirSync(config.whisper.dir).length > 0) {
        throw new Error(`${config.whisper.dir} exists but contains no whisper.cpp executable; delete it to reinstall`);
      }
      console.log(`[tts] installing whisper.cpp ${WHISPER_CPP_VERSION} into ${config.whisper.dir} ...`);
      await installWhisperCpp({ to: config.whisper.dir, version: WHISPER_CPP_VERSION, printOutput: false });
      version = installedVersion();
      if (!version) throw new Error(`whisper.cpp install finished but no executable was found in ${config.whisper.dir}`);
    }
    if (!fs.existsSync(modelFile())) {
      console.log(`[tts] downloading whisper model ${config.whisper.model} ...`);
      await downloadWhisperModel({ model: model(), folder: config.whisper.dir, printOutput: false });
    }
    return version;
  })().catch((e: unknown) => {
    installing = null; // allow a retry later
    throw e;
  });
  return installing;
}

// transcribe() always writes "<process.cwd()>/tmp.json" -> never run two at once.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Word timings of a 16 kHz mono WAV (seconds). tokenLevelTimestamps + DTW, one word per item;
 * words are re-joined from sub-word tokens (an item whose text does not start with a space continues the word).
 */
export function whisperWords(wav16k: string): Promise<WordTiming[]> {
  const job = queue.then(async () => {
    const version = await ensureWhisper();
    const json = await transcribe({
      inputPath: wav16k,
      whisperPath: config.whisper.dir,
      whisperCppVersion: version,
      model: model(),
      modelFolder: config.whisper.dir,
      tokenLevelTimestamps: true,
      splitOnWord: true,
      language: config.whisper.model.endsWith(".en") ? "en" : null,
      printOutput: false,
    });
    const { captions } = toCaptions({ whisperCppOutput: json });
    const words: WordTiming[] = [];
    for (const c of captions) {
      const text = c.text;
      if (!text.trim() || /^\s*\[.*\]\s*$/.test(text)) continue; // [BLANK_AUDIO], [Music] ...
      const startSec = c.startMs / 1000;
      const endSec = Math.max(c.endMs / 1000, startSec);
      const prev = words[words.length - 1];
      if (prev && !/^\s/.test(text) && words.length > 0) {
        prev.text += text;
        prev.endSec = Math.max(prev.endSec, endSec);
      } else {
        words.push({ text: text.trim(), startSec, endSec });
      }
    }
    return words;
  });
  queue = job.catch(() => undefined);
  return job;
}
