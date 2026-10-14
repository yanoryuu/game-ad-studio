import {
  DEFAULT_AUDIO,
  DEFAULT_SE,
  DEFAULT_STYLE,
  DEFAULT_VOICES,
  PROJECT_SCHEMA_VERSION,
  createDefaultIntroData,
  createDefaultShortFormData,
  SHORT_TEMPLATE_IDS,
  createDefaultTemplateData,
  langSchema,
  projectSchema,
  type Lang,
  type Project,
  type ScriptLine,
} from "./project";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Upgrades a raw project.json (any known schemaVersion) to the current schema and validates it.
 * Throws (ZodError or Error) when the data is not a valid project.
 *
 * v1 -> v2:
 *  - game.releaseText: string -> { ja: s, en: s }
 *  - sources[]: + proxyStatus "ready" (v1 proxies were encoded synchronously), analysisStatus "none"
 *  - candidates: v1 never wrote any; entries not matching the v2 shape are dropped
 *  - script: v1 entries ({ voice: { speakerId } }) are converted to v2 lines with status "none" (audio dropped)
 *  - bgm (top level) -> audio.bgm (+ loop: true); audio gets narrationVolume / gameVolumeUnderNarration defaults
 *  - style: + watermark { position "top-right", scale 1 }, + captions { enabled, "bottom", "m" }
 *
 * v2 -> v3 (Phase 3):
 *  - templateData: added with createDefaultTemplateData() (3 feature items, 2 trailer cards, beatSync/logoReveal on)
 *  - style.vertical: added { mode: "blur" }
 *  - everything else is additive + optional (clip.featureId, line.featureId/warning, voice.sourcePath,
 *    bgm.beats/bpm/analysisStatus/analysisError) -> nothing to convert
 *
 * v3 -> v4 (Phase 3.5, template "intro"):
 *  - templateData.intro: added with createDefaultIntroData()
 *  - audio.se: added DEFAULT_SE (enabled, volume 0.7, every slot -> _placeholder/*.wav). Only SE-emitting
 *    templates (SE_TEMPLATES = ["intro"]) play them, so existing templates sound exactly as before.
 *  - style.emphasisColor: added "#FFE14D"
 *  - 【】 in existing texts become emphasis markup (no conversion; such brackets were rare before)
 *
 * v4 -> v5 (10 short-form templates):
 *  - templateData.shorts: added; every missing template entry gets createDefaultShortFormData(id)
 */
export function migrateProject(raw: unknown): Project {
  if (!isObj(raw)) throw new Error("project.json is not an object");
  const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1;
  if (version > PROJECT_SCHEMA_VERSION) {
    throw new Error(`project.json schemaVersion ${version} is newer than supported (${PROJECT_SCHEMA_VERSION})`);
  }
  let p: Obj = structuredClone(raw);
  if (version < 2) p = v1ToV2(p);
  if (version < 3) p = v2ToV3(p);
  if (version < 4) p = v3ToV4(p);
  if (version < 5) p = v4ToV5(p);
  return projectSchema.parse(p);
}

function v4ToV5(p: Obj): Obj {
  const out: Obj = { ...p, schemaVersion: 5 };
  const td: Obj = isObj(p.templateData) ? { ...p.templateData } : {};
  const shorts: Obj = isObj(td.shorts) ? { ...td.shorts } : {};
  for (const id of SHORT_TEMPLATE_IDS) if (!isObj(shorts[id])) shorts[id] = createDefaultShortFormData(id);
  td.shorts = shorts;
  out.templateData = td;
  return out;
}

function v3ToV4(p: Obj): Obj {
  const out: Obj = { ...p, schemaVersion: 4 };
  const td: Obj = isObj(p.templateData) ? { ...p.templateData } : {};
  if (!isObj(td.intro)) td.intro = createDefaultIntroData();
  out.templateData = td;
  const audio: Obj = isObj(p.audio) ? { ...p.audio } : { ...DEFAULT_AUDIO };
  audio.se = structuredClone(isObj(audio.se) ? audio.se : DEFAULT_SE);
  out.audio = audio;
  const style: Obj = isObj(p.style) ? { ...p.style } : { ...DEFAULT_STYLE };
  if (typeof style.emphasisColor !== "string") style.emphasisColor = DEFAULT_STYLE.emphasisColor;
  out.style = style;
  return out;
}

function v2ToV3(p: Obj): Obj {
  const out: Obj = { ...p, schemaVersion: 3 };
  if (!isObj(p.templateData)) out.templateData = createDefaultTemplateData();
  const style: Obj = isObj(p.style) ? { ...p.style } : { ...DEFAULT_STYLE };
  if (!isObj(style.vertical)) style.vertical = { ...DEFAULT_STYLE.vertical };
  out.style = style;
  return out;
}

function v1ToV2(p: Obj): Obj {
  const out: Obj = { ...p, schemaVersion: 2 };

  // game.releaseText
  if (isObj(p.game)) {
    const rt = p.game.releaseText;
    const s = typeof rt === "string" ? rt : "";
    out.game = { ...p.game, releaseText: isObj(rt) ? rt : { ja: s, en: s } };
  }

  // sources
  if (Array.isArray(p.sources)) {
    out.sources = p.sources.map((s) =>
      isObj(s)
        ? {
            ...s,
            proxyStatus: typeof s.proxyStatus === "string" ? s.proxyStatus : "ready",
            analysisStatus: typeof s.analysisStatus === "string" ? s.analysisStatus : "none",
          }
        : s,
    );
  }

  // candidates: keep only v2-shaped ones
  if (Array.isArray(p.candidates)) {
    out.candidates = p.candidates.filter((c) => isObj(c) && isObj(c.features) && typeof c.thumbPath === "string");
  } else {
    out.candidates = [];
  }

  // script
  if (Array.isArray(p.script)) {
    out.script = p.script.filter(isObj).map((e, i): ScriptLine | Obj => {
      if (isObj(e.voice) && typeof e.voice.engine === "string") return e; // already v2-like
      const langParsed = langSchema.safeParse(e.lang);
      const lang: Lang = langParsed.success ? langParsed.data : "ja";
      const v1Voice = isObj(e.voice) ? e.voice : {};
      const voice = { ...DEFAULT_VOICES[lang] };
      if (lang === "ja" && typeof v1Voice.speakerId === "number") voice.speaker = String(v1Voice.speakerId);
      if (typeof v1Voice.speed === "number") voice.speed = Math.min(2, Math.max(0.5, v1Voice.speed));
      const id = typeof e.id === "string" && /^[A-Za-z0-9_-]+$/.test(e.id) ? e.id : `line_v1_${i}`;
      return {
        id,
        lang,
        section: e.section,
        text: typeof e.text === "string" ? e.text : "",
        voice,
        offsetSec: 0,
        captions: [],
        status: "none",
      };
    });
  } else {
    out.script = [];
  }

  // bgm -> audio.bgm
  const audio: Obj = isObj(p.audio) ? { ...DEFAULT_AUDIO, ...p.audio } : { ...DEFAULT_AUDIO };
  if (isObj(p.bgm) && !isObj(audio.bgm)) audio.bgm = { loop: true, ...p.bgm };
  out.audio = audio;
  delete out.bgm;

  // style
  const style: Obj = isObj(p.style) ? { ...p.style } : { ...DEFAULT_STYLE };
  if (!isObj(style.watermark)) style.watermark = { ...DEFAULT_STYLE.watermark };
  if (!isObj(style.captions)) style.captions = { ...DEFAULT_STYLE.captions };
  out.style = style;

  return out;
}
