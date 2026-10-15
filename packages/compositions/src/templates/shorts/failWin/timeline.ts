import { isStillImageSource, type Lang, type Project } from "@gas/shared";
import { segLen, type PlacedClip, type Segment } from "../../../common/clips";
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
 * Template "fail-win" (失敗→逆転) — ARCHITECTURE §5.10:
 * hook slot (失敗): red flashes, shake, glitch + title (the fail text) -> sub ("でも…") as a full-screen card for ~1 s
 * -> main slot (逆転): flag = the first ~1.2 s at 0.5× speed, then normal speed with a white flash and note (the
 * comeback text) slammed big, which then settles into the top band for the rest. -> common end card.
 */

export const FAIL_WIN = {
  MIN_BODY_SEC: 6,
  NO_NARRATION_MIN_SEC: 8,
  NO_NARRATION_MAX_SEC: 15,
  /** fail part: hook lines / hook clip length clamped to this range */
  FAIL_MIN_SEC: 2.0,
  FAIL_MAX_SEC: 4.0,
  /** "でも…" card */
  CARD_SEC: 1.0,
  /** slow-motion opening of the comeback (flag) */
  SLOW_SEC: 1.2,
  SLOW_RATE: 0.5,
  /** comeback part never shorter than this */
  WIN_MIN_SEC: 3.0,
  /** big note slam, then it settles into the band */
  NOTE_BIG_SEC: 1.3,
  /** tempo in the comeback part */
  MAX_CUT_SEC: 2.2,
} as const;

/** The slow-motion clip (played with playbackRate SLOW_RATE, muted). */
export type SlowClip = {
  sourceId: string;
  /** absolute body frames [from, from + frames) */
  from: number;
  frames: number;
  /** source frame where it starts */
  trimBefore: number;
  focusX: number;
};

export type FailWinTimeline = TemplateTimeline & {
  bodyFrames: number;
  endFrames: number;
  /** fail text ("" = none) */
  title: string;
  /** bridge card text ("" = none: no card, the fail part runs on) */
  sub: string;
  /** comeback text ("" = none) */
  note: string;
  /** fail part [0, failTo) */
  failTo: number;
  /** card [failTo, winFrom) */
  winFrom: number;
  /** slow motion [winFrom, speedFrom) (equal = none); the note slams at speedFrom */
  speedFrom: number;
  /** note big [speedFrom, noteSettle), then in the band until the body end */
  noteSettle: number;
  /** clips of the normal-speed parts (a gap during the slow motion, drawn by `slow`) */
  clips: PlacedClip[];
  slow: SlowClip | null;
  failCuts: number[];
  winCuts: number[];
};

