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

/** Video file extensions accepted as sources (path registration and upload). */
export const VIDEO_EXTS = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"] as const;
/**
 * Still image extensions accepted as sources (source.kind "image", used as an image without any video
 * conversion; see isStillImageSource / IMAGE_MAX_CLIP_SEC).
 */
export const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".bmp"] as const;
/** @deprecated length of the still mp4 the server USED to generate from an image (legacy image sources only). */
export const IMAGE_SOURCE_SEC = 8;

/**
 * POST /api/projects/:id/sources/upload (multipart, field "file", ONE file per request, ≤ 20 GB,
 * VIDEO_EXTS + IMAGE_EXTS) -> 201 Project, exactly like POST /sources.
 * The file is saved as `projects/<id>/media/<nanoid><ext>` and then registered from that path;
 * on a registration error the uploaded file is deleted. 400 for other extensions, 413 when too large.
 */
export type UploadSourceResponse = Project;

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
 * 409 if the source is already being analyzed, its proxy is not ready, or it is an image source (kind "image").
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

/**
 * POST /api/projects/:id/bgm/carve (no body) — voice-band ducking (ARCHITECTURE §5.3.1)
 * -> 202 Project (audio.bgm.voiceCarveStatus = "running"); poll GET until voiceCarvePath is set ("done") / "error".
 * 409 if there is no audio.bgm or carving of the same file is already running.
 */
export type BgmCarveStartResponse = Project;

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
 * POST /api/se/upload (multipart, field "file", SE_EXTS only, ≤ 50 MB) -> SeListResponse.
 * The file is copied into the library dir ROOT under its original (sanitized) name; an existing name gets
 * " (2)", " (3)", … before the extension. The new id is the stored file name.
 */
export const SE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

/**
 * PUT /api/se/manifest -> SeListResponse. MERGES credits into se.json: id -> credit text; "" removes the credit.
 * Ids are not required to exist (but must be valid ids).
 */
export const seManifestUpdateRequestSchema = z.object({
  credits: z.record(seFileIdSchema, z.string().max(200)),
});
export type SeManifestUpdateRequest = z.infer<typeof seManifestUpdateRequestSchema>;

/* ------------------------------------------------------------------ */
/* BGM library (ARCHITECTURE §6.14)                                     */
/* ------------------------------------------------------------------ */

