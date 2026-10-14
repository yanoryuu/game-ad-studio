import { stripEmphasis, type Lang, type Project } from "@gas/shared";
import { segLen, type PlacedClip, type Segment } from "../../../common/clips";
import type { SeEvent } from "../../../common/SeTrack";
import type { TemplateTimeline } from "../../types";
import {
  buildShortBase,
  captionLayoutFor,
  layClips,
  sec,
  sectionsFromMarks,
  shortData,
  shortTimelineFields,
  textOf,
  SE_GAIN,
  type SectionMark,
} from "../common";

/**
 * Template "comment" (コメント返信) — ARCHITECTURE §5.10:
 * 0 s: a TikTok-style reply sticker (sub = commenter handle, title = the comment) pops over the hook-slot footage
 * (SE info). When the hook slot ends (= hook narration end, or the hook clips' length) the sticker shrinks to the
 * top-left and stays. The main slot = the answer: at its start the reply word (note) slams in big, then settles
 * as a small reply bubble under the sticker (a comment thread). -> common end card.
 */

export const COMMENT = {
  MIN_BODY_SEC: 5,
  NO_NARRATION_MIN_SEC: 7,
  NO_NARRATION_MAX_SEC: 14,
  /** comment phase without hook narration: hook clips' natural length clamped to this range */
  COMMENT_MIN_SEC: 2.0,
  COMMENT_MAX_SEC: 3.5,
  /** answer phase must keep at least this */
  ANSWER_MIN_SEC: 2.0,
  /** sticker shrink to the corner */
  MORPH_SEC: 0.4,
  /** the big answer word, then it settles into the reply bubble */
  ANSWER_SLAM_SEC: 1.5,
  /** hold after the hook narration ends before switching */
  HOOK_TAIL_SEC: 0.2,
  MAX_CUT_SEC: 2.2,
} as const;

export type CommentTimeline = TemplateTimeline & {
  bodyFrames: number;
  endFrames: number;
  /** the viewer comment (rich, "" = no sticker) */
  comment: string;
  /** commenter handle (plain, "" = generic header) */
  author: string;
  /** reply word (rich, "" = none) */
  answer: string;
  /** frame where the answer (main slot) starts; the sticker shrinks from here */
  switchAt: number;
  morphFrames: number;
  /** big answer slam [switchAt, switchAt + answerSlamFrames), then the small reply bubble */
  answerSlamFrames: number;
  clips: PlacedClip[];
  cuts: number[];
};

export function buildTimeline(project: Project, fps: number, lang: Lang): CommentTimeline {
  const data = shortData(project, "comment");
  const base = buildShortBase(project, fps, lang, {
    minBodySec: COMMENT.MIN_BODY_SEC,
    noNarrationSec: { min: COMMENT.NO_NARRATION_MIN_SEC, max: COMMENT.NO_NARRATION_MAX_SEC },
  });
  const body = base.bodyFrames;
  const comment = textOf(data.title, lang);
  const author = stripEmphasis(textOf(data.sub, lang)).replace(/\s+/g, " ").trim();
  const answer = textOf(data.note, lang);

  const hookPool: Segment[] = base.hookSegs.length > 0 ? base.hookSegs : base.segs;
  const mainPool: Segment[] = base.mainSegs.length > 0 ? base.mainSegs : base.segs;

  // ---- where the answer starts --------------------------------------------------------------------
  const hookClipLen = base.hookSegs.reduce((a, s) => a + segLen(s), 0);
  let switchAt =
    base.hookEnd > 0
      ? base.hookEnd + sec(COMMENT.HOOK_TAIL_SEC, fps)
      : Math.max(sec(COMMENT.COMMENT_MIN_SEC, fps), Math.min(sec(COMMENT.COMMENT_MAX_SEC, fps), hookClipLen || sec(2.6, fps)));
  switchAt = Math.max(sec(1.2, fps), switchAt);
  // keep room for the answer (very short bodies: the comment gets ~40 %)
  switchAt = Math.min(switchAt, Math.max(Math.floor(body * 0.4), body - sec(COMMENT.ANSWER_MIN_SEC, fps)));
  switchAt = Math.max(1, Math.min(body - 1, switchAt));

  // ---- clips: hook slot during the comment, main slot for the answer --------------------------------
  const hookLines = base.played.filter((p) => p.section === "hook");
  const mainLines = base.played.filter((p) => p.section === "main");
  const hookLay = layClips(hookPool, { from: 0, to: switchAt }, fps, { lines: hookLines, maxCutSec: COMMENT.COMMENT_MAX_SEC, holdFirstSec: Math.min(2, switchAt / fps), keyPrefix: "ch" });
  const mainLay = layClips(mainPool, { from: switchAt, to: body }, fps, {
    lines: mainLines,
    maxCutSec: COMMENT.MAX_CUT_SEC,
    holdFirstSec: COMMENT.ANSWER_SLAM_SEC,
    startIndex: base.mainSegs.length > 0 ? 0 : hookLay.nextIndex,
    keyPrefix: "cm",
  });
  const clips = [...hookLay.clips, ...mainLay.clips];
  const cuts = [...hookLay.cuts, ...(clips.length > 0 ? [switchAt] : []), ...mainLay.cuts];

  const morphFrames = Math.min(sec(COMMENT.MORPH_SEC, fps), Math.max(1, body - switchAt));
  const answerSlamFrames = answer ? Math.min(sec(COMMENT.ANSWER_SLAM_SEC, fps), Math.max(1, body - switchAt)) : 0;

  // ---- sections / SE -------------------------------------------------------------------------------
  const marks: SectionMark[] = [
    { id: "comment", kind: "hook", label: "コメント", from: 0 },
    { id: "answer", kind: "main", label: "回答", from: switchAt },
  ];
  if (base.endFrames > 0) marks.push({ id: "end", kind: "end", label: "エンド", from: body });
  const sections = sectionsFromMarks(marks, base.totalFrames);

  const ev: SeEvent[] = [];
  if (comment) ev.push({ frame: 0, slot: "info", gain: SE_GAIN.info });
  for (const c of cuts) ev.push({ frame: c, slot: "transition", gain: c === switchAt ? 0.8 : 0.55 });
  if (answer) ev.push({ frame: switchAt, slot: "headline", gain: SE_GAIN.headline });
  if (base.endFrames > 0) ev.push({ frame: body, slot: "cta", gain: SE_GAIN.cta });
  const seEvents = ev.filter((e) => e.frame >= 0 && e.frame < base.totalFrames).sort((a, b) => a.frame - b.frame);

  return {
    ...shortTimelineFields(base, { sections, seEvents, captionLayout: captionLayoutFor(project, { scale: 1.2 }) }),
    bodyFrames: body,
    endFrames: base.endFrames,
    comment,
    author,
    answer,
    switchAt,
    morphFrames,
    answerSlamFrames,
    clips,
    cuts: [...new Set(cuts)].filter((c) => c > 0 && c < body).sort((a, b) => a - b),
  };
}
