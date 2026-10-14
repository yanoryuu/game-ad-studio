import { stripEmphasis, type Lang, type Project } from "@gas/shared";
import type { PlacedClip } from "../../../common/clips";
import type { TemplateTimeline } from "../../types";
import {
  buildShortBase,
  captionLayoutFor,
  ctaText,
  layClips,
  sectionsFromMarks,
  shortData,
  shortTimelineFields,
  standardMarks,
  standardSeEvents,
  textOf,
} from "../common";

/**
 * Template "dev-pitch" (開発者ピッチ, "The Matriarch" type) — ARCHITECTURE §5.10:
 * 9:16 = first-person pitch (title) in a top band the whole body, gameplay strip in the middle with short, punchy
 * cuts, a CTA bar ALWAYS visible under the strip (texts.cta + developer handle = sub); 16:9 = top banner +
 * bottom-right CTA card. -> common end card.
 */

export const DEV_PITCH = {
  MIN_BODY_SEC: 5,
  NO_NARRATION_MIN_SEC: 8,
  NO_NARRATION_MAX_SEC: 15,
  /** tempo: clips are short */
  MAX_CUT_SEC: 1.3,
  /** the hook clip stays this long ("the core of the game in 2 seconds") */
  HOLD_FIRST_SEC: 2.0,
  /** 9:16 geometry (reference px): band [0, BAND_H), strip [BAND_H, BAND_H + 608), CTA bar below it */
  BAND_H: 600,
} as const;

export type DevPitchTimeline = TemplateTimeline & {
  bodyFrames: number;
  endFrames: number;
  /** pitch text ("" = none) */
  title: string;
  /** developer handle ("" = none) */
  handle: string;
  /** texts[lang].cta ("" = no button) */
  cta: string;
  clips: PlacedClip[];
  cuts: number[];
};

export function buildTimeline(project: Project, fps: number, lang: Lang): DevPitchTimeline {
  const data = shortData(project, "dev-pitch");
  const base = buildShortBase(project, fps, lang, {
    minBodySec: DEV_PITCH.MIN_BODY_SEC,
    noNarrationSec: { min: DEV_PITCH.NO_NARRATION_MIN_SEC, max: DEV_PITCH.NO_NARRATION_MAX_SEC },
  });
  const lay = layClips(base.segs, { from: 0, to: base.bodyFrames }, fps, {
    lines: base.played,
    maxCutSec: DEV_PITCH.MAX_CUT_SEC,
    holdFirstSec: DEV_PITCH.HOLD_FIRST_SEC,
    keyPrefix: "dp",
  });
  const sections = sectionsFromMarks(standardMarks(base), base.totalFrames);
  const title = textOf(data.title, lang);
  // many short cuts -> quieter whooshes
  const seEvents = standardSeEvents(base, lay.cuts, [], { headline: !!title, transitionGain: 0.45 });
  return {
    ...shortTimelineFields(base, {
      sections,
      seEvents,
      // captions sit between the CTA bar and the bottom safe zone (above the bottom 16%)
      captionLayout: captionLayoutFor(project, { scale: 1.1, verticalMode: "crop" }),
    }),
    bodyFrames: base.bodyFrames,
    endFrames: base.endFrames,
    title,
    handle: stripEmphasis(textOf(data.sub, lang)).trim(),
    cta: ctaText(project, lang),
    clips: lay.clips,
    cuts: lay.cuts,
  };
}
