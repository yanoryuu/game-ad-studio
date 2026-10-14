import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import { badRequest, isClientAbort, notFound } from "./errors";
import { projectDir } from "./paths";
import { assertSafeId } from "./store";

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".json": "application/json; charset=utf-8",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Resolves a project-relative path (already split into segments) to an absolute path
 * strictly inside the project directory. Rejects traversal, absolute paths, drive letters,
 * backslashes, NUL and dot-files (e.g. the temp files of atomic writes).
 */
export function resolveInProject(projectId: string, segments: string[]): string {
  assertSafeId(projectId);
  if (segments.length === 0) throw badRequest("Missing file path");
  for (const seg of segments) {
    if (
      seg === "" ||
      seg.startsWith(".") ||
      seg.includes("\\") ||
      seg.includes("/") ||
      seg.includes(":") ||
      seg.includes("\0")
    ) {
      throw badRequest(`Invalid path segment: ${JSON.stringify(seg)}`);
    }
  }
  const root = path.resolve(projectDir(projectId));
  const abs = path.resolve(root, ...segments);
  if (!abs.startsWith(root + path.sep)) throw badRequest("Path escapes the project directory");
  return abs;
}

/**
 * Streams a file with HTTP Range support (via express' res.sendFile -> `send`):
 * 206 + Content-Range for valid ranges, 416 for unsatisfiable ones, Accept-Ranges: bytes.
 */
export async function sendFileWithRange(
  res: Response,
  next: NextFunction,
  absPath: string,
  opts: { cacheControl?: string } = {},
): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch {
    throw notFound(`File not found: ${path.basename(absPath)}`);
  }
  if (!stat.isFile()) throw notFound(`Not a file: ${path.basename(absPath)}`);
  res.type(contentTypeFor(absPath));
  if (opts.cacheControl) res.setHeader("Cache-Control", opts.cacheControl);
  res.sendFile(
    absPath,
    {
      dotfiles: "allow", // originals may live under dot-directories; /files guards dotfiles itself
      acceptRanges: true,
      cacheControl: !opts.cacheControl,
      lastModified: true,
      etag: true,
    },
    (err) => {
      if (!err || isClientAbort(err)) return;
      if (!res.headersSent) next(err);
    },
  );
}

/** GET /files/:projectId/*path */
export async function serveProjectFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  const projectId = String(req.params.projectId);
  const raw = (req.params as Record<string, unknown>).path;
  const segments = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split("/") : [];
  const abs = resolveInProject(projectId, segments);
  // proxies/thumbs/assets are written once under unique names; renders too. Allow revalidation anyway.
  await sendFileWithRange(res, next, abs, { cacheControl: "no-cache" });
}
