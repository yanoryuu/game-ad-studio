import { trailerClipOrder, type Lang, type Project, type VerticalMode } from "@gas/shared";
import { fitSegments, MIN_CLIP_SEC, segLen, toSegments, type PlacedClip, type Segment } from "../../../common/clips";
import { placeSection, playableLines, toFrames, type PlacedNarration, type RelLine } from "../../../common/narrationLayout";
import type { SeEvent } from "../../../common/SeTrack";
import { END_CARD_SEC, MAX_END_CARD_SEC } from "../../hookPlayCta/timeline";
import type { SectionKind, TemplateTimeline, TimelineSectionInfo } from "../../types";

/**
 * Pure timeline kit shared by the 10 short-form templates (ARCHITECTURE §5.10). No React.
 * Everything is in integer frames at the output fps; the body always starts at frame 0, so "body frames" are
 * absolute output frames.
 */

/** seconds -> frames (the project-wide rule: Math.round(sec * fps), never negative) */
export const sec = (s: number, fps: number) => Math.round(Math.max(0, s) * fps);

/** narration tail after the last body line (free length) */
export const BODY_TAIL_SEC = 0.4;
/** loop templates: the small CTA overlay window at the very end */
export const LOOP_CTA_SEC = 2.5;
/** a narration line shorter than this does not switch the clip (= MIN_CLIP_SEC, like intro) */
export const LINE_CLIP_MIN_SEC = MIN_CLIP_SEC;
/** after the last line: up to this long the last clip is extended, longer -> more clips */
export const TAIL_SPLIT_SEC = 1.0;

export { END_CARD_SEC, MAX_END_CARD_SEC, MIN_CLIP_SEC };

/* ------------------------------------------------------------------ */
/* Base: lengths + narration + clip material                            */
/* ------------------------------------------------------------------ */

export type ShortBaseOptions = {
  /** free length: minimum body length in seconds (template's own minimum, incl. what its effects need). Default 3 */
  minBodySec?: number;
  /**
   * free length WITHOUT narration: body = sum of the clips' natural lengths, clamped to [min, max] seconds.
   * Default { min: minBodySec, max: 30 }.
   */
  noNarrationSec?: { min?: number; max?: number };
  /** false = NO end card (loop): the body runs to the end; cta lines play in the last `loopCtaSec`. Default true */
  endCard?: boolean;
  /** endCard false: length of the CTA overlay window at the end (grows with the cta lines). Default LOOP_CTA_SEC */
  loopCtaSec?: number;
};

export type ShortBase = {
  fps: number;
  lang: Lang;
  /** durationSec === null */
  free: boolean;
  /** body = [0, bodyFrames). With endCard false: bodyFrames === totalFrames */
  bodyFrames: number;
  /** end card = [bodyFrames, totalFrames); 0 when endCard is false */
  endFrames: number;
  totalFrames: number;
  /**
   * Where the cta lines play: = bodyFrames with an end card; loop: start of the CTA overlay window
   * (= totalFrames - ctaFrames). Body narration is cut at `narrationEnd`.
   */
  ctaFrom: number;
  ctaFrames: number;
  /** body lines are cut / dropped here (fixed length): bodyFrames, or ctaFrom for a loop with cta lines */
  narrationEnd: number;
  /** total natural length of the body narration incl. offsets (0 = no body narration) */
  need: number;
  /** every body line (hook then main) with its placement; durationInFrames 0 = dropped */
  bodyLines: PlacedNarration[];
  /** body lines that actually play, in playback order */
  played: PlacedNarration[];
  ctaLines: PlacedNarration[];
  /** end of the last played hook line (0 = none) — the natural "つかみ" section */
  hookEnd: number;
  /** usable clip material in trailerClipOrder (hook slot then main slot); unknown sources removed */
  segs: Segment[];
  /** usable hook-slot / main-slot material (array order) — for templates where the slots mean something */
  hookSegs: Segment[];
  mainSegs: Segment[];
};

