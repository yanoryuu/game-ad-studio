import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import express from "express";
import cors from "cors";
import multer from "multer";
import { nanoid } from "nanoid";
import {
  SERVER_PORT,
  addSourceRequestSchema,
  createProjectRequestSchema,
  projectSchema,
  renderRequestSchema,
  type HealthResponse,
  type RenderStartResponse,
  type Source,
  type UploadAssetResponse,
} from "@gas/shared";
import { badRequest, errorHandler, notFound, notFoundHandler, parseBody } from "./errors";
import { sendFileWithRange, serveProjectFile } from "./files";
import { makeProxy, makeThumb, probe, toolAvailable } from "./media";
import { PROJECTS_DIR, projectDir } from "./paths";
import { enqueueRender, getJob } from "./render";
import {
  assertSafeId,
  createProject,
  listProjects,
  projectExists,
  readProject,
  updateProject,
  withProjectLock,
  writeProject,
} from "./store";

const app = express();
app.disable("x-powered-by");
// Headless Chrome (render, origin http://localhost:<random>) and Vite dev (:5173) read from here.
app.use(cors({ exposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length"] }));
app.use(express.json({ limit: "10mb" }));

/* ------------------------------------------------------------------ */
/* Health                                                               */
/* ------------------------------------------------------------------ */

app.get("/api/health", async (_req, res) => {
  const [ffmpeg, ffprobe] = await Promise.all([toolAvailable("ffmpeg"), toolAvailable("ffprobe")]);
  const body: HealthResponse = { ok: true, ffmpeg, ffprobe };
  res.json(body);
});

/* ------------------------------------------------------------------ */
/* Projects                                                             */
/* ------------------------------------------------------------------ */

app.get("/api/projects", async (_req, res) => {
  res.json(await listProjects());
});

app.post("/api/projects", async (req, res) => {
  const { name } = parseBody(createProjectRequestSchema, req.body);
  res.status(201).json(await createProject(name));
});

app.get("/api/projects/:id", async (req, res) => {
  res.json(await readProject(assertSafeId(req.params.id)));
});

app.put("/api/projects/:id", async (req, res) => {
  const id = assertSafeId(req.params.id);
  const body = parseBody(projectSchema, req.body, "project");
  const saved = await withProjectLock(id, async () => {
    const existing = await readProject(id); // 404 if missing
    // id (URL) and createdAt (stored) win; updatedAt is stamped by writeProject.
    return writeProject({ ...body, id, createdAt: existing.createdAt });
  });
  res.json(saved);
});

/* ------------------------------------------------------------------ */
/* Sources                                                              */
/* ------------------------------------------------------------------ */

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
 * Synchronous per ARCHITECTURE §6.1: responds once probe + proxy + thumbnail are done.
 * The encode runs in a child process, so the event loop (and all other requests) stay responsive.
 */
app.post("/api/projects/:id/sources", async (req, res) => {
  const id = assertSafeId(req.params.id);
  const { path: rawPath } = parseBody(addSourceRequestSchema, req.body);
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
  if (!(await projectExists(id))) throw notFound(`Project not found: ${id}`);

  let info;
  try {
    info = await probe(original);
  } catch (e) {
    throw badRequest(`Cannot read video: ${(e as Error).message}`);
  }

  const sourceId = `src_${nanoid(8)}`;
  const dir = projectDir(id);
  const proxyRel = `proxies/${sourceId}.mp4`;
  const thumbRel = `thumbs/${sourceId}.jpg`;
  const proxyAbs = path.join(dir, proxyRel);
  const thumbAbs = path.join(dir, thumbRel);
  await fsp.mkdir(path.dirname(proxyAbs), { recursive: true });
  await fsp.mkdir(path.dirname(thumbAbs), { recursive: true });

  const started = Date.now();
  console.log(`[sources] ${id}: probing ok (${info.width}x${info.height} @${info.fps}fps, ${info.durationSec.toFixed(1)}s, audio=${info.hasAudio}); encoding proxy ${sourceId} ...`);
  try {
    await withProxySlot(async () => {
      await makeProxy(original, proxyAbs, info);
      await makeThumb(original, thumbAbs, info.durationSec);
    });
  } catch (e) {
    await fsp.rm(proxyAbs, { force: true }).catch(() => {});
    await fsp.rm(thumbAbs, { force: true }).catch(() => {});
    throw e;
  }
  console.log(`[sources] ${id}: proxy ${sourceId} ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const source: Source = {
    id: sourceId,
    originalPath: original,
    proxyPath: proxyRel,
    thumbPath: thumbRel,
    durationSec: info.durationSec,
    fps: info.fps,
    width: info.width,
    height: info.height,
    hasAudio: info.hasAudio,
  };
  // Re-read under the lock so edits PUT while the proxy was encoding are kept.
  const project = await updateProject(id, (p) => {
    p.sources.push(source);
  });
  res.json(project);
});

app.get("/api/projects/:id/sources/:sourceId/original", async (req, res, next) => {
  const project = await readProject(assertSafeId(req.params.id));
  const source = project.sources.find((s) => s.id === req.params.sourceId);
  if (!source) throw notFound(`Source not found: ${req.params.sourceId}`);
  await sendFileWithRange(res, next, source.originalPath);
});

/* ------------------------------------------------------------------ */
/* Assets                                                               */
/* ------------------------------------------------------------------ */

const ASSET_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".mp3", ".wav", ".m4a", ".ogg"]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(projectDir(String(req.params.id)), "assets");
      fsp.mkdir(dir, { recursive: true }).then(
        () => cb(null, dir),
        (e: Error) => cb(e, dir),
      );
    },
    filename: (_req, file, cb) => cb(null, `${nanoid(10)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ASSET_EXTS.has(ext)) cb(null, true);
    else cb(badRequest(`Unsupported file type "${ext || file.originalname}". Allowed: ${[...ASSET_EXTS].join(", ")}`));
  },
});

app.post(
  "/api/projects/:id/assets",
  async (req, _res, next) => {
    const id = assertSafeId(String(req.params.id));
    if (!(await projectExists(id))) throw notFound(`Project not found: ${id}`);
    next();
  },
  upload.single("file"),
  (req, res) => {
    if (!req.file) throw badRequest('Missing multipart file field "file"');
    const body: UploadAssetResponse = { path: `assets/${req.file.filename}` };
    res.json(body);
  },
);

/* ------------------------------------------------------------------ */
/* Render                                                               */
/* ------------------------------------------------------------------ */

app.post("/api/projects/:id/render", async (req, res) => {
  const id = assertSafeId(req.params.id);
  const body = parseBody(renderRequestSchema, req.body);
  await readProject(id); // 404 early
  const jobId = enqueueRender(id, body);
  const out: RenderStartResponse = { jobId };
  res.json(out);
});

app.get("/api/render/:jobId", (req, res) => {
  res.json(getJob(req.params.jobId));
});

/* ------------------------------------------------------------------ */
/* Static project files                                                 */
/* ------------------------------------------------------------------ */

app.get("/files/:projectId/*path", serveProjectFile);

app.use(notFoundHandler);
app.use(errorHandler);

await fsp.mkdir(PROJECTS_DIR, { recursive: true });
const server = app.listen(SERVER_PORT, () => {
  console.log(`[server] listening on http://localhost:${SERVER_PORT} (projects: ${PROJECTS_DIR})`);
});
// Source registration responds only after the proxy encode; never time those requests out.
server.requestTimeout = 0;
server.timeout = 0;
