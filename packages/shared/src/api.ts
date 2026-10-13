import { z } from "zod";
import { formatSchema, fpsSchema, langSchema, templateIdSchema } from "./project";

/**
 * HTTP API request/response shapes (see docs/ARCHITECTURE.md).
 * Server validates request bodies with these; web uses the inferred types.
 */

export const SERVER_PORT = 3101;
export const WEB_PORT = 5173;

/** Error body for every non-2xx JSON response. */
export const apiErrorSchema = z.object({ error: z.string() });
export type ApiError = z.infer<typeof apiErrorSchema>;

/** GET /api/health */
export const healthResponseSchema = z.object({
  ok: z.literal(true),
  ffmpeg: z.boolean(),
  ffprobe: z.boolean(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** GET /api/projects -> ProjectSummary[] (sorted by updatedAt desc) */
export const projectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  template: templateIdSchema,
  /** asset ref of the first source's thumbnail, if any */
  thumbPath: z.string().optional(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

/** POST /api/projects -> Project */
export const createProjectRequestSchema = z.object({
  name: z.string().min(1),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

/** POST /api/projects/:id/sources -> Project */
export const addSourceRequestSchema = z.object({
  /** absolute local path to a video file */
  path: z.string().min(1),
});
export type AddSourceRequest = z.infer<typeof addSourceRequestSchema>;

/** POST /api/projects/:id/assets (multipart, field "file") -> UploadAssetResponse */
export const uploadAssetResponseSchema = z.object({
  /** project-relative asset ref, e.g. "assets/k3j2h4.png" */
  path: z.string(),
});
export type UploadAssetResponse = z.infer<typeof uploadAssetResponseSchema>;

/** POST /api/projects/:id/render -> RenderStartResponse */
export const renderRequestSchema = z.object({
  format: formatSchema,
  lang: langSchema,
  /** overrides project.fps */
  fps: fpsSchema.optional(),
});
export type RenderRequest = z.infer<typeof renderRequestSchema>;

export const renderStartResponseSchema = z.object({ jobId: z.string() });
export type RenderStartResponse = z.infer<typeof renderStartResponseSchema>;

export const renderStatusSchema = z.enum(["queued", "bundling", "rendering", "done", "error"]);
export type RenderStatus = z.infer<typeof renderStatusSchema>;

/** GET /api/render/:jobId -> RenderJob */
export const renderJobSchema = z.object({
  jobId: z.string(),
  projectId: z.string(),
  format: formatSchema,
  lang: langSchema,
  status: renderStatusSchema,
  /** 0..1 */
  progress: z.number().min(0).max(1),
  /** project-relative, e.g. "renders/20261014-120000_16x9_ja.mp4" (download via /files/:pid/<outputPath>) */
  outputPath: z.string().optional(),
  error: z.string().optional(),
});
export type RenderJob = z.infer<typeof renderJobSchema>;
