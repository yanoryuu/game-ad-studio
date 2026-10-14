import fsp from "node:fs/promises";
import path from "node:path";
import express from "express";
import cors from "cors";
import multer from "multer";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  SERVER_PORT,
  addSourceRequestSchema,
  createProjectRequestSchema,
  migrateProject,
  renderRequestSchema,
  type HealthResponse,
  type AddSourceResponse,
  type RenderStartResponse,
  type UploadAssetResponse,
} from "@gas/shared";
import { badRequest, errorHandler, notFound, notFoundHandler, parseBody } from "./errors";
import { sendFileWithRange, serveProjectFile } from "./files";
import { toolAvailable } from "./media";
import { PROJECTS_DIR, projectDir } from "./paths";
import { enqueueRender, getJob } from "./render";
import { registerAnalysisRoutes } from "./routes/analysis";
import { registerTtsRoutes } from "./routes/tts";
import { recoverInterruptedJobs, registerSource } from "./sources";
import {
  assertSafeId,
  createProject,
  listProjects,
  mergeServerOwned,
  projectExists,
  readProject,
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
  let body;
  try {
    body = migrateProject(req.body); // accepts v2 (and tolerates v1) bodies
  } catch (e) {
    throw badRequest(`Invalid project: ${e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message}`);
  }
  const saved = await withProjectLock(id, async () => {
    const existing = await readProject(id); // 404 if missing
    // id (URL) and createdAt (stored) win; updatedAt is stamped by writeProject.
    // Server-owned fields (source status, candidates, fresh TTS results) are merged from the stored copy.
    return writeProject(mergeServerOwned(existing, { ...body, id, createdAt: existing.createdAt }));
  });
  res.json(saved);
});

/* ------------------------------------------------------------------ */
/* Sources                                                              */
/* ------------------------------------------------------------------ */

app.post("/api/projects/:id/sources", async (req, res) => {
  const id = assertSafeId(req.params.id);
  const { path: rawPath } = parseBody(addSourceRequestSchema, req.body);
  const project: AddSourceResponse = await registerSource(id, rawPath);
  res.status(201).json(project);
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

const ASSET_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".mp3", ".wav", ".m4a", ".ogg", ".aac"]);

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

/* ------------------------------------------------------------------ */
/* Phase 2 route modules (owned by server-highlight / server-tts)       */
/* ------------------------------------------------------------------ */

registerAnalysisRoutes(app);
registerTtsRoutes(app);

app.use(notFoundHandler);
app.use(errorHandler);

await fsp.mkdir(PROJECTS_DIR, { recursive: true });
await recoverInterruptedJobs();
const server = app.listen(SERVER_PORT, () => {
  console.log(`[server] listening on http://localhost:${SERVER_PORT} (projects: ${PROJECTS_DIR})`);
});
// TTS synthesis requests can take a while; never time requests out.
server.requestTimeout = 0;
server.timeout = 0;