/** File extensions the BGM library lists / serves / accepts for upload. */
export const BGM_EXTS = [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"] as const;

/** Mood tags of library tracks (fixed list; id is stored in bgm.json, label is the UI text). */
export const BGM_MOODS = [
  { id: "pop", label: "ポップ" },
  { id: "upbeat", label: "アップテンポ" },
  { id: "comedy", label: "コミカル・ゆるい" },
  { id: "cute", label: "かわいい" },
  { id: "chiptune", label: "チップチューン" },
  { id: "edm", label: "EDM" },
  { id: "epic", label: "壮大" },
  { id: "rock", label: "ロック" },
  { id: "chill", label: "落ち着き" },
  { id: "dark", label: "ダーク・緊張" },
  { id: "jingle", label: "ジングル" },
] as const;
export const bgmMoodSchema = z.enum(["pop", "upbeat", "comedy", "cute", "chiptune", "edm", "epic", "rock", "chill", "dark", "jingle"]);
export type BgmMood = z.infer<typeof bgmMoodSchema>;

/**
 * Well-known free BGM sites (UI hints + the "credit required" warning). Matching is by `source`
 * (case-insensitive, any of `names`). creditRequired = the site's terms require a credit in the video/description.
 */
export const BGM_SOURCES = [
  { id: "opentracks", label: "OpenTracks(旧DOVA-SYNDROME)", names: ["OpenTracks", "DOVA-SYNDROME", "DOVA"], creditRequired: false, creditExample: "" },
  { id: "peritune", label: "PeriTune", names: ["PeriTune"], creditRequired: false, creditExample: "" },
  { id: "otologic", label: "OtoLogic", names: ["OtoLogic"], creditRequired: true, creditExample: "BGM by OtoLogic(CC BY 4.0)" },
  { id: "maou", label: "魔王魂", names: ["魔王魂", "maou", "maoudamashii"], creditRequired: true, creditExample: "音楽：魔王魂" },
] as const;
export type BgmSourceInfo = (typeof BGM_SOURCES)[number];

/** Known site for a `source` text (case-insensitive), or undefined. */
export function bgmSourceInfo(source: string | undefined): BgmSourceInfo | undefined {
  const s = source?.trim().toLowerCase();
  if (!s) return undefined;
  return BGM_SOURCES.find((x) => x.names.some((n) => n.toLowerCase() === s) || x.label.toLowerCase() === s);
}

/** One manifest entry (all optional). `tags` keeps unknown strings on read; the list response filters them. */
export const bgmManifestEntrySchema = z.object({
  credit: z.string().optional(),
  source: z.string().optional(),
  url: z.string().optional(),
  tags: z.array(z.string()).optional(),
  note: z.string().optional(),
});
export type BgmManifestEntry = z.infer<typeof bgmManifestEntrySchema>;

/** Library manifest `<bgm.dir>/bgm.json` (server-owned file; edited via PUT /api/bgm/manifest). */
export const bgmManifestSchema = z.object({
  version: z.literal(1),
  /** file id (library-relative path) -> metadata. Entries for missing files are kept (harmless). */
  files: z.record(z.string(), bgmManifestEntrySchema),
});
export type BgmManifest = z.infer<typeof bgmManifestSchema>;

/** One track of the BGM library. */
export const bgmFileSchema = z.object({
  /** library-relative path with "/" (same id rules as SE: seFileIdSchema) */
  id: seFileIdSchema,
  /** file name for display */
  name: z.string(),
  /** length in seconds (ffprobe, cached by size+mtime; 0 if unknown) */
  durationSec: z.number().nonnegative(),
  credit: z.string().optional(),
  source: z.string().optional(),
  url: z.string().optional(),
  /** known mood tags only, in BGM_MOODS order */
  tags: z.array(bgmMoodSchema),
  note: z.string().optional(),
});
export type BgmFile = z.infer<typeof bgmFileSchema>;

/** GET /api/bgm, POST /api/bgm/rescan, PUT /api/bgm/manifest, POST /api/bgm/upload -> BgmListResponse. */
export const bgmListResponseSchema = z.object({
  /** absolute library dir (config bgm.dir, default D:\Tools\bgm) */
  dir: z.string(),
  /** false when the dir does not exist (files = []) */
  exists: z.boolean(),
  files: z.array(bgmFileSchema),
});
export type BgmListResponse = z.infer<typeof bgmListResponseSchema>;

/** POST /api/bgm/upload (multipart "file", BGM_EXTS, ≤ 100 MB) -> BgmListResponse (copied to the library root). */
export const BGM_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

/**
 * PUT /api/bgm/manifest -> BgmListResponse. MERGES per id and per field: a present field replaces the stored one,
 * "" (or [] for tags) removes it, an absent field is unchanged. Ids must be valid (not required to exist).
 */
export const bgmManifestUpdateRequestSchema = z.object({
  files: z.record(
    seFileIdSchema,
    z.object({
      credit: z.string().max(200).optional(),
      source: z.string().max(100).optional(),
      url: z.string().max(500).optional(),
      tags: z.array(bgmMoodSchema).max(20).optional(),
      note: z.string().max(500).optional(),
    }),
  ),
});
export type BgmManifestUpdateRequest = z.infer<typeof bgmManifestUpdateRequestSchema>;

/**
 * POST /api/projects/:id/bgm/from-library { id } -> Project (200). Copies the library file into the project's
 * assets/<nanoid><ext>, sets audio.bgm (mix settings kept from the previous BGM, else DEFAULT_BGM), records
 * audio.bgm.library (id + credit/source/url snapshot) and starts beat analysis (analysisStatus "running").
 * 404: project / library file missing.
 */
export const bgmFromLibraryRequestSchema = z.object({ id: seFileIdSchema });
export type BgmFromLibraryRequest = z.infer<typeof bgmFromLibraryRequestSchema>;
export type BgmFromLibraryResponse = Project;

/* ------------------------------------------------------------------ */
/* Still frames (MCP preview_frames, ARCHITECTURE §9)                    */
/* ------------------------------------------------------------------ */

/**
 * POST /api/projects/:id/stills -> StillsResponse. Renders still frames of the SAVED project (same bundle,
 * browser and asset setup as /render; originals, not proxies) at the given output-timeline seconds.
 * Times are clamped to the video length. Files are written to projects/<id>/stills/ (overwritten per request
 * name) and also returned base64-encoded.
 */
export const stillsRequestSchema = z.object({
  format: formatSchema,
  lang: langSchema,
  /** output-timeline seconds, 1..12 entries */
  times: z.array(z.number().min(0)).min(1).max(12),
  /** output width in px (downscaled from the composition; default 540, never upscaled) */
  width: z.number().int().min(120).max(1920).optional(),
  imageFormat: z.enum(["jpeg", "png"]).optional(),
});
export type StillsRequest = z.infer<typeof stillsRequestSchema>;

export const stillsResponseSchema = z.object({
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  durationInFrames: z.number(),
  durationSec: z.number(),
  frames: z.array(
    z.object({
      /** requested seconds (after clamping) */
      sec: z.number(),
      frame: z.number().int(),
      mimeType: z.string(),
      /** absolute local path of the written image */
      absPath: z.string(),
      base64: z.string(),
    }),
  ),
});
export type StillsResponse = z.infer<typeof stillsResponseSchema>;
