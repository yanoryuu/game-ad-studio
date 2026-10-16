import fs from "node:fs";
import path from "node:path";
import {
  createScriptLine,
  DEFAULT_BGM,
  DEFAULT_VOICES,
  generateId,
  IMAGE_EXTS,
  isStillImageSource,
  sameVoice,
  stripEmphasis,
  VIDEO_EXTS,
  type Bgm,
  type BgmListResponse,
  type Candidate,
  type Clip,
  type DurationSec,
  type Format,
  type Fps,
  type Lang,
  type Project,
  type RenderBatchResponse,
  type RenderJob,
  type RenderStartResponse,
  type ScriptLine,
  type SeListResponse,
  type StillsResponse,
  type TemplateId,
  type Voice,
} from "@gas/shared";
import { apiGet, apiPost, apiUpload, enc } from "./api";
import { editProject, getProject, waitForProject, withProjectLock } from "./project";
import { applyTemplateData, type TemplateDataInput } from "./templateEdit";

export type Progress = (message: string) => void;
const noop: Progress = () => {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/* Project create / settings                                           */
/* ------------------------------------------------------------------ */

export type ProjectSettings = {
  name?: string;
  template?: TemplateId;
  formats?: Format[];
  languages?: Lang[];
  durationSec?: DurationSec;
  fps?: Fps;
  gameTitle?: string;
  releaseText?: string | { ja?: string; en?: string };
  platforms?: string[];
  steamUrl?: string;
};

export function applySettings(p: Project, s: ProjectSettings) {
  if (s.name !== undefined) p.name = s.name;
  if (s.template !== undefined) p.template = s.template;
  if (s.formats?.length) p.formats = [...new Set(s.formats)];
  if (s.languages?.length) p.languages = [...new Set(s.languages)];
  if (s.durationSec !== undefined) p.durationSec = s.durationSec;
  if (s.fps !== undefined) p.fps = s.fps;
  if (s.gameTitle !== undefined) p.game.title = s.gameTitle;
  if (s.releaseText !== undefined) {
    if (typeof s.releaseText === "string") p.game.releaseText[p.languages[0] ?? "ja"] = s.releaseText;
    else p.game.releaseText = { ja: s.releaseText.ja ?? p.game.releaseText.ja, en: s.releaseText.en ?? p.game.releaseText.en };
  }
  if (s.platforms !== undefined) p.game.platforms = s.platforms;
  if (s.steamUrl !== undefined) p.game.steamUrl = s.steamUrl || undefined;
}

export async function createProject(s: ProjectSettings & { name: string }): Promise<Project> {
  const created = await apiPost<Project>("/api/projects", { name: s.name });
  return editProject(created.id, (p) => {
    applySettings(p, s);
    if (s.gameTitle === undefined) p.game.title = s.name;
    // 9:16-first templates: crop is not used by intro/shorts; keep blur default
  });
}

/* ------------------------------------------------------------------ */
/* Sources                                                              */
/* ------------------------------------------------------------------ */

const SOURCE_EXTS = new Set<string>([...VIDEO_EXTS, ...IMAGE_EXTS]);

export type AddSourcesResult = {
  added: { id: string; path: string; kind: string }[];
  errors: { path: string; error: string }[];
  project: Project;
  timedOut: boolean;
};

export async function addSources(
  projectId: string,
  paths: string[],
  opts: { mode: "upload" | "reference"; analyze: boolean; wait: boolean; timeoutSec: number },
  progress: Progress = noop,
): Promise<AddSourcesResult> {
  const added: AddSourcesResult["added"] = [];
  const errors: AddSourcesResult["errors"] = [];
  // Serialized with our own PUTs (a PUT from an older snapshot would drop a source added meanwhile, §6.2).
  await withProjectLock(projectId, async () => {
    for (const raw of paths) {
      const abs = path.resolve(raw);
      const ext = path.extname(abs).toLowerCase();
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        errors.push({ path: raw, error: "file not found (give an absolute local path)" });
        continue;
      }
      if (!SOURCE_EXTS.has(ext)) {
        errors.push({ path: raw, error: `unsupported extension ${ext || "(none)"}; allowed: ${[...SOURCE_EXTS].join(" ")}` });
        continue;
      }
      try {
        const before = new Set((await getProject(projectId)).sources.map((s) => s.id));
        progress(`${opts.mode === "upload" ? "uploading" : "registering"} ${path.basename(abs)} (${(fs.statSync(abs).size / 1048576).toFixed(1)} MB)`);
        const p =
          opts.mode === "upload"
            ? await apiUpload<Project>(`/api/projects/${enc(projectId)}/sources/upload`, abs)
            : await apiPost<Project>(`/api/projects/${enc(projectId)}/sources`, { path: abs });
        const s = p.sources.find((x) => !before.has(x.id));
        if (s) added.push({ id: s.id, path: abs, kind: s.kind === "image" ? "image" : "video" });
      } catch (e) {
        errors.push({ path: raw, error: (e as Error).message });
      }
    }
  });
  let project = await getProject(projectId);
  if (!opts.wait && !opts.analyze) return { added, errors, project, timedOut: false };

  const deadline = Date.now() + opts.timeoutSec * 1000;
  const ids = new Set(added.map((a) => a.id));
  // proxies (needed before analysis)
  const proxies = await waitForProject(
    projectId,
    (p) => p.sources.filter((s) => ids.has(s.id)).every((s) => s.proxyStatus !== "pending"),
    Math.max(0, deadline - Date.now()),
    (p) => progress(`waiting for proxies: ${p.sources.filter((s) => ids.has(s.id) && s.proxyStatus === "pending").length} pending`),
  );
  project = proxies.project;
  if (proxies.timedOut) return { added, errors, project, timedOut: true };

  if (opts.analyze) {
    for (const s of project.sources) {
      if (!ids.has(s.id) || s.kind === "image" || s.proxyStatus !== "ready" || s.analysisStatus === "running") continue;
      try {
        await apiPost<Project>(`/api/projects/${enc(projectId)}/sources/${enc(s.id)}/analyze`);
        progress(`analyzing highlights of ${s.id}`);
      } catch (e) {
        errors.push({ path: s.originalPath, error: `analysis: ${(e as Error).message}` });
      }
    }
    if (opts.wait) {
      const done = await waitForProject(
        projectId,
        (p) => p.sources.filter((s) => ids.has(s.id)).every((s) => s.analysisStatus !== "running"),
        Math.max(0, deadline - Date.now()),
        (p) => progress(`analysis running on ${p.sources.filter((s) => ids.has(s.id) && s.analysisStatus === "running").length} source(s)`),
      );
      return { added, errors, project: done.project, timedOut: done.timedOut };
    }
    project = await getProject(projectId);
  }
  return { added, errors, project, timedOut: false };
}

