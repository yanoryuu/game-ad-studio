import { z } from "zod";
import { formatSchema, fpsSchema, langSchema, seFileIdSchema, templateIdSchema, ttsEngineSchema, type Project } from "./project";

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
  /** absolute local path of the output file (for "copy path") */
  absPath: z.string().optional(),
  error: z.string().optional(),
  /** v3: ISO 8601 time the job was queued */
  createdAt: z.string().optional(),
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
    /** e.g. "base.en" (English: Piper word timing + recorded en lines) */
    model: z.string(),
    error: z.string().optional(),
    /**
     * v3: multilingual model used for recorded ja lines (config.whisper.multilingualModel, default "small").
     * Absent until the server implements it.
     */
    multilingual: z
      .object({
        ok: z.boolean(),
        model: z.string(),
        error: z.string().optional(),
      })
      .optional(),
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
 * lineIds omitted: every line of `lang` with hasNarrationInput(line) (v3: recorded lines with a sourcePath count)
 * and status !== "ok" (plus lines without input that still have audio -> cleared).
 * v3: engine "recorded" lines are converted from voice.sourcePath instead of synthesized (ARCHITECTURE §6.10).
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

/* ------------------------------------------------------------------ */
/* Phase 3: batch render / render history                               */
/* ------------------------------------------------------------------ */

export const renderTargetSchema = z.object({ format: formatSchema, lang: langSchema });
export type RenderTarget = z.infer<typeof renderTargetSchema>;

/**
 * POST /api/projects/:id/render-batch -> RenderBatchResponse.
 * One queued job per target (duplicate targets are rendered once). Jobs run sequentially in the global queue.
 */
export const renderBatchRequestSchema = z.object({
  targets: z.array(renderTargetSchema).min(1).max(8),
  /** overrides project.fps for every target */
  fps: fpsSchema.optional(),
});
export type RenderBatchRequest = z.infer<typeof renderBatchRequestSchema>;

export const renderBatchResponseSchema = z.object({
  /** in the order of the (deduplicated) targets; poll each with GET /api/render/:jobId */
  jobIds: z.array(z.string()),
});
export type RenderBatchResponse = z.infer<typeof renderBatchResponseSchema>;

/** One finished file in projects/<id>/renders/. */
export const renderFileSchema = z.object({
  /** file name, e.g. "20261014-120000_16x9_ja.mp4" */
  name: z.string(),
  /** project-relative path "renders/<name>" */
  path: z.string(),
  /** absolute local path (for "copy path") */
  absPath: z.string().optional(),
  /** download/preview URL (relative): "/files/<projectId>/renders/<name>" */
  url: z.string(),
  /** parsed from the name (`<yyyymmdd-hhmmss>_<16x9|9x16>_<ja|en>[-n].mp4`); absent if it doesn't match */
  format: formatSchema.optional(),
  lang: langSchema.optional(),
  sizeBytes: z.number().int().nonnegative(),
  /** ISO 8601 modification time */
  mtime: z.string(),
});
export type RenderFile = z.infer<typeof renderFileSchema>;

/** GET /api/projects/:id/renders -> RenderListResponse */
export const renderListResponseSchema = z.object({
  /** .mp4 files, newest (mtime) first */
  files: z.array(renderFileSchema),
  /**
   * This project's jobs known to the running server (in memory, lost on restart), newest first:
   * queued / bundling / rendering ones plus recently finished (done / error) ones.
   */
  jobs: z.array(renderJobSchema),
});
export type RenderListResponse = z.infer<typeof renderListResponseSchema>;

/* ------------------------------------------------------------------ */
/* Phase 3: BGM beat analysis                                           */
/* ------------------------------------------------------------------ */

/**
 * POST /api/projects/:id/bgm/analyze (no body)
 * -> 202 Project (audio.bgm.analysisStatus = "running"); poll GET /api/projects/:id until "done" / "error".
 * 409 if there is no audio.bgm or its analysis is already running.
 */
export type BgmAnalyzeStartResponse = Project;

/* ------------------------------------------------------------------ */
/* Phase 3.5: SE library (ARCHITECTURE §6.12)                            */
/* ------------------------------------------------------------------ */

/** File extensions the SE library lists / serves. */
export const SE_EXTS = [".wav", ".mp3", ".ogg", ".m4a", ".aac"] as const;

/** Library manifest `<se.dir>/se.json` (server-owned file; edited via PUT /api/se/manifest). */
export const seManifestSchema = z.object({
  version: z.literal(1),
  /** file id (library-relative path) -> metadata. Entries for missing files are kept (harmless). */
  files: z.record(z.string(), z.object({ credit: z.string().optional() })),
});
export type SeManifest = z.infer<typeof seManifestSchema>;

/** One audio file of the SE library. */
export const seFileSchema = z.object({
  /** library-relative path with "/" (= the value stored in audio.se.slots), e.g. "_placeholder/pop.wav" */
  id: seFileIdSchema,
  /** file name for display, e.g. "pop.wav" */
  name: z.string(),
  /** length in seconds (ffprobe; 0 if unknown) */
  durationSec: z.number().nonnegative(),
  /** required credit from se.json (e.g. "効果音:OtoLogic"); absent = none */
  credit: z.string().optional(),
});
export type SeFile = z.infer<typeof seFileSchema>;

/**
 * GET /api/se, POST /api/se/rescan, PUT /api/se/manifest -> SeListResponse.
 * files: every SE_EXTS file under `dir` (recursive, dot-files/dirs skipped), "_placeholder/*" included, sorted by id.
 */
export const seListResponseSchema = z.object({
  /** absolute library dir (config se.dir, default D:\Tools\se) */
  dir: z.string(),
  /** false when the dir does not exist (files = []) */
  exists: z.boolean(),
  files: z.array(seFileSchema),
});
export type SeListResponse = z.infer<typeof seListResponseSchema>;

/**
 * PUT /api/se/manifest -> SeListResponse. MERGES credits into se.json: id -> credit text; "" removes the credit.
 * Ids are not required to exist (but must be valid ids).
 */
export const seManifestUpdateRequestSchema = z.object({
  credits: z.record(seFileIdSchema, z.string().max(200)),
});
export type SeManifestUpdateRequest = z.infer<typeof seManifestUpdateRequestSchema>;