export function buildTimeline(project: Project, fps: number, lang: Lang): FailWinTimeline {
  const data = shortData(project, "fail-win");
  const base = buildShortBase(project, fps, lang, {
    minBodySec: FAIL_WIN.MIN_BODY_SEC,
    noNarrationSec: { min: FAIL_WIN.NO_NARRATION_MIN_SEC, max: FAIL_WIN.NO_NARRATION_MAX_SEC },
  });
  const body = base.bodyFrames;
  const title = textOf(data.title, lang);
  const sub = textOf(data.sub, lang);
  const note = textOf(data.note, lang);

  // material: hook slot = fail, main slot = comeback (one slot empty -> split the material)
  let failSegs: Segment[] = base.hookSegs;
  let winSegs: Segment[] = base.mainSegs;
  if (failSegs.length === 0 && winSegs.length > 1) {
    failSegs = winSegs.slice(0, 1);
    winSegs = winSegs.slice(1);
  } else if (failSegs.length === 0) failSegs = winSegs;
  if (winSegs.length === 0) winSegs = failSegs;

  // ---- blocks: fail | card | comeback ---------------------------------------------------------------------
  const failNatural = base.hookEnd > 0 ? base.hookEnd : failSegs.reduce((a, s) => a + segLen(s), 0);
  const failWanted = Math.max(sec(FAIL_WIN.FAIL_MIN_SEC, fps), Math.min(sec(FAIL_WIN.FAIL_MAX_SEC, fps), failNatural || sec(FAIL_WIN.FAIL_MIN_SEC, fps)));
  const cardWanted = sub ? sec(FAIL_WIN.CARD_SEC, fps) : 0;
  const [failLen, cardLen] = fitBlocks([failWanted, cardWanted, sec(FAIL_WIN.WIN_MIN_SEC, fps)], body);
  const failTo = Math.min(body, failLen!);
  const winFrom = Math.min(body, failTo + cardLen!);
  const winLen = body - winFrom;
  // a still image has nothing to slow down (and can't be played as a video) -> no slow motion
  const firstWin = winSegs[0];
  const firstIsImage = !!firstWin && project.sources.some((s) => s.id === firstWin.sourceId && isStillImageSource(s));
  const slowLen = data.flag && firstWin && !firstIsImage ? Math.min(sec(FAIL_WIN.SLOW_SEC, fps), Math.floor(winLen * 0.4)) : 0;
  const speedFrom = winFrom + slowLen;
  const noteSettle = note ? Math.min(body, speedFrom + Math.min(sec(FAIL_WIN.NOTE_BIG_SEC, fps), Math.max(0, Math.floor((body - speedFrom) * 0.6)))) : speedFrom;

  // ---- clips ----------------------------------------------------------------------------------------------
  // fail part: the hook slot, tempo cuts per line; the card covers [failTo, winFrom) -> the fail clip just runs on
  const failLay = layClips(failSegs, { from: 0, to: winFrom }, fps, { lines: base.played, maxCutSec: FAIL_WIN.MAX_CUT_SEC, holdFirstSec: Math.min(1.5, failTo / fps), keyPrefix: "fw-f" });
  let slow: SlowClip | null = null;
  let rest = winSegs;
  if (slowLen > 0) {
    const first = winSegs[0]!;
    slow = { sourceId: first.sourceId, from: winFrom, frames: slowLen, trimBefore: first.inF, focusX: first.focusX };
    // the normal-speed continuation picks up where the slow motion left the source
    const used = Math.ceil(slowLen * FAIL_WIN.SLOW_RATE);
    const inF = first.inF + used;
    const cont: Segment = { ...first, inF, outF: Math.max(first.outF, inF + sec(0.6, fps)) };
    rest = [cont, ...winSegs.slice(1)];
  }
  const winLay = layClips(rest, { from: speedFrom, to: body }, fps, {
    lines: base.played,
    maxCutSec: FAIL_WIN.MAX_CUT_SEC,
    holdFirstSec: Math.min(1.4, (body - speedFrom) / fps),
    keyPrefix: "fw-w",
  });
  const clips = [...failLay.clips, ...winLay.clips];
  const failCuts = cutsOf(failLay.clips, 0, failTo);
  const winCuts = cutsOf(winLay.clips, speedFrom, body);

  // ---- sections -------------------------------------------------------------------------------------------
  const marks: SectionMark[] = [{ id: "fail", kind: "hook", label: "失敗", from: 0 }];
  if (winFrom > failTo) marks.push({ id: "but", kind: "card", label: "でも…", from: failTo });
  marks.push({ id: "win", kind: "main", label: "逆転", from: winFrom });
  if (base.endFrames > 0) marks.push({ id: "end", kind: "end", label: "エンド", from: body });
  const sections = sectionsFromMarks(marks, base.totalFrames);

  // ---- SE -------------------------------------------------------------------------------------------------
  const se: SeEvent[] = [];
  if (winFrom > failTo) se.push({ frame: failTo, slot: "info", gain: SE_GAIN.info });
  if (winFrom < body) se.push({ frame: winFrom, slot: "transition", gain: 0.8 });
  if (note && speedFrom < body) se.push({ frame: speedFrom, slot: "point", gain: 1 });
  else if (slowLen > 0 && speedFrom < body) se.push({ frame: speedFrom, slot: "transition", gain: 0.8 });
  const seEvents = standardSeEvents(base, [...failCuts, ...winCuts], se, { headline: !!title, transitionGain: 0.55 });

  return {
    ...shortTimelineFields(base, { sections, seEvents, captionLayout: captionLayoutFor(project, { scale: 1.2 }) }),
    bodyFrames: body,
    endFrames: base.endFrames,
    title,
    sub,
    note,
    failTo,
    winFrom,
    speedFrom,
    noteSettle,
    clips,
    slow,
    // §5.11 cut transitions (auto): glitch on the fail cuts, whip on the win cuts; not fail -> card -> win nor slow -> normal speed
    transitionCuts: [...transitionCutsOf(failCuts, "glitch", failTo), ...transitionCutsOf(winCuts.filter((f) => f > speedFrom), "whip", body)],
    failCuts,
    winCuts,
  };
}
