import { introClipOrder, stripEmphasis, type Lang, type Project } from "@gas/shared";
import { fitSegments, MIN_CLIP_SEC, segLen, toSegments, type PlacedClip, type Segment, type TimelineSection } from "../../common/clips";
import { placeSection, playableLines, toFrames, type PlacedNarration, type RelLine } from "../../common/narrationLayout";
import type { SeEvent } from "../../common/SeTrack";
import { END_CARD_SEC, MAX_END_CARD_SEC } from "../hookPlayCta/timeline";
import type { TemplateTimeline, TimelineSectionInfo } from "../types";

/**
 * Timeline of the "intro" (紹介動画風) template — ARCHITECTURE §5.8.
 * body (hook + main lines played back to back, persistent headline band, 16:9 gameplay strip switching clip per
 * narration line, info card, numbered points) -> end card.
 * Pure + deterministic, integer frames; shared by calcAdMetadata / getSectionDurations / buildNarrationPlan / render.
 */

export const BODY_MIN_SEC = 3;
export const BODY_TAIL_SEC = 0.4;
/** a body line shorter than this does not switch the clip (= MIN_CLIP_SEC) */
export const LINE_CLIP_MIN_SEC = MIN_CLIP_SEC;
/** rest of the body after the last line: up to this long it extends the last clip, longer -> more clips */
export const TAIL_SPLIT_SEC = 1.0;
/** no narration: the info card starts here */
export const NO_NARRATION_INFO_SEC = 1.0;

/** SE gains (template's choice, §5.8) */
const GAIN = { headline: 1, transition: 0.7, info: 0.9, point: 0.9, cta: 1 } as const;

export type IntroInfoRow = { id: string; label: string; value: string };
export type IntroInfo = { from: number; to: number; rows: IntroInfoRow[] };
export type IntroPointShow = {
  id: string;
  /** 1-based number among the displayed points (①②③…) */
  number: number;
  text: string;
  /** absolute frames [from, to) */
  from: number;
  to: number;
};

export type IntroTimeline = TemplateTimeline & {
  /** body = [0, body.durationInFrames); clips are relative to 0 (= absolute) */
  body: TimelineSection;
  /** absolute frames (> 0) where the gameplay strip cuts to another clip */
  cuts: number[];
  endCard: TimelineSection;
  info: IntroInfo | null;
  /** sorted by `from`, non-overlapping (each ends at the next one's start at the latest) */
  points: IntroPointShow[];
};