/**
 * Lengths + narration of a short-form template (§5.10 common rules, same narration rules as intro §5.8):
 * - body lines = hook lines then main lines, back to back from t = 0 (each: t += offset, from = t, t += duration);
 * - cta lines = end card start + offsetSec (loop: CTA window start + offsetSec);
 * - end card = END_CARD_SEC, grows with the cta lines (free: unlimited, fixed: up to MAX_END_CARD_SEC);
 * - free: body = need > 0 ? max(minBodySec, need + BODY_TAIL_SEC) : clamp(sum of clip lengths, noNarrationSec);
 * - fixed 15/30: total = exactly durationSec; body = durationSec - end card; lines crossing the body end are
 *   cut, lines starting at/after it are dropped (overflowLineIds).
 * Never throws; an empty project still gets >= 1 frame.
 */
export function buildShortBase(project: Project, fps: number, lang: Lang, opts: ShortBaseOptions = {}): ShortBase {
  const free = project.durationSec === null;
  const withEnd = opts.endCard !== false;
  const minBody = Math.max(1, sec(opts.minBodySec ?? 3, fps));
  const playable = playableLines(project, lang);

  const bodyRel: RelLine[] = [];
  let t = 0;
  for (const line of [...playable.filter((l) => l.section === "hook"), ...playable.filter((l) => l.section === "main")]) {
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

  const order = trailerClipOrder(project);
  const segs = toSegments(project, order, fps);
  const hookSegs = toSegments(project, order.filter((c) => c.slot === "hook"), fps);
  const mainSegs = toSegments(project, order.filter((c) => c.slot === "main"), fps);
  const clipSum = segs.reduce((a, s) => a + segLen(s), 0);
  const nnMin = sec(opts.noNarrationSec?.min ?? (opts.minBodySec ?? 3), fps);
  const nnMax = Math.max(nnMin, sec(opts.noNarrationSec?.max ?? 30, fps));
  const clampNoNarration = () => Math.max(minBody, Math.min(nnMax, Math.max(nnMin, clipSum)));

  const capCta = (base: number) => Math.max(base, free ? ctaNeed : Math.min(ctaNeed, sec(MAX_END_CARD_SEC, fps)));
  let bodyFrames: number;
  let endFrames: number;
  let ctaFrom: number;
  let ctaFrames: number;
  let narrationEnd: number;

  if (withEnd) {
    endFrames = capCta(sec(END_CARD_SEC, fps));
    if (free) bodyFrames = need > 0 ? Math.max(minBody, need + sec(BODY_TAIL_SEC, fps)) : clampNoNarration();
    else bodyFrames = Math.max(1, sec(project.durationSec!, fps) - endFrames);
    ctaFrom = bodyFrames;
    ctaFrames = endFrames;
    narrationEnd = bodyFrames;
  } else {
    endFrames = 0;
    ctaFrames = capCta(sec(opts.loopCtaSec ?? LOOP_CTA_SEC, fps));
    const hasCta = ctaRel.length > 0;
    let total: number;
    if (free) total = need > 0 ? Math.max(minBody, need + sec(BODY_TAIL_SEC, fps) + (hasCta ? ctaFrames : 0)) : clampNoNarration();
    else total = Math.max(1, sec(project.durationSec!, fps));
    ctaFrames = Math.min(ctaFrames, total);
    bodyFrames = total;
    ctaFrom = total - ctaFrames;
    narrationEnd = hasCta ? Math.max(1, ctaFrom) : total;
  }

  const bodyLines = bodyRel.map((r) => placeSection([r], r.line.section, 0, narrationEnd, !free)[0]!);
  const ctaLines = placeSection(ctaRel, "cta", ctaFrom, ctaFrames, !free);
  const played = bodyLines.filter((p) => p.durationInFrames > 0);
  const lastHook = [...played].reverse().find((p) => p.section === "hook");
  const hookEnd = lastHook ? Math.min(bodyFrames, lastHook.from + lastHook.durationInFrames) : 0;

  return {
    fps,
    lang,
    free,
    bodyFrames,
    endFrames,
    totalFrames: bodyFrames + endFrames,
    ctaFrom,
    ctaFrames,
    narrationEnd,
    need,
    bodyLines,
    played,
    ctaLines,
    hookEnd,
    segs,
    hookSegs,
    mainSegs,
  };
}

/** Played body lines that START inside [from, to). */
export const linesIn = (base: ShortBase, from: number, to: number) => base.played.filter((p) => p.from >= from && p.from < to);

/* ------------------------------------------------------------------ */
/* Clips                                                                */
/* ------------------------------------------------------------------ */

export type LayClipsOptions = {
  /**
   * Narration lines to switch on (one clip per line, like intro clipPerLine): the clip changes at the start of
   * every line (except the first), lines shorter than LINE_CLIP_MIN_SEC keep the previous clip. Lines that do
   * not start inside the span are ignored. Absent / empty -> no line switching.
   */
  lines?: PlacedNarration[];
  /** tempo: no clip runs longer than this (long intervals are split, each part gets the next clip). */
  maxCutSec?: number;
  /** the first clip stays at least this long (e.g. so the hook clip covers the title slam). Default 0 */
  holdFirstSec?: number;
  /** index (into segs, wraps) of the first clip. Default 0 */
  startIndex?: number;
  /** React key prefix (unique per call within a template). Default "clips" */
  keyPrefix?: string;
};

export type ClipLayout = {
  /** clips with `from` on the SAME axis as the span (normally absolute body frames) */
  clips: PlacedClip[];
  /** frames (span.from < f < span.to) where the picture cuts to another clip */
  cuts: number[];
  /** startIndex + number of clips used -> pass as startIndex to continue the rotation in the next span */
  nextIndex: number;
};

/** Plays one segment over exactly `len` frames from `from` (extends past outSec / holds the last frame if short). */
export function fillInterval(seg: Segment, from: number, len: number, key: string): PlacedClip[] {
  if (len <= 0) return [];
  return fitSegments([seg], len, 1, key).map((c) => ({ ...c, from: c.from + from }));
}

/**
 * Lays `segs` into the span [from, to). Modes:
 *  - `lines` given (and >= 1 starts in the span): one clip per narration line (intro rules), then the rest after
 *    the last line: <= TAIL_SPLIT_SEC extends the last clip, longer -> following clips (natural length or maxCutSec);
 *  - no lines + maxCutSec: clips in rotation at min(natural length, maxCutSec) (tempo editing);
 *  - no lines, no maxCutSec: all clips in order fitted proportionally (fitSegments, = intro without narration).
 * With maxCutSec every interval longer than maxCutSec is split into equal parts, each with the next clip.
 * Clips rotate (index j % n). No segs / empty span -> no clips (draw NoFootage / Backdrop).
 */
export function layClips(segs: Segment[], span: { from: number; to: number }, fps: number, opts: LayClipsOptions = {}): ClipLayout {
  const start = opts.startIndex ?? 0;
  const { from, to } = span;
  const key = opts.keyPrefix ?? "clips";
  if (segs.length === 0 || to <= from) return { clips: [], cuts: [], nextIndex: start };
  const n = segs.length;
  const minClip = sec(MIN_CLIP_SEC, fps);
  const lineMin = sec(LINE_CLIP_MIN_SEC, fps);
  const maxCut = opts.maxCutSec ? Math.max(minClip, sec(opts.maxCutSec, fps)) : 0;
  const holdTo = from + sec(opts.holdFirstSec ?? 0, fps);
  const seg = (j: number) => segs[(((start + j) % n) + n) % n]!;

  const lines = (opts.lines ?? []).filter((p) => p.durationInFrames > 0 && p.from >= from && p.from < to).sort((a, b) => a.from - b.from);

  // No lines, no tempo: proportional fit of all clips (rotated to startIndex).
  if (lines.length === 0 && !maxCut) {
    const rotated = segs.map((_, i) => seg(i));
    const clips = fitSegments(rotated, to - from, minClip, key).map((c) => ({ ...c, from: c.from + from }));
    return { clips, cuts: clips.map((c) => c.from).filter((f) => f > from && f < to), nextIndex: start + clips.length };
  }

  // 1) raw boundaries
  const bounds: number[] = [];
  let tailFrom = from;
  if (lines.length > 0) {
    lines.forEach((p, k) => {
      if (k > 0) bounds.push(p.from);
    });
    const last = lines[lines.length - 1]!;
    tailFrom = Math.min(to, last.from + last.durationInFrames);
    if (to - tailFrom > sec(TAIL_SPLIT_SEC, fps)) bounds.push(tailFrom);
    else tailFrom = to; // short tail: the last clip is extended
  }
  // 2) filter: hold the first clip, drop too-short intervals (the previous clip keeps running)
  const kept: number[] = [];
  let prev = from;
  for (const b of bounds.sort((a, c) => a - c)) {
    if (b <= from || b >= to || b < holdTo) continue;
    if (b - prev < lineMin || to - b < lineMin) continue;
    kept.push(b);
    prev = b;
  }
  // 3) intervals; the tail (after the last line, or the whole span without lines) is "free material"
  const edges = [from, ...kept, to];
  const clips: PlacedClip[] = [];
  let j = 0;
  const place = (a: number, b: number) => {
    if (b <= a) return;
    clips.push(...fillInterval(seg(j), a, b - a, `${key}-${j}`));
    j++;
  };
  for (let i = 0; i + 1 < edges.length; i++) {
    const a = edges[i]!;
    const b = edges[i + 1]!;
    if (a >= tailFrom) {
      // free material: natural clip lengths (capped by maxCut), the last one fills the rest
      let cursor = a;
      while (cursor < b) {
        let len = Math.max(minClip, segLen(seg(j)));
        if (maxCut) len = Math.min(maxCut, len);
        if (cursor === from && holdTo > cursor) len = Math.max(len, holdTo - cursor);
        const rest = b - cursor;
        if (len >= rest || rest - len < minClip) len = rest;
        place(cursor, cursor + len);
        cursor += len;
      }
      continue;
    }
    // a line interval: one clip, or equal parts of <= ~maxCut (tempo); the part covering holdFirst stays whole
    const len = b - a;
    if (!maxCut || len <= maxCut * 1.25) {
      place(a, b);
      continue;
    }
    let s = a;
    if (a === from && holdTo > from) {
      let head = Math.min(b, Math.max(holdTo, from + maxCut));
      if (b - head < minClip) head = b;
      place(s, head);
      s = head;
    }
    const rest = b - s;
    if (rest <= 0) continue;
    const parts = Math.max(1, Math.ceil(rest / maxCut));
    for (let p = 0; p < parts; p++) place(s + Math.floor((rest * p) / parts), s + Math.floor((rest * (p + 1)) / parts));
  }
  const cuts = clips.map((c) => c.from).filter((f) => f > from && f < to);
  return { clips, cuts, nextIndex: start + j };
}

/** Frames (> 0) where consecutive clips change, for SE "transition" / cut flashes. */
export const cutsOf = (clips: PlacedClip[], from = 0, to = Infinity) =>
  [...new Set(clips.map((c) => c.from))].filter((f) => f > from && f < to).sort((a, b) => a - b);

/* ------------------------------------------------------------------ */
/* Proportional blocks (fixed length)                                   */
/* ------------------------------------------------------------------ */

/**
 * Wanted block lengths (frames) -> lengths that fit `total` (scaled down proportionally when the sum is larger,
 * unchanged otherwise). Integer, sum <= total, each >= `min` when possible.
 */
export function fitBlocks(wanted: number[], total: number, min = 1): number[] {
  const sum = wanted.reduce((a, b) => a + b, 0);
  if (sum <= total || sum === 0) return wanted.slice();
  const out = wanted.map((w) => Math.max(Math.min(min, w), Math.floor((w * total) / sum)));
  let over = out.reduce((a, b) => a + b, 0) - total;
  for (let i = out.length - 1; over > 0 && i >= 0; i--) {
    const take = Math.min(over, Math.max(0, out[i]! - 1));
    out[i]! -= take;
    over -= take;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Sections / SE / timeline                                             */
/* ------------------------------------------------------------------ */

export type SectionMark = { id: string; kind: SectionKind; label: string; from: number };

/**
 * Section marks (start frames, any order) -> gap-free sections covering [0, totalFrames): each runs to the next
 * mark; zero-length ones are dropped; the first one is stretched to start at 0. Always >= 1 section.
 */
export function sectionsFromMarks(marks: SectionMark[], totalFrames: number): TimelineSectionInfo[] {
  const sorted = marks
    .map((m, i) => ({ ...m, from: Math.max(0, Math.min(totalFrames, Math.round(m.from))), i }))
    .sort((a, b) => a.from - b.from || a.i - b.i);
  const out: TimelineSectionInfo[] = [];
  sorted.forEach((m, i) => {
    const next = sorted[i + 1];
    const end = next ? next.from : totalFrames;
    const from = out.length === 0 ? 0 : m.from;
    if (end > from) out.push({ id: m.id, kind: m.kind, label: m.label, from, durationInFrames: end - from });
  });
  if (out.length === 0) out.push({ id: "main", kind: "main", label: "本編", from: 0, durationInFrames: Math.max(1, totalFrames) });
  return out;
}

/**
 * Standard marks: つかみ (hook kind, until the last hook line ends; omitted without hook lines) / 本編 (main) /
 * extra marks of the template / エンド (end, when there is an end card). Pass the result to sectionsFromMarks.
 */
export function standardMarks(base: ShortBase, extra: SectionMark[] = [], hookEnd = base.hookEnd): SectionMark[] {
  const marks: SectionMark[] = [];
  if (hookEnd > 0) marks.push({ id: "hook", kind: "hook", label: "つかみ", from: 0 });
  marks.push({ id: "main", kind: "main", label: "本編", from: hookEnd });
  marks.push(...extra);
  if (base.endFrames > 0) marks.push({ id: "end", kind: "end", label: "エンド", from: base.bodyFrames });
  return marks;
}

/** default SE gains of the kit (templates may override per event) */
export const SE_GAIN = { headline: 1, transition: 0.7, point: 0.9, info: 0.9, cta: 1, captionPop: 1 } as const;

/**
 * Standard SE: "headline" @ 0, "transition" @ every cut (gain 0.7, or `transitionGain`), "cta" @ end card start
 * (loop: @ the CTA window start), then `extra`. Sorted by frame; events outside [0, totalFrames) are dropped.
 */
export function standardSeEvents(base: ShortBase, cuts: number[], extra: SeEvent[] = [], o: { headline?: boolean; transitionGain?: number } = {}): SeEvent[] {
  const ev: SeEvent[] = [];
  if (o.headline !== false) ev.push({ frame: 0, slot: "headline", gain: SE_GAIN.headline });
  for (const f of cuts) ev.push({ frame: f, slot: "transition", gain: o.transitionGain ?? SE_GAIN.transition });
  ev.push(...extra);
  ev.push({ frame: base.endFrames > 0 ? base.bodyFrames : base.ctaFrom, slot: "cta", gain: SE_GAIN.cta });
  return ev.filter((e) => e.frame >= 0 && e.frame < base.totalFrames).sort((a, b) => a.frame - b.frame);
}

/**
 * Caption placement for 9:16: "strip" layouts (centered 16:9 strip) -> captions in the band below the strip
 * ("blur"); "full" (full-bleed, style.vertical.mode "crop") -> above the bottom 16% ("crop"). 16:9 ignores it.
 */
export function captionLayoutFor(project: Project, o: { scale?: number; verticalMode?: VerticalMode } = {}): NonNullable<TemplateTimeline["captionLayout"]> {
  return { scale: o.scale ?? 1.2, verticalMode: o.verticalMode ?? (project.style.vertical.mode === "crop" ? "crop" : "blur") };
}

/**
 * The TemplateTimeline fields every short-form template returns: fps / totalFrames / sections / narration /
 * seEvents / captionPopSe (true) / captionLayout. Spread it into the template's own timeline object.
 */
export function shortTimelineFields(
  base: ShortBase,
  o: { sections: TimelineSectionInfo[]; seEvents: SeEvent[]; captionLayout: TemplateTimeline["captionLayout"]; captionPopSe?: boolean },
): TemplateTimeline {
  const lines = [...base.bodyLines, ...base.ctaLines];
  return {
    fps: base.fps,
    totalFrames: Math.max(1, base.totalFrames),
    sections: o.sections,
    narration: { lines, overflowLineIds: lines.filter((l) => l.cut).map((l) => l.lineId) },
    seEvents: o.seEvents,
    captionPopSe: o.captionPopSe ?? true,
    captionLayout: o.captionLayout,
  };
}
