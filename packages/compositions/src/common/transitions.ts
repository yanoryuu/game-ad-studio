import { DEFAULT_TRANSITION_INTENSITY, type Project, type TransitionKind } from "@gas/shared";

/**
 * Cut transitions (ARCHITECTURE §5.11) — the PURE part (no React): which effect plays at which cut and for how
 * many frames, and what the effect looks like at a given frame. Clips are laid back to back (no overlap), so a
 * transition is "cut-based": the outgoing shot's last `nOut` frames and the incoming shot's first `nIn` frames
 * around the cut frame get the effect (like a short-form editor's whip / zoom transitions).
 */

/** One cut a template offers for a transition: absolute output frame + the template's recommendation ("auto"). */
export type TransitionCut = { frame: number; auto: TransitionKind };

/** A concrete effect (never "none") */
export type TransitionEffect = Exclude<TransitionKind, "none">;

export type ScheduledTransition = {
  /** absolute frame of the cut (first frame of the incoming shot) */
  frame: number;
  kind: TransitionEffect;
  /** frames before the cut that get the effect ([frame - nOut, frame - 1]) */
  nOut: number;
  /** frames from the cut on that get the effect ([frame, frame + nIn - 1]) */
  nIn: number;
  /** 0-based index among the scheduled transitions (direction / glitch seed) */
  index: number;
};

/** Effect state at one frame. t: 0..1, 1 = at the cut (strongest), falling off on both sides. */
export type TransitionState = {
  kind: TransitionEffect;
  phase: "out" | "in";
  t: number;
  /** frames from the cut (negative = before) */
  d: number;
  index: number;
  /** strength multiplier from style.transition.intensity */
  gain: number;
};

/** half lengths (seconds) of each effect: before the cut / from the cut on. ~8–12 frames total at 30 fps. */
export const TRANSITION_HALF_SEC: Record<TransitionEffect, { out: number; in: number }> = {
  whip: { out: 0.17, in: 0.2 },
  zoom: { out: 0.17, in: 0.2 },
  glitch: { out: 0.14, in: 0.17 },
  flash: { out: 0.1, in: 0.2 },
};

/** intensity 0..1 -> strength multiplier (default intensity 0.6 -> ~1) */
export const transitionGain = (intensity: number) => 0.15 + 1.4 * Math.min(1, Math.max(0, intensity));

/** The resolved user choice: preset ("auto" when style.transition is absent) + intensity. */
export function transitionSetting(project: Project): { preset: TransitionKind | "auto"; intensity: number } {
  const t = project.style.transition;
  return { preset: t?.preset ?? "auto", intensity: t?.intensity ?? DEFAULT_TRANSITION_INTENSITY };
}

/**
 * Template cuts -> the transitions that actually play. preset "auto" takes each cut's own recommendation, any
 * other preset replaces it ("none" = no transitions at all). Cuts outside (0, totalFrames) are dropped, duplicates
 * merged. Windows are clamped so neighbouring transitions never overlap (each side gets at most half the gap).
 */
export function buildTransitionSchedule(project: Project, cuts: TransitionCut[] | undefined, totalFrames: number, fps: number): ScheduledTransition[] {
  if (!cuts || cuts.length === 0) return [];
  const { preset } = transitionSetting(project);
  if (preset === "none") return [];
  const byFrame = new Map<number, TransitionCut>();
  for (const c of cuts) {
    const f = Math.round(c.frame);
    if (f > 0 && f < totalFrames && !byFrame.has(f)) byFrame.set(f, { frame: f, auto: c.auto });
  }
  const sorted = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
  const out: ScheduledTransition[] = [];
  sorted.forEach((c, i) => {
    const kind = preset === "auto" ? c.auto : preset;
    if (kind === "none") return;
    const prev = sorted[i - 1]?.frame ?? 0;
    const next = sorted[i + 1]?.frame ?? totalFrames;
    const half = TRANSITION_HALF_SEC[kind];
    const nOut = Math.max(0, Math.min(Math.max(1, Math.round(half.out * fps)), Math.floor((c.frame - prev) / 2)));
    const nIn = Math.max(0, Math.min(Math.max(1, Math.round(half.in * fps)), Math.floor((next - c.frame) / 2)));
    if (nOut + nIn === 0) return;
    out.push({ frame: c.frame, kind, nOut, nIn, index: out.length });
  });
  return out;
}

