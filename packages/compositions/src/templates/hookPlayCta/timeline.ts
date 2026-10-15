import type { Lang, Project } from "@gas/shared";
import { consumeFrames, fitSegments, MIN_CLIP_SEC, segLen, toSegments, type TimelineSection } from "../../common/clips";
import { layoutNarration, placeSection } from "../../common/narrationLayout";
import type { TransitionCut } from "../../common/transitions";
import type { TemplateTimeline } from "../types";

/**
 * Shared timeline of the "hook-play-cta" template.
 * Used by BOTH calcAdMetadata (duration) and <AdVideo> (rendering), so they can never disagree.
 * All values are integer frames at the output fps.
 */

export const HOOK_SEC = 2.5;
export const END_CARD_SEC = 3;
/** Fixed durationSec: the hook / end card may grow up to this to fit their narration (main shrinks). */
export const MAX_HOOK_SEC = 5;
export const MAX_END_CARD_SEC = 5;

export type AdTimeline = TemplateTimeline & {
  hook: TimelineSection;
  main: TimelineSection;
  endCard: TimelineSection;
  /** true if the hook section re-uses the beginning of the main clips (no hook-slot clips) */
  hookBorrowedFromMain: boolean;
};

/**
 * @param lang narration language: with durationSec === null, sections grow so its narration fits.
 *             With a fixed durationSec, hook / end card grow to fit their narration up to
 *             MAX_HOOK_SEC / MAX_END_CARD_SEC (the main section absorbs the difference, total stays
 *             exactly durationSec); narration that still overflows its section is cut (see NarrationPlan).
 */
export function buildTimeline(project: Project, fps: number, lang: Lang): AdTimeline {
  const narr = layoutNarration(project, lang, fps);
  const free = project.durationSec === null;
  const grow = (base: number, need: number, max: number) =>
    Math.max(Math.round(base * fps), free ? need : Math.min(need, Math.round(max * fps)));
  // fixed durations are 15 / 30 s, so hook + end card (<= 10 s) always leave room for main
  const hookFrames = grow(HOOK_SEC, narr.hookNeed, MAX_HOOK_SEC);
  const endFrames = grow(END_CARD_SEC, narr.ctaNeed, MAX_END_CARD_SEC);
  const minFrames = Math.round(MIN_CLIP_SEC * fps);

  const hookSegs0 = toSegments(project, project.clips.filter((c) => c.slot === "hook"), fps);
  let mainSegs = toSegments(project, project.clips.filter((c) => c.slot === "main"), fps);

  let hookSegs = hookSegs0;
  let hookBorrowedFromMain = false;
  if (hookSegs.length === 0 && mainSegs.length > 0) {
    const { taken, rest } = consumeFrames(mainSegs, hookFrames, Math.round(0.5 * fps));
    hookSegs = taken;
    mainSegs = rest;
    hookBorrowedFromMain = true;
  }

  let mainFrames: number;
  if (project.durationSec === null) {
    // free length: natural clip length, extended (extra source material / last-frame hold) to fit the narration
    mainFrames = Math.max(mainSegs.reduce((a, s) => a + segLen(s), 0), narr.mainNeed);
  } else {
    mainFrames = Math.max(0, Math.round(project.durationSec * fps) - hookFrames - endFrames);
  }

  const hookClips = fitSegments(hookSegs, hookFrames, 1, "hook");
  const mainClips = fitSegments(mainSegs, mainFrames, minFrames, "main");

  const hook: TimelineSection = { from: 0, durationInFrames: hookFrames, clips: hookClips };
  const main: TimelineSection = { from: hookFrames, durationInFrames: mainFrames, clips: mainClips };
  const endCard: TimelineSection = { from: hookFrames + mainFrames, durationInFrames: endFrames, clips: [] };

  const lines = [
    ...placeSection(narr.hook, "hook", hook.from, hook.durationInFrames, !free),
    ...placeSection(narr.main, "main", main.from, main.durationInFrames, !free),
    ...placeSection(narr.cta, "cta", endCard.from, endCard.durationInFrames, !free),
  ];

  // §5.11 cut transitions: every clip change in hook + main incl. hook -> main (not into the end card);
  // auto alternates whip / zoom (they replace the cut punch of ClipTrack there)
  const cutFrames = [
    ...hookClips.map((c) => hook.from + c.from).filter((f) => f > hook.from),
    ...(hookClips.length > 0 && mainClips.length > 0 ? [main.from] : []),
    ...mainClips.map((c) => main.from + c.from).filter((f) => f > main.from),
  ].filter((f) => f < endCard.from);
  const transitionCuts: TransitionCut[] = [...new Set(cutFrames)]
    .sort((a, b) => a - b)
    .map((frame, i) => ({ frame, auto: i % 2 === 0 ? "whip" : "zoom" }));

  return {
    fps,
    transitionCuts,
    totalFrames: hookFrames + mainFrames + endFrames,
    sections: [
      { id: "hook", kind: "hook", label: "フック", from: hook.from, durationInFrames: hook.durationInFrames },
      { id: "main", kind: "main", label: "本編", from: main.from, durationInFrames: main.durationInFrames },
      { id: "end", kind: "end", label: "エンド", from: endCard.from, durationInFrames: endCard.durationInFrames },
    ],
    hook,
    main,
    endCard,
    hookBorrowedFromMain,
    narration: { lines, overflowLineIds: lines.filter((l) => l.cut).map((l) => l.lineId) },
  };
}
