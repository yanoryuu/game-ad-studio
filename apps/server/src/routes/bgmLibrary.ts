import path from "node:path";
import type { Express } from "express";
import multer from "multer";
import { BGM_EXTS, BGM_UPLOAD_MAX_BYTES, bgmManifestUpdateRequestSchema, type BgmListResponse } from "@gas/shared";
import { badRequest, parseBody } from "../errors";
import { sendFileWithRange } from "../files";
import {
  clearBgmCache,
  initBgmLibrary,
  listBgmLibrary,
  resolveBgmFile,
  sanitizeBgmFileName,
  saveBgmUpload,
  updateBgmManifest,
} from "../bgm/library";

/**
 * BGM library routes (ARCHITECTURE §6.14; implementation in src/bgm/library.ts). Modeled on routes/se.ts.
 *
 *   GET  /api/bgm              -> BgmListResponse (tracks, durations, bgm.json metadata)
 *   POST /api/bgm/rescan       -> BgmListResponse (clears the duration cache, creates dir / bgm.json if missing)
 *   PUT  /api/bgm/manifest     BgmManifestUpdateRequest { files: { <id>: { credit?, source?, url?, tags?, note? } } }
 *   POST /api/bgm/upload       multipart "file" (BGM_EXTS, ≤ 100 MB) -> copied into the library root -> BgmListResponse
 *   GET  /api/bgm/file/*path   the audio file (Range, no-cache) for previews
 * Taking a track into a project: POST /api/projects/:id/bgm/from-library (routes/bgm.ts).
 */

const bgmUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: BGM_UPLOAD_MAX_BYTES, files: 1 },
  defParamCharset: "utf8",
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ((BGM_EXTS as readonly string[]).includes(ext)) cb(null, true);
    else cb(badRequest(`Unsupported BGM file type "${ext || file.originalname}". Allowed: ${BGM_EXTS.join(", ")}`));
  },
});

export { initBgmLibrary };

export function registerBgmLibraryRoutes(app: Express): void {
  app.get("/api/bgm", async (_req, res) => {
    const body: BgmListResponse = await listBgmLibrary();
    res.json(body);
  });

  app.post("/api/bgm/rescan", async (_req, res) => {
    clearBgmCache();
    await initBgmLibrary();
    const body: BgmListResponse = await listBgmLibrary();
    res.json(body);
  });

  app.put("/api/bgm/manifest", async (req, res) => {
    const { files } = parseBody(bgmManifestUpdateRequestSchema, req.body);
    await updateBgmManifest(files);
    const body: BgmListResponse = await listBgmLibrary();
    res.json(body);
  });

  app.post("/api/bgm/upload", bgmUpload.single("file"), async (req, res) => {
    if (!req.file) throw badRequest('Missing multipart file field "file"');
    const id = await saveBgmUpload(sanitizeBgmFileName(req.file.originalname), req.file.buffer);
    console.log(`[bgm] uploaded "${req.file.originalname}" -> ${id}`);
    clearBgmCache();
    const body: BgmListResponse = await listBgmLibrary();
    res.json(body);
  });

  app.get("/api/bgm/file/*path", async (req, res, next) => {
    const raw = (req.params as Record<string, unknown>).path;
    const segments = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split("/") : [];
    const abs = resolveBgmFile(segments.join("/"));
    await sendFileWithRange(res, next, abs, { cacheControl: "no-cache" });
  });
}
