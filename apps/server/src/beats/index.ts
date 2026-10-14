import { runOk } from "../tts/proc";
import { SAMPLE_RATE, detectBeats } from "./dsp";

/**
 * BGM beat detection (owner: server agent, Phase 3). ARCHITECTURE §6.11.
 *
 * Contract:
 *  - input: absolute path of the BGM file (mp3 / wav / m4a / ogg / aac)
 *  - output: beat times in seconds from the start of the file (ascending, deduplicated, >= 0, whole file) and the tempo
 *  - throw on failure (message is stored in audio.bgm.analysisError)
 *  - runs outside the project lock; ffmpeg decode + DSP in src/beats/dsp.ts (a 3-min song takes ~1–2 s)
 */
export type BeatAnalysis = { beats: number[]; bpm: number };

const MAX_SECONDS = 20 * 60;

/** Decodes any audio file to mono float32 PCM at SAMPLE_RATE via ffmpeg (stdout). */
export async function decodeMono(file: string): Promise<Float32Array> {
  const r = await runOk(
    "ffmpeg",
    [
      "-hide_banner", "-nostdin", "-v", "error", "-i", file, "-t", String(MAX_SECONDS),
      "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1",
    ],
    "ffmpeg decode",
    { timeoutMs: 120_000 },
  );
  const buf = r.stdout;
  const n = Math.floor(buf.length / 4);
  if (!n) throw new Error("ffmpeg decoded no audio samples");
  // copy into an aligned buffer (Buffer.concat result may not be 4-byte aligned)
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

export async function analyzeBeats(file: string): Promise<BeatAnalysis> {
  const samples = await decodeMono(file);
  return detectBeats(samples);
}
