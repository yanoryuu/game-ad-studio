import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * ffmpeg I/O for the highlight analysis. ONE decode pass over the (proxy) video:
 *   video: downscale -> scdet (scene score + mean abs frame difference) -> signalstats (brightness, saturation)
 *   audio: mono, 0.1 s windows -> astats RMS / peak level
 * Per-frame metadata is written by the `metadata` / `ametadata` filters to text files in a temp dir.
 */

export type VideoFrameStat = {
  t: number;
  /** scdet scene-change score, 0..100 */
  scene: number;
  /** scdet mean absolute frame difference (motion proxy), 0..100-ish */
  mafd: number;
  /** mean luma 0..255 */
  yavg: number;
  /** mean saturation */
  sat: number;
};

export type AudioFrameStat = {
  t: number;
  /** RMS level dBFS (silence clamped to -100) */
  rms: number;
  /** peak level dBFS (silence clamped to -100) */
  peak: number;
};

export type RawFeatures = { video: VideoFrameStat[]; audio: AudioFrameStat[] };

export type RunResult = { code: number | null; stderr: string };

export function runFfmpeg(args: string[], cwd?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true, cwd, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString("utf8");
      if (err.length > 64_000) err = err.slice(-32_000);
    });
    child.on("error", (e) => reject(new Error(`could not start ffmpeg (${e.message}). Is it on PATH?`)));
    child.on("close", (code) => resolve({ code, stderr: err }));
  });
}

function tail(s: string, n = 6): string {
  return s.trim().split(/\r?\n/).slice(-n).join("\n");
}

const num = (v: string | undefined, fallback: number): number => {
  if (v === undefined) return fallback;
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

/** Parses the output of the (a)metadata=print filter into one record per frame. */
export function parseMetadataPrint(text: string): { t: number; kv: Record<string, string> }[] {
  const out: { t: number; kv: Record<string, string> }[] = [];
  let cur: { t: number; kv: Record<string, string> } | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("frame:")) {
      const m = /pts_time:(\S+)/.exec(line);
      cur = { t: m ? Number(m[1]) : NaN, kv: {} };
      out.push(cur);
    } else if (cur) {
      const i = line.indexOf("=");
      if (i > 0) cur.kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return out.filter((r) => Number.isFinite(r.t));
}

/** Runs the single feature-extraction pass. `hasAudio` = the input has an audio stream. */
export async function extractRawFeatures(input: string, hasAudio: boolean): Promise<RawFeatures> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "gas-analysis-"));
  try {
    const vChain =
      "[0:v:0]scale=320:-2,format=yuv420p,scdet=threshold=100,signalstats," +
      "metadata=mode=print:file=v.txt[vo]";
    const aChain =
      "[0:a:0]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=mono,asetnsamples=n=4800:p=0," +
      "astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level+Peak_level," +
      "ametadata=mode=print:file=a.txt[ao]";
    const graph = hasAudio ? `${vChain};${aChain}` : vChain;
    const args = [
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-i",
      path.resolve(input),
      "-filter_complex",
      graph,
      "-map",
      "[vo]",
      ...(hasAudio ? ["-map", "[ao]"] : []),
      "-f",
      "null",
      "-",
    ];
    const r = await runFfmpeg(args, tmp);
    if (r.code !== 0) throw new Error(`Feature extraction failed (exit ${r.code}): ${tail(r.stderr)}`);

    const vText = await fsp.readFile(path.join(tmp, "v.txt"), "utf8");
    const video: VideoFrameStat[] = parseMetadataPrint(vText).map(({ t, kv }) => ({
      t,
      scene: num(kv["lavfi.scd.score"], 0),
      mafd: num(kv["lavfi.scd.mafd"], 0),
      yavg: num(kv["lavfi.signalstats.YAVG"], 0),
      sat: num(kv["lavfi.signalstats.SATAVG"], 0),
    }));
    let audio: AudioFrameStat[] = [];
    if (hasAudio) {
      const aText = await fsp.readFile(path.join(tmp, "a.txt"), "utf8").catch(() => "");
      const db = (v: string | undefined) => Math.max(-100, num(v === "-inf" ? undefined : v, -100));
      audio = parseMetadataPrint(aText).map(({ t, kv }) => ({
        t,
        rms: db(kv["lavfi.astats.Overall.RMS_level"]),
        peak: db(kv["lavfi.astats.Overall.Peak_level"]),
      }));
    }
    if (video.length === 0) throw new Error("Feature extraction produced no video frames");
    return { video, audio };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Thumbnail at `sec` (height 360) */
export async function extractThumb(input: string, sec: number, output: string): Promise<void> {
  const r = await runFfmpeg([
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    Math.max(0, sec).toFixed(3),
    "-i",
    path.resolve(input),
    "-frames:v",
    "1",
    "-vf",
    "scale=-2:360,format=yuvj420p",
    "-q:v",
    "4",
    path.resolve(output),
  ]);
  if (r.code !== 0) throw new Error(`Candidate thumbnail failed (exit ${r.code}): ${tail(r.stderr)}`);
}