/** Effect state at absolute `frame`, or null when no transition is running. */
export function transitionStateAt(schedule: ScheduledTransition[], frame: number, gain: number): TransitionState | null {
  for (const s of schedule) {
    const d = frame - s.frame;
    if (d < 0 && -d <= s.nOut) {
      // outgoing: 1/nOut .. 1 approaching the cut
      return { kind: s.kind, phase: "out", t: (s.nOut + d + 1) / s.nOut, d, index: s.index, gain };
    }
    if (d >= 0 && d < s.nIn) {
      // incoming: 1 at the cut .. 1/nIn
      return { kind: s.kind, phase: "in", t: (s.nIn - d) / s.nIn, d, index: s.index, gain };
    }
  }
  return null;
}

/** deterministic pseudo-random in [0, 1) */
export function hash01(a: number, b = 0): number {
  const x = Math.sin(a * 127.1 + b * 311.7 + 74.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Numbers of one effect frame (px values for a frame whose short side is 1080 px; the renderer multiplies by
 * the unit). All effects keep the layer covering its box: `scale` includes the overscale needed for the
 * translation / blur / displacement so no black edge is revealed.
 */
export type TransitionLook = {
  /** horizontal translation, fraction of the box width */
  tx: number;
  scale: number;
  /** horizontal motion blur (px @1080) — SVG feGaussianBlur "x 0" */
  blurX: number;
  /** uniform blur (px @1080) */
  blur: number;
  /** extra blur toward the edges (px @1080, zoom: radial-ish) */
  edgeBlur: number;
  /** RGB split (px @1080) */
  rgb: number;
  /** horizontal slice displacement (px @1080) */
  slice: number;
  brightness: number;
  /** white overlay opacity 0..1 */
  flash: number;
};

const NONE: TransitionLook = { tx: 0, scale: 1, blurX: 0, blur: 0, edgeBlur: 0, rgb: 0, slice: 0, brightness: 1, flash: 0 };

export function transitionLook(s: TransitionState | null): TransitionLook {
  if (!s) return NONE;
  const g = s.gain;
  const e = s.t * s.t; // ease: accelerate into the cut, decelerate out of it
  switch (s.kind) {
    case "whip": {
      // outgoing slides away (dir), incoming arrives from the other side; directions alternate per cut
      const dir = s.index % 2 === 0 ? -1 : 1;
      const amp = 0.12 * Math.min(g, 1.4) * e;
      const tx = s.phase === "out" ? dir * amp : -dir * amp;
      return { ...NONE, tx, scale: 1 + 2 * Math.abs(tx) + 0.03 * e, blurX: 95 * g * e, brightness: 1 + 0.12 * e };
    }
    case "zoom": {
      // continuous zoom-in through the cut: outgoing pushes in, incoming starts pushed in and settles
      const z = 0.4 * g * e;
      return { ...NONE, scale: 1 + z, blur: 5 * g * e, edgeBlur: 26 * g * e, brightness: 1 + 0.15 * e };
    }
    case "glitch": {
      const j = (hash01(s.index, s.d) - 0.5) * 2;
      const tx = 0.012 * g * e * j;
      const rgb = 16 * g * e;
      const slice = 70 * g * e;
      return { ...NONE, tx, scale: 1 + 2 * Math.abs(tx) + (2 * (rgb + slice / 2)) / 1080 + 0.01, rgb, slice, brightness: 1 + 0.1 * e };
    }
    case "flash": {
      const peak = Math.min(1, 0.95 * Math.min(1, g * 1.05));
      const flash = s.phase === "out" ? peak * e : peak * Math.pow(s.t, 1.6);
      return { ...NONE, flash, scale: s.phase === "in" ? 1 + 0.06 * g * e : 1, brightness: 1 + 0.35 * e };
    }
  }
}
