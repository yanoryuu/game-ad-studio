import type { Lang, Project } from "@gas/shared";
import type { PlacedClip } from "../../../common/clips";
import type { TemplateTimeline } from "../../types";
import {
  buildShortBase,
  captionLayoutFor,
  ctaText,
  layClips,
  LOOP_CTA_SEC,
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
 * Template "loop" (無限ループ) — ARCHITECTURE §5.10:
 * minimal text (title small on top if set), footage only at a quick tempo, NO end card. The last ~2.5 s get a
 * small CTA card (texts.cta; cta lines play there). flag: the last ~0.5 s cross-fade into the opening footage
 * (the frames right before the first clip's in-point) so the video loops seamlessly; the CTA leaves before the
 * loop point so the last frame matches frame 0.
 */

export const LOOP = {
  MIN_BODY_SEC: 5,
  NO_NARRATION_MIN_SEC: 7,
  NO_NARRATION_MAX_SEC: 15,
  /** tempo: short cuts */
  MAX_CUT_SEC: 1.6,
  /** the opening clip (the seam) is held at least this long */
  HOLD_FIRST_SEC: 1.0,
  /** cross-fade into the opening footage at the very end (flag) */
  XFADE_SEC: 0.5,
  /** CTA window (= kit LOOP_CTA_SEC) */
  CTA_SEC: LOOP_CTA_SEC,
} as const;

export type LoopTimeline = TemplateTimeline & {
  bodyFrames: number;
  /** always 0 (no end card) */
  endFrames: number;
  /** small headline ("" = none) */
  title: string;
  /** texts[lang].cta */
  cta: string;
  /** CTA overlay window [ctaFrom, totalFrames) */
  ctaFrom: number;
  /** seamless cross-fade [xfadeFrom, totalFrames) (= totalFrames when off) */
  xfadeFrom: number;
  clips: PlacedClip[];
  cuts: number[];
  /** opening footage played under the cross-fade (frames relative to xfadeFrom; muted) */
  seamClip: PlacedClip | null;
};

export function buildTimeline(project: Project, fps: number, lang: Lang): LoopTimeline {
  const C = LOOP;
  const data = shortData(project, "loop");
  const base = buildShortBase(project, fps, lang, {
    minBodySec: C.MIN_BODY_SEC,
    noNarrationSec: { min: C.NO_NARRATION_MIN_SEC, max: C.NO_NARRATION_MAX_SEC },
    endCard: false,
    loopCtaSec: C.CTA_SEC,
  });
  const total = base.bodyFrames;
  const title = textOf(data.title, lang);

  const lay = layClips(base.segs, { from: 0, to: total }, fps, {
    lines: base.played,
    maxCutSec: C.MAX_CUT_SEC,
    holdFirstSec: C.HOLD_FIRST_SEC,
    keyPrefix: "lp",
  });

  // seamless loop: the opening footage fades in over the last XF frames, ending right at the first clip's in-point
  const first = base.segs[0];
  const xf = data.flag && first ? Math.min(sec(C.XFADE_SEC, fps), Math.floor(total * 0.1)) : 0;
  const xfadeFrom = total - xf;
  const seamClip: PlacedClip | null =
    xf > 0 && first
      ? {
          key: "lp-seam",
          clipId: first.clipId,
          sourceId: first.sourceId,
          from: 0,
          playFrames: xf,
          holdFrames: 0,
          trimBefore: Math.max(0, first.inF - xf),
          volume: 0,
          focusX: first.focusX,
          hasAudio: first.hasAudio,
        }
      : null;

  const extra: SectionMark[] = base.ctaFrames > 0 && base.ctaFrom > 0 ? [{ id: "cta", kind: "card", label: "CTA", from: base.ctaFrom }] : [];
  const marks = standardMarks(base, extra).map((m) => (m.id === "main" ? { ...m, label: "ループ" } : m));
  const sections = sectionsFromMarks(marks, base.totalFrames);
  // quiet whooshes (many cuts); "cta" @ the CTA window (kit)
  const seEvents = standardSeEvents(base, lay.cuts, [], { headline: !!title, transitionGain: 0.35 });

  return {
    ...shortTimelineFields(base, {
      sections,
      seEvents,
      // 9:16: captions above the bottom 16% (under the footage window / CTA; crop mode = full-bleed)
      captionLayout: captionLayoutFor(project, { scale: 1.15, verticalMode: "crop" }),
    }),
    bodyFrames: total,
    endFrames: 0,
    title,
    cta: ctaText(project, lang),
    ctaFrom: base.ctaFrom,
    xfadeFrom,
    clips: lay.clips,
    cuts: lay.cuts,
    seamClip,
  };
}
