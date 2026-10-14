import type { Clip, Project } from "@gas/shared";

/**
 * Clip-fitting building blocks shared by all templates (pure, no React). All values are integer frames
 * at the output fps. Moved unchanged from the Phase 2 hook-play-cta timeline.
 */

/** Proportional trimming never makes a main clip shorter than this; overflow clips are dropped instead. */
export const MIN_CLIP_SEC = 0.6;
/** Clips shorter than this (after validation) are ignored. */
const MIN_VALID_FRAMES = 2;

/** A usable piece of source material, in output frames. */
export type Segment = {
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

export function toSegments(project: Project, clips: Clip[], fps: number): Segment[] {
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

export const segLen = (s: Segment) => s.outF - s.inF;

/** Takes the first `frames` frames of material off the front of `segs`. */
export function consumeFrames(segs: Segment[], frames: number, minRestFrames: number): { taken: Segment[]; rest: Segment[] } {
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
 * Native image sources (durationSec = IMAGE_MAX_CLIP_SEC) extend like any source; ClipTrack shows an image clip
 * for its whole placed length (playFrames + holdFrames, motion over all of it), so a "hold" is just more image.
 */
export function fitSegments(segs: Segment[], target: number, minFrames: number, keyPrefix: string): PlacedClip[] {
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
