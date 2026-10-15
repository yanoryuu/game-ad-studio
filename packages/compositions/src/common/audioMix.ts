import type { Project } from "@gas/shared";
import type { NarrationPlan } from "./narrationLayout";

/**
 * Ducking envelope (ARCHITECTURE §5.3): 0 = no narration, 1 = narration playing.
 * Narration intervals [from, from + durationInFrames) are merged when the gap between them is shorter
 * than two ramps (no pumping between consecutive lines); the envelope ramps up during the RAMP_SEC
 * before an interval (so the bed is already down when the voice starts) and back down during the
 * RAMP_SEC after it, with a smoothstep curve.
 */
export const DUCK_RAMP_SEC = 0.2;

export type DuckEnvelope = (absFrame: number) => number;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function makeDuckEnvelope(plan: NarrationPlan, fps: number): DuckEnvelope {
  const ramp = Math.max(1, Math.round(DUCK_RAMP_SEC * fps));
  const raw = plan.lines
    .filter((l) => l.durationInFrames > 0)
    .map((l) => [l.from, l.from + l.durationInFrames] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv[0] - last[1] <= 2 * ramp) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }
  if (merged.length === 0) return () => 0;
  return (f) => {
    let v = 0;
    for (const [a, b] of merged) {
      if (f >= a && f < b) return 1;
      if (f < a && f >= a - ramp) v = Math.max(v, smooth((f - (a - ramp)) / ramp));
      else if (f >= b && f < b + ramp) v = Math.max(v, smooth(1 - (f - b + 1) / ramp));
    }
    return v;
  };
}

/** Game-audio gain multiplier at `absFrame`: 1 -> audio.gameVolumeUnderNarration while narration plays. */
export function gameDuckGain(project: Project, env: DuckEnvelope, absFrame: number): number {
  const under = project.audio.gameVolumeUnderNarration;
  return 1 - env(absFrame) * (1 - under);
}

/**
 * Voice-band ducking (ARCHITECTURE §5.3.1): fraction of duckingDb applied broadband to the voice-carved copy.
 * The carved file already cuts ~10 dB around 1–3 kHz, so with the default -12 dB the speech band ends up ~-16 dB
 * while bass / highs only drop 6 dB (volume mode: everything -12 dB).
 */
export const BAND_DUCK_BROADBAND_RATIO = 0.5;

/**
 * Band-mode BGM gains at `absFrame`: `dry` for the original file = 1 - env, `wet` for the voice-carved copy
 * = env × 10^(duckingDb × BAND_DUCK_BROADBAND_RATIO / 20). Both files are sample-aligned, so the crossfade
 * during the ramps is a plain linear mix.
 */
export function bgmBandDuckGains(duckingDb: number, env: DuckEnvelope, absFrame: number): { dry: number; wet: number } {
  const e = env(absFrame);
  const wetLevel = Math.pow(10, (Math.min(0, duckingDb) * BAND_DUCK_BROADBAND_RATIO) / 20);
  return { dry: 1 - e, wet: e * wetLevel };
}

/** BGM gain multiplier at `absFrame`: 1 -> 10^(duckingDb/20) while narration plays. */
export function bgmDuckGain(duckingDb: number, env: DuckEnvelope, absFrame: number): number {
  const under = Math.pow(10, Math.min(0, duckingDb) / 20);
  return 1 - env(absFrame) * (1 - under);
}
