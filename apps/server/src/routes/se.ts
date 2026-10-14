import path from "node:path";
import type { Express } from "express";
import multer from "multer";
import { SE_EXTS, SE_UPLOAD_MAX_BYTES, seManifestUpdateRequestSchema, type SeListResponse } from "@gas/shared";
import { badRequest, parseBody } from "../errors";
import { sendFileWithRange } from "../files";
import { ensurePlaceholders } from "../se/placeholders";
import {
  clearSeCache,
  ensureManifest,
  listSeLibrary,
  resolveSeFile,
  sanitizeSeFileName,
  saveSeUpload,
  seDir,
  updateManifestCredits,
} from "../se/library";

/**
 * SE library routes (owner after step 1: server agent; implementation in src/se/**). ARCHITECTURE §6.12.
 *
 *   GET  /api/se              -> SeListResponse (library files incl. _placeholder/, durations, credits from se.json)
 *   POST /api/se/rescan       -> SeListResponse (clears the duration cache, regenerates missing placeholders)
 *   PUT  /api/se/manifest     SeManifestUpdateRequest { credits: { <id>: "<credit>" | "" } } -> SeListResponse
 *   GET  /api/se/file/*path   the audio file (Range, no-cache), path-safe inside the library dir
 *   POST /api/se/upload       multipart "file" (SE_EXTS, ≤ 50 MB) -> copied into the library root -> SeListResponse
 */

/** In memory (≤ 50 MB), then written with an exclusive flag so name collisions get " (2)" etc. */
const seUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SE_UPLOAD_MAX_BYTES, files: 1 },
  defParamCharset: "utf8", // browsers send UTF-8 file names (Japanese)
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ((SE_EXTS as readonly string[]).includes(ext)) cb(null, true);
    else cb(badRequest(`Unsupported SE file type "${ext || file.originalname}". Allowed: ${SE_EXTS.join(", ")}`));
  },
});

/** Startup: create the library dir's placeholders + se.json when missing (background, never throws). */
export async function initSeLibrary(): Promise<void> {
  await ensurePlaceholders(seDir());
  await ensureManifest();
}

export function registerSeRoutes(app: Express): void {
  app.get("/api/se", async (_req, res) => {
    const body: SeListResponse = await listSeLibrary();
    res.json(body);
  });

  app.post("/api/se/rescan", async (_req, res) => {
    clearSeCache();
    await initSeLibrary();
    const body: SeListResponse = await listSeLibrary();
    res.json(body);
  });

  app.put("/api/se/manifest", async (req, res) => {
    const { credits } = parseBody(seManifestUpdateRequestSchema, req.body);
    await updateManifestCredits(credits);
    const body: SeListResponse = await listSeLibrary();
    res.json(body);
  });

  app.post("/api/se/upload", seUpload.single("file"), async (req, res) => {
    if (!req.file) throw badRequest('Missing multipart file field "file"');
    const id = await saveSeUpload(sanitizeSeFileName(req.file.originalname), req.file.buffer);
    console.log(`[se] uploaded "${req.file.originalname}" -> ${id}`);
    clearSeCache();
    const body: SeListResponse = await listSeLibrary();
    res.json(body);
  });

  app.get("/api/se/file/*path", async (req, res, next) => {
    const raw = (req.params as Record<string, unknown>).path;
    const segments = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split("/") : [];
    const abs = resolveSeFile(segments.join("/"));
    // library files may be replaced under the same name -> always revalidate
    await sendFileWithRange(res, next, abs, { cacheControl: "no-cache" });
  });
}
