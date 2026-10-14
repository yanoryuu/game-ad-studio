import type { Express } from "express";
import { seManifestUpdateRequestSchema, type SeListResponse } from "@gas/shared";
import { parseBody } from "../errors";
import { sendFileWithRange } from "../files";
import { ensurePlaceholders } from "../se/placeholders";
import {
  clearSeCache,
  ensureManifest,
  listSeLibrary,
  resolveSeFile,
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
 */

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

  app.get("/api/se/file/*path", async (req, res, next) => {
    const raw = (req.params as Record<string, unknown>).path;
    const segments = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split("/") : [];
    const abs = resolveSeFile(segments.join("/"));
    // library files may be replaced under the same name -> always revalidate
    await sendFileWithRange(res, next, abs, { cacheControl: "no-cache" });
  });
}
