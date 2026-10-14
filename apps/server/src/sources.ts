import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Project, Source } from "@gas/shared";
import { badRequest, notFound } from "./errors";
import { makeProxy, makeThumb, probe, type ProbeResult } from "./media";
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

/**
 * POST /api/projects/:id/sources (v2, async):
 * validates + ffprobes synchronously, appends the source with proxyStatus "pending", returns the project.
 * The proxy + thumbnail encode runs in the background and flips proxyStatus to "ready" / "error".
 */
export async function registerSource(projectId: string, rawPath: string): Promise<Project> {
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

async function encodeInBackground(projectId: string, source: Source, known?: ProbeResult): Promise<void> {
  const dir = projectDir(projectId);
  const proxyAbs = path.join(dir, source.proxyPath);
  const thumbAbs = path.join(dir, source.thumbPath);
  const started = Date.now();
  let error: string | undefined;
  try {
    await fsp.mkdir(path.dirname(proxyAbs), { recursive: true });
    await fsp.mkdir(path.dirname(thumbAbs), { recursive: true });
    const info = known ?? (await probe(source.originalPath));
    await withProxySlot(async () => {
      await makeProxy(source.originalPath, proxyAbs, info);
      await makeThumb(source.originalPath, thumbAbs, info.durationSec);
    });
    console.log(`[sources] ${projectId}: proxy ${source.id} ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error(`[sources] ${projectId}: proxy ${source.id} failed: ${error}`);
    await fsp.rm(proxyAbs, { force: true }).catch(() => {});
    await fsp.rm(thumbAbs, { force: true }).catch(() => {});
  }
  try {
    await updateProject(projectId, (p) => {
      const s = p.sources.find((x) => x.id === source.id);
      if (!s) return; // source deleted meanwhile
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
    const bgmRunning = p.audio.bgm?.analysisStatus === "running";
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
      }).catch(() => {});
    }
    for (const s of pending) {
      console.log(`[sources] ${id}: re-queueing interrupted proxy ${s.id}`);
      void encodeInBackground(id, s);
    }
  }
}
