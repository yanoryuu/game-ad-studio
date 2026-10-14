import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { unitFor } from "../../../common/theme";

/** Animation helpers shared by the short-form parts. All frames are relative to the enclosing Sequence. */

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** frame / fps / size + layout unit u (1 = 1px of a 1080p short side) + vertical flag */
export function useShortFrame() {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  return { frame, fps, width, height, durationInFrames, u: unitFor(width, height), vertical: height > width };
}

/**
 * Pop-in spring 0..1 starting at `delay` (0 before it). Thumbnail rule (§5.10): use it for SCALE / position
 * (e.g. scale = interpolate(p, [0, 1], [1.25, 1])), never for the opacity of the main text, so frame 0 is legible.
 */
export function pop(frame: number, fps: number, delay = 0, o: { stiff?: boolean } = {}): number {
  return spring({
    frame: frame - delay,
    fps,
    config: o.stiff ? { damping: 12, stiffness: 320, mass: 0.6 } : { damping: 13, stiffness: 220, mass: 0.7 },
  });
}

/** 0..1 decaying flash right after the most recent cut in `cuts` (frames relative to the same axis as `frame`). */
export function cutFlash(cuts: number[], frame: number, fps: number, sec = 0.3): number {
  let last = -1;
  for (const c of cuts) if (c <= frame && c > last) last = c;
  if (last < 0) return 0;
  return interpolate(frame - last, [0, Math.max(1, Math.round(fps * sec))], [1, 0], clamp);
}

/** Deterministic shake offset (px) with decaying amplitude over `durFrames` from `start`. */
export function shake(frame: number, start: number, durFrames: number, amp: number): { x: number; y: number; r: number } {
  const t = frame - start;
  if (t < 0 || t >= durFrames) return { x: 0, y: 0, r: 0 };
  const k = 1 - t / durFrames;
  return { x: Math.sin(t * 2.7) * amp * k, y: Math.cos(t * 3.3) * amp * 0.7 * k, r: Math.sin(t * 1.9) * 1.2 * k };
}

/** Gentle idle pulse 1 ± amp at `hz`. */
export const pulse = (frame: number, fps: number, amp = 0.02, hz = 1) => 1 + amp * Math.sin((frame / fps) * Math.PI * 2 * hz);

/** Fade-out factor 1 -> 0 over the last `sec` seconds of a window of `dur` frames (for exits; never for entrances). */
export const fadeOutAtEnd = (frame: number, dur: number, fps: number, sec = 0.2) =>
  interpolate(frame, [dur - Math.max(1, Math.round(sec * fps)), dur], [1, 0], clamp);
