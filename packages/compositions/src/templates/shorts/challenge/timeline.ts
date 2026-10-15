import type { Lang, Project } from "@gas/shared";
import { segLen, type PlacedClip } from "../../../common/clips";
import type { SeEvent } from "../../../common/SeTrack";
import type { TemplateTimeline } from "../../types";
import {
  buildShortBase,
  captionLayoutFor,
  cutsOf,
  fitBlocks,
  layClips,
  sec,
  sectionsFromMarks,
  shortData,
  shortTimelineFields,
  standardSeEvents,
  textOf,
  SE_GAIN,
  type SectionMark,
  transitionCutsOf,
} from "../common";

/**
 * Template "challenge" (挑戦状) — ARCHITECTURE §5.10:
 * 0 s: "CHALLENGE" badge + the challenge (title) over the hook clip (the hard part), screen-recording look (red REC
 * viewfinder). number > 0: a countdown timer number -> 0 stretched over the play part. Body: hook slot (挑戦シーン)
 * then main slot (プレイ) with quick cuts. flag: the last ~1.2 s of the play is blacked out and the result is hidden
 * behind sub ("結果は…"). Then note (エンド前の一言) on a hazard-tape card -> common end card.
 */

export const CHALLENGE = {
  MIN_BODY_SEC: 6,
  NO_NARRATION_MIN_SEC: 8,
  NO_NARRATION_MAX_SEC: 15,
  /** the hook (challenge) part: hook lines / hook clip length clamped to this range */
  HOOK_MIN_SEC: 2.0,
  HOOK_MAX_SEC: 4.0,
  /** blackout hiding the result (flag) */
  SUSPENSE_SEC: 1.2,
  /** note card before the end card */
  NOTE_SEC: 1.6,
  /** the play part never gets shorter than this (fixed length shrinks the other blocks) */
  PLAY_MIN_SEC: 2.0,
  /** tempo: no clip longer than this */
  MAX_CUT_SEC: 2.2,
  /** last timer seconds that tick (SE point) */
  TICKS: 3,
} as const;

export type ChallengeTimeline = TemplateTimeline & {
  bodyFrames: number;
  endFrames: number;
  /** challenge text ("" = none) */
  title: string;
  /** result-hiding text ("" = none; the blackout still shows a "?" when flag) */
  sub: string;
  /** line before the end card ("" = no note card) */
  note: string;
  /** timer start value in seconds (0 = no timer) */
  timerSec: number;
  /** the timer runs [0, timerTo) and shows 0 from there */
  timerTo: number;
  /** end of the challenge (hook) part */
  hookTo: number;
  /** blackout window [suspenseFrom, noteFrom) (equal = none) */
  suspenseFrom: number;
  /** note card [noteFrom, bodyFrames) (equal = none) */
  noteFrom: number;
  clips: PlacedClip[];
  cuts: number[];
};

