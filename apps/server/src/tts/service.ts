import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  DEFAULT_PIPER_VOICE,
  stripEmphasis,
  type Caption,
  type ScriptLine,
  type TtsEngine,
  type TtsStatusResponse,
  type TtsVoice,
  type Voice,
} from "@gas/shared";
import { config } from "../config";
import { projectDir } from "../paths";
import { buildEnCaptions } from "./enCaptions";
import { buildJaCaptions } from "./jaCaptions";
import { piperStatus, piperSynthesize, piperVoices } from "./piper";
import { InvalidVoiceError, audioDuration, normalizePeak, peakDb, runOk, toWhisperWav } from "./proc";
import { buildRecordedJaCaptions, isLikelyHallucination, scriptMatchRatio } from "./recordedCaptions";
import { voicevoxCredit, voicevoxSynthesize, voicevoxVersion, voicevoxVoices } from "./voicevox";
import { whisperJaSegments, whisperStatus, whisperWords, type TimedSegment, type WordTiming } from "./whisper";

export type LineSynthesis = {
  audioPath: string;
  durationSec: number;
  captions: Caption[];
  credit?: string;
  /** non-fatal problem (e.g. whisper failed -> proportional caption timing) */
  warning?: string;
};

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gas-tts-"));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Atomically moves `tmp` over `dest` (Windows: retry while a reader holds the old file). */
async function replaceFile(tmp: string, dest: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(tmp, dest);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        await fsp.copyFile(tmp, dest);
        await fsp.rm(tmp, { force: true });
        return;
      }
      if (attempt < 10 && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

/* ------------------------------------------------------------------ */
/* v3: recorded narration (ARCHITECTURE §6.10)                          */
/* ------------------------------------------------------------------ */

export const RECORDED_SAMPLE_RATE = 48000;
/** Leading/trailing silence below this level longer than the kept padding is trimmed. */
const TRIM_THRESHOLD_DB = -50;
const TRIM_KEEP_START_SEC = 0.25;
const TRIM_KEEP_END_SEC = 0.35;

/** Absolute path of a recorded line's source asset; throws a user-facing error when it is missing. */
function recordingFile(projectId: string, sourcePath: string | undefined): string {
  if (!sourcePath) throw new Error("録音ファイルがありません (voice.sourcePath is not set)");
  const parts = sourcePath.split("/");
  if (parts.some((p) => p === ".." || p === "") || /^[a-zA-Z]:/.test(sourcePath) || sourcePath.includes("\\")) {
    throw new Error(`録音ファイルのパスが不正です: ${sourcePath}`);
  }
  const file = path.join(projectDir(projectId), ...parts);
  if (!fs.existsSync(file)) throw new Error(`録音ファイルがありません: ${sourcePath}`);
  return file;
}

type Converted = Omit<LineSynthesis, "audioPath">;

/** Below this peak (before normalization) the recording is treated as silence (whisper would hallucinate). */
const QUIET_PEAK_DB = -45;
/** With script text, at least this fraction of its characters must appear in the transcript. */
const MIN_SCRIPT_MATCH = 0.3;

/** Throws (-> warning + fallback captions) when the whisper result is unusable. */
function checkTranscript(text: string, transcript: string): void {
  if (!transcript.trim() || isLikelyHallucination(transcript)) {
    throw new Error(`whisper found no speech${transcript.trim() ? ` (ignored "${transcript.trim().slice(0, 40)}")` : ""}`);
  }
  if (text) {
    const r = scriptMatchRatio(text, transcript);
    if (r < MIN_SCRIPT_MATCH) {
      throw new Error(`the transcript does not match the text (${Math.round(r * 100)} % match): "${transcript.trim().slice(0, 60)}"`);
    }
  }
}

/**
 * Converts voice.sourcePath into `out` (PCM s16 WAV, mono, 48 kHz, long leading/trailing silence trimmed,
 * peak -3 dBFS) and builds captions with whisper (en: config.whisper.model, ja: config.whisper.multilingualModel).
 * Problems with whisper are non-fatal (warning); a missing/undecodable recording throws.
 */
async function convertRecording(projectId: string, line: Pick<ScriptLine, "id" | "text" | "voice" | "lang">, out: string): Promise<Converted> {
  const src = recordingFile(projectId, line.voice.sourcePath);
  return withTmpDir(async (tmp) => {
    const warnings: string[] = [];
    const base = ["-hide_banner", "-nostdin", "-y", "-i", src, "-vn", "-ac", "1", "-ar", String(RECORDED_SAMPLE_RATE)];
    const raw = path.join(tmp, "rec-raw.wav");
    await runOk("ffmpeg", [...base, "-c:a", "pcm_f32le", raw], "Converting the recording", { timeoutMs: 120_000 });
    const rawDur = await audioDuration(raw).catch(() => 0);
    if (!(rawDur > 0)) throw new Error("録音ファイルに音声がありません (no audio decoded)");

    // trim long silence at both ends (areverse trick for the tail); fall back to the untrimmed audio
    const trimmed = path.join(tmp, "rec-trim.wav");
    const sr = (keep: number) =>
      `silenceremove=start_periods=1:start_duration=0:start_threshold=${TRIM_THRESHOLD_DB}dB:start_silence=${keep}`;
    let pre = raw;
    try {
      await runOk(
        "ffmpeg",
        ["-hide_banner", "-nostdin", "-y", "-i", raw, "-af", `${sr(TRIM_KEEP_START_SEC)},areverse,${sr(TRIM_KEEP_END_SEC)},areverse`, "-c:a", "pcm_f32le", trimmed],
        "Trimming silence",
        { timeoutMs: 120_000 },
      );
      if ((await audioDuration(trimmed)) >= 0.3) pre = trimmed;
    } catch (e) {
      console.warn(`[tts] ${line.id}: silence trim failed, using the untrimmed recording: ${(e as Error).message}`);
    }

    const peak = await peakDb(pre);
    const tooQuiet = !Number.isFinite(peak) || peak < QUIET_PEAK_DB;
    await normalizePeak(pre, out, -3);
    const durationSec = await audioDuration(out);

    let captions: Caption[];
    // v4 (§6.13): 【】 are not spoken -> compare the transcript with the stripped text; captions keep the markers
    const text = line.text;
    const spoken = stripEmphasis(text).trim();
    try {
      if (tooQuiet) throw new Error(`録音がほぼ無音です (peak ${Number.isFinite(peak) ? peak.toFixed(1) : "-inf"} dBFS)`);
      const w16 = path.join(tmp, "w16k.wav");
      await toWhisperWav(out, w16);
      let transcript: string;
      if (line.lang === "ja") {
        const segs: TimedSegment[] = await whisperJaSegments(w16);
        transcript = segs.map((s) => s.text).join(" ");
        checkTranscript(spoken, transcript);
        captions = buildRecordedJaCaptions(text, durationSec, segs);
      } else {
        const words: WordTiming[] = await whisperWords(w16);
        transcript = words.map((w) => w.text).join(" ");
        checkTranscript(spoken, transcript);
        captions = buildEnCaptions(spoken ? text : transcript, durationSec, words);
      }
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      captions = line.lang === "ja" ? buildRecordedJaCaptions(text, durationSec, null) : buildEnCaptions(text, durationSec, null);
      warnings.push(
        spoken
          ? `字幕のタイミングを取得できませんでした(文字数で比例配分): ${msg}`
          : `字幕を作成できませんでした(テキストが空): ${msg}`,
      );
    }
    for (const w of warnings) console.warn(`[tts] ${line.id}: ${w}`);
    const res: Converted = { durationSec, captions };
    if (warnings.length) res.warning = warnings.join(" / ");
    return res;
  });
}

/**
 * Synthesizes one line into projects/<id>/tts/<lineId>.wav (overwrite) and computes its captions.
 * v3: "recorded" lines are converted from voice.sourcePath instead (no credit).
 * Runs outside the project lock; the caller stores the result with updateProject.
 */
export async function synthesizeLine(projectId: string, line: Pick<ScriptLine, "id" | "text" | "voice" | "lang">): Promise<LineSynthesis> {
  const ttsDir = path.join(projectDir(projectId), "tts");
  await fsp.mkdir(ttsDir, { recursive: true });
  const rel = `tts/${line.id}.wav`;
  const dest = path.join(ttsDir, `${line.id}.wav`);
  const tmpOut = path.join(ttsDir, `.${line.id}.${nanoid(6)}.tmp.wav`);
  // v4 (§6.13): the engines read stripEmphasis(text); captions are built from the original text (markers kept)
  const text = stripEmphasis(line.text).trim();
  try {
    if (line.voice.engine === "recorded") {
      const r = await convertRecording(projectId, line, tmpOut);
      await replaceFile(tmpOut, dest);
      return { audioPath: rel, ...r };
    }
    if (line.voice.engine === "voicevox") {
      const credit = await voicevoxCredit(line.voice.speaker);
      const { query, wav } = await voicevoxSynthesize(text, line.voice.speaker, line.voice.speed);
      // same -3 dBFS peak normalization as Piper so line levels are consistent (gain only: timing unchanged)
      const durationSec = await withTmpDir(async (tmp) => {
        const raw = path.join(tmp, "voicevox-raw.wav");
        await fsp.writeFile(raw, wav);
        await normalizePeak(raw, tmpOut, -3);
        return audioDuration(tmpOut);
      });
      await replaceFile(tmpOut, dest);
      return { audioPath: rel, durationSec, captions: buildJaCaptions(line.text, query, durationSec), credit };
    }
    return await withTmpDir(async (tmp) => {
      await piperSynthesize(text, line.voice.speaker, line.voice.speed, tmpOut, tmp);
      const durationSec = await audioDuration(tmpOut);
      let words = null;
      let warning: string | undefined;
      try {
        const w16 = path.join(tmp, "w16k.wav");
        await toWhisperWav(tmpOut, w16);
        words = await whisperWords(w16);
        if (!words.length) throw new Error("whisper returned no words");
      } catch (e) {
        words = null;
        warning = `Word timing (whisper) failed, captions use proportional timing: ${(e as Error).message.slice(0, 300)}`;
        console.warn(`[tts] ${line.id}: ${warning}`);
      }
      await replaceFile(tmpOut, dest);
      const out: LineSynthesis = { audioPath: rel, durationSec, captions: buildEnCaptions(line.text, durationSec, words) };
      if (warning) out.warning = warning;
      return out;
    });
  } finally {
    await fsp.rm(tmpOut, { force: true }).catch(() => undefined);
  }
}

/** WAV bytes for a preview (nothing stored, no captions). v4: emphasis markers are not read. */
export async function previewWav(voice: Voice, rawText: string): Promise<Buffer> {
  const text = stripEmphasis(rawText);
  if (voice.engine === "recorded") throw new InvalidVoiceError("Preview is only available for TTS engines (not recorded lines)");
  if (voice.engine === "voicevox") {
    await voicevoxCredit(voice.speaker); // validates the style id (InvalidVoiceError)
    const { wav } = await voicevoxSynthesize(text.trim(), voice.speaker, voice.speed);
    return withTmpDir(async (tmp) => {
      const raw = path.join(tmp, "voicevox-raw.wav");
      const out = path.join(tmp, "preview.wav");
      await fsp.writeFile(raw, wav);
      await normalizePeak(raw, out, -3);
      return fsp.readFile(out);
    });
  }
  return withTmpDir(async (tmp) => {
    const out = path.join(tmp, "preview.wav");
    await piperSynthesize(text.trim(), voice.speaker, voice.speed, out, tmp);
    return fsp.readFile(out);
  });
}

/** GET /api/tts/status — no side effects (does not start the engine or install whisper). */
export async function ttsStatus(): Promise<TtsStatusResponse> {
  const url = config.voicevox.url;
  let voicevox: TtsStatusResponse["voicevox"];
  try {
    voicevox = { ok: true, version: await voicevoxVersion(1500), url };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "timeout" : (e as Error).message;
    voicevox = { ok: false, url, error: `VOICEVOX engine not reachable (${msg}); it is started automatically on first use` };
  }
  return { voicevox, piper: piperStatus(DEFAULT_PIPER_VOICE), whisper: whisperStatus() };
}

export function listVoices(engine: TtsEngine): Promise<TtsVoice[]> {
  return engine === "voicevox" ? voicevoxVoices() : piperVoices();
}

export async function removeLineAudio(projectId: string, lineId: string): Promise<void> {
  const f = path.join(projectDir(projectId), "tts", `${lineId}.wav`);
  if (fs.existsSync(f)) await fsp.rm(f, { force: true }).catch(() => undefined);
}
