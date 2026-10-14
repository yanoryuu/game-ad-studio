import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Lang, TtsVoice } from "@gas/shared";
import { config } from "../config";
import { EngineUnavailableError, InvalidVoiceError, normalizePeak, runOk } from "./proc";

/* ------------------------------------------------------------------ */
/* Piper (English TTS)                                                  */
/* ------------------------------------------------------------------ */

const SAFE_VOICE = /^[A-Za-z0-9_.-]+$/;

export function piperVoicePath(voice: string): string {
  if (!SAFE_VOICE.test(voice) || voice.includes("..")) throw new InvalidVoiceError(`Invalid Piper voice name "${voice}"`);
  return path.join(config.piper.voicesDir, `${voice}.onnx`);
}

/** Side-effect free check: exe + default voice exist. */
export function piperStatus(defaultVoice: string): { ok: boolean; error?: string } {
  if (!fs.existsSync(config.piper.exePath)) return { ok: false, error: `piper.exe not found: ${config.piper.exePath}` };
  const v = piperVoicePath(defaultVoice);
  if (!fs.existsSync(v)) return { ok: false, error: `Default Piper voice not found: ${v}` };
  if (!fs.existsSync(`${v}.json`)) return { ok: false, error: `Voice config not found: ${v}.json` };
  return { ok: true };
}

type VoiceJson = { language?: { code?: string; family?: string }; dataset?: string };

function langOf(j: VoiceJson, name: string): string {
  return (j.language?.family ?? j.language?.code ?? name).slice(0, 2).toLowerCase();
}

/** *.onnx (with .onnx.json) in voicesDir whose language is ja/en. */
export async function piperVoices(): Promise<TtsVoice[]> {
  if (!fs.existsSync(config.piper.exePath)) throw new EngineUnavailableError(`piper.exe not found: ${config.piper.exePath}`);
  let entries: string[];
  try {
    entries = await fsp.readdir(config.piper.voicesDir);
  } catch {
    throw new EngineUnavailableError(`Piper voices directory not found: ${config.piper.voicesDir}`);
  }
  const out: TtsVoice[] = [];
  for (const f of entries.sort()) {
    if (!f.toLowerCase().endsWith(".onnx")) continue;
    const name = f.slice(0, -5);
    if (!SAFE_VOICE.test(name)) continue;
    let j: VoiceJson = {};
    try {
      j = JSON.parse(await fsp.readFile(path.join(config.piper.voicesDir, `${f}.json`), "utf8")) as VoiceJson;
    } catch {
      continue; // piper needs the .onnx.json
    }
    const lang = langOf(j, name);
    if (lang !== "en" && lang !== "ja") continue;
    out.push({ engine: "piper", speaker: name, name, lang: lang as Lang });
  }
  return out;
}

/**
 * Synthesizes `text` to `outWav` (PCM WAV, native rate of the voice, peak normalized to -3 dBFS).
 * length_scale = 1 / speed. Text goes through stdin as UTF-8 (one utterance; newlines collapsed).
 */
export async function piperSynthesize(text: string, voice: string, speed: number, outWav: string, tmpDir: string): Promise<void> {
  const model = piperVoicePath(voice);
  if (!fs.existsSync(model)) throw new InvalidVoiceError(`Piper voice not found: ${model}`);
  if (!fs.existsSync(config.piper.exePath)) throw new EngineUnavailableError(`piper.exe not found: ${config.piper.exePath}`);
  const raw = path.join(tmpDir, "piper-raw.wav");
  const lengthScale = (1 / speed).toFixed(4);
  await runOk(
    config.piper.exePath,
    ["--model", model, "--output_file", raw, "--length_scale", lengthScale],
    "Piper",
    { input: Buffer.from(text.replace(/\s*\r?\n\s*/g, " ").trim() + "\n", "utf8"), cwd: path.dirname(config.piper.exePath), timeoutMs: 120_000 },
  );
  if (!fs.existsSync(raw)) throw new Error("Piper produced no output file");
  await normalizePeak(raw, outWav, -3);
}
