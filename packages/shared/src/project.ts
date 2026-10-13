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

/** 15 / 30 sec, or null = "free" (natural length of the selected clips). */
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

/* ------------------------------------------------------------------ */
/* Game info (end card)                                                */
/* ------------------------------------------------------------------ */

export const gameSchema = z.object({
  title: z.string(),
  /** asset ref, e.g. "assets/xxxx.png" */
  logo: assetRefSchema.optional(),
  /** asset ref */
  keyArt: assetRefSchema.optional(),
  /** e.g. "2026年冬 発売予定" / "Coming Winter 2026" / "発売中" */
  releaseText: z.string(),
  steamUrl: z.string().optional(),
  /** e.g. ["Steam"] */
  platforms: z.array(z.string()),
});
export type Game = z.infer<typeof gameSchema>;

/* ------------------------------------------------------------------ */
/* Sources / candidates / clips                                        */
/* ------------------------------------------------------------------ */

export const sourceSchema = z.object({
  /** "src_" + nanoid */
  id: z.string(),
  /** ABSOLUTE local path of the original file (outside the project dir). */
  originalPath: z.string(),
  /** asset ref: 720p / 30fps / H.264 + AAC proxy, e.g. "proxies/<id>.mp4" */
  proxyPath: assetRefSchema,
  /** asset ref: jpg thumbnail, e.g. "thumbs/<id>.jpg" */
  thumbPath: assetRefSchema,
  /** metadata of the ORIGINAL (from ffprobe) */
  durationSec: z.number().nonnegative(),
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  hasAudio: z.boolean(),
});
export type Source = z.infer<typeof sourceSchema>;

/** Phase 2: highlight candidates (auto-detected). */
export const candidateSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  score: z.number(),
  /** asset ref */
  thumbPath: assetRefSchema.optional(),
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
/* Texts / script / captions                                           */
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
  /** seconds on the OUTPUT video timeline */
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
});
export type Caption = z.infer<typeof captionSchema>;

export const captionsSchema = z.object({
  ja: z.array(captionSchema),
  en: z.array(captionSchema),
});
export type Captions = z.infer<typeof captionsSchema>;

export const scriptSectionIdSchema = z.enum(["hook", "main", "cta"]);
export type ScriptSectionId = z.infer<typeof scriptSectionIdSchema>;

/** Phase 2: narration script (one entry per section x lang). */
export const scriptEntrySchema = z.object({
  id: z.string(),
  section: scriptSectionIdSchema,
  lang: langSchema,
  text: z.string(),
  voice: z.object({
    /** VOICEVOX speaker id (ja) / Piper voice index (en) */
    speakerId: z.number().int(),
    speed: z.number().positive(),
  }),
  /** asset ref, e.g. "tts/<id>.wav" */
  audioPath: assetRefSchema.optional(),
  captions: z.array(captionSchema),
});
export type ScriptEntry = z.infer<typeof scriptEntrySchema>;

/* ------------------------------------------------------------------ */
/* BGM / style                                                          */
/* ------------------------------------------------------------------ */

export const bgmSchema = z.object({
  /** asset ref, e.g. "assets/bgm.mp3" */
  path: assetRefSchema,
  /** 0..1 */
  volume: z.number().min(0).max(1),
  /** negative dB applied while narration plays (e.g. -12) */
  duckingDb: z.number().max(0),
  fadeOutSec: z.number().nonnegative(),
});
export type Bgm = z.infer<typeof bgmSchema>;

export const fontIdSchema = z.enum(["noto-sans-jp"]);
export type FontId = z.infer<typeof fontIdSchema>;

export const styleSchema = z.object({
  /** CSS color, e.g. "#ff3b30" */
  primaryColor: z.string(),
  accentColor: z.string(),
  font: fontIdSchema,
});
export type Style = z.infer<typeof styleSchema>;

/* ------------------------------------------------------------------ */
/* Project                                                              */
/* ------------------------------------------------------------------ */

export const PROJECT_SCHEMA_VERSION = 1 as const;

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
  script: z.array(scriptEntrySchema),
  captions: captionsSchema,
  bgm: bgmSchema.optional(),
  style: styleSchema,
});
export type Project = z.infer<typeof projectSchema>;

/* ------------------------------------------------------------------ */
/* Factory                                                              */
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
      releaseText: "",
      platforms: ["Steam"],
    },
    sources: [],
    candidates: [],
    clips: [],
    texts: structuredClone(DEFAULT_TEXTS),
    script: [],
    captions: { ja: [], en: [] },
    style: {
      primaryColor: "#ffffff",
      accentColor: "#ffcc00",
      font: "noto-sans-jp",
    },
  };
}
