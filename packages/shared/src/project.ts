import { z } from "zod";
import { stripEmphasis } from "./emphasis";

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

export const templateIdSchema = z.enum(["hook-play-cta", "features", "trailer", "intro"]);
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
  /**
   * 9:16 with style.vertical.mode "crop": horizontal center of the full-bleed crop, 0..1
   * (0 = left edge, 0.5 = center = default when absent, 1 = right edge). Also used as the
   * object-position of the blurred background in "blur" mode.
   */
  focusX: z.number().min(0).max(1).optional(),
  /**
   * v3, template "features": id of the templateData.features.items entry this MAIN-slot clip belongs to.
   * Absent / unknown id -> distributed round-robin (see assignFeatureClips). Ignored by other templates.
   */
  featureId: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
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
  /** v4: may contain 【emphasis】 markers (rendered colored + larger, brackets hidden) */
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

/** Engines that SYNTHESIZE speech (voice lists, preview). */
export const ttsEngineSchema = z.enum(["voicevox", "piper"]);
export type TtsEngine = z.infer<typeof ttsEngineSchema>;

/** v3: engine of a script line's voice = a TTS engine, or "recorded" (user-uploaded recording). */
export const voiceEngineSchema = z.enum(["voicevox", "piper", "recorded"]);
export type VoiceEngine = z.infer<typeof voiceEngineSchema>;

export const voiceSchema = z
  .object({
    engine: voiceEngineSchema,
    /**
     * VOICEVOX: style id as a decimal string (e.g. "3"). Piper: voice name = .onnx basename (e.g. "en_US-lessac-medium").
     * "recorded": unused, may be "" (required non-empty for the TTS engines).
     */
    speaker: z.string(),
    /** speech rate multiplier, 1 = normal (VOICEVOX speedScale / Piper length_scale = 1/speed). Ignored for "recorded". */
    speed: z.number().min(0.5).max(2),
    /**
     * v3, engine "recorded" only: asset ref of the uploaded recording ("assets/<nanoid>.<ext>", via POST /assets).
     * POST /tts converts it to tts/<lineId>.wav. Absent -> the line cannot be "synthesized" (status "error").
     */
    sourcePath: assetRefSchema.optional(),
  })
  .refine((v) => v.engine === "recorded" || v.speaker.length > 0, {
    message: "voice.speaker is required for TTS engines",
    path: ["speaker"],
  });
export type Voice = z.infer<typeof voiceSchema>;

/** True when two voices produce the same audio (engine, speaker, speed and, for "recorded", sourcePath). */
export function sameVoice(a: Voice, b: Voice): boolean {
  return a.engine === b.engine && a.speaker === b.speaker && a.speed === b.speed && a.sourcePath === b.sourcePath;
}

/** v3: a recorded (uploaded) narration voice. */
export function createRecordedVoice(sourcePath?: string): Voice {
  return sourcePath ? { engine: "recorded", speaker: "", speed: 1, sourcePath } : { engine: "recorded", speaker: "", speed: 1 };
}

export const scriptLineStatusSchema = z.enum(["none", "ok", "stale", "error"]);
export type ScriptLineStatus = z.infer<typeof scriptLineStatusSchema>;

/**
 * One narration line (v2). The array order of lines with the same (lang, section) = playback order.
 *
 * v3 "recorded" lines (voice.engine === "recorded"): the audio is the uploaded voice.sourcePath, converted by
 * POST /tts (same endpoint, same status rules). `text` is optional for them (playable with empty text); when
 * non-empty it is used as the caption text (timed with whisper), otherwise captions are the whisper transcript.
 * The web sets "stale" when sourcePath or text changes (sameVoice() covers sourcePath).
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
  /** narration text; v4: may contain 【emphasis】 markers (not spoken: TTS uses stripEmphasis(text)) */
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
   * VOICEVOX: "VOICEVOX:<character name>" (e.g. "VOICEVOX:ずんだもん"). Piper / recorded: absent.
   */
  credit: z.string().optional(),
  /**
   * v3, server-owned: non-fatal problem of the last successful synthesis (e.g. "whisper failed, captions use
   * proportional timing"). Set together with status "ok"; removed on the next synthesis / clear.
   */
  warning: z.string().optional(),
  /**
   * v3, section "main" + template "features": id of the templateData.features.items entry this line is
   * bound to (played inside that feature). Absent / unknown -> unbound (ARCHITECTURE §5.5). Ignored otherwise.
   */
  featureId: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
});
export type ScriptLine = z.infer<typeof scriptLineSchema>;