export function buildTimeline(project: Project, fps: number, lang: Lang): IntroTimeline {
  const free = project.durationSec === null;
  const data = project.templateData.intro;
  const playable = playableLines(project, lang);

  // ---- narration: body lines (hook then main, array order) back to back from t = 0 -------------------
  const bodyLines = [...playable.filter((l) => l.section === "hook"), ...playable.filter((l) => l.section === "main")];
  const bodyRel: RelLine[] = [];
  let t = 0;
  for (const line of bodyLines) {
    const natural = Math.max(1, toFrames(line.durationSec!, fps));
    t += toFrames(line.offsetSec, fps);
    bodyRel.push({ line, rel: t, natural });
    t += natural;
  }
  const need = t;
  const ctaRel: RelLine[] = playable
    .filter((l) => l.section === "cta")
    .map((line) => ({ line, rel: toFrames(line.offsetSec, fps), natural: Math.max(1, toFrames(line.durationSec!, fps)) }));
  const ctaNeed = ctaRel.reduce((m, x) => Math.max(m, x.rel + x.natural), 0);

  // ---- lengths ----------------------------------------------------------------------------------------
  const endFrames = Math.max(Math.round(END_CARD_SEC * fps), free ? ctaNeed : Math.min(ctaNeed, Math.round(MAX_END_CARD_SEC * fps)));
  const segs = toSegments(project, introClipOrder(project), fps);
  const minBody = Math.round(BODY_MIN_SEC * fps);
  let bodyFrames: number;
  if (free) {
    bodyFrames =
      need > 0
        ? Math.max(minBody, need + Math.round(BODY_TAIL_SEC * fps))
        : Math.max(minBody, segs.reduce((a, s) => a + segLen(s), 0));
  } else {
    bodyFrames = Math.max(1, Math.round(project.durationSec! * fps) - endFrames);
  }

  // place each body line with its own section id (cut / dropped at the body end when fixed)
  const bodyPlaced: PlacedNarration[] = bodyRel.map((r) => placeSection([r], r.line.section, 0, bodyFrames, !free)[0]!);
  const ctaPlaced = placeSection(ctaRel, "cta", bodyFrames, endFrames, !free);
  /** body lines that actually play, in playback order */
  const played = bodyPlaced.filter((p) => p.durationInFrames > 0);

  // ---- clips of the 16:9 strip --------------------------------------------------------------------------
  const minClip = Math.round(MIN_CLIP_SEC * fps);
  let clips: PlacedClip[] = [];
  if (segs.length > 0) {
    if (data.clipPerLine && played.length > 0) clips = clipsPerLine(segs, played, bodyFrames, fps);
    else clips = fitSegments(segs, bodyFrames, minClip, "intro");
  }
  const cuts = clips.map((c) => c.from).filter((f) => f > 0 && f < bodyFrames);

  // ---- info card --------------------------------------------------------------------------------------
  let info: IntroInfo | null = null;
  let infoLineId: string | null = null;
  const rows = data.info.items
    .map((it) => ({ id: it.id, label: it.label[lang].trim(), value: it.value[lang].trim() }))
    .filter((r) => stripEmphasis(r.value).trim() !== "");
  if (data.info.enabled && rows.length > 0) {
    let start: number;
    const atId = data.info.atLineId?.[lang];
    const at = atId ? played.find((p) => p.lineId === atId) : undefined;
    const pick = at ?? played[1] ?? played[0];
    if (pick) {
      start = pick.from;
      infoLineId = pick.lineId;
    } else {
      const s = Math.round(NO_NARRATION_INFO_SEC * fps);
      start = bodyFrames > s ? s : 0;
    }
    const end = Math.min(start + Math.round(data.info.durationSec * fps), bodyFrames);
    if (end > start) info = { from: start, to: end, rows };
  }

  // ---- points -----------------------------------------------------------------------------------------
  const shown = data.points.items.filter((p) => stripEmphasis(p.text[lang]).trim() !== "");
  const raw: IntroPointShow[] = [];
  if (played.length > 0) {
    const bound = new Map<string, PlacedNarration>();
    for (const p of shown) {
      const id = p.lineId?.[lang];
      const line = id ? played.find((x) => x.lineId === id) : undefined;
      if (line) bound.set(p.id, line);
    }
    const boundIds = new Set([...bound.values()].map((l) => l.lineId));
    const candidates = played.filter((l) => l.section === "main" && !boundIds.has(l.lineId) && l.lineId !== infoLineId);
    let k = 0;
    shown.forEach((p, i) => {
      const line = bound.get(p.id) ?? candidates[k++];
      if (!line) return; // not enough candidate lines -> not shown
      raw.push({ id: p.id, number: i + 1, text: p.text[lang], from: line.from, to: line.from + line.durationInFrames });
    });
  } else if (shown.length > 0) {
    const s0 = info ? info.to : 0;
    const span = bodyFrames - s0;
    if (span >= shown.length) {
      shown.forEach((p, i) => {
        const from = s0 + Math.floor((span * i) / shown.length);
        const to = s0 + Math.floor((span * (i + 1)) / shown.length);
        raw.push({ id: p.id, number: i + 1, text: p.text[lang], from, to });
      });
    }
  }
  // a new point replaces the previous one
  const sortedPts = raw.map((p, i) => ({ p, i })).sort((a, b) => a.p.from - b.p.from || a.i - b.i).map((x) => x.p);
  const points: IntroPointShow[] = [];
  sortedPts.forEach((p, i) => {
    const next = sortedPts[i + 1];
    const to = Math.min(p.to, next ? next.from : p.to, bodyFrames);
    if (to > p.from) points.push({ ...p, to });
  });

  // ---- sections -----------------------------------------------------------------------------------------
  const lastHook = [...played].reverse().find((p) => p.section === "hook");
  const hookEnd = lastHook ? Math.min(bodyFrames, lastHook.from + lastHook.durationInFrames) : 0;
  const sections: TimelineSectionInfo[] = [];
  if (hookEnd > 0) sections.push({ id: "hook", kind: "hook", label: "つかみ", from: 0, durationInFrames: hookEnd });
  if (bodyFrames - hookEnd > 0) sections.push({ id: "main", kind: "main", label: "本編", from: hookEnd, durationInFrames: bodyFrames - hookEnd });
  sections.push({ id: "end", kind: "end", label: "エンド", from: bodyFrames, durationInFrames: endFrames });
  const totalFrames = bodyFrames + endFrames;

  // ---- sound effects ------------------------------------------------------------------------------------
  const seEvents: SeEvent[] = [{ frame: 0, slot: "headline", gain: GAIN.headline }];
  for (const f of cuts) seEvents.push({ frame: f, slot: "transition", gain: GAIN.transition });
  if (info) seEvents.push({ frame: info.from, slot: "info", gain: GAIN.info });
  for (const p of points) seEvents.push({ frame: p.from, slot: "point", gain: GAIN.point });
  seEvents.push({ frame: bodyFrames, slot: "cta", gain: GAIN.cta });

  const lines = [...bodyPlaced, ...ctaPlaced];
  return {
    fps,
    totalFrames,
    sections,
    narration: { lines, overflowLineIds: lines.filter((l) => l.cut).map((l) => l.lineId) },
    seEvents,
    captionPopSe: true,
    captionLayout: { scale: 1.3, verticalMode: "blur" },
    body: { from: 0, durationInFrames: bodyFrames, clips },
    cuts,
    endCard: { from: bodyFrames, durationInFrames: endFrames, clips: [] },
    info,
    points,
  };
}

