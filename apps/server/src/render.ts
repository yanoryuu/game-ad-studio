import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { type Format, type Fps, type Lang, type Project, type RenderJob } from "@gas/shared";
// type-only: importing the compositions package at runtime would pull React/fonts into the server process
import type { AdVideoProps } from "@gas/compositions";
import { notFound } from "./errors";
import { BROWSER_EXECUTABLE, BUNDLE_WATCH_DIRS, COMPOSITIONS_ENTRY, LISTEN_PORT, projectDir } from "./paths";
import { readProject } from "./store";

/** Must equal COMPOSITION_ID exported by @gas/compositions (kept literal to avoid a runtime import). */
const COMPOSITION_ID = "AdVideo";
const ASSET_BASE_URL = `http://localhost:${LISTEN_PORT}`;
const MAX_KEPT_JOBS = 200;

type JobInternal = RenderJob & { fps?: Fps; createdAtMs: number };

const jobs = new Map<string, JobInternal>();
const queue: string[] = [];
let running = false;

/* ------------------------------------------------------------------ */
/* Bundle cache                                                         */
/* ------------------------------------------------------------------ */

let cachedBundle: { serveUrl: string; builtAt: number } | null = null;
let bundling: Promise<string> | null = null;

async function newestMtime(dir: string): Promise<number> {
  let max = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) max = Math.max(max, await newestMtime(p));
    else if (e.isFile()) {
      try {
        max = Math.max(max, (await fsp.stat(p)).mtimeMs);
      } catch {
        /* deleted meanwhile */
      }
    }
  }
  return max;
}

/** Returns a cached serveUrl; rebundles when packages/compositions/src or packages/shared/src changed. */
async function getServeUrl(): Promise<string> {
  if (bundling) return bundling;
  let srcMtime = 0;
  for (const d of BUNDLE_WATCH_DIRS) srcMtime = Math.max(srcMtime, await newestMtime(d));
  if (cachedBundle && srcMtime <= cachedBundle.builtAt) return cachedBundle.serveUrl;

  bundling = (async () => {
    const started = Date.now();
    console.log(`[render] bundling ${COMPOSITIONS_ENTRY} ...`);
    const serveUrl = await bundle({ entryPoint: COMPOSITIONS_ENTRY });
    console.log(`[render] bundle ready in ${((Date.now() - started) / 1000).toFixed(1)}s: ${serveUrl}`);
    const old = cachedBundle;
    cachedBundle = { serveUrl, builtAt: started };
    if (old && old.serveUrl !== serveUrl) void fsp.rm(old.serveUrl, { recursive: true, force: true }).catch(() => {});
    return serveUrl;
  })();
  try {
    return await bundling;
  } finally {
    bundling = null;
  }
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                 */
/* ------------------------------------------------------------------ */

function publicJob(j: JobInternal): RenderJob {
  const out: RenderJob = {
    jobId: j.jobId,
    projectId: j.projectId,
    format: j.format,
    lang: j.lang,
    status: j.status,
    progress: j.progress,
  };
  if (j.outputPath) {
    out.outputPath = j.outputPath;
    out.absPath = path.join(projectDir(j.projectId), j.outputPath);
  }
  if (j.error) out.error = j.error;
  if (j.createdAt) out.createdAt = j.createdAt;
  return out;
}

/** v3: this project's jobs known in memory (all statuses), newest first. */
export function listProjectJobs(projectId: string): RenderJob[] {
  // Map iteration = insertion (queue) order; reversed = newest first (stable for jobs queued in one batch)
  return [...jobs.values()]
    .filter((j) => j.projectId === projectId)
    .reverse()
    .map(publicJob);
}

export function getJob(jobId: string): RenderJob {
  const j = jobs.get(jobId);
  if (!j) throw notFound(`Render job not found: ${jobId}`);
  return publicJob(j);
}

function pruneJobs() {
  if (jobs.size <= MAX_KEPT_JOBS) return;
  const finished = [...jobs.values()]
    .filter((j) => j.status === "done" || j.status === "error")
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
  for (const j of finished.slice(0, jobs.size - MAX_KEPT_JOBS)) jobs.delete(j.jobId);
}

export function enqueueRender(projectId: string, opts: { format: Format; lang: Lang; fps?: Fps }): string {
  const jobId = `job_${nanoid(10)}`;
  const job: JobInternal = {
    jobId,
    projectId,
    format: opts.format,
    lang: opts.lang,
    status: "queued",
    progress: 0,
    createdAtMs: Date.now(),
    createdAt: new Date().toISOString(),
    ...(opts.fps ? { fps: opts.fps } : {}),
  };
  jobs.set(jobId, job);
  queue.push(jobId);
  pruneJobs();
  void pump();
  return jobId;
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const job = jobs.get(id);
      if (!job) continue;
      try {
        await runJob(job);
      } catch (e) {
        job.status = "error";
        job.error = e instanceof Error ? e.message : String(e);
        console.error(`[render] ${job.jobId} failed:`, e);
      }
    }
  } finally {
    running = false;
  }
}

