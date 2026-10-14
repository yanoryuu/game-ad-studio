import type { Clip, Lang, Project } from "@gas/shared";
import { layoutNarration, placeSection, type NarrationPlan } from "./narrationLayout";

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
/** Proportional trimming never makes a main clip shorter than this; overflow clips are dropped instead. */
export const MIN_CLIP_SEC = 0.6;
/** Clips shorter than this (after validation) are ignored. */
const MIN_VALID_FRAMES = 2;

/** A usable piece of source material, in output frames. */
type Segment = {
  clipId: string;
  sourceId: string;
  /** source-time in/out converted to frames */
  inF: number;
  outF: number;
  /** last usable source frame (source duration), Infinity if unknown */
  maxOutF: number;
  volume: number;
  focusX: number;
  hasAudio: boolean;
};

export type PlacedClip = {
  /** unique React key */
  key: string;
  clipId: string;
  sourceId: string;
  /** start frame RELATIVE to its section */
  from: number;
  /** frames actually played from the source */
  playFrames: number;
  /** frames the last frame is held (only when material runs out) */
  holdFrames: number;
  /** source position (frames) where playback starts — OffthreadVideo `trimBefore` */
  trimBefore: number;
  volume: number;
  focusX: number;
  hasAudio: boolean;
};

export type TimelineSection = {
  /** absolute start frame */
  from: number;
  durationInFrames: number;
  clips: PlacedClip[];
};

export type AdTimeline = {
  fps: number;
  totalFrames: number;
  hook: TimelineSection;
  main: TimelineSection;
  endCard: TimelineSection;
  /** true if the hook section re-uses the beginning of the main clips (no hook-slot clips) */
  hookBorrowedFromMain: boolean;
  /** narration of the requested language placed on this timeline (ARCHITECTURE §5.1) */
  narration: NarrationPlan;
};

function toSegments(project: Project, clips: Clip[], fps: number): Segment[] {
  const out: Segment[] = [];
  for (const c of clips) {
    const source = project.sources.find((s) => s.id === c.sourceId);
    if (!source) continue; // unknown source -> skip (sourceUrl would throw)
    const srcDur = source.durationSec > 0 ? source.durationSec : Infinity;
    const inSec = Math.max(0, Math.min(c.inSec, srcDur));
    const outSec = Math.min(c.outSec, srcDur);
    if (!Number.isFinite(inSec) || !Number.isFinite(outSec)) continue;
    const inF = Math.round(inSec * fps);
    const outF = Math.round(outSec * fps);
    if (outF - inF < MIN_VALID_FRAMES) continue;
    out.push({
      clipId: c.id,
      sourceId: c.sourceId,
      inF,
      outF,
      maxOutF: Number.isFinite(srcDur) ? Math.floor(srcDur * fps) : Infinity,
      volume: c.gameVolume,
      focusX: c.focusX ?? 0.5,
      hasAudio: source.hasAudio,
    });
  }
  return out;
}

const segLen = (s: Segment) => s.outF - s.inF;

/** Takes the first `frames` frames of material off the front of `segs`. */
function consumeFrames(segs: Segment[], frames: number, minRestFrames: number): { taken: Segment[]; rest: Segment[] } {
  const taken: Segment[] = [];
  const rest: Segment[] = [];
  let remaining = frames;
  for (const s of segs) {
    if (remaining <= 0) {
      rest.push(s);
      continue;
    }
    const len = segLen(s);
    if (len <= remaining) {
      taken.push(s);
      remaining -= len;
    } else {
      taken.push({ ...s, outF: s.inF + remaining });
      const left: Segment = { ...s, inF: s.inF + remaining };
      if (segLen(left) >= minRestFrames) rest.push(left);
      remaining = 0;
    }
  }
  return { taken, rest };
}

/**
 * Fits segments into exactly `target` frames.
 * - Longer than target: trims each clip proportionally at its out side; if that would make a clip shorter
 *   than MIN_CLIP_SEC, drops clips from the end (overflow) and retries.
 * - Shorter than target: extends clips past outSec into the source proportionally (as far as the source
 *   allows); anything still missing is a hold on the last frame of the last clip.
 */
function fitSegments(segs: Segment[], target: number, minFrames: number, keyPrefix: string): PlacedClip[] {
  if (segs.length === 0 || target <= 0) return [];
  let list = segs.slice();
  let alloc: number[] = [];
  let holdLast = 0;

  const sum = (xs: Segment[]) => xs.reduce((a, s) => a + segLen(s), 0);

  if (sum(list) >= target) {
    for (;;) {
      const total = sum(list);
      alloc = list.map((s) => Math.floor((segLen(s) * target) / total));
      const tooShort = alloc.some((a) => a < Math.min(minFrames, target));
      if (tooShort && list.length > 1) {
        const candidate = list.slice(0, -1);
        if (sum(candidate) < target) break; // dropping would leave a gap -> keep short clips instead
        list = candidate;
        continue;
      }
      break;
    }
  }

  const total = sum(list);
  if (total >= target) {
    // distribute rounding remainder
    let rem = target - alloc.reduce((a, b) => a + b, 0);
    for (let i = 0; rem > 0 && i < list.length * 2; i++) {
      const idx = i % list.length;
      if (alloc[idx]! < segLen(list[idx]!)) {
        alloc[idx]!++;
        rem--;
      }
    }
    if (rem > 0) alloc[alloc.length - 1]! += rem; // should not happen; safety
  } else {
    // extend into source material after outSec
    alloc = list.map(segLen);
    let short = target - total;
    const avail = list.map((s) => Math.max(0, s.maxOutF - s.outF));
    const shares = list.map((s) => Math.floor((short * segLen(s)) / total));
    for (let i = 0; i < list.length; i++) {
      const add = Math.min(avail[i]!, shares[i]!);
      alloc[i]! += add;
      avail[i]! -= add;
      short -= add;
    }
    for (let i = 0; short > 0 && i < list.length; i++) {
      const add = Math.min(avail[i]!, short);
      alloc[i]! += add;
      short -= add;
    }
    holdLast = short;
  }

  const placed: PlacedClip[] = [];
  let cursor = 0;
  list.forEach((s, i) => {
    const play = Math.max(1, alloc[i]!);
    const hold = i === list.length - 1 ? holdLast : 0;
    placed.push({
      key: `${keyPrefix}-${i}-${s.clipId}`,
      clipId: s.clipId,
      sourceId: s.sourceId,
      from: cursor,
      playFrames: play,
      holdFrames: hold,
      trimBefore: s.inF,
      volume: s.volume,
      focusX: s.focusX,
      hasAudio: s.hasAudio,
    });
    cursor += play + hold;
  });
  // Final safety: make the section sum exactly `target`.
  const last = placed[placed.length - 1];
  if (last && cursor !== target) {
    const diff = target - cursor;
    if (last.holdFrames + diff >= 0 && diff < 0 && last.holdFrames > 0) last.holdFrames += diff;
    else last.playFrames = Math.max(1, last.playFrames + diff);
  }
  return placed;
}

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

  return {
    fps,
    totalFrames: hookFrames + mainFrames + endFrames,
    hook,
    main,
    endCard,
    hookBorrowedFromMain,
    narration: { lines, overflowLineIds: lines.filter((l) => l.cut).map((l) => l.lineId) },
  };
}