/**
 * v3: true if the line has something to turn into audio: non-empty text (TTS engines), or an uploaded
 * recording (engine "recorded" + sourcePath; text optional). Used for POST /tts target selection,
 * "playable" checks and the web's synth buttons.
 */
export function hasNarrationInput(line: Pick<ScriptLine, "text" | "voice">): boolean {
  if (line.voice.engine === "recorded") return !!line.voice.sourcePath;
  // v4: emphasis markers 【】 are not spoken
  return stripEmphasis(line.text).trim() !== "";
}

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
  /**
   * v3, server-owned (POST /bgm/analyze): beat times in seconds from the start of the file, ascending.
   * Only valid for the current `path` (the web drops beats/bpm/analysis* when it replaces the file).
   */
  beats: z.array(z.number().nonnegative()).optional(),
  /** v3, server-owned: estimated tempo (beats per minute) */
  bpm: z.number().positive().optional(),
  /** v3, server-owned: beat analysis state; absent = "none" */
  analysisStatus: analysisStatusSchema.optional(),
  /** v3, server-owned: set only when analysisStatus === "error" */
  analysisError: z.string().optional(),
});
export type Bgm = z.infer<typeof bgmSchema>;

/**
 * v4: sound-effect slots. A template emits SE events per slot (ARCHITECTURE §5.9); each slot plays the library
 * file assigned to it (unset = silent).
 */
export const seSlotSchema = z.enum(["captionPop", "headline", "point", "info", "transition", "cta"]);
export type SeSlot = z.infer<typeof seSlotSchema>;
export const SE_SLOTS = seSlotSchema.options;

/**
 * v4: SE library file id = path RELATIVE TO THE SE LIBRARY DIR (config se.dir, default D:\Tools\se), forward
 * slashes, e.g. "_placeholder/pop.wav", "otologic/Onmtp-Click01-1.mp3". No "..", no leading "/", no drive
 * letter, no backslash, no dot-file segments. Served at GET /api/se/file/<id> (seFileUrl in compositions).
 */
export const seFileIdSchema = z
  .string()
  .min(1)
  .max(400)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !p.includes("\\") &&
      !p.includes("\0") &&
      !/^[a-zA-Z]:/.test(p) &&
      p.split("/").every((seg) => seg !== "" && !seg.startsWith(".")),
    { message: "SE file id must be a library-relative path using forward slashes" },
  );
export type SeFileId = z.infer<typeof seFileIdSchema>;

export const seSlotsSchema = z.object({
  /** each caption chunk appearing (emitted centrally by <AdVideo> when the template opts in) */
  captionPop: seFileIdSchema.optional(),
  /** headline / title appearing */
  headline: seFileIdSchema.optional(),
  /** a recommended point (①②③) appearing */
  point: seFileIdSchema.optional(),
  /** the game info card appearing */
  info: seFileIdSchema.optional(),
  /** clip switch / scene transition */
  transition: seFileIdSchema.optional(),
  /** end card / call to action */
  cta: seFileIdSchema.optional(),
});
export type SeSlots = z.infer<typeof seSlotsSchema>;