/* ------------------------------------------------------------------ */
/* Clips                                                                */
/* ------------------------------------------------------------------ */

export type ClipInput = {
  candidateId?: string;
  sourceId?: string;
  inSec?: number;
  outSec?: number;
  slot?: "hook" | "main";
  focusX?: number;
  imageMotion?: "none" | "zoomIn" | "zoomOut" | "panLeft" | "panRight";
  gameVolume?: number;
  featureId?: string;
};

export const DEFAULT_GAME_VOLUME = 0.8;

export function buildClip(p: Project, c: ClipInput): Clip {
  let clip: Clip;
  if (c.candidateId) {
    const cand = p.candidates.find((x) => x.id === c.candidateId);
    if (!cand) throw new Error(`Candidate ${c.candidateId} not found (get_candidates lists them)`);
    clip = { id: generateId("clip", 8), sourceId: cand.sourceId, inSec: cand.startSec, outSec: cand.endSec, slot: c.slot ?? "main", gameVolume: DEFAULT_GAME_VOLUME };
    if (c.inSec !== undefined) clip.inSec = c.inSec;
    if (c.outSec !== undefined) clip.outSec = c.outSec;
  } else if (c.sourceId) {
    const s = p.sources.find((x) => x.id === c.sourceId);
    if (!s) throw new Error(`Source ${c.sourceId} not found (get_project lists sources)`);
    const still = isStillImageSource(s);
    const inSec = c.inSec ?? 0;
    const outSec = c.outSec ?? (still ? inSec + 3 : undefined);
    if (outSec === undefined) throw new Error(`Clip on video source ${s.id} needs inSec and outSec`);
    clip = { id: generateId("clip", 8), sourceId: s.id, inSec, outSec, slot: c.slot ?? "main", gameVolume: DEFAULT_GAME_VOLUME };
  } else {
    throw new Error("Each clip needs candidateId or sourceId (+ inSec/outSec)");
  }
  const s = p.sources.find((x) => x.id === clip.sourceId)!;
  clip.inSec = Math.max(0, Math.min(clip.inSec, s.durationSec));
  clip.outSec = Math.max(0, Math.min(clip.outSec, s.durationSec));
  if (clip.outSec - clip.inSec < 0.2) throw new Error(`Clip on ${s.id} is too short (${clip.inSec}-${clip.outSec} s; source length ${r2(s.durationSec)} s)`);
  if (c.gameVolume !== undefined) clip.gameVolume = c.gameVolume;
  if (c.focusX !== undefined) clip.focusX = c.focusX;
  if (c.imageMotion !== undefined) clip.imageMotion = c.imageMotion;
  if (c.featureId !== undefined) clip.featureId = c.featureId;
  return clip;
}