export function buildTimeline(project: Project, fps: number, lang: Lang): ChallengeTimeline {
  const data = shortData(project, "challenge");
  const base = buildShortBase(project, fps, lang, {
    minBodySec: CHALLENGE.MIN_BODY_SEC,
    noNarrationSec: { min: CHALLENGE.NO_NARRATION_MIN_SEC, max: CHALLENGE.NO_NARRATION_MAX_SEC },
  });
  const body = base.bodyFrames;
  const title = textOf(data.title, lang);
  const sub = textOf(data.sub, lang);
  const note = textOf(data.note, lang);
  const timerSec = Math.max(0, Math.min(99, Math.round(data.number || 0)));

  // ---- blocks: hook | play | suspense | note -------------------------------------------------------------
  const hookSegs = base.hookSegs.length > 0 ? base.hookSegs : base.segs.slice(0, 1);
  const hookNatural = base.hookEnd > 0 ? base.hookEnd : hookSegs.reduce((a, s) => a + segLen(s), 0);
  const hookWanted = Math.max(sec(CHALLENGE.HOOK_MIN_SEC, fps), Math.min(sec(CHALLENGE.HOOK_MAX_SEC, fps), hookNatural || sec(CHALLENGE.HOOK_MIN_SEC, fps)));
  const suspWanted = data.flag ? sec(CHALLENGE.SUSPENSE_SEC, fps) : 0;
  const noteWanted = note ? sec(CHALLENGE.NOTE_SEC, fps) : 0;
  const playMin = sec(CHALLENGE.PLAY_MIN_SEC, fps);
  const [hookLen, , suspLen, noteLen] = fitBlocks([hookWanted, playMin, suspWanted, noteWanted], body);
  const hookTo = Math.min(body, hookLen!);
  const noteFrom = body - noteLen!;
  const suspenseFrom = Math.max(hookTo, noteFrom - suspLen!);
  const timerTo = Math.max(1, data.flag ? suspenseFrom : noteFrom);

  // ---- clips: hook slot over the challenge part, main slot over the rest (they run under the blackout) ----
  const mainSegs = base.mainSegs.length > 0 ? base.mainSegs : base.segs;
  const sameMaterial = base.hookSegs.length === 0;
  const hookLay = layClips(hookSegs, { from: 0, to: hookTo }, fps, { lines: base.played, maxCutSec: CHALLENGE.MAX_CUT_SEC, holdFirstSec: Math.min(1.5, hookTo / fps), keyPrefix: "ch-h" });
  const mainLay = layClips(mainSegs, { from: hookTo, to: body }, fps, {
    lines: base.played,
    maxCutSec: CHALLENGE.MAX_CUT_SEC,
    startIndex: sameMaterial ? hookLay.nextIndex : 0,
    keyPrefix: "ch-m",
  });
  const clips = [...hookLay.clips, ...mainLay.clips];
  const cuts = cutsOf(clips, 0, suspenseFrom < noteFrom ? suspenseFrom : noteFrom);

  // ---- sections ------------------------------------------------------------------------------------------
  const marks: SectionMark[] = [
    { id: "hook", kind: "hook", label: "挑戦", from: 0 },
    { id: "main", kind: "main", label: "プレイ", from: hookTo },
  ];
  if (noteFrom > suspenseFrom) marks.push({ id: "suspense", kind: "card", label: "結果は…", from: suspenseFrom });
  if (body > noteFrom) marks.push({ id: "note", kind: "card", label: "ひとこと", from: noteFrom });
  if (base.endFrames > 0) marks.push({ id: "end", kind: "end", label: "エンド", from: body });
  const sections = sectionsFromMarks(marks, base.totalFrames);

  // ---- SE: headline @0, cuts, timer ticks (last 3 s), time-up/blackout, note card, cta ---------------------
  const se: SeEvent[] = [];
  if (timerSec > 0) {
    for (let k = 1; k <= CHALLENGE.TICKS && k < timerSec; k++) {
      const f = Math.round(timerTo * (1 - k / timerSec));
      if (f > 0 && f < timerTo) se.push({ frame: f, slot: "point", gain: 0.45 });
    }
    se.push({ frame: timerTo, slot: "point", gain: 1 });
  }
  if (noteFrom > suspenseFrom) se.push({ frame: suspenseFrom, slot: "info", gain: SE_GAIN.info });
  if (body > noteFrom) se.push({ frame: noteFrom, slot: "headline", gain: 0.8 });
  const seEvents = standardSeEvents(base, cuts, se, { headline: !!title, transitionGain: 0.55 });

  return {
    ...shortTimelineFields(base, { sections, seEvents, captionLayout: captionLayoutFor(project, { scale: 1.2 }) }),
    bodyFrames: body,
    endFrames: base.endFrames,
    title,
    sub,
    note,
    timerSec,
    timerTo,
    hookTo,
    suspenseFrom,
    noteFrom,
    clips,
    // §5.11 cut transitions (auto): zoom punches through the play cuts (none in the blackout / note part)
    transitionCuts: transitionCutsOf(cuts, "zoom", body),
    cuts,
  };
}
