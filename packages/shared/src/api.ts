import { z } from "zod";
import { formatSchema, fpsSchema, langSchema, templateIdSchema, ttsEngineSchema, type Project } from "./project";

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

/**
 * POST /api/projects/:id/sources -> 201 Project (v2: returns immediately; the new source is appended LAST
 * with proxyStatus "pending"; poll GET /api/projects/:id until it becomes "ready" or "error").
 */
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

/* ------------------------------------------------------------------ */
/* Phase 2: highlight analysis                                          */
/* ------------------------------------------------------------------ */

/**
 * POST /api/projects/:id/sources/:sourceId/analyze  (no body)
 * -> 202 Project (source.analysisStatus = "running"); poll GET /api/projects/:id.
 * 409 if the source is already being analyzed or its proxy is not ready.
 */
export type AnalyzeStartResponse = Project;

/* ------------------------------------------------------------------ */
/* Phase 2: TTS                                                         */
/* ------------------------------------------------------------------ */

/** GET /api/tts/status */
export const ttsStatusResponseSchema = z.object({
  voicevox: z.object({
    ok: z.boolean(),
    /** engine version from GET <url>/version */
    version: z.string().optional(),
    url: z.string(),
    error: z.string().optional(),
  }),
  piper: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  whisper: z.object({
    ok: z.boolean(),
    /** e.g. "base.en" */
    model: z.string(),
    error: z.string().optional(),
  }),
});
export type TtsStatusResponse = z.infer<typeof ttsStatusResponseSchema>;

/** GET /api/tts/voices?engine=voicevox|piper -> TtsVoice[] */
export const ttsVoicesQuerySchema = z.object({ engine: ttsEngineSchema });
export const ttsVoiceSchema = z.object({
  engine: ttsEngineSchema,
  /** value for Voice.speaker (VOICEVOX style id as string / Piper voice name) */
  speaker: z.string(),
  /** display name, e.g. "ずんだもん(ノーマル)" / "en_US-lessac-medium" */
  name: z.string(),
  /** language the voice speaks */
  lang: langSchema,
  /** required credit, e.g. "VOICEVOX:ずんだもん" (VOICEVOX only) */
  credit: z.string().optional(),
});
export type TtsVoice = z.infer<typeof ttsVoiceSchema>;

/**
 * POST /api/projects/:id/tts -> 200 Project (synchronous).
 * lineIds omitted: every line of `lang` with non-empty text and status !== "ok".
 * lineIds given: exactly those lines (must belong to `lang`), regardless of status.
 * Per-line failures do NOT fail the request: the line gets status "error" + error message.
 */
export const ttsSynthesizeRequestSchema = z.object({
  lang: langSchema,
  lineIds: z.array(z.string()).optional(),
});
export type TtsSynthesizeRequest = z.infer<typeof ttsSynthesizeRequestSchema>;

/** POST /api/tts/preview -> audio/wav (binary). Nothing is saved. */
export const ttsPreviewRequestSchema = z.object({
  engine: ttsEngineSchema,
  speaker: z.string().min(1),
  speed: z.number().min(0.5).max(2),
  text: z.string().min(1).max(500),
});
export type TtsPreviewRequest = z.infer<typeof ttsPreviewRequestSchema>;

/** POST /api/projects/:id/sources -> 201 */
export type AddSourceResponse = Project;
