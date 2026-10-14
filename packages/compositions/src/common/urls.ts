import type { Project } from "@gas/shared";

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${path}`;
}

function encodeRelPath(relPath: string): string {
  return relPath
    .replace(/^\/+/, "")
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/**
 * URL of a project-relative file (asset ref).
 * assetUrl("", "p_1", "assets/logo.png") -> "/files/p_1/assets/logo.png"
 * assetUrl("http://localhost:3101", ...) -> "http://localhost:3101/files/p_1/assets/logo.png"
 */
export function assetUrl(baseUrl: string, projectId: string, relPath: string): string {
  return joinUrl(baseUrl, `/files/${encodeURIComponent(projectId)}/${encodeRelPath(relPath)}`);
}

/**
 * URL of a source video (NOT for native image sources: use sourceImageUrl, they are not videos).
 * useProxy=true  -> /files/:pid/<source.proxyPath>
 * useProxy=false -> /api/projects/:pid/sources/:sid/original
 * Throws if the source does not exist.
 */
export function sourceUrl(baseUrl: string, project: Project, sourceId: string, useProxy: boolean): string {
  const source = project.sources.find((s) => s.id === sourceId);
  if (!source) throw new Error(`Unknown sourceId: ${sourceId}`);
  if (useProxy) return assetUrl(baseUrl, project.id, source.proxyPath);
  return joinUrl(
    baseUrl,
    `/api/projects/${encodeURIComponent(project.id)}/sources/${encodeURIComponent(sourceId)}/original`,
  );
}

/**
 * URL of a native image source's picture (isStillImageSource): useProxy=true -> the preview still
 * (/files/:pid/<source.proxyPath>, <= 1280 px); useProxy=false -> the full-resolution image
 * (/files/:pid/<source.imagePath>). Throws if the source does not exist or is not a native image.
 */
export function sourceImageUrl(baseUrl: string, project: Project, sourceId: string, useProxy: boolean): string {
  const source = project.sources.find((s) => s.id === sourceId);
  if (!source) throw new Error(`Unknown sourceId: ${sourceId}`);
  if (!source.imagePath) throw new Error(`Source ${sourceId} is not an image source`);
  return assetUrl(baseUrl, project.id, useProxy ? source.proxyPath : source.imagePath);
}

/**
 * v4: URL of an SE library file (id = library-relative path, e.g. "_placeholder/pop.wav"):
 * seFileUrl("", "_placeholder/pop.wav") -> "/api/se/file/_placeholder/pop.wav" (preview, via the Vite /api proxy)
 * seFileUrl("http://localhost:3101", ...) -> "http://localhost:3101/api/se/file/_placeholder/pop.wav" (render)
 */
export function seFileUrl(baseUrl: string, fileId: string): string {
  return joinUrl(baseUrl, `/api/se/file/${encodeRelPath(fileId)}`);
}