function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Fail early with a readable message instead of a Chrome/compositor error deep in the render. */
function checkSources(project: Project) {
  const used = new Set(project.clips.map((c) => c.sourceId));
  for (const s of project.sources) {
    if (used.has(s.id) && !fs.existsSync(s.originalPath)) {
      throw new Error(`Original video of source ${s.id} not found: ${s.originalPath}`);
    }
  }
}

async function runJob(job: JobInternal): Promise<void> {
  const started = Date.now();
  // Snapshot the project when the job starts (picks up the latest saved edits).
  const loaded = await readProject(job.projectId);
  const project: Project = job.fps ? { ...structuredClone(loaded), fps: job.fps } : loaded;
  checkSources(project);

  job.status = "bundling";
  job.progress = 0;
  const serveUrl = await getServeUrl();

  const inputProps: AdVideoProps = {
    project,
    format: job.format,
    lang: job.lang,
    assetBaseUrl: ASSET_BASE_URL,
    useProxy: false,
  };

  const rendersDir = path.join(projectDir(job.projectId), "renders");
  await fsp.mkdir(rendersDir, { recursive: true });
  const base = `${timestamp()}_${job.format.replace(":", "x")}_${job.lang}`;
  let name = `${base}.mp4`;
  for (let i = 2; fs.existsSync(path.join(rendersDir, name)); i++) name = `${base}-${i}.mp4`;
  const outputLocation = path.join(rendersDir, name);

  job.status = "rendering";
  const browserExecutable = fs.existsSync(BROWSER_EXECUTABLE) ? BROWSER_EXECUTABLE : null;
  if (!browserExecutable) console.warn(`[render] browser not found at ${BROWSER_EXECUTABLE}; Remotion will resolve/download one`);

  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps,
    browserExecutable,
    logLevel: "warn",
  });
  console.log(
    `[render] ${job.jobId} ${job.projectId} ${job.format} ${job.lang}: ${composition.width}x${composition.height} @${composition.fps}fps, ${composition.durationInFrames} frames`,
  );

  let lastLogged = -1;
  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation,
      inputProps,
      browserExecutable,
      logLevel: "warn",
      timeoutInMilliseconds: 120_000,
      onProgress: ({ progress }) => {
        job.progress = Math.min(1, Math.max(0, progress));
        const pct = Math.floor(progress * 10);
        if (pct !== lastLogged) {
          lastLogged = pct;
          console.log(`[render] ${job.jobId} ${Math.round(progress * 100)}%`);
        }
      },
    });
  } catch (e) {
    await fsp.rm(outputLocation, { force: true }).catch(() => {});
    throw e;
  }

  job.outputPath = `renders/${name}`;
  job.progress = 1;
  job.status = "done";
  console.log(`[render] ${job.jobId} done in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${job.outputPath}`);
}
