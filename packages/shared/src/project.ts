import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Primitive enums                                                     */
/* ------------------------------------------------------------------ */

export const formatSchema = z.enum(["16:9", "9:16"]);
export type Format = z.infer<typeof formatSchema>;
export const FORMATS = formatSchema.options;

export const FORMAT_SIZE: Record<Format, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
};

export const langSchema = z.enum(["ja", "en"]);
export type Lang = z.infer<typeof langSchema>;
export const LANGS = langSchema.options;

export const fpsSchema = z.union([z.literal(30), z.literal(60)]);
export type Fps = z.infer<typeof fpsSchema>;

export const templateIdSchema = z.enum(["hook-play-cta", "features", "trailer"]);
export type TemplateId = z.infer<typeof templateIdSchema>;

/** 15 / 30 sec, or null = "free" (natural length of the selected clips + narration). */
export const durationSecSchema = z.union([z.literal(15), z.literal(30), z.null()]);
export type DurationSec = z.infer<typeof durationSecSchema>;

/**
 * Asset reference: a path RELATIVE to the project directory, forward slashes,
 * no leading slash, e.g. "assets/logo.png", "proxies/src_ab12.mp4".
 * Served at GET /files/:projectId/<relPath>.
 */
export const assetRefSchema = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.includes("\\") && !/^[a-zA-Z]:/.test(p) && !p.split("/").includes(".."), {
    message: "asset ref must be a project-relative path using forward slashes",
  });
export type AssetRef = z.infer<typeof assetRefSchema>;

