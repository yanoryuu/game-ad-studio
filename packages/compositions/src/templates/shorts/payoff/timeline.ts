import type { Lang, Project } from "@gas/shared";
import type { PlacedClip, Segment } from "../../../common/clips";
import type { SeEvent } from "../../../common/SeTrack";
import type { TemplateTimeline } from "../../types";
import {
  buildShortBase,
  captionLayoutFor,
  fillInterval,
  fitBlocks,
  sec,
  sectionsFromMarks,
  shortData,
  shortTimelineFields,
  standardSeEvents,
  textOf,
  MIN_CLIP_SEC,
  type SectionMark,
  transitionCutsOf,
} from "../common";

/**
 * Template "payoff" (溜め→爆発) — ARCHITECTURE §5.10:
 * the hype line (title) sits in the top band the whole body. Every clip but the last = build-up: cuts get
 * shorter and shorter (accelerating tempo), and (flag) a charge gauge fills up, bumping at every cut. The last clip
 * = the payoff: white flash, zoom punch, shake, burst rays and note slammed big. -> common end card.
 */

export const PAYOFF = {
  MIN_BODY_SEC: 6,
  NO_NARRATION_MIN_SEC: 8,
  NO_NARRATION_MAX_SEC: 15,
  /** payoff (last clip) length */
  PAYOFF_SEC: 3.2,
  /** build-up never shorter than this (fixed length shrinks the payoff first) */
  BUILD_MIN_SEC: 2.5,
  /** accelerating build-up: first cut length range and the last (fastest) cut length */
  FIRST_CUT_MIN_SEC: 1.0,
  FIRST_CUT_MAX_SEC: 2.6,
  LAST_CUT_SEC: 0.55,
} as const;

export type PayoffTimeline = TemplateTimeline & {
  bodyFrames: number;
  endFrames: number;
  /** hype line ("" = no band text) */
  title: string;
  /** payoff text ("" = none) */
  note: string;
  /** show the charge gauge */
  gauge: boolean;
  /** build-up [0, payFrom), payoff [payFrom, bodyFrames) */
  payFrom: number;
  clips: PlacedClip[];
  /** build-up cuts (accelerating) */
  cuts: number[];
};

/**
 * Accelerating cut lengths filling `span` frames: a geometric series from `first` down to `last` frames, the number
 * of cuts chosen so the natural sum is closest to `span`, then scaled to fit exactly. Integer, each >= `min`.
 */
export function acceleratingCuts(span: number, first: number, last: number, min: number): number[] {
  if (span <= 0) return [];
  if (span <= first + min) return [span];
  let best: number[] = [span];
  let bestErr = Infinity;
  for (let n = 2; n <= 80; n++) {
    const r = Math.pow(last / first, 1 / (n - 1));
    const lens = Array.from({ length: n }, (_, k) => first * Math.pow(r, k));
    const sum = lens.reduce((a, b) => a + b, 0);
    const err = Math.abs(sum - span);
    if (err < bestErr) {
      bestErr = err;
      best = lens;
    }
    if (sum > span * 1.5) break;
  }
  const sum = best.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let acc = 0;
  let prevEdge = 0;
  for (let k = 0; k < best.length; k++) {
    acc += best[k]!;
    const edge = k === best.length - 1 ? span : Math.round((acc * span) / sum);
    out.push(edge - prevEdge);
    prevEdge = edge;
  }
  // merge too-short cuts into their predecessor
  const merged: number[] = [];
  for (const l of out) {
    if (l < min && merged.length > 0) merged[merged.length - 1]! += l;
    else merged.push(l);
  }
  return merged.filter((l) => l > 0);
}

