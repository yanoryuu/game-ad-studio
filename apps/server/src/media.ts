import { spawn } from "node:child_process";
import { IMAGE_EXTS } from "@gas/shared";

/* ------------------------------------------------------------------ */
/* Process helpers (spawn, no shell, argument arrays)                  */
/* ------------------------------------------------------------------ */

type RunResult = { code: number | null; stdout: string; stderr: string };

function run(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString("utf8");
      // keep only the tail; ffmpeg can be chatty on long inputs
      if (err.length > 64_000) err = err.slice(-32_000);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: err }));
  });
}

function lastLines(s: string, n = 6): string {
  return s.trim().split(/\r?\n/).slice(-n).join("\n");
}

async function runOrThrow(cmd: string, args: string[], what: string): Promise<RunResult> {
  let r: RunResult;
  try {
    r = await run(cmd, args);
  } catch (e) {
    throw new Error(`${what}: could not start ${cmd} (${(e as Error).message}). Is it on PATH?`);
  }
  if (r.code !== 0) throw new Error(`${what} failed (exit ${r.code}): ${lastLines(r.stderr)}`);
  return r;
}

const toolCache = new Map<string, { ok: boolean; at: number }>();

/** true if `<tool> -version` runs. Cached for 60s. */
export async function toolAvailable(tool: "ffmpeg" | "ffprobe"): Promise<boolean> {
  const c = toolCache.get(tool);
  if (c && Date.now() - c.at < 60_000) return c.ok;
  let ok = false;
  try {
    ok = (await run(tool, ["-version"])).code === 0;
  } catch {
    ok = false;
  }
  toolCache.set(tool, { ok, at: Date.now() });
  return ok;
}

/* ------------------------------------------------------------------ */
/* ffprobe                                                              */
/* ------------------------------------------------------------------ */

export type ProbeResult = {
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  hasAudio: boolean;
  /** absolute stream index of the video stream used for the proxy */
  videoStreamIndex: number;
  /** absolute stream index of the first audio stream, if any */
  audioStreamIndex?: number;
};

type FfprobeStream = {
  index: number;
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
};

function parseRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [n, d] = rate.split("/").map(Number);
  const v = d ? n! / d : Number(n);
  return Number.isFinite(v) && v > 0 && v < 1000 ? v : 0;
}

export async function probe(file: string): Promise<ProbeResult> {
  const r = await runOrThrow(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file],
    "ffprobe",
  );
  const json = JSON.parse(r.stdout) as { streams?: FfprobeStream[]; format?: { duration?: string; format_name?: string } };
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!video || !video.width || !video.height) throw new Error("No video stream found in file");
  const formatName = json.format?.format_name ?? "";
  if (/image2|_pipe$/.test(formatName)) throw new Error(`Still images must use an image extension (${IMAGE_EXTS.join(" ")}) to be registered (format: ${formatName})`);
  const audio = streams.find((s) => s.codec_type === "audio");
  // avg_frame_rate is more meaningful for VFR game captures; fall back to r_frame_rate
  const fps = Math.round((parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 30) * 1000) / 1000;
  const durationSec = Number(json.format?.duration ?? video.duration ?? 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("Could not determine a positive duration");
  return {
    durationSec,
    fps,
    width: video.width,
    height: video.height,
    hasAudio: !!audio,
    videoStreamIndex: video.index,
    ...(audio ? { audioStreamIndex: audio.index } : {}),
  };
}

/** Verifies that `file` is a readable still image; returns its size. */
export async function probeImage(file: string): Promise<{ width: number; height: number }> {
  const r = await runOrThrow(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file],
    "ffprobe",
  );
  const json = JSON.parse(r.stdout) as { streams?: FfprobeStream[]; format?: { format_name?: string } };
  const video = (json.streams ?? []).find((s) => s.codec_type === "video");
  if (!video || !video.width || !video.height) throw new Error("No image found in file");
  const formatName = json.format?.format_name ?? "";
  if (!/image2|_pipe$/.test(formatName)) throw new Error(`Not a still image (format: ${formatName})`);
  return { width: video.width, height: video.height };
}

/* ------------------------------------------------------------------ */
/* Native image source: preview still + thumbnail                       */
/* ------------------------------------------------------------------ */

/** Longest side of an image source's preview still (proxies/<id>.webp). */
export const IMAGE_PROXY_MAX_PX = 1280;

/**
 * Preview still of an image source: WebP (alpha kept), longest side <= IMAGE_PROXY_MAX_PX (never upscaled).
 * Rendering always uses the full-resolution image; this only keeps the browser preview light.
 */
export async function makeImageProxy(input: string, output: string): Promise<void> {
  const m = IMAGE_PROXY_MAX_PX;
  await runOrThrow(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      `scale='min(${m},iw)':'min(${m},ih)':force_original_aspect_ratio=decrease:flags=lanczos,format=rgba`,
      "-c:v",
      "libwebp",
      "-quality",
      "90",
      "-map_metadata",
      "-1",
      output,
    ],
    "Image preview generation",
  );
}

/** 360 px high jpg thumbnail of an image source (transparent areas become dark gray). */
export async function makeImageThumb(input: string, output: string): Promise<void> {
  await runOrThrow(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      input,
      "-f",
      "lavfi",
      "-i",
      "color=c=0x22252c:s=16x16",
      "-filter_complex",
      "[0:v]scale=-2:360:flags=lanczos,format=rgba[fg];[1:v][fg]scale2ref[bg][fg2];[bg][fg2]overlay=format=auto,format=yuvj420p[v]",
      "-map",
      "[v]",
      "-frames:v",
      "1",
      "-q:v",
      "3",
      output,
    ],
    "Thumbnail generation",
  );
}

/* ------------------------------------------------------------------ */
/* Proxy / thumbnail                                                    */
/* ------------------------------------------------------------------ */

/** 720p (never upscaled, even height) / 30fps / H.264 + AAC, faststart. */
export async function makeProxy(input: string, output: string, info: ProbeResult): Promise<void> {
  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    input,
    "-map",
    `0:${info.videoStreamIndex}`,
    ...(info.audioStreamIndex !== undefined ? ["-map", `0:${info.audioStreamIndex}`] : []),
    "-vf",
    "scale=-2:'min(720,trunc(ih/2)*2)',fps=30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    ...(info.audioStreamIndex !== undefined
      ? ["-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000"]
      : ["-an"]),
    "-sn",
    "-dn",
    "-map_metadata",
    "-1",
    "-movflags",
    "+faststart",
    output,
  ];
  await runOrThrow("ffmpeg", args, "Proxy generation");
}

export async function makeThumb(input: string, output: string, durationSec: number): Promise<void> {
  const ss = Math.max(0, Math.min(1, durationSec / 2));
  await runOrThrow(
    "ffmpeg",
    ["-hide_banner", "-nostdin", "-y", "-ss", ss.toFixed(3), "-i", input, "-frames:v", "1", "-vf", "scale=-2:360,format=yuvj420p", "-q:v", "3", output],
    "Thumbnail generation",
  );
}
