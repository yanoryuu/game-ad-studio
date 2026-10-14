import { stripEmphasis, type Lang, type Project } from "@gas/shared";
import { segLen, type PlacedClip, type Segment } from "../../../common/clips";
import type { SeEvent } from "../../../common/SeTrack";
import type { TemplateTimeline } from "../../types";
import {
  buildShortBase,
  captionLayoutFor,
  fillInterval,
  fitBlocks,
  layClips,
  sec,
  sectionsFromMarks,
  shortData,
  shortTimelineFields,
  standardMarks,
  standardSeEvents,
  textOf,
  type SectionMark,
} from "../common";

/**
 * Template "before-after" (ビフォーアフター) — ARCHITECTURE §5.10:
 * title (見出し) on top the whole body. Hook slot = BEFORE (desaturated, old-tape look + sub label "1年前").
 * HARD cut (no fade, ~2-frame white flash) -> main slot = AFTER (vivid + note label "今").
 * flag: the last ~2.5 s of the body show both side by side (9:16 stacked, 16:9 left/right). -> common end card.
 */

export const BEFORE_AFTER = {
  MIN_BODY_SEC: 6,
  NO_NARRATION_MIN_SEC: 8,
  NO_NARRATION_MAX_SEC: 15,
  /** BEFORE part: clamp of (hook lines / hook clip length) */
  BEFORE_MIN_SEC: 2.0,
  BEFORE_MAX_SEC: 4.5,
  /** BEFORE never takes more than this share of the body */
  BEFORE_MAX_SHARE: 0.42,
  /** AFTER part: shortest worth showing before the comparison */
  AFTER_MIN_SEC: 2.0,
  /** comparison window at the end of the body (flag) */
  COMPARE_SEC: 2.5,
  COMPARE_MIN_SEC: 1.2,
  /** hard-cut white flash */
  FLASH_FRAMES: 2,
  /** tempo of the AFTER part */
  MAX_CUT_SEC: 2.2,
} as const;

export type BeforeAfterTimeline = TemplateTimeline & {
  bodyFrames: number;
  endFrames: number;
  /** headline ("" = none) */
  title: string;
  /** BEFORE / AFTER labels (plain text, "" = none) */
  beforeLabel: string;
  afterLabel: string;
  /** body frame of the hard cut BEFORE -> AFTER (0 = no BEFORE part) */
  switchAt: number;
  /** comparison window [compareFrom, bodyFrames); compareFrom = bodyFrames when off */
  compareFrom: number;
  /** BEFORE footage [0, switchAt) + AFTER footage [switchAt, compareFrom) — absolute body frames */
  clips: PlacedClip[];
  cuts: number[];
  /** comparison footage, frames relative to compareFrom (BEFORE is muted) */
  compareBefore: PlacedClip[];
  compareAfter: PlacedClip[];
};

export function buildTimeline(project: Project, fps: number, lang: Lang): BeforeAfterTimeline {
  const C = BEFORE_AFTER;
  const data = shortData(project, "before-after");
  const base = buildShortBase(project, fps, lang, {
    minBodySec: C.MIN_BODY_SEC,
    noNarrationSec: { min: C.NO_NARRATION_MIN_SEC, max: C.NO_NARRATION_MAX_SEC },
  });
  const body = base.bodyFrames;
  const title = textOf(data.title, lang);
  const beforeLabel = stripEmphasis(textOf(data.sub, lang)).replace(/\s*\n\s*/g, " ").trim();
  const afterLabel = stripEmphasis(textOf(data.note, lang)).replace(/\s*\n\s*/g, " ").trim();

  // material: hook slot = BEFORE, main slot = AFTER (fallbacks so a project with one slot still works)
  const beforeSegs: Segment[] = base.hookSegs.length > 0 ? base.hookSegs : base.segs.slice(0, 1);
  const afterSegs: Segment[] = base.mainSegs.length > 0 ? base.mainSegs : base.segs.length > 1 ? base.segs.slice(1) : base.segs;

  // block lengths: BEFORE / AFTER / COMPARE
  const beforeNatural = base.hookEnd > 0 ? base.hookEnd + sec(0.15, fps) : beforeSegs.reduce((a, s) => a + segLen(s), 0) || sec(3, fps);
  const beforeWanted = Math.min(
    Math.max(sec(C.BEFORE_MIN_SEC, fps), Math.min(beforeNatural, sec(C.BEFORE_MAX_SEC, fps))),
    Math.floor(body * C.BEFORE_MAX_SHARE),
  );
  const compareWanted = data.flag ? sec(C.COMPARE_SEC, fps) : 0;
  const afterMin = sec(C.AFTER_MIN_SEC, fps);
  let [beforeF, afterF, compareF] = fitBlocks([beforeWanted, afterMin, compareWanted], body, 1) as [number, number, number];
  afterF = body - beforeF - compareF; // the AFTER part takes everything else
  if (compareF > 0 && compareF < sec(C.COMPARE_MIN_SEC, fps)) {
    afterF += compareF;
    compareF = 0;
  }
  const switchAt = beforeF;
  const compareFrom = switchAt + afterF;

  // footage
  const before = layClips(beforeSegs, { from: 0, to: switchAt }, fps, { keyPrefix: "ba-b" });
  const after = layClips(afterSegs, { from: switchAt, to: compareFrom }, fps, {
    lines: base.played,
    maxCutSec: C.MAX_CUT_SEC,
    keyPrefix: "ba-a",
  });
  const clips = [...before.clips, ...after.clips];
  const cuts = [...new Set(clips.map((c) => c.from))].filter((f) => f > 0 && f < body).sort((a, b) => a - b);

  let compareBefore: PlacedClip[] = [];
  let compareAfter: PlacedClip[] = [];
  if (compareF > 0) {
    const b = beforeSegs[0];
    // the AFTER side: the most "finished" shot = the last AFTER clip material
    const a = afterSegs[afterSegs.length - 1];
    if (b) compareBefore = fillInterval(b, 0, compareF, "ba-cb").map((c) => ({ ...c, volume: 0 }));
    if (a) compareAfter = fillInterval(a, 0, compareF, "ba-ca");
  }

  // sections
  const extra: SectionMark[] = [];
  if (switchAt > 0) extra.push({ id: "after", kind: "main", label: "アフター", from: switchAt });
  if (compareF > 0) extra.push({ id: "compare", kind: "card", label: "比較", from: compareFrom });
  const marks = standardMarks(base, extra, 0)
    .filter((m) => m.id !== "hook")
    .map((m) => (m.id === "main" ? { ...m, id: "before", kind: "hook" as const, label: "ビフォー" } : m));
  const sections = sectionsFromMarks(marks, base.totalFrames);

  // SE: headline @0, a strong transition + point @ the hard cut, soft whooshes on later cuts, point @ compare
  const se: SeEvent[] = [];
  if (switchAt > 0) se.push({ frame: switchAt, slot: "transition", gain: 1 }, { frame: switchAt, slot: "point", gain: 0.9 });
  if (compareF > 0) se.push({ frame: compareFrom, slot: "info", gain: 0.9 });
  const softCuts = cuts.filter((f) => f !== switchAt);
  const seEvents = standardSeEvents(base, softCuts, se, { headline: !!title, transitionGain: 0.45 });

  return {
    ...shortTimelineFields(base, { sections, seEvents, captionLayout: captionLayoutFor(project, { scale: 1.2 }) }),
    bodyFrames: body,
    endFrames: base.endFrames,
    title,
    beforeLabel,
    afterLabel,
    switchAt,
    compareFrom,
    clips,
    cuts,
    compareBefore,
    compareAfter,
  };
}