/**
 * clipPerLine: body line k gets [b_k, b_k+1) (b_0 = 0, b_k = line k's start), playing clip j % n where j counts the
 * switches; lines shorter than LINE_CLIP_MIN_SEC keep the previous clip. After the last line: up to TAIL_SPLIT_SEC
 * extends the last interval, longer -> the following clips at their natural length (>= MIN_CLIP_SEC), the last
 * one filling the rest. Each interval plays its clip from inSec (extended past outSec / last frame held).
 */
function clipsPerLine(segs: Segment[], played: PlacedNarration[], bodyFrames: number, fps: number): PlacedClip[] {
  const n = segs.length;
  const lineMin = Math.round(LINE_CLIP_MIN_SEC * fps);
  const minClip = Math.round(MIN_CLIP_SEC * fps);
  // intervals: [from, to) + clip index j
  const iv: { from: number; to: number; j: number }[] = [];
  let j = 0;
  played.forEach((p, k) => {
    const from = k === 0 ? 0 : p.from;
    const to = k + 1 < played.length ? played[k + 1]!.from : p.from + p.durationInFrames;
    if (to <= from) return;
    if (iv.length === 0) {
      iv.push({ from, to, j });
      return;
    }
    const prev = iv[iv.length - 1]!;
    if (to - from < lineMin) {
      prev.to = to; // too short: keep the previous clip running
    } else {
      j++;
      iv.push({ from, to, j });
    }
  });
  if (iv.length === 0) iv.push({ from: 0, to: bodyFrames, j: 0 });
  // tail
  const last = iv[iv.length - 1]!;
  if (last.to > bodyFrames) last.to = bodyFrames;
  let rest = bodyFrames - last.to;
  if (rest > 0 && rest <= Math.round(TAIL_SPLIT_SEC * fps)) {
    last.to = bodyFrames;
  } else {
    let cursor = last.to;
    while (rest > 0) {
      j++;
      const seg = segs[j % n]!;
      let len = Math.max(minClip, segLen(seg));
      if (len >= rest || rest - len < minClip) len = rest;
      iv.push({ from: cursor, to: cursor + len, j });
      cursor += len;
      rest -= len;
    }
  }
  const out: PlacedClip[] = [];
  iv.forEach((x, i) => {
    const placed = fitSegments([segs[x.j % n]!], x.to - x.from, 1, `line-${i}`);
    for (const c of placed) out.push({ ...c, from: c.from + x.from });
  });
  return out;
}
