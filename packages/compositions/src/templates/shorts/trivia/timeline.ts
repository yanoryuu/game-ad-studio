import { stripEmphasis, type Lang, type Project } from "@gas/shared";
import type { PlacedClip } from "../../../common/clips";
import { BODY_FONT } from "../../../common/fonts";
import type { PlacedNarration } from "../../../common/narrationLayout";
import type { TemplateTimeline } from "../../types";
import {
  buildShortBase,
  layClips,
  sectionsFromMarks,
  shortData,
  shortTimelineFields,
  standardMarks,
  standardSeEvents,
  textOf,
  type SectionMark,
} from "../common";
import { TRIVIA_FAMILY_NAME } from "./font";

/**
 * Template "trivia" (雑学ストーリー) — ARCHITECTURE §5.10. Recreates the "ゲーム雑学" YouTube Short format:
 * WHITE background, a 2-line title fixed for the whole video (line 1 = white on a red box, line 2 = black on
 * white), a full-width ~8:7 media window under it (cover-cropped at focusX, hard cuts per narration line,
 * long lines split every ~1.2 s) and black, un-outlined captions below the window (common <Captions>,
 * captionLayout.variant "plain-dark"). flag = no end card (cta lines continue right after the body lines);
 * flag off = common end card.
 */

export const TRIVIA = {
  MIN_BODY_SEC: 5,
  NO_NARRATION_MIN_SEC: 8,
  NO_NARRATION_MAX_SEC: 20,
  /** tempo: a long narration line switches the picture every ~1.2 s */
  MAX_CUT_SEC: 1.2,
  /** whooshes on every cut, but quiet (there are many) */
  TRANSITION_GAIN: 0.5,
  /** caption size multiplier (base 68px "m" -> ~85px like the reference) */
  CAPTION_SCALE: 1.25,
  /** 9:16 geometry (px of 1080×1920), measured on the reference */
  V: {
    /** title block: red box from ~272, line 2 ends right above the window */
    titleBottom: 482,
    titleMaxFont: 86,
    titleSideMargin: 30,
    /** media window [mediaTop, mediaTop + mediaH): full width, 8:7 */
    mediaTop: 488,
    mediaH: 945,
    /** caption box hangs from here (reference caption center y ≈ 1504) */
    captionTop: 1452,
  },
  /** 16:9 geometry (px of 1920×1080): title + captions in the left column, media window on the right */
  H: {
    colLeft: 56,
    colRight: 1920 - 880 + 40, // = 1080 px from the right edge -> column [56, 840)
    titleTop: 150,
    titleMaxFont: 66,
    mediaLeft: 880,
    mediaW: 984,
    mediaH: 861, // 8:7
    captionTop: 470,
    captionBottom: 130,
  },
} as const;

export type TriviaTimeline = TemplateTimeline & {
  bodyFrames: number;
  endFrames: number;
  /** title line 1 (red box) / line 2 (black on white); "" = not shown */
  line1: string;
  line2: string;
  /** small line near the bottom of the media window ("" = none) */
  sub: string;
  /** flag: no end card */
  noEndCard: boolean;
  clips: PlacedClip[];
  cuts: number[];
};

/** "line 1\nline 2[\n…]" -> [line 1, rest joined]. One line -> [line, ""]. Empty lines are skipped. */
export function splitTitle(title: string): [string, string] {
  const lines = title
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => stripEmphasis(l).trim() !== "");
  return [lines[0] ?? "", lines.slice(1).join(" ")];
}

/**
 * flag (no end card): the cta lines of `lang` are moved behind the body lines (as main lines), so they play
 * right after the body narration and also switch the picture. Their PlacedNarration keeps section "cta".
 */
function withCtaInBody(project: Project, lang: Lang): Project {
  const isCta = (l: Project["script"][number]) => l.lang === lang && l.section === "cta";
  if (!project.script.some(isCta)) return project;
  return {
    ...project,
    script: [...project.script.filter((l) => !isCta(l)), ...project.script.filter(isCta).map((l) => ({ ...l, section: "main" as const }))],
  };
}

export function buildTimeline(project: Project, fps: number, lang: Lang): TriviaTimeline {
  const data = shortData(project, "trivia");
  const noEndCard = data.flag;
  const ctaIds = new Set(project.script.filter((l) => l.lang === lang && l.section === "cta").map((l) => l.id));
  const base = buildShortBase(noEndCard ? withCtaInBody(project, lang) : project, fps, lang, {
    minBodySec: TRIVIA.MIN_BODY_SEC,
    noNarrationSec: { min: TRIVIA.NO_NARRATION_MIN_SEC, max: TRIVIA.NO_NARRATION_MAX_SEC },
    endCard: !noEndCard,
  });
  // restore the real section of moved cta lines
  const fix = (p: PlacedNarration): PlacedNarration => (noEndCard && ctaIds.has(p.lineId) ? { ...p, section: "cta" } : p);
  const bodyLines = base.bodyLines.map(fix);
  const played = base.played.map(fix);
  const b = { ...base, bodyLines, played };

  const lay = layClips(b.segs, { from: 0, to: b.bodyFrames }, fps, {
    lines: played,
    maxCutSec: TRIVIA.MAX_CUT_SEC,
    keyPrefix: "tv",
  });

  const extra: SectionMark[] = [];
  const firstCta = played.find((p) => p.section === "cta");
  if (noEndCard && firstCta && firstCta.from > 0) extra.push({ id: "outro", kind: "main", label: "締め", from: firstCta.from });
  const sections = sectionsFromMarks(standardMarks(b, extra), b.totalFrames);

  const title = textOf(data.title, lang);
  const [line1, line2] = splitTitle(title);
  let seEvents = standardSeEvents(b, lay.cuts, [], { headline: !!title, transitionGain: TRIVIA.TRANSITION_GAIN });
  // no end card -> no "cta" whoosh (standardSeEvents would put it at the loop CTA window start)
  if (noEndCard) seEvents = seEvents.filter((e) => e.slot !== "cta");

  const fields = shortTimelineFields(b, {
    sections,
    seEvents,
    captionLayout: {
      scale: TRIVIA.CAPTION_SCALE,
      variant: "plain-dark",
      fontFamily: TRIVIA_FONT_FAMILY,
      box916: { top: TRIVIA.V.captionTop, left: 40, right: 40 },
      box169: { top: TRIVIA.H.captionTop, bottom: TRIVIA.H.captionBottom, left: TRIVIA.H.colLeft, right: TRIVIA.H.colRight },
    },
  });
  // shortTimelineFields lists ctaLines separately; with no end card they are already among the body lines
  const lines = [...bodyLines, ...(noEndCard ? [] : b.ctaLines)];
  return {
    ...fields,
    narration: { lines, overflowLineIds: lines.filter((l) => l.cut).map((l) => l.lineId) },
    bodyFrames: b.bodyFrames,
    endFrames: b.endFrames,
    line1,
    line2,
    sub: textOf(data.sub, lang),
    noEndCard,
    clips: lay.clips,
    cuts: lay.cuts,
  };
}

/** CSS family of the title / caption font (M PLUS Rounded 1c Black, loaded lazily by the Component, see font.ts). */
export const TRIVIA_FONT_FAMILY = `"${TRIVIA_FAMILY_NAME}", ${BODY_FONT}`;