/** Per-language string. */
export const localizedTextSchema = z.object({
  ja: z.string(),
  en: z.string(),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

/* ------------------------------------------------------------------ */
/* Game info (end card)                                                */
/* ------------------------------------------------------------------ */

export const gameSchema = z.object({
  title: z.string(),
  /** asset ref, e.g. "assets/xxxx.png" */
  logo: assetRefSchema.optional(),
  /** asset ref */
  keyArt: assetRefSchema.optional(),
  /** v2: per language, e.g. { ja: "2026年冬 発売予定", en: "Coming Winter 2026" }. "" = not shown. */
  releaseText: localizedTextSchema,
  steamUrl: z.string().optional(),
  /** e.g. ["Steam"] */
  platforms: z.array(z.string()),
});
export type Game = z.infer<typeof gameSchema>;

/* ------------------------------------------------------------------ */
/* Sources / candidates / clips                                        */
/* ------------------------------------------------------------------ */

/** v2: proxy encoding runs in the background after POST /sources. */
export const proxyStatusSchema = z.enum(["pending", "ready", "error"]);
export type ProxyStatus = z.infer<typeof proxyStatusSchema>;

/** v2: highlight analysis state of a source (POST /sources/:sid/analyze). */
export const analysisStatusSchema = z.enum(["none", "running", "done", "error"]);
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;

export const sourceSchema = z.object({
  /** "src_" + nanoid */
  id: z.string(),
  /** ABSOLUTE local path of the original file (outside the project dir). */
  originalPath: z.string(),
  /**
   * asset ref: 720p / 30fps / H.264 + AAC proxy, "proxies/<id>.mp4".
   * Assigned at registration; the FILE exists only when proxyStatus === "ready".
   */
  proxyPath: assetRefSchema,
  /** asset ref: jpg thumbnail "thumbs/<id>.jpg". The FILE exists only when proxyStatus === "ready". */
  thumbPath: assetRefSchema,
  /** metadata of the ORIGINAL (from ffprobe; known immediately at registration) */
  durationSec: z.number().nonnegative(),
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  hasAudio: z.boolean(),
  /** v2 */
  proxyStatus: proxyStatusSchema,
  /** v2: set only when proxyStatus === "error" */
  proxyError: z.string().optional(),
  /** v2 */
  analysisStatus: analysisStatusSchema,
  /** v2: set only when analysisStatus === "error" */
  analysisError: z.string().optional(),
});
export type Source = z.infer<typeof sourceSchema>;

const unitSchema = z.number().min(0).max(1);

/** v2: auto-detected highlight candidate (written by the analysis job). */
export const candidateSchema = z.object({
  /** "cand_" + nanoid */
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  sourceId: z.string(),
  /** seconds in the source timeline; length 2..6 s */
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  /** overall score 0..1 (higher = better) */
  score: unitSchema,
  /** normalized feature scores 0..1 */
  features: z.object({
    scene: unitSchema,
    motion: unitSchema,
    loudness: unitSchema,
  }),
  /** asset ref "thumbs/<id>.jpg" (id already starts with "cand_", e.g. "thumbs/cand_ab12cd34.jpg") */
  thumbPath: assetRefSchema,
  /** set by the web when the candidate has been turned into a clip */
  adopted: z.boolean().optional(),
});
export type Candidate = z.infer<typeof candidateSchema>;

export const clipSlotSchema = z.enum(["hook", "main"]);
export type ClipSlot = z.infer<typeof clipSlotSchema>;

export const clipSchema = z.object({
  /** "clip_" + nanoid */
  id: z.string(),
  sourceId: z.string(),
  /** seconds in the source timeline */
  inSec: z.number().nonnegative(),
  outSec: z.number().nonnegative(),
  slot: clipSlotSchema,
  /** game audio volume 0..1 */
  gameVolume: z.number().min(0).max(1),
  /** Phase 3 (9:16 crop): horizontal focus 0..1 (0.5 = center) */
  focusX: z.number().min(0).max(1).optional(),
});
export type Clip = z.infer<typeof clipSchema>;

/* ------------------------------------------------------------------ */
/* Texts / captions                                                    */
/* ------------------------------------------------------------------ */

export const copySchema = z.object({
  /** big hook text shown in the hook section */
  hook: z.string(),
  /** CTA on the end card, default "ウィッシュリストに追加" / "Wishlist now on Steam" */
  cta: z.string(),
});
export type Copy = z.infer<typeof copySchema>;

export const textsSchema = z.object({
  ja: copySchema,
  en: copySchema,
});
export type Texts = z.infer<typeof textsSchema>;

export const captionSchema = z.object({
  text: z.string(),
  /** seconds; on the OUTPUT timeline in project.captions, RELATIVE TO LINE START in scriptLine.captions */
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
});
export type Caption = z.infer<typeof captionSchema>;

/** Manual / extra captions per language (output-timeline seconds). Narration captions live on script lines. */
export const captionsSchema = z.object({
  ja: z.array(captionSchema),
  en: z.array(captionSchema),
});
export type Captions = z.infer<typeof captionsSchema>;

/* ------------------------------------------------------------------ */
/* Narration script (v2)                                                */
/* ------------------------------------------------------------------ */

export const scriptSectionIdSchema = z.enum(["hook", "main", "cta"]);
export type ScriptSectionId = z.infer<typeof scriptSectionIdSchema>;

export const ttsEngineSchema = z.enum(["voicevox", "piper"]);
export type TtsEngine = z.infer<typeof ttsEngineSchema>;

export const voiceSchema = z.object({
  engine: ttsEngineSchema,
  /** VOICEVOX: style id as a decimal string (e.g. "3"). Piper: voice name = .onnx basename (e.g. "en_US-lessac-medium"). */
  speaker: z.string().min(1),
  /** speech rate multiplier, 1 = normal (VOICEVOX speedScale / Piper length_scale = 1/speed) */
  speed: z.number().min(0.5).max(2),
});
export type Voice = z.infer<typeof voiceSchema>;

export const scriptLineStatusSchema = z.enum(["none", "ok", "stale", "error"]);
export type ScriptLineStatus = z.infer<typeof scriptLineStatusSchema>;

/**
 * One narration line (v2). The array order of lines with the same (lang, section) = playback order.
 *
 * Status rules:
 *  - "none"  : never synthesized (no audioPath / durationSec, captions = [])
 *  - "ok"    : audioPath/durationSec/captions match the current text + voice
 *  - "stale" : text or voice was edited after synthesis. THE WEB sets "stale" whenever it changes text or
 *              voice of a line whose status is "ok" or "error". Old audio (if any) is kept and still played.
 *  - "error" : last synthesis failed; `error` holds the message (old audio, if any, is kept)
 */
export const scriptLineSchema = z.object({
  /** "line_" + id (used as file name tts/<id>.wav) */
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  lang: langSchema,
  section: scriptSectionIdSchema,
  text: z.string(),
  voice: voiceSchema,
  /**
   * seconds >= 0. hook / cta: delay from the section start.
   * main: extra gap inserted before this line (main lines play sequentially).
   */
  offsetSec: z.number().min(0),
  /** asset ref "tts/<lineId>.wav" (written by POST /api/projects/:id/tts) */
  audioPath: assetRefSchema.optional(),
  /** length of the wav in seconds */
  durationSec: z.number().positive().optional(),
  /** caption chunks; times RELATIVE TO THE LINE START */
  captions: z.array(captionSchema),
  status: scriptLineStatusSchema,
  error: z.string().optional(),
  /**
   * Required credit for the voice used, set by the server on synthesis.
   * VOICEVOX: "VOICEVOX:<character name>" (e.g. "VOICEVOX:ずんだもん"). Piper: absent.
   */
  credit: z.string().optional(),
});
export type ScriptLine = z.infer<typeof scriptLineSchema>;

/* ------------------------------------------------------------------ */
/* Audio (v2) / style                                                   */
/* ------------------------------------------------------------------ */

export const bgmSchema = z.object({
  /** asset ref, e.g. "assets/xxxx.mp3" (uploaded via POST /assets) */
  path: assetRefSchema,
  /** 0..1 */
  volume: z.number().min(0).max(1),
  /** dB (<= 0) applied to the BGM while narration plays, e.g. -12 */
  duckingDb: z.number().min(-60).max(0),
  /** fade-out at the end of the video, seconds */
  fadeOutSec: z.number().nonnegative(),
  /** true: loop to fill the video; false: play once (silence after it ends) */
  loop: z.boolean(),
});
export type Bgm = z.infer<typeof bgmSchema>;

export const audioSettingsSchema = z.object({
  /** narration (TTS) volume 0..1 */
  narrationVolume: z.number().min(0).max(1),
  /** multiplier 0..1 applied to each clip's gameVolume while narration plays (game-audio ducking) */
  gameVolumeUnderNarration: z.number().min(0).max(1),
  bgm: bgmSchema.optional(),
});
export type AudioSettings = z.infer<typeof audioSettingsSchema>;

export const fontIdSchema = z.enum(["noto-sans-jp"]);
export type FontId = z.infer<typeof fontIdSchema>;

export const watermarkPositionSchema = z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "none"]);
export type WatermarkPosition = z.infer<typeof watermarkPositionSchema>;

