import path from "node:path";
import { z } from "zod";
import {
  bgmSourceInfo,
  isShortTemplate,
  isStillImageSource,
  projectSchema,
  SHORT_TEMPLATE_META,
  stripEmphasis,
  type Lang,
  type Project,
} from "@gas/shared";
import { apiGet, apiPut, enc } from "./api";
import { PROJECTS_DIR_GUESS } from "./env";

/* ------------------------------------------------------------------ */
/* GET -> modify -> PUT (server-owned fields are merged by the server, §6.2) */
/* ------------------------------------------------------------------ */

const locks = new Map<string, Promise<unknown>>();

/** Serializes MCP-side edits per project (a PUT from a stale snapshot could drop a source added meanwhile). */
export async function withProjectLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chain = prev.then(() => mine);
  locks.set(id, chain);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(id) === chain) locks.delete(id);
  }
}

export const getProject = (id: string) => apiGet<Project>(`/api/projects/${enc(id)}`);

/**
 * Applies `mutate` to a fresh copy of the saved project and PUTs it (like the web's useProject: the server keeps
 * server-owned fields — source status, candidates, synthesis results, BGM analysis — via mergeServerOwned).
 * The body is validated locally first so the error names the bad field.
 */
export async function editProject(id: string, mutate: (p: Project) => void | Promise<void>): Promise<Project> {
  return withProjectLock(id, async () => {
    const p = structuredClone(await getProject(id));
    await mutate(p);
    const parsed = projectSchema.safeParse(p);
    if (!parsed.success) throw new Error(`Invalid project after edit: ${z.prettifyError(parsed.error)}`);
    return apiPut<Project>(`/api/projects/${enc(id)}`, parsed.data);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls GET /api/projects/:id until `done(p)` or the timeout (returns the last snapshot + timedOut). */
export async function waitForProject(
  id: string,
  done: (p: Project) => boolean,
  timeoutMs: number,
  onTick?: (p: Project, elapsedMs: number) => void,
): Promise<{ project: Project; timedOut: boolean }> {
  const t0 = Date.now();
  for (;;) {
    const p = await getProject(id);
    if (done(p)) return { project: p, timedOut: false };
    const el = Date.now() - t0;
    if (el >= timeoutMs) return { project: p, timedOut: true };
    onTick?.(p, el);
    await sleep(1500);
  }
}

/* ------------------------------------------------------------------ */
/* Compact summary (get_project)                                       */
/* ------------------------------------------------------------------ */

const r2 = (n: number) => Math.round(n * 100) / 100;

type Compositions = typeof import("@gas/compositions");
let compositions: Promise<Compositions> | null = null;
/** Lazy: the timeline helpers live in @gas/compositions (pure TS, but pulls React/Remotion; ~1.5 s once). */
export function loadCompositions(): Promise<Compositions> {
  compositions ??= import("@gas/compositions");
  return compositions;
}

export function projectDirOf(id: string): string {
  return path.join(PROJECTS_DIR_GUESS, id);
}

export async function timelineOf(p: Project, lang: Lang) {
  const c = await loadCompositions();
  const sd = c.getSectionDurations(p, lang);
  let overflow: string[] = [];
  try {
    overflow = c.buildNarrationPlan(p, lang, p.fps).overflowLineIds;
  } catch {
    /* ignore */
  }
  return {
    totalSec: r2(sd.totalSec),
    sections: sd.sections.map((s) => ({ id: s.id, kind: s.kind, label: s.label, sec: r2(s.sec) })),
    overflowLineIds: overflow,
  };
}

export function projectWarnings(p: Project, overflowByLang: Partial<Record<Lang, string[]>> = {}): string[] {
  const w: string[] = [];
  if (p.sources.length === 0) w.push("素材がありません (no sources) -> add_sources");
  for (const s of p.sources) {
    const name = s.name ?? path.basename(s.originalPath);
    if (s.proxyStatus === "pending") w.push(`素材 ${s.id} (${name}) のプロキシ生成中 (proxy pending)`);
    if (s.proxyStatus === "error") w.push(`素材 ${s.id} (${name}) のプロキシ生成に失敗: ${s.proxyError ?? "?"}`);
    if (s.analysisStatus === "error") w.push(`素材 ${s.id} の見どころ解析に失敗: ${s.analysisError ?? "?"}`);
  }
  if (p.clips.length === 0) w.push("クリップがありません (no clips) -> set_clips");
  else if (!p.clips.some((c) => c.slot === "hook")) w.push("hook スロットのクリップがありません (no hook clip)");
  const srcIds = new Set(p.sources.map((s) => s.id));
  for (const c of p.clips) if (!srcIds.has(c.sourceId)) w.push(`クリップ ${c.id} の素材 ${c.sourceId} がありません`);
  for (const lang of p.languages) {
    const lines = p.script.filter((l) => l.lang === lang && stripEmphasis(l.text).trim() !== "");
    const bad = lines.filter((l) => l.status !== "ok");
    if (bad.length) w.push(`${lang}: 未合成/古い台本行 ${bad.length} 行 (status ${[...new Set(bad.map((l) => l.status))].join("/")}) -> set_script で再合成`);
    for (const l of lines) if (l.warning) w.push(`${lang} ${l.id}: ${l.warning}`);
    for (const l of lines) if (l.status === "error") w.push(`${lang} ${l.id}: 合成エラー ${l.error ?? ""}`);
    const of = overflowByLang[lang];
    if (of?.length) w.push(`${lang}: 尺に収まらない台本行 ${of.join(", ")} (fixed durationSec) -> 短くするか durationSec=null`);
  }
  if (isShortTemplate(p.template)) {
    const f = SHORT_TEMPLATE_META[p.template].fields.items;
    const n = p.templateData.shorts[p.template].items.length;
    if (f && (n < f.min || n > f.max)) w.push(`${f.label}は ${f.min}〜${f.max} 個にしてください (now ${n})`);
  }
  if ((p.template === "intro" || isShortTemplate(p.template)) && !p.formats.includes("9:16")) {
    w.push(`テンプレート ${p.template} は 9:16 向けです (formats に 9:16 がありません)`);
  }
  const bgm = p.audio.bgm;
  if (p.template === "trailer" && p.templateData.trailer.beatSync && !(bgm?.beats?.length)) {
    w.push("trailer の beatSync には BGM のビート解析が必要です -> set_audio で BGM を設定");
  }
  if (bgm?.analysisStatus === "error") w.push(`BGM のビート解析に失敗: ${bgm.analysisError ?? "?"}`);
  if (bgm?.library) {
    const info = bgmSourceInfo(bgm.library.source);
    if (info?.creditRequired && !bgm.library.credit) w.push(`BGM (${info.label}) はクレジット表記が必要です (例: ${info.creditExample})`);
  }
  return w;
}

export async function summarizeProject(p: Project) {
  const timelines: Record<string, unknown> = {};
  const overflowByLang: Partial<Record<Lang, string[]>> = {};
  for (const lang of p.languages) {
    try {
      const t = await timelineOf(p, lang);
      timelines[lang] = { totalSec: t.totalSec, sections: t.sections };
      overflowByLang[lang] = t.overflowLineIds;
    } catch (e) {
      timelines[lang] = { error: (e as Error).message };
    }
  }
  const candBySource = new Map<string, number>();
  for (const c of p.candidates) candBySource.set(c.sourceId, (candBySource.get(c.sourceId) ?? 0) + 1);
  const short = isShortTemplate(p.template) ? p.templateData.shorts[p.template] : undefined;
  const templateData =
    short ??
    (p.template === "features"
      ? p.templateData.features
      : p.template === "trailer"
        ? p.templateData.trailer
        : p.template === "intro"
          ? p.templateData.intro
          : { hook: { ja: p.texts.ja.hook, en: p.texts.en.hook } });
  const bgm = p.audio.bgm;
  return {
    id: p.id,
    name: p.name,
    dir: projectDirOf(p.id),
    template: p.template,
    formats: p.formats,
    languages: p.languages,
    durationSec: p.durationSec,
    fps: p.fps,
    updatedAt: p.updatedAt,
    timeline: timelines,
    game: { title: p.game.title, releaseText: p.game.releaseText, platforms: p.game.platforms, steamUrl: p.game.steamUrl },
    cta: { ja: p.texts.ja.cta, en: p.texts.en.cta },
    sources: p.sources.map((s) => ({
      id: s.id,
      name: s.name ?? path.basename(s.originalPath),
      kind: isStillImageSource(s) ? "image" : "video",
      durationSec: isStillImageSource(s) ? undefined : r2(s.durationSec),
      size: `${s.width}x${s.height}`,
      proxy: s.proxyStatus,
      analysis: s.analysisStatus,
      candidates: candBySource.get(s.id) ?? 0,
    })),
    clips: p.clips.map((c) => ({
      id: c.id,
      slot: c.slot,
      sourceId: c.sourceId,
      inSec: r2(c.inSec),
      outSec: r2(c.outSec),
      lenSec: r2(c.outSec - c.inSec),
      ...(c.focusX !== undefined ? { focusX: c.focusX } : {}),
      ...(c.imageMotion ? { imageMotion: c.imageMotion } : {}),
      ...(c.featureId ? { featureId: c.featureId } : {}),
    })),
    script: p.languages.map((lang) => ({
      lang,
      lines: p.script
        .filter((l) => l.lang === lang)
        .map((l) => ({
          id: l.id,
          section: l.section,
          text: l.text,
          voice: `${l.voice.engine}:${l.voice.speaker}@${l.voice.speed}`,
          status: l.status,
          ...(l.durationSec ? { sec: r2(l.durationSec) } : {}),
          ...(l.error ? { error: l.error } : {}),
          ...(l.warning ? { warning: l.warning } : {}),
        })),
    })),
    templateData,
    style: {
      primaryColor: p.style.primaryColor,
      accentColor: p.style.accentColor,
      emphasisColor: p.style.emphasisColor,
      captions: p.style.captions,
      vertical: p.style.vertical.mode,
      transition: p.style.transition ?? { preset: "auto" },
      watermark: p.style.watermark,
    },
    audio: {
      narrationVolume: p.audio.narrationVolume,
      gameVolumeUnderNarration: p.audio.gameVolumeUnderNarration,
      bgm: bgm
        ? {
            path: bgm.path,
            library: bgm.library?.id,
            credit: bgm.library?.credit,
            volume: bgm.volume,
            duckMode: bgm.duckMode ?? "band",
            duckingDb: bgm.duckingDb,
            fadeOutSec: bgm.fadeOutSec,
            loop: bgm.loop,
            beats: bgm.analysisStatus ?? "none",
            bpm: bgm.bpm ? r2(bgm.bpm) : undefined,
            voiceCarve: bgm.voiceCarveStatus ?? "none",
          }
        : null,
      se: { enabled: p.audio.se.enabled, volume: p.audio.se.volume, slots: p.audio.se.slots },
    },
    warnings: projectWarnings(p, overflowByLang),
  };
}