export function buildTimeline(project: Project, fps: number, lang: Lang): PayoffTimeline {
  const data = shortData(project, "payoff");
  const base = buildShortBase(project, fps, lang, {
    minBodySec: PAYOFF.MIN_BODY_SEC,
    noNarrationSec: { min: PAYOFF.NO_NARRATION_MIN_SEC, max: PAYOFF.NO_NARRATION_MAX_SEC },
  });
  const body = base.bodyFrames;
  const title = textOf(data.title, lang);
  const note = textOf(data.note, lang);

  // ---- blocks: build-up | payoff --------------------------------------------------------------------------
  const segs = base.segs;
  const paySeg: Segment | undefined = segs[segs.length - 1];
  const buildSegs = segs.length > 1 ? segs.slice(0, -1) : segs;
  const [buildLen] = fitBlocks([Math.max(0, body - sec(PAYOFF.PAYOFF_SEC, fps)), sec(PAYOFF.PAYOFF_SEC, fps)], body);
  let payFrom = Math.max(0, Math.min(body, buildLen!));
  if (payFrom < sec(PAYOFF.BUILD_MIN_SEC, fps)) payFrom = Math.min(Math.floor(body * 0.55), sec(PAYOFF.BUILD_MIN_SEC, fps));

  // ---- clips: accelerating build-up through the build-up clips (each continues where it stopped), then payoff
  const clips: PlacedClip[] = [];
  const cuts: number[] = [];
  if (buildSegs.length > 0 && payFrom > 0) {
    const first = Math.max(sec(PAYOFF.FIRST_CUT_MIN_SEC, fps), Math.min(sec(PAYOFF.FIRST_CUT_MAX_SEC, fps), Math.round(payFrom / 6)));
    const lens = acceleratingCuts(payFrom, first, sec(PAYOFF.LAST_CUT_SEC, fps), Math.max(2, Math.round(sec(MIN_CLIP_SEC, fps) * 0.6)));
    const cursor = buildSegs.map((s) => s.inF);
    let at = 0;
    lens.forEach((len, k) => {
      const i = k % buildSegs.length;
      const s = buildSegs[i]!;
      // continue inside the clip's material; restart at inF when the rest is shorter than this cut
      let start = cursor[i]!;
      if (start + len > s.outF) start = s.inF;
      cursor[i] = start + len;
      clips.push(...fillInterval({ ...s, inF: start, outF: Math.max(start + 1, Math.min(s.outF, start + len)) }, at, len, `po-b${k}`));
      if (at > 0) cuts.push(at);
      at += len;
    });
  }
  if (paySeg && body > payFrom) clips.push(...fillInterval(paySeg, payFrom, body - payFrom, "po-pay"));

  // ---- sections -------------------------------------------------------------------------------------------
  const marks: SectionMark[] = [];
  const hookEnd = Math.min(base.hookEnd, payFrom);
  if (hookEnd > 0) marks.push({ id: "hook", kind: "hook", label: "つかみ", from: 0 });
  marks.push({ id: "build", kind: "main", label: "溜め", from: hookEnd });
  if (body > payFrom) marks.push({ id: "payoff", kind: "card", label: "爆発", from: payFrom });
  if (base.endFrames > 0) marks.push({ id: "end", kind: "end", label: "エンド", from: body });
  const sections = sectionsFromMarks(marks, base.totalFrames);

  // ---- SE: whooshes get louder towards the payoff; the payoff hits with transition + point ----------------
  const se: SeEvent[] = cuts.map((f) => ({ frame: f, slot: "transition" as const, gain: 0.3 + 0.5 * (f / Math.max(1, payFrom)) }));
  if (body > payFrom && payFrom > 0) se.push({ frame: payFrom, slot: "transition", gain: 1 });
  if (body > payFrom) se.push({ frame: payFrom, slot: "point", gain: 1 });
  const seEvents = standardSeEvents(base, [], se, { headline: !!title });

  return {
    ...shortTimelineFields(base, { sections, seEvents, captionLayout: captionLayoutFor(project, { scale: 1.2 }) }),
    bodyFrames: body,
    endFrames: base.endFrames,
    title,
    note,
    gauge: data.flag,
    payFrom,
    clips,
    // §5.11 cut transitions (auto): whip through the accelerating build-up; NOT the payoff cut (own flash + zoom punch)
    transitionCuts: transitionCutsOf(cuts, "whip", payFrom),
    cuts,
  };
}

/** Gauge fill 0..1 at body frame `f` (eased, with a small bump at every build-up cut). Full from payFrom. */
export function gaugeValue(tl: Pick<PayoffTimeline, "payFrom" | "cuts" | "fps">, f: number): number {
  if (f >= tl.payFrom) return 1;
  const t = Math.max(0, f / Math.max(1, tl.payFrom));
  let v = 0.04 + 0.9 * Math.pow(t, 1.35);
  for (const c of tl.cuts) {
    const d = f - c;
    if (d >= 0 && d < tl.fps * 0.25) v += 0.035 * (1 - d / (tl.fps * 0.25));
  }
  return Math.min(0.97, v);
}