/** Hook clips first (array order), then main; `adopted` flags recomputed from the clip ranges of candidates. */
export function setClips(p: Project, clips: Clip[]) {
  p.clips = [...clips.filter((c) => c.slot === "hook"), ...clips.filter((c) => c.slot === "main")];
  const used = (cand: Candidate) => p.clips.some((c) => c.sourceId === cand.sourceId && c.inSec === cand.startSec && c.outSec === cand.endSec);
  p.candidates = p.candidates.map((cand) => {
    const { adopted: _drop, ...rest } = cand;
    return used(cand) ? { ...rest, adopted: true } : rest;
  });
}

const overlaps = (a: { sourceId: string; startSec: number; endSec: number }, b: { sourceId: string; startSec: number; endSec: number }) =>
  a.sourceId === b.sourceId && a.startSec < b.endSec && b.startSec < a.endSec;

/**
 * Automatic arrangement (make_ad): best candidate -> hook, next best non-overlapping ones -> main (source/time order),
 * until `targetSec` (fixed length) or `count` clips; image sources are appended as 3 s main clips; video sources
 * without candidates fall back to evenly spaced 3 s segments.
 */
export function autoClips(p: Project, opts: { count: number; targetSec: number | null }): Clip[] {
  const srcIndex = new Map(p.sources.map((s, i) => [s.id, i]));
  const pool: { sourceId: string; startSec: number; endSec: number; score: number }[] = p.candidates
    .filter((c) => srcIndex.has(c.sourceId) && c.endSec > c.startSec)
    .map((c) => ({ sourceId: c.sourceId, startSec: c.startSec, endSec: c.endSec, score: c.score }));
  for (const s of p.sources) {
    if (isStillImageSource(s) || s.proxyStatus === "error") continue;
    if (pool.some((c) => c.sourceId === s.id)) continue;
    const n = Math.max(1, Math.min(5, Math.floor(s.durationSec / 3)));
    for (let i = 0; i < n; i++) {
      const start = (s.durationSec / n) * i + Math.max(0, s.durationSec / n - 3) / 2;
      pool.push({ sourceId: s.id, startSec: start, endSec: Math.min(s.durationSec, start + 3), score: 0.1 });
    }
  }
  const ranked = pool.sort((a, b) => b.score - a.score);
  const clip = (c: { sourceId: string; startSec: number; endSec: number }, slot: Clip["slot"]): Clip => ({
    id: generateId("clip", 8),
    sourceId: c.sourceId,
    inSec: c.startSec,
    outSec: c.endSec,
    slot,
    gameVolume: DEFAULT_GAME_VOLUME,
  });
  const images = p.sources.filter((s) => isStillImageSource(s));
  const out: Clip[] = [];
  const hook = ranked[0];
  if (hook) out.push(clip(hook, "hook"));
  const main: typeof ranked = [];
  let total = 0;
  for (const c of ranked) {
    if (c === hook || (hook && overlaps(c, hook)) || main.some((m) => overlaps(m, c))) continue;
    if (opts.targetSec !== null ? total >= opts.targetSec : main.length >= opts.count) break;
    main.push(c);
    total += c.endSec - c.startSec;
  }
  main.sort((a, b) => srcIndex.get(a.sourceId)! - srcIndex.get(b.sourceId)! || a.startSec - b.startSec);
  out.push(...main.map((c) => clip(c, "main")));
  for (const s of images) {
    const c: Clip = { id: generateId("clip", 8), sourceId: s.id, inSec: 0, outSec: 3, slot: out.length ? "main" : "hook", gameVolume: DEFAULT_GAME_VOLUME, imageMotion: "zoomIn" };
    out.push(c);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Script + TTS                                                         */
/* ------------------------------------------------------------------ */

export type LineInput = { section: "hook" | "main" | "cta"; text: string; offsetSec?: number; speed?: number; speaker?: string; featureId?: string };
export type VoiceInput = { engine?: "voicevox" | "piper"; speaker?: string; speed?: number };

/**
 * Replaces (or appends to) the narration lines of `lang`. An unchanged line (same section/order, text and voice)
 * keeps its id and synthesis result, so re-sending a script only re-synthesizes what changed.
 */
export function applyScript(p: Project, lang: Lang, lines: LineInput[], voice: VoiceInput | undefined, mode: "replace" | "append") {
  const base: Voice = { ...DEFAULT_VOICES[lang], ...(voice?.engine ? { engine: voice.engine } : {}) };
  if (voice?.engine && voice.engine !== DEFAULT_VOICES[lang].engine && !voice.speaker) {
    throw new Error(`voice.speaker is required when engine is ${voice.engine} (get_status includeVoices=true lists them)`);
  }
  if (voice?.speaker) base.speaker = voice.speaker;
  if (voice?.speed) base.speed = voice.speed;
  const old = p.script.filter((l) => l.lang === lang);
  const others = p.script.filter((l) => l.lang !== lang);
  const fresh: ScriptLine[] = lines.map((li, i) => {
    const v: Voice = { ...base, ...(li.speaker ? { speaker: li.speaker } : {}), ...(li.speed ? { speed: li.speed } : {}) };
    const prev = mode === "replace" ? old.filter((l) => l.section === li.section)[lines.slice(0, i).filter((x) => x.section === li.section).length] : undefined;
    if (prev && prev.text === li.text && sameVoice(prev.voice, v)) {
      return { ...prev, offsetSec: li.offsetSec ?? prev.offsetSec, ...(li.featureId ? { featureId: li.featureId } : {}) };
    }
    const l = createScriptLine(lang, li.section, li.text);
    l.voice = v;
    if (li.offsetSec !== undefined) l.offsetSec = li.offsetSec;
    if (li.featureId) l.featureId = li.featureId;
    return l;
  });
  const kept = mode === "append" ? old : [];
  // stable order: hook lines, main lines, cta lines (array order = playback order within a section)
  const all = [...kept, ...fresh];
  const ordered = (["hook", "main", "cta"] as const).flatMap((sec) => all.filter((l) => l.section === sec));
  p.script = [...others, ...ordered];
}

export async function synthesize(projectId: string, lang: Lang, progress: Progress = noop): Promise<Project> {
  progress(`synthesizing ${lang} narration (TTS + captions)`);
  return withProjectLock(projectId, () => apiPost<Project>(`/api/projects/${enc(projectId)}/tts`, { lang }));
}

export function scriptReport(p: Project, lang: Lang) {
  return p.script
    .filter((l) => l.lang === lang)
    .map((l) => ({
      id: l.id,
      section: l.section,
      text: l.text,
      status: l.status,
      ...(l.durationSec ? { sec: r2(l.durationSec) } : {}),
      captions: l.captions.length,
      ...(l.credit ? { credit: l.credit } : {}),
      ...(l.error ? { error: l.error } : {}),
      ...(l.warning ? { warning: l.warning } : {}),
    }));
}

export function hasUnsynthesized(p: Project, lang: Lang): string[] {
  return p.script.filter((l) => l.lang === lang && stripEmphasis(l.text).trim() !== "" && l.status !== "ok").map((l) => l.id);
}

/* ------------------------------------------------------------------ */
/* Template data                                                        */
/* ------------------------------------------------------------------ */

export async function setTemplateData(projectId: string, template: TemplateId | undefined, data: TemplateDataInput, lang: Lang | undefined, select: boolean) {
  let warnings: string[] = [];
  const project = await editProject(projectId, (p) => {
    const t = template ?? p.template;
    warnings = applyTemplateData(p, t, data, lang ?? p.languages[0] ?? "ja");
    if (select) p.template = t;
  });
  return { project, warnings };
}

/* ------------------------------------------------------------------ */
/* Audio                                                                */
/* ------------------------------------------------------------------ */

export type AudioInput = {
  bgmLibraryId?: string;
  bgmMood?: string;
  bgmFile?: string;
  removeBgm?: boolean;
  bgmVolume?: number;
  duckMode?: "band" | "volume";
  duckingDb?: number;
  fadeOutSec?: number;
  loop?: boolean;
  narrationVolume?: number;
  gameVolumeUnderNarration?: number;
  seEnabled?: boolean;
  seVolume?: number;
  seSlots?: Partial<Record<"captionPop" | "headline" | "point" | "info" | "transition" | "cta", string | null>>;
};

/** Library track for a mood tag (first match in id order), or null. */
export async function pickBgmByMood(mood: string): Promise<{ id: string; name: string } | null> {
  const lib = await apiGet<BgmListResponse>("/api/bgm");
  const m = mood.toLowerCase();
  const hit = lib.files.find((f) => f.tags.includes(m as never)) ?? lib.files.find((f) => f.name.toLowerCase().includes(m) || f.id.toLowerCase().includes(m));
  return hit ? { id: hit.id, name: hit.name } : null;
}

export async function setAudio(projectId: string, a: AudioInput, progress: Progress = noop): Promise<{ project: Project; notes: string[] }> {
  const notes: string[] = [];
  let libId = a.bgmLibraryId;
  if (!libId && a.bgmMood) {
    const hit = await pickBgmByMood(a.bgmMood);
    if (hit) {
      libId = hit.id;
      notes.push(`BGM for mood "${a.bgmMood}": ${hit.id}`);
    } else notes.push(`No BGM in the library matches mood "${a.bgmMood}" (list_bgm); BGM unchanged`);
  }
  if (libId) {
    progress(`BGM from library: ${libId}`);
    await withProjectLock(projectId, () => apiPost<Project>(`/api/projects/${enc(projectId)}/bgm/from-library`, { id: libId }));
  } else if (a.bgmFile) {
    const abs = path.resolve(a.bgmFile);
    if (!fs.existsSync(abs)) throw new Error(`BGM file not found: ${abs}`);
    progress(`uploading BGM ${path.basename(abs)}`);
    const up = await apiUpload<{ path: string }>(`/api/projects/${enc(projectId)}/assets`, abs);
    await editProject(projectId, (p) => {
      const prev = p.audio.bgm;
      const bgm: Bgm = prev
        ? { ...DEFAULT_BGM, volume: prev.volume, duckingDb: prev.duckingDb, fadeOutSec: prev.fadeOutSec, loop: prev.loop, ...(prev.duckMode ? { duckMode: prev.duckMode } : {}), path: up.path }
        : { ...DEFAULT_BGM, path: up.path };
      p.audio.bgm = bgm;
    });
    // same as the web: beat analysis + voice-band carve for the new file
    for (const ep of ["bgm/analyze", "bgm/carve"]) {
      await apiPost(`/api/projects/${enc(projectId)}/${ep}`).catch((e: Error) => notes.push(`${ep}: ${e.message}`));
    }
    notes.push("BGM uploaded (no library credit recorded; add the credit yourself if the track requires one)");
  }
  let seCredits: Record<string, string> | undefined;
  if (a.seSlots) {
    const lib = await apiGet<SeListResponse>("/api/se");
    for (const [slot, id] of Object.entries(a.seSlots)) {
      if (id && !lib.files.some((f) => f.id === id)) throw new Error(`SE file "${id}" (slot ${slot}) is not in the SE library (list_se)`);
    }
    seCredits = Object.fromEntries(lib.files.filter((f) => f.credit).map((f) => [f.id, f.credit!]));
  }
  const project = await editProject(projectId, (p) => {
    if (a.removeBgm) delete p.audio.bgm;
    const bgm = p.audio.bgm;
    const mix = [a.bgmVolume, a.duckMode, a.duckingDb, a.fadeOutSec, a.loop].some((v) => v !== undefined);
    if (mix && !bgm) notes.push("BGM mix settings ignored: the project has no BGM");
    if (bgm) {
      if (a.bgmVolume !== undefined) bgm.volume = a.bgmVolume;
      if (a.duckMode !== undefined) bgm.duckMode = a.duckMode;
      if (a.duckingDb !== undefined) bgm.duckingDb = a.duckingDb;
      if (a.fadeOutSec !== undefined) bgm.fadeOutSec = a.fadeOutSec;
      if (a.loop !== undefined) bgm.loop = a.loop;
    }
    if (a.narrationVolume !== undefined) p.audio.narrationVolume = a.narrationVolume;
    if (a.gameVolumeUnderNarration !== undefined) p.audio.gameVolumeUnderNarration = a.gameVolumeUnderNarration;
    const se = p.audio.se;
    if (a.seEnabled !== undefined) se.enabled = a.seEnabled;
    if (a.seVolume !== undefined) se.volume = a.seVolume;
    if (a.seSlots) {
      for (const [slot, id] of Object.entries(a.seSlots) as [keyof typeof se.slots, string | null][]) {
        if (id) se.slots[slot] = id;
        else delete se.slots[slot];
      }
    }
    if (seCredits) {
      // credit snapshot of the files in use (web-maintained field, §6.12)
      const credits: Record<string, string> = {};
      for (const id of Object.values(se.slots)) if (id && seCredits[id]) credits[id] = seCredits[id];
      se.credits = credits;
    }
  });
  return { project, notes };
}

/* ------------------------------------------------------------------ */
/* Render / stills                                                      */
/* ------------------------------------------------------------------ */

export async function waitRender(jobId: string, timeoutSec: number, progress: Progress = noop): Promise<{ job: RenderJob; timedOut: boolean }> {
  const t0 = Date.now();
  let last = "";
  for (;;) {
    const job = await apiGet<RenderJob>(`/api/render/${enc(jobId)}`);
    if (job.status === "done" || job.status === "error") return { job, timedOut: false };
    if (Date.now() - t0 > timeoutSec * 1000) return { job, timedOut: true };
    const msg = `${jobId} ${job.format} ${job.lang}: ${job.status} ${Math.round(job.progress * 100)}%`;
    if (msg !== last) progress(msg);
    last = msg;
    await sleep(2000);
  }
}

export async function startRender(projectId: string, format: Format, lang: Lang, fps?: Fps): Promise<string> {
  const r = await apiPost<RenderStartResponse>(`/api/projects/${enc(projectId)}/render`, { format, lang, ...(fps ? { fps } : {}) });
  return r.jobId;
}

export async function startRenderBatch(projectId: string, targets: { format: Format; lang: Lang }[], fps?: Fps): Promise<string[]> {
  const r = await apiPost<RenderBatchResponse>(`/api/projects/${enc(projectId)}/render-batch`, { targets, ...(fps ? { fps } : {}) });
  return r.jobIds;
}

export function jobReport(j: RenderJob) {
  return {
    jobId: j.jobId,
    format: j.format,
    lang: j.lang,
    status: j.status,
    progress: Math.round(j.progress * 100) / 100,
    ...(j.absPath ? { path: j.absPath } : {}),
    ...(j.error ? { error: j.error } : {}),
  };
}

export async function renderStills(projectId: string, format: Format, lang: Lang, times: number[], width?: number): Promise<StillsResponse> {
  return apiPost<StillsResponse>(`/api/projects/${enc(projectId)}/stills`, { format, lang, times, ...(width ? { width } : {}) });
}

/** Default preview times: start (0.3 s), a few evenly spaced points, last second (before the end). */
export function defaultTimes(totalSec: number, n = 4): number[] {
  if (!(totalSec > 0)) return [0.3];
  const out = [Math.min(0.3, totalSec / 2)];
  for (let i = 1; i < n - 1; i++) out.push((totalSec * i) / (n - 1));
  out.push(Math.max(0, totalSec - 1));
  return [...new Set(out.map((t) => r2(t)))];
}
