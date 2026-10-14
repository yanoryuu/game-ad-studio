import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  DEFAULT_PIPER_VOICE,
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
import { audioDuration, normalizePeak, toWhisperWav } from "./proc";
import { voicevoxCredit, voicevoxSynthesize, voicevoxVersion, voicevoxVoices } from "./voicevox";
import { whisperStatus, whisperWords } from "./whisper";

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

/**
 * Synthesizes one line into projects/<id>/tts/<lineId>.wav (overwrite) and computes its captions.
 * Runs outside the project lock; the caller stores the result with updateProject.
 */
export async function synthesizeLine(projectId: string, line: Pick<ScriptLine, "id" | "text" | "voice" | "lang">): Promise<LineSynthesis> {
  const ttsDir = path.join(projectDir(projectId), "tts");
  await fsp.mkdir(ttsDir, { recursive: true });
  const rel = `tts/${line.id}.wav`;
  const dest = path.join(ttsDir, `${line.id}.wav`);
  const tmpOut = path.join(ttsDir, `.${line.id}.${nanoid(6)}.tmp.wav`);
  const text = line.text.trim();
  try {
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
      return { audioPath: rel, durationSec, captions: buildJaCaptions(text, query, durationSec), credit };
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
      const out: LineSynthesis = { audioPath: rel, durationSec, captions: buildEnCaptions(text, durationSec, words) };
      if (warning) out.warning = warning;
      return out;
    });
  } finally {
    await fsp.rm(tmpOut, { force: true }).catch(() => undefined);
  }
}

/** WAV bytes for a preview (nothing stored, no captions). */
export async function previewWav(voice: Voice, text: string): Promise<Buffer> {
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