export const watermarkSchema = z.object({
  /** corner of the logo/title watermark shown during the main section; "none" hides it */
  position: watermarkPositionSchema,
  /** size multiplier, 1 = default size */
  scale: z.number().min(0.25).max(3),
});
export type Watermark = z.infer<typeof watermarkSchema>;

export const captionStyleSchema = z.object({
  /** show captions (narration captions + manual project.captions) */
  enabled: z.boolean(),
  position: z.enum(["bottom", "center"]),
  size: z.enum(["m", "l"]),
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export const styleSchema = z.object({
  /** CSS color, e.g. "#ff3b30" */
  primaryColor: z.string(),
  accentColor: z.string(),
  font: fontIdSchema,
  /** v2 */
  watermark: watermarkSchema,
  /** v2 */
  captions: captionStyleSchema,
});
export type Style = z.infer<typeof styleSchema>;

/* ------------------------------------------------------------------ */
/* Project                                                              */
/* ------------------------------------------------------------------ */

export const PROJECT_SCHEMA_VERSION = 2 as const;

export const projectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  /** "p_" + nanoid; also the directory name under projects/ */
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  name: z.string(),
  /** ISO 8601 */
  createdAt: z.string(),
  /** ISO 8601, set by the server on every save */
  updatedAt: z.string(),
  template: templateIdSchema,
  formats: z.array(formatSchema).min(1),
  durationSec: durationSecSchema,
  fps: fpsSchema,
  languages: z.array(langSchema).min(1),
  game: gameSchema,
  sources: z.array(sourceSchema),
  candidates: z.array(candidateSchema),
  /** ordered: order within each slot = playback order */
  clips: z.array(clipSchema),
  texts: textsSchema,
  /** v2: narration lines of all languages (filter by lang) */
  script: z.array(scriptLineSchema),
  captions: captionsSchema,
  /** v2: replaces the v1 top-level `bgm` */
  audio: audioSettingsSchema,
  style: styleSchema,
});
export type Project = z.infer<typeof projectSchema>;