export const seSettingsSchema = z.object({
  /** master switch (false = no SE at all) */
  enabled: z.boolean(),
  /** master SE volume 0..1 (not ducked) */
  volume: z.number().min(0).max(1),
  slots: seSlotsSchema,
  /**
   * Snapshot of the library credits (se.json) of the files used in `slots`: file id -> credit text
   * (e.g. "効果音:OtoLogic"). WEB-maintained (refreshed from GET /api/se whenever slots or the manifest change)
   * so that collectCredits() / the end card work without the API (render). Absent / missing key = no credit.
   */
  credits: z.record(z.string(), z.string()).optional(),
});
export type SeSettings = z.infer<typeof seSettingsSchema>;

export const audioSettingsSchema = z.object({
  /** narration (TTS) volume 0..1 */
  narrationVolume: z.number().min(0).max(1),
  /** multiplier 0..1 applied to each clip's gameVolume while narration plays (game-audio ducking) */
  gameVolumeUnderNarration: z.number().min(0).max(1),
  bgm: bgmSchema.optional(),
  /** v4: sound effects (only templates that emit SE events play them; currently "intro") */
  se: seSettingsSchema,
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

/** v3: how 16:9 footage is fit into a 9:16 frame. */
export const verticalModeSchema = z.enum(["blur", "crop"]);
export type VerticalMode = z.infer<typeof verticalModeSchema>;

export const verticalStyleSchema = z.object({
  /**
   * "blur" (default): full 16:9 video centered, blurred copy fills the bands above/below.
   * "crop": full-bleed 9:16 crop of the footage, horizontal center = clip.focusX (default 0.5).
   */
  mode: verticalModeSchema,
});
export type VerticalStyle = z.infer<typeof verticalStyleSchema>;

export const styleSchema = z.object({
  /** CSS color, e.g. "#ff3b30" */
  primaryColor: z.string(),
  accentColor: z.string(),
  font: fontIdSchema,
  /** v2 */
  watermark: watermarkSchema,
  /** v2 */
  captions: captionStyleSchema,
  /** v3: 9:16 layout (default { mode: "blur" }) */
  vertical: verticalStyleSchema,
  /**
   * v4: CSS color of 【emphasis】 runs in captions / headlines (default EMPHASIS_COLORS.yellow "#FFE14D";
   * the UI also offers EMPHASIS_COLORS.red).
   */
  emphasisColor: z.string(),
});
export type Style = z.infer<typeof styleSchema>;

/* ------------------------------------------------------------------ */
/* Template data (v3)                                                   */
/* ------------------------------------------------------------------ */

const itemIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

/** One "魅力" (selling point) of the features template. */
export const featureItemSchema = z.object({
  /** "feat_" + id; referenced by clip.featureId / scriptLine.featureId */
  id: itemIdSchema,
  /** heading shown with the feature, e.g. { ja: "爽快なアクション", en: "Thrilling action" } */
  heading: localizedTextSchema,
  /** optional smaller line under the heading ("" or absent = none) */
  sub: localizedTextSchema.optional(),
});
export type FeatureItem = z.infer<typeof featureItemSchema>;

export const featuresDataSchema = z.object({
  /** display order = playback order; the UI keeps 2..4 items (0..4 are valid) */
  items: z.array(featureItemSchema).max(4),
});
export type FeaturesData = z.infer<typeof featuresDataSchema>;

/** Big full-screen text card of the trailer template. */
export const trailerCardSchema = z.object({
  /** "card_" + id */
  id: itemIdSchema,
  text: localizedTextSchema,
  /**
   * Shown right AFTER the cut with this index in trailerClipOrder(project) (0-based; -1 = before the first cut).
   * Index >= number of cuts -> after the last cut (before the logo reveal).
   */
  afterClipIndex: z.number().int().min(-1),
});
export type TrailerCard = z.infer<typeof trailerCardSchema>;

export const trailerDataSchema = z.object({
  cards: z.array(trailerCardSchema),
  /** snap cut points to audio.bgm.beats (when a BGM with beats exists) */
  beatSync: z.boolean(),
  /** logo / title reveal before the end card */
  logoReveal: z.boolean(),
});
export type TrailerData = z.infer<typeof trailerDataSchema>;

/**
 * v4: reference to a script line PER LANGUAGE (script lines are per language, so a binding needs one id per
 * language). Absent / unknown / not-playable id for the rendered lang = unbound (template default applies).
 */
export const langLineRefSchema = z.object({
  ja: itemIdSchema.optional(),
  en: itemIdSchema.optional(),
});
export type LangLineRef = z.infer<typeof langLineRefSchema>;

/** One row of the intro info card, e.g. { label: { ja: "ジャンル", en: "Genre" }, value: { ja: "アクション", en: "Action" } }. */
export const introInfoItemSchema = z.object({
  /** "info_" + id */
  id: itemIdSchema,
  label: localizedTextSchema,
  /** may contain 【emphasis】; "" = row hidden in that language */
  value: localizedTextSchema,
});
export type IntroInfoItem = z.infer<typeof introInfoItemSchema>;

/** One numbered recommended point (①②③…) of the intro template. */
export const introPointSchema = z.object({
  /** "point_" + id */
  id: itemIdSchema,
  /** may contain 【emphasis】; "" = point skipped in that language */
  text: localizedTextSchema,
  /** show this point's badge while that line plays (per language). Absent = auto (ARCHITECTURE §5.8) */
  lineId: langLineRefSchema.optional(),
});
export type IntroPoint = z.infer<typeof introPointSchema>;

/** v4: template "intro" (紹介動画風, vertical-first game introduction short). ARCHITECTURE §5.8. */
export const introDataSchema = z.object({
  /** persistent headline band; 【emphasis】 + "\n" line breaks; "" = no headline text in that language */
  headline: localizedTextSchema,
  /**
   * small label above the headline, e.g. { ja: "今話題", en: "TRENDING" }. Displayed with stripEmphasis()
   * (so "【今話題】" and "今話題" look the same: the whole label is drawn as a badge). Absent / "" = none.
   */
  kicker: localizedTextSchema.optional(),
  info: z.object({
    enabled: z.boolean(),
    /** rows in display order (UI keeps 1..6) */
    items: z.array(introInfoItemSchema).max(6),
    /** start the card when this line starts (per language). Absent = the 2nd body line (§5.8) */
    atLineId: langLineRefSchema.optional(),
    /** how long the card stays, seconds */
    durationSec: z.number().min(0.5).max(20),
  }),
  points: z.object({
    /** display order = numbering ①②③…; max 5 */
    items: z.array(introPointSchema).max(5),
  }),
  /** true (default): every body narration line switches to the next clip (§5.8); false: clips play back to back */
  clipPerLine: z.boolean(),
});
export type IntroData = z.infer<typeof introDataSchema>;

/** v3: per-template settings. Every template's data is kept regardless of the selected template. */
export const templateDataSchema = z.object({
  features: featuresDataSchema,
  trailer: trailerDataSchema,
  /** v4 */
  intro: introDataSchema,
});
export type TemplateData = z.infer<typeof templateDataSchema>;

/* ------------------------------------------------------------------ */
/* Project                                                              */
/* ------------------------------------------------------------------ */

export const PROJECT_SCHEMA_VERSION = 4 as const;

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
  /** v3 (v4: + intro) */
  templateData: templateDataSchema,
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

/** v4: SE library dir subfolder with the generated placeholder sounds (server creates them when missing). */
export const SE_PLACEHOLDER_DIR = "_placeholder";

/** v4: placeholder file per slot (relative to the SE library), used by DEFAULT_SE. */
export const SE_PLACEHOLDER_FILES: Record<SeSlot, SeFileId> = {
  captionPop: "_placeholder/pop.wav",
  headline: "_placeholder/headline.wav",
  point: "_placeholder/point.wav",
  info: "_placeholder/info.wav",
  transition: "_placeholder/transition.wav",
  cta: "_placeholder/cta.wav",
};

/** v4: default SE settings: on, volume 0.7, every slot mapped to its placeholder. */
export const DEFAULT_SE: SeSettings = {
  enabled: true,
  volume: 0.7,
  slots: { ...SE_PLACEHOLDER_FILES },
};

/** v4: templates that emit SE events (others never play SE, and collectCredits skips SE credits for them). */
export const SE_TEMPLATES: readonly TemplateId[] = ["intro"];
export const templateUsesSe = (id: TemplateId): boolean => SE_TEMPLATES.includes(id);

export const DEFAULT_AUDIO: AudioSettings = {
  narrationVolume: 1,
  gameVolumeUnderNarration: 0.35,
  se: structuredClone(DEFAULT_SE),
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
  vertical: { mode: "blur" },
  emphasisColor: "#FFE14D",
};

/** Defaults of templateData (deterministic ids, so repeated in-memory migrations of the same file agree). */
export function createDefaultTemplateData(): TemplateData {
  return {
    features: {
      items: [
        { id: "feat_1", heading: { ja: "爽快なアクション", en: "Thrilling action" } },
        { id: "feat_2", heading: { ja: "奥深い戦略", en: "Deep strategy" } },
        { id: "feat_3", heading: { ja: "美しい世界", en: "A gorgeous world" } },
      ],
    },
    trailer: {
      cards: [
        { id: "card_1", text: { ja: "運命に抗え", en: "DEFY YOUR FATE" }, afterClipIndex: 1 },
        { id: "card_2", text: { ja: "すべてを賭けろ", en: "RISK IT ALL" }, afterClipIndex: 3 },
      ],
      beatSync: true,
      logoReveal: true,
    },
    intro: createDefaultIntroData(),
  };
}

/** v4: defaults of templateData.intro (deterministic ids info_1..4 / point_1..3). */
export function createDefaultIntroData(): IntroData {
  return {
    headline: { ja: "このゲーム\n【神すぎる】んだが！", en: "This game is\n【INSANELY GOOD】" },
    kicker: { ja: "今話題", en: "TRENDING" },
    info: {
      enabled: true,
      items: [
        { id: "info_1", label: { ja: "ジャンル", en: "Genre" }, value: { ja: "アクション", en: "Action" } },
        { id: "info_2", label: { ja: "価格", en: "Price" }, value: { ja: "1,500円", en: "$9.99" } },
        { id: "info_3", label: { ja: "対応機種", en: "Platforms" }, value: { ja: "PC(Steam)", en: "PC (Steam)" } },
        { id: "info_4", label: { ja: "発売日", en: "Release" }, value: { ja: "2026年冬", en: "Winter 2026" } },
      ],
      durationSec: 4,
    },
    points: {
      items: [
        { id: "point_1", text: { ja: "【爽快】なアクション", en: "【Thrilling】 action" } },
        { id: "point_2", text: { ja: "毎回変わる【ステージ】", en: "A 【new stage】 every run" } },
        { id: "point_3", text: { ja: "やり込み要素が【無限】", en: "【Endless】 replay value" } },
      ],
    },
    clipPerLine: true,
  };
}

/**
 * v4, template "intro": clip order for the per-line clip switching = hook-slot clips (array order) then
 * main-slot clips (array order) — the same list as trailerClipOrder. Body line k uses clip k % n.
 */
export function introClipOrder(project: Pick<Project, "clips">): Clip[] {
  return trailerClipOrder(project);
}

/**
 * v4, template "intro": the BODY lines of `lang` in playback order = hook lines (array order) then main lines
 * (array order). Every line is listed (playable or not) — the web uses this for the info / point line pickers;
 * the template only places playable ones. cta lines play on the end card and are not body lines.
 */
export function introBodyLines(project: Pick<Project, "script">, lang: Lang): ScriptLine[] {
  const ls = project.script.filter((l) => l.lang === lang);
  return [...ls.filter((l) => l.section === "hook"), ...ls.filter((l) => l.section === "main")];
}

/**
 * Template "features": main-slot clips per feature item (keys = item ids, in item order; each list in clip
 * array order). A clip whose featureId matches an item goes there; the others ("unassigned": no / unknown
 * featureId) are distributed ROUND-ROBIN in clip array order: the k-th unassigned clip -> items[k % N].
 * Hook-slot clips are not included (they play in the intro). No items -> {}.
 */
export function assignFeatureClips(project: Pick<Project, "clips" | "templateData">): Record<string, Clip[]> {
  const items = project.templateData.features.items;
  const out: Record<string, Clip[]> = {};
  for (const it of items) out[it.id] = [];
  if (items.length === 0) return out;
  let k = 0;
  for (const c of project.clips) {
    if (c.slot !== "main") continue;
    const own = c.featureId ? out[c.featureId] : undefined;
    if (own) own.push(c);
    else out[items[k++ % items.length]!.id]!.push(c);
  }
  return out;
}

/**
 * Template "trailer": the cut list = hook-slot clips (array order) followed by main-slot clips (array order).
 * trailerCard.afterClipIndex indexes into THIS list (an unusable clip keeps its index but produces no cut).
 */
export function trailerClipOrder(project: Pick<Project, "clips">): Clip[] {
  return [...project.clips.filter((c) => c.slot === "hook"), ...project.clips.filter((c) => c.slot === "main")];
}

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

/**
 * Unique credits (e.g. "VOICEVOX:ずんだもん") required by the narration lines of `lang` (all langs if omitted).
 * A line's stored `credit` (set on synthesis) wins; for VOICEVOX lines without one (not synthesized yet) the
 * credit is looked up by speaker in `voices` (e.g. GET /api/tts/voices?engine=voicevox), falling back to
 * DEFAULT_VOICEVOX_CREDIT for the default speaker. Lines with empty text, Piper and recorded lines need none.
 * v4: + SE credits (collectSeCredits; pass `seFiles` = GET /api/se `files` for fresh values, otherwise the
 * project's audio.se.credits snapshot is used — that is what the end card shows in renders).
 */
export function collectCredits(
  project: Project,
  lang?: Lang,
  voices?: readonly { speaker: string; credit?: string }[],
  seFiles?: readonly { id: string; credit?: string }[],
): string[] {
  const out = new Set<string>();
  for (const l of project.script) {
    if (lang && l.lang !== lang) continue;
    if (!stripEmphasis(l.text).trim()) continue;
    if (l.credit) {
      out.add(l.credit);
      continue;
    }
    if (l.voice.engine !== "voicevox") continue;
    const looked = voices?.find((v) => v.speaker === l.voice.speaker)?.credit;
    if (looked) out.add(looked);
    else if (l.voice.speaker === DEFAULT_VOICEVOX_SPEAKER) out.add(DEFAULT_VOICEVOX_CREDIT);
  }
  for (const c of collectSeCredits(project, seFiles)) out.add(c);
  return [...out];
}

/**
 * v4: credits of the SE library files the project actually plays: only for templates that emit SE
 * (templateUsesSe), audio.se.enabled and volume > 0, over the files assigned to slots (deduplicated, slot order).
 * Credit per file = `seFiles` (GET /api/se `files`, fresh) when given, else the audio.se.credits snapshot.
 * Language-independent. Included by collectCredits().
 */
export function collectSeCredits(
  project: Pick<Project, "template" | "audio">,
  seFiles?: readonly { id: string; credit?: string }[],
): string[] {
  const se = project.audio.se;
  if (!templateUsesSe(project.template) || !se.enabled || se.volume <= 0) return [];
  const out = new Set<string>();
  for (const slot of SE_SLOTS) {
    const id = se.slots[slot];
    if (!id) continue;
    const credit = seFiles ? seFiles.find((f) => f.id === id)?.credit : se.credits?.[id];
    if (credit?.trim()) out.add(credit.trim());
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
    templateData: createDefaultTemplateData(),
  };
}
