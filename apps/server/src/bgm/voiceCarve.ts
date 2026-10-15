import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Voice-band ducking (ARCHITECTURE §5.3.1): a "voice-carved" copy of the BGM with the speech band cut,
 * crossfaded in by the composition while narration plays (bass/kick and highs keep their energy).
 *
 * EQ (three peaking biquads; measured response on sines):
 *   550 Hz Q0.9 -5 dB   (300 Hz–1 kHz: about -2.5..-7 dB)
 *   1.7 kHz Q0.9 -10 dB (1–3 kHz: about -7..-11 dB, the core of speech intelligibility)
 *   3 kHz Q1.6 -4 dB    (consonants; 4 kHz about -5 dB)
 *   <= 150 Hz: < 1 dB change, >= 6 kHz: <= 1.6 dB change.
 * IIR filters are causal with no latency and the output is lossless FLAC (no encoder delay / padding),
 * so the copy has the same sample rate, channel count and sample count as the decoded original and the two
 * stay sample-aligned when played together.
 */
export const VOICE_CARVE_FILTER = [
  "equalizer=f=550:t=q:w=0.9:g=-5",
  "equalizer=f=1700:t=q:w=0.9:g=-10",
  "equalizer=f=3000:t=q:w=1.6:g=-4",
].join(",");

/** "assets/abc.mp3" -> "assets/abc-vcarve.flac" */
export function voiceCarvePathFor(bgmPath: string): string {
  const ext = path.posix.extname(bgmPath);
  return `${bgmPath.slice(0, bgmPath.length - ext.length)}-vcarve.flac`;
}

function run(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString("utf8");
      if (err.length > 64_000) err = err.slice(-32_000);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr: err }));
  });
}

/** Writes the voice-carved copy of `input` to `output` (temp file -> rename). Throws on failure. */
export async function makeVoiceCarve(input: string, output: string): Promise<void> {
  const tmp = `${output}.tmp-${process.pid}-${Date.now()}.flac`;
  let r: { code: number | null; stderr: string };
  try {
    r = await run([
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      input,
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-af",
      VOICE_CARVE_FILTER,
      "-c:a",
      "flac",
      "-sample_fmt",
      "s16",
      "-map_metadata",
      "-1",
      tmp,
    ]);
  } catch (e) {
    throw new Error(`Voice carve: could not start ffmpeg (${(e as Error).message}). Is it on PATH?`);
  }
  if (r.code !== 0) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw new Error(`Voice carve failed (exit ${r.code}): ${r.stderr.trim().split(/\r?\n/).slice(-4).join("\n")}`);
  }
  await fsp.rename(tmp, output);
}
