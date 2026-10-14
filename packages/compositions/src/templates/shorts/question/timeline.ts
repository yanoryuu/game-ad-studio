import type { Lang, Project } from "@gas/shared";
import type { PlacedClip } from "../../../common/clips";
import type { SeEvent } from "../../../common/SeTrack";
import type { TemplateTimeline } from "../../types";
import {
  buildShortBase,
  captionLayoutFor,
  itemsOf,
  layClips,
  sec,
  sectionsFromMarks,
  shortData,
  shortTimelineFields,
  standardMarks,
  standardSeEvents,
  textOf,
  SE_GAIN,
} from "../common";

/**
 * Template "question" (質問フック) — ARCHITECTURE §5.10:
 * 0 s: the question (title) slams in big over the hook clip -> after ~0.8 s it shrinks into the top band and stays
 * for the whole body. Body: clips switch at a quick tempo (per narration line, split to <= MAX_CUT_SEC).
 * Last ~3 s of the body: poll buttons (flag && items: A/B/… with growing bars) + the comment prompt (sub) in a
 * speech bubble. -> common end card.
 */

export const QUESTION = {
  /** free length: body minimum (slam + a bit of play + the poll) */
  MIN_BODY_SEC: 6,
  /** no narration (free): clip-length body clamped to this range */
  NO_NARRATION_MIN_SEC: 8,
  NO_NARRATION_MAX_SEC: 15,
  /** big slam phase, then the morph into the band */
  SLAM_SEC: 0.8,
  MORPH_SEC: 0.35,
  /** poll / comment prompt window at the end of the body */
  POLL_SEC: 3,
  /** shortest poll window worth showing */
  POLL_MIN_SEC: 1.2,
  /** tempo: no clip longer than this */
  MAX_CUT_SEC: 2.0,
  /** option rows pop one after another */
  OPTION_STAGGER_SEC: 0.18,
} as const;

export type QuestionPoll = {
  /** absolute frames [from, to) (always ends at the body end) */
  from: number;
  to: number;
  /** comment prompt (sub), "" = none */
  prompt: string;
  /** vote options (empty when flag is off) */
  options: { id: string; text: string }[];
};

export type QuestionTimeline = TemplateTimeline & {
  bodyFrames: number;
  endFrames: number;
  /** question text ("" = none: no slam, empty band) */
  title: string;
  /** slam phase [0, slamFrames), then the morph [slamFrames, slamFrames + morphFrames) */
  slamFrames: number;
  morphFrames: number;
  clips: PlacedClip[];
  cuts: number[];
  poll: QuestionPoll | null;
};

export function buildTimeline(project: Project, fps: number, lang: Lang): QuestionTimeline {
  const data = shortData(project, "question");
  const base = buildShortBase(project, fps, lang, {
    minBodySec: QUESTION.MIN_BODY_SEC,
    noNarrationSec: { min: QUESTION.NO_NARRATION_MIN_SEC, max: QUESTION.NO_NARRATION_MAX_SEC },
  });
  const body = base.bodyFrames;
  const title = textOf(data.title, lang);

  // slam + morph (shrunk proportionally on very short bodies)
  const slamFrames = title ? Math.min(sec(QUESTION.SLAM_SEC, fps), Math.floor(body * 0.3)) : 0;
  const morphFrames = title ? Math.min(sec(QUESTION.MORPH_SEC, fps), Math.floor(body * 0.1)) : 0;
  const titleDone = slamFrames + morphFrames;

  // poll window
  const prompt = textOf(data.sub, lang);
  const options = data.flag ? itemsOf(data, lang).slice(0, 3) : [];
  let poll: QuestionPoll | null = null;
  if (prompt || options.length > 0) {
    const len = Math.min(sec(QUESTION.POLL_SEC, fps), body - titleDone - sec(1, fps));
    if (len >= sec(QUESTION.POLL_MIN_SEC, fps)) poll = { from: body - len, to: body, prompt, options };
  }

  // clips: hook clip first (holds through the slam), then tempo cuts per narration line
  const lay = layClips(base.segs, { from: 0, to: body }, fps, {
    lines: base.played,
    maxCutSec: QUESTION.MAX_CUT_SEC,
    holdFirstSec: (titleDone + sec(0.25, fps)) / fps,
    keyPrefix: "q",
  });

  // sections: 質問 (until the title has settled or the hook lines end) / 本編 / 投票 / エンド
  const hookEnd = Math.min(Math.max(base.hookEnd, titleDone), poll ? poll.from : body);
  const extra = poll ? [{ id: "poll", kind: "card" as const, label: options.length > 0 ? "投票" : "コメント誘導", from: poll.from }] : [];
  const marks = standardMarks(base, extra, hookEnd).map((m) => (m.id === "hook" ? { ...m, label: "質問" } : m));
  const sections = sectionsFromMarks(marks, base.totalFrames);

  // SE: headline @0, transitions, info @ the prompt bubble, point @ each option row
  const se: SeEvent[] = [];
  if (poll) {
    se.push({ frame: poll.from, slot: "info", gain: SE_GAIN.info });
    poll.options.forEach((_, i) => se.push({ frame: poll!.from + optionDelay(i, fps, !!poll!.prompt), slot: "point", gain: 0.8 }));
  }
  const seEvents = standardSeEvents(base, lay.cuts, se, { headline: !!title, transitionGain: 0.6 });

  return {
    ...shortTimelineFields(base, { sections, seEvents, captionLayout: captionLayoutFor(project, { scale: 1.2 }) }),
    bodyFrames: body,
    endFrames: base.endFrames,
    title,
    slamFrames,
    morphFrames,
    clips: lay.clips,
    cuts: lay.cuts,
    poll,
  };
}

/** Frame (relative to the poll start) at which option row i pops. */
export function optionDelay(i: number, fps: number, hasPrompt: boolean): number {
  return (hasPrompt ? sec(0.3, fps) : 0) + sec(QUESTION.OPTION_STAGGER_SEC, fps) * i;
}
