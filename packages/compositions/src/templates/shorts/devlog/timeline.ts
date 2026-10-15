import { stripEmphasis, type Lang, type Project } from "@gas/shared";
import type { PlacedClip } from "../../../common/clips";
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
  standardMarks,
  standardSeEvents,
  textOf,
  type SectionMark,
  transitionCutsOf,
} from "../common";

/**
 * Template "devlog" (開発日記) — ARCHITECTURE §5.10:
 * 0 s: a giant "DAY {number}" (none when number is 0) + today's theme (title) on a tape label over the hook clip.
 * Then the raw "screen recording" body: small "DAY n" badge + series tag (sub) top-left the whole time, REC dot +
 * running timecode + viewfinder corners on the footage, the theme stays in the band. Last ~2 s of the body: the
 * follow prompt (note) with a "NEXT: DAY n+1" teaser. -> common end card.
 */

export const DEVLOG = {
  MIN_BODY_SEC: 5,
  NO_NARRATION_MIN_SEC: 8,
  NO_NARRATION_MAX_SEC: 15,
  /** giant DAY intro: follows the hook lines, clamped */
  INTRO_SEC: 1.6,
  INTRO_MIN_SEC: 1.2,
  INTRO_MAX_SEC: 2.4,
  /** intro never takes more than this share of the body */
  INTRO_MAX_SHARE: 0.35,
  /** the giant block shrinks away / the small badge pops in */
  SETTLE_SEC: 0.3,
  /** follow prompt window at the end of the body */
  OUTRO_SEC: 2.0,
  OUTRO_MIN_SEC: 1.0,
  /** raw, calm editing: longer cuts than the other templates */
  MAX_CUT_SEC: 2.6,
} as const;

export type DevlogTimeline = TemplateTimeline & {
  bodyFrames: number;
  endFrames: number;
  /** DAY number (0 = no DAY display) */
  day: number;
  /** today's theme ("" = none) */
  title: string;
  /** series name / tag, plain ("" = none) */
  tag: string;
  /** follow prompt ("" = none) */
  note: string;
  /** giant intro [0, introFrames) (0 = no intro), then the settle animation */
  introFrames: number;
  settleFrames: number;
  /** follow prompt window [outroFrom, bodyFrames); = bodyFrames when none */
  outroFrom: number;
  clips: PlacedClip[];
  cuts: number[];
};

export function buildTimeline(project: Project, fps: number, lang: Lang): DevlogTimeline {
  const C = DEVLOG;
  const data = shortData(project, "devlog");
  const base = buildShortBase(project, fps, lang, {
    minBodySec: C.MIN_BODY_SEC,
    noNarrationSec: { min: C.NO_NARRATION_MIN_SEC, max: C.NO_NARRATION_MAX_SEC },
  });
  const body = base.bodyFrames;
  const day = Math.max(0, Math.round(data.number || 0));
  const title = textOf(data.title, lang);
  const tag = stripEmphasis(textOf(data.sub, lang)).replace(/\s*\n\s*/g, " ").trim();
  const note = textOf(data.note, lang);

  // giant intro (DAY and/or theme)
  let introFrames = 0;
  if (day > 0 || title) {
    const wanted = base.hookEnd > 0 ? base.hookEnd : sec(C.INTRO_SEC, fps);
    introFrames = Math.min(Math.max(sec(C.INTRO_MIN_SEC, fps), Math.min(wanted, sec(C.INTRO_MAX_SEC, fps))), Math.floor(body * C.INTRO_MAX_SHARE));
  }
  const settleFrames = introFrames > 0 ? Math.min(sec(C.SETTLE_SEC, fps), Math.max(1, Math.floor(body * 0.05))) : 0;

  // follow prompt
  let outroFrom = body;
  if (note) {
    const len = Math.min(sec(C.OUTRO_SEC, fps), body - introFrames - settleFrames - sec(1, fps));
    if (len >= sec(C.OUTRO_MIN_SEC, fps)) outroFrom = body - len;
  }

  // footage: the hook clip stays under the intro, then one clip per narration line (calm tempo)
  const lay = layClips(base.segs, { from: 0, to: body }, fps, {
    lines: base.played,
    maxCutSec: C.MAX_CUT_SEC,
    holdFirstSec: (introFrames + settleFrames) / fps + 0.15,
    keyPrefix: "dl",
  });

  // sections: DAY / 今日の成果 / フォロー誘導 / エンド
  const extra: SectionMark[] = outroFrom < body ? [{ id: "follow", kind: "card", label: "フォロー誘導", from: outroFrom }] : [];
  const hookEnd = Math.min(Math.max(base.hookEnd, introFrames), outroFrom);
  const marks = standardMarks(base, extra, hookEnd).map((m) =>
    m.id === "hook" ? { ...m, label: day > 0 ? `DAY ${day}` : "つかみ" } : m.id === "main" ? { ...m, label: "今日の成果" } : m,
  );
  const sections = sectionsFromMarks(marks, base.totalFrames);

  // SE: headline @0 (giant DAY), point @ the settle (badge), soft transitions, info @ the follow prompt
  const se: SeEvent[] = [];
  if (introFrames > 0 && (day > 0 || tag)) se.push({ frame: introFrames, slot: "point", gain: 0.6 });
  if (outroFrom < body) se.push({ frame: outroFrom, slot: "info", gain: 0.9 });
  const seEvents = standardSeEvents(base, lay.cuts, se, { headline: introFrames > 0, transitionGain: 0.4 });

  return {
    ...shortTimelineFields(base, { sections, seEvents, captionLayout: captionLayoutFor(project, { scale: 1.2 }) }),
    bodyFrames: body,
    endFrames: base.endFrames,
    day,
    title,
    tag,
    note,
    introFrames,
    settleFrames,
    outroFrom,
    clips: lay.clips,
    // §5.11 cut transitions (auto): none — raw, calm jump cuts by design (an explicit preset still applies)
    transitionCuts: transitionCutsOf(lay.cuts, "none", body),
    cuts: lay.cuts,
  };
}
