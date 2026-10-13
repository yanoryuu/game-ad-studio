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
 * URL of a source video.
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