/* ------------------------------------------------------------------ */
/* Defaults / constants                                                 */
/* ------------------------------------------------------------------ */

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Small random id (works in Node 20 and browsers). Server may use nanoid instead. */
export function generateId(prefix: string, length = 10): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return `${prefix}_${out}`;
}

export const DEFAULT_TEXTS: Texts = {
  ja: { hook: "", cta: "ウィッシュリストに追加" },
  en: { hook: "", cta: "Wishlist now on Steam" },
};

export const DEFAULT_VOICEVOX_URL = "http://127.0.0.1:50021";
/**
 * VOICEVOX style id 3 = ずんだもん(ノーマル).
 * Using any VOICEVOX voice REQUIRES the credit "VOICEVOX:<character>" (here "VOICEVOX:ずんだもん")
 * in the video or its description. See ScriptLine.credit / collectCredits().
 */
export const DEFAULT_VOICEVOX_SPEAKER = "3";
export const DEFAULT_VOICEVOX_CREDIT = "VOICEVOX:ずんだもん";
/** Piper voice name (= <voicesDir>/<name>.onnx + <name>.onnx.json) */
export const DEFAULT_PIPER_VOICE = "en_US-lessac-medium";

/** Default voice per language: ja -> VOICEVOX ずんだもん, en -> Piper lessac. */
export const DEFAULT_VOICES: Record<Lang, Voice> = {
  ja: { engine: "voicevox", speaker: DEFAULT_VOICEVOX_SPEAKER, speed: 1 },
  en: { engine: "piper", speaker: DEFAULT_PIPER_VOICE, speed: 1 },
};

export const DEFAULT_AUDIO: AudioSettings = {
  narrationVolume: 1,
  gameVolumeUnderNarration: 0.35,
};

/** Defaults for a newly added BGM (web sets `path` after the upload). */
export const DEFAULT_BGM: Omit<Bgm, "path"> = {
  volume: 0.5,
  duckingDb: -12,
  fadeOutSec: 1.5,
  loop: true,
};

export const DEFAULT_STYLE: Style = {
  primaryColor: "#ffffff",
  accentColor: "#ffcc00",
  font: "noto-sans-jp",
  watermark: { position: "top-right", scale: 1 },
  captions: { enabled: true, position: "bottom", size: "m" },
};

/** New empty narration line with the default voice of `lang`. */
export function createScriptLine(
  lang: Lang,
  section: ScriptSectionId,
  text = "",
  id: string = generateId("line", 8),
): ScriptLine {
  return {
    id,
    lang,
    section,
    text,
    voice: { ...DEFAULT_VOICES[lang] },
    offsetSec: 0,
    captions: [],
    status: "none",
  };
}

/** Unique credits (e.g. "VOICEVOX:ずんだもん") required by the narration lines of `lang` (all langs if omitted). */
export function collectCredits(project: Project, lang?: Lang): string[] {
  const out = new Set<string>();
  for (const l of project.script) {
    if (lang && l.lang !== lang) continue;
    if (!l.text.trim()) continue;
    if (l.credit) out.add(l.credit);
    else if (l.voice.engine === "voicevox" && l.voice.speaker === DEFAULT_VOICEVOX_SPEAKER) out.add(DEFAULT_VOICEVOX_CREDIT);
  }
  return [...out];
}

export function createDefaultProject(
  name: string,
  opts: { id?: string; now?: Date } = {},
): Project {
  const now = (opts.now ?? new Date()).toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: opts.id ?? generateId("p"),
    name,
    createdAt: now,
    updatedAt: now,
    template: "hook-play-cta",
    formats: ["16:9"],
    durationSec: null,
    fps: 30,
    languages: ["ja"],
    game: {
      title: name,
      releaseText: { ja: "", en: "" },
      platforms: ["Steam"],
    },
    sources: [],
    candidates: [],
    clips: [],
    texts: structuredClone(DEFAULT_TEXTS),
    script: [],
    captions: { ja: [], en: [] },
    audio: structuredClone(DEFAULT_AUDIO),
    style: structuredClone(DEFAULT_STYLE),
  };
}
