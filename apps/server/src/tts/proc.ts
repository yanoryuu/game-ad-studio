import { spawn } from "node:child_process";

/* ------------------------------------------------------------------ */
/* Small process helpers for the TTS pipeline (media.ts `run` is not exported). */
/* ------------------------------------------------------------------ */

export type ProcResult = { code: number | null; stdout: Buffer; stderr: string };

/** Spawns without a shell; optional stdin (written as-is, e.g. UTF-8 text). */
export function runProc(
  cmd: string,
  args: string[],
  opts: { input?: string | Buffer; cwd?: string; timeoutMs?: number } = {},
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      cwd: opts.cwd,
      stdio: [opts.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    let err = "";
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        child.kill();
        reject(new Error(`${cmd} timed out after ${Math.round(opts.timeoutMs! / 1000)}s`));
      }, opts.timeoutMs);
    }
    child.stdout!.on("data", (d: Buffer) => out.push(d));
    child.stderr!.on("data", (d: Buffer) => {
      err += d.toString("utf8");
      if (err.length > 64_000) err = err.slice(-32_000);
    });
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out), stderr: err });
    });
    if (opts.input !== undefined) {
      child.stdin!.on("error", () => undefined); // EPIPE if the process dies early; reported via exit code
      child.stdin!.end(opts.input);
    }
  });
}

export function tail(s: string, n = 6): string {
  return s.trim().split(/\r?\n/).slice(-n).join("\n");
}

export async function runOk(cmd: string, args: string[], what: string, opts?: Parameters<typeof runProc>[2]): Promise<ProcResult> {
  let r: ProcResult;
  try {
    r = await runProc(cmd, args, opts);
  } catch (e) {
    throw new Error(`${what}: could not run ${cmd} (${(e as Error).message})`);
  }
  if (r.code !== 0) throw new Error(`${what} failed (exit ${r.code}): ${tail(r.stderr)}`);
  return r;
}

/* ------------------------------------------------------------------ */
/* ffprobe / ffmpeg (audio)                                             */
/* ------------------------------------------------------------------ */

/** Duration in seconds of an audio file (ffprobe). */
export async function audioDuration(file: string): Promise<number> {
  const r = await runOk(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
    "ffprobe",
  );
  const d = Number(r.stdout.toString("utf8").trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`Could not read the duration of ${file}`);
  return d;
}

/** Peak level in dBFS (ffmpeg volumedetect max_volume). */
export async function peakDb(file: string): Promise<number> {
  const r = await runOk("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-af", "volumedetect", "-f", "null", "-"], "ffmpeg volumedetect");
  const m = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr);
  if (!m) throw new Error("volumedetect: no max_volume in ffmpeg output");
  return m[1] === "-inf" ? -Infinity : Number(m[1]);
}

/** Applies a constant gain so the peak becomes `targetDb` (PCM s16 WAV out, same rate/channels). */
export async function normalizePeak(input: string, output: string, targetDb = -3): Promise<void> {
  const peak = await peakDb(input);
  const gain = Number.isFinite(peak) ? targetDb - peak : 0;
  await runOk(
    "ffmpeg",
    ["-hide_banner", "-nostdin", "-y", "-i", input, "-af", `volume=${gain.toFixed(2)}dB`, "-c:a", "pcm_s16le", output],
    "ffmpeg normalize",
  );
}

/** 16 kHz mono s16 WAV (whisper.cpp input). */
export async function toWhisperWav(input: string, output: string): Promise<void> {
  await runOk("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output], "ffmpeg resample");
}

/** The TTS engine itself is unavailable (not installed / not reachable) -> HTTP 503 where relevant. */
export class EngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineUnavailableError";
  }
}

/** The requested voice/speaker does not exist or is malformed -> HTTP 400 for previews. */
export class InvalidVoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVoiceError";
  }
}
