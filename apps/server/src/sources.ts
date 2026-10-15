import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { IMAGE_EXTS, IMAGE_MAX_CLIP_SEC, isStillImageSource, type Project, type Source } from "@gas/shared";
import { badRequest, notFound } from "./errors";
import { makeImageProxy, makeImageThumb, makeProxy, makeThumb, probe, probeImage, type ProbeResult } from "./media";
import { PROJECTS_DIR, projectDir } from "./paths";
import { projectExists, readProject, updateProject } from "./store";

/** Limits concurrent proxy encodes (each ffmpeg already uses all cores). */
const MAX_PARALLEL_PROXIES = 2;
let activeProxies = 0;
const proxyWaiters: (() => void)[] = [];
async function withProxySlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeProxies >= MAX_PARALLEL_PROXIES) await new Promise<void>((r) => proxyWaiters.push(r));
  activeProxies++;
  try {
    return await fn();
  } finally {
    activeProxies--;
    proxyWaiters.shift()?.();
  }
}

/** projects/<id>/media: uploaded sources + image sources' images (+ legacy still videos); deleted with the source. */
export function mediaDir(projectId: string): string {
  return path.join(projectDir(projectId), "media");
}

/** true if `file` is strictly inside `dir` (both resolved; case-insensitive like the Windows file system). */
function isInside(dir: string, file: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

const isImagePath = (p: string) => (IMAGE_EXTS as readonly string[]).includes(path.extname(p).toLowerCase());

/** An image source's image (copied / moved input): media/<sourceId>-image<ext>; its imagePath. */
const IMAGE_COPY_INFIX = "-image";

/**
 * POST /api/projects/:id/sources (v2, async):
 * validates + ffprobes synchronously, appends the source with proxyStatus "pending", returns the project.
 * The proxy + thumbnail encode runs in the background and flips proxyStatus to "ready" / "error".
 */
export async function registerSource(projectId: string, rawPath: string, opts: { name?: string } = {}): Promise<Project> {
  const inputPath = rawPath.trim().replace(/^"(.*)"$/, "$1"); // tolerate "Copy as path" quotes
  if (!path.isAbsolute(inputPath)) throw badRequest(`path must be absolute: ${inputPath}`);
  const original = path.resolve(inputPath);
  let st: fs.Stats;
  try {
    st = await fsp.stat(original);
  } catch {
    throw badRequest(`File not found: ${original}`);
  }
  if (!st.isFile()) throw badRequest(`Not a file: ${original}`);
  if (!(await projectExists(projectId))) throw notFound(`Project not found: ${projectId}`);
  // display name: the uploaded file's original name, or the image's file name (it is copied to media/)
  const name = opts.name?.trim() || (isImagePath(original) ? path.basename(original) : undefined);
  if (isImagePath(original)) return registerImageSource(projectId, original, name);

  let info: ProbeResult;
  try {
    info = await probe(original);
  } catch (e) {
    throw badRequest(`Cannot read video: ${(e as Error).message}`);
  }

  const sourceId = `src_${nanoid(8)}`;
  const source: Source = {
    id: sourceId,
    originalPath: original,
    ...(name ? { name } : {}),
    proxyPath: `proxies/${sourceId}.mp4`,
    thumbPath: `thumbs/${sourceId}.jpg`,
    durationSec: info.durationSec,
    fps: info.fps,
    width: info.width,
    height: info.height,
    hasAudio: info.hasAudio,
    proxyStatus: "pending",
    analysisStatus: "none",
  };
  const project = await updateProject(projectId, (p) => {
    p.sources.push(source);
  });
  console.log(
    `[sources] ${projectId}: registered ${sourceId} (${info.width}x${info.height} @${info.fps}fps, ${info.durationSec.toFixed(1)}s, audio=${info.hasAudio}); proxy queued`,
  );
  void encodeInBackground(projectId, source, info);
  return project;
}

/**
 * Native image source (no video conversion): validated + sized synchronously, the image is kept as
 * media/<sourceId>-image<ext> (moved when it was uploaded into this project's media dir, copied otherwise)
 * and registered with imagePath = that asset ref, originalPath = its absolute path,
 * durationSec = IMAGE_MAX_CLIP_SEC, the image's own width/height, 30 fps, no audio, proxyStatus "pending".
 * The background job only writes the small preview still (proxies/<id>.webp) + thumbnail (well under 1 s).
 */
async function registerImageSource(projectId: string, original: string, name: string | undefined): Promise<Project> {
  let size: { width: number; height: number };
  try {
    size = await probeImage(original);
  } catch (e) {
    throw badRequest(`Cannot read image: ${(e as Error).message}`);
  }
  const sourceId = `src_${nanoid(8)}`;
  const media = mediaDir(projectId);
  await fsp.mkdir(media, { recursive: true });
  const fileName = `${sourceId}${IMAGE_COPY_INFIX}${path.extname(original).toLowerCase()}`;
  const imageCopy = path.join(media, fileName);
  if (isInside(media, original)) await fsp.rename(original, imageCopy);
  else await fsp.copyFile(original, imageCopy);

  const source: Source = {
    id: sourceId,
    originalPath: imageCopy,
    kind: "image",
    ...(name ? { name } : {}),
    imagePath: `media/${fileName}`,
    proxyPath: `proxies/${sourceId}.webp`,
    thumbPath: `thumbs/${sourceId}.jpg`,
    durationSec: IMAGE_MAX_CLIP_SEC,
    fps: 30,
    width: size.width,
    height: size.height,
    hasAudio: false,
    proxyStatus: "pending",
    analysisStatus: "none",
  };
  let project: Project;
  try {
    project = await updateProject(projectId, (p) => {
      p.sources.push(source);
    });
  } catch (e) {
    await fsp.rm(imageCopy, { force: true }).catch(() => {});
    throw e;
  }
  console.log(`[sources] ${projectId}: registered image ${sourceId} (${size.width}x${size.height}, native still); preview queued`);
  void encodeInBackground(projectId, source);
  return project;
}

/** media/<sourceId>-image.* of an image source, or undefined. */
async function findImageCopy(projectId: string, sourceId: string): Promise<string | undefined> {
  const media = mediaDir(projectId);
  const names = await fsp.readdir(media).catch(() => [] as string[]);
  const name = names.find((n) => n.startsWith(`${sourceId}${IMAGE_COPY_INFIX}.`) && isImagePath(n));
  return name ? path.join(media, name) : undefined;
}

/**
 * Startup recovery of a LEGACY image source (kind "image", no imagePath) whose still mp4 was never finished:
 * the mp4 is no longer generated, so it is turned into a native image source when its kept image exists.
 * Returns the upgraded source (also stored), or undefined (left as is -> the proxy job reports the error).
 */
async function upgradeLegacyImageSource(projectId: string, source: Source): Promise<Source | undefined> {
  if (await fsp.stat(source.originalPath).then((st) => st.isFile(), () => false)) return undefined;
  const image = await findImageCopy(projectId, source.id);
  if (!image) return undefined;
  let size: { width: number; height: number };
  try {
    size = await probeImage(image);
  } catch {
    return undefined;
  }
  const patch: Partial<Source> = {
    originalPath: image,
    imagePath: `media/${path.basename(image)}`,
    proxyPath: `proxies/${source.id}.webp`,
    durationSec: IMAGE_MAX_CLIP_SEC,
    width: size.width,
    height: size.height,
  };
  await updateProject(projectId, (p) => {
    const s = p.sources.find((x) => x.id === source.id);
    if (s) Object.assign(s, patch);
  });
  console.log(`[sources] ${projectId}: legacy image source ${source.id} upgraded to a native image source`);
  return { ...source, ...patch };
}

/**
 * Deletes the files of removed sources that live in the project's media dir (best effort): an uploaded
 * original / generated still video (originalPath) and an image source's kept image. Never touches
 * anything outside projects/<id>/media.
 */
export async function removeSourceMedia(projectId: string, sources: readonly Source[]): Promise<void> {
  if (sources.length === 0) return;
  const media = mediaDir(projectId);
  const names = await fsp.readdir(media).catch(() => [] as string[]);
  for (const s of sources) {
    const files = new Set<string>();
    if (isInside(media, s.originalPath)) files.add(path.resolve(s.originalPath));
    for (const n of names) {
      if (n.startsWith(`${s.id}${IMAGE_COPY_INFIX}.`) || n === `${s.id}.partial.mp4`) files.add(path.join(media, n));
    }
    for (const f of files) {
      if (!isInside(media, f)) continue;
      try {
        await fsp.rm(f, { force: true });
        console.log(`[sources] ${projectId}: removed media file ${path.basename(f)} of ${s.id}`);
      } catch (e) {
        console.warn(`[sources] ${projectId}: could not remove ${f}: ${(e as Error).message}`);
      }
    }
  }
}

async function encodeInBackground(projectId: string, source: Source, known?: ProbeResult): Promise<void> {
  const dir = projectDir(projectId);
  const proxyAbs = path.join(dir, source.proxyPath);
  const thumbAbs = path.join(dir, source.thumbPath);
  const started = Date.now();
  let error: string | undefined;
  try {
    await fsp.mkdir(path.dirname(proxyAbs), { recursive: true });
    await fsp.mkdir(path.dirname(thumbAbs), { recursive: true });
    if (isStillImageSource(source)) {
      // native image: a light preview still + thumbnail, no video encode (does not wait for a proxy slot)
      await makeImageProxy(source.originalPath, proxyAbs);
      await makeImageThumb(source.originalPath, thumbAbs);
    } else {
      await withProxySlot(async () => {
        const info = known ?? (await probe(source.originalPath));
        await makeProxy(source.originalPath, proxyAbs, info);
        await makeThumb(source.originalPath, thumbAbs, info.durationSec);
      });
    }
    console.log(`[sources] ${projectId}: proxy ${source.id} ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error(`[sources] ${projectId}: proxy ${source.id} failed: ${error}`);
    await fsp.rm(proxyAbs, { force: true }).catch(() => {});
    await fsp.rm(thumbAbs, { force: true }).catch(() => {});
  }
  let gone = false;
  try {
    await updateProject(projectId, (p) => {
      const s = p.sources.find((x) => x.id === source.id);
      if (!s) {
        gone = true; // source deleted meanwhile
        return;
      }
      if (error === undefined) {
        s.proxyStatus = "ready";
        delete s.proxyError;
      } else {
        s.proxyStatus = "error";
        s.proxyError = error;
      }
    });
  } catch (e) {
    // project deleted meanwhile, etc.
    console.warn(`[sources] ${projectId}: could not store proxy status of ${source.id}: ${(e as Error).message}`);
  }
  // removed while encoding: the PUT's cleanup may have run before the files existed
  if (gone) await removeSourceMedia(projectId, [source]);
}

/**
 * Startup recovery: re-queues proxies left "pending" by a previous server process and marks
 * analyses left "running" as "error" (the job died with the process).
 */
export async function recoverInterruptedJobs(): Promise<void> {
  let names: string[];
  try {
    names = await fsp.readdir(PROJECTS_DIR);
  } catch {
    return;
  }
  for (const id of names) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;
    let p: Project;
    try {
      p = await readProject(id);
    } catch {
      continue;
    }
    const pending = p.sources.filter((s) => s.proxyStatus === "pending");
    const running = p.sources.filter((s) => s.analysisStatus === "running");
    const bgmRunning = p.audio.bgm?.analysisStatus === "running" || p.audio.bgm?.voiceCarveStatus === "running";
    if (running.length || bgmRunning) {
      await updateProject(id, (q) => {
        for (const s of q.sources) {
          if (s.analysisStatus === "running") {
            s.analysisStatus = "error";
            s.analysisError = "Interrupted (server restarted)";
          }
        }
        // v3: BGM beat analysis (routes/bgm.ts)
        if (q.audio.bgm?.analysisStatus === "running") {
          q.audio.bgm.analysisStatus = "error";
          q.audio.bgm.analysisError = "Interrupted (server restarted)";
        }
        // Voice carve (§5.3.1): forget the interrupted run (status absent) so the web starts it again.
        if (q.audio.bgm?.voiceCarveStatus === "running") delete q.audio.bgm.voiceCarveStatus;
      }).catch(() => {});
    }
    for (const s0 of pending) {
      let s = s0;
      if (s.kind === "image" && !s.imagePath) s = (await upgradeLegacyImageSource(id, s).catch(() => undefined)) ?? s;
      console.log(`[sources] ${id}: re-queueing interrupted proxy ${s.id}`);
      void encodeInBackground(id, s);
    }
  }
}
