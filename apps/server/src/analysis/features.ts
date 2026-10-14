import type { AudioFrameStat, RawFeatures, VideoFrameStat } from "./ffmpegFeatures";

/**
 * Pure feature processing: per-frame stats -> fixed time bins -> robust per-source normalization.
 */

export type Bin = {
  /** bin start (s) */
  t: number;
  /** max scdet score in the bin (0..100) */
  sceneRaw: number;
  /** mean frame difference */
  motionRaw: number;
  /** share of the frame difference explained by a global brightness shift (1 = pure fade) */
  fadeRatio: number;
  /** mean luma 0..255 */
  luma: number;
  /** mean saturation */
  sat: number;
  /** mean RMS level (dBFS, power average) */
  rmsDb: number;
  /** max peak level (dBFS) */
  peakDb: number;
  /** loudest 0.1 s RMS window in the bin (dBFS) */
  rmsMaxDb: number;
  hasVideo: boolean;
  hasAudio: boolean;
};

export type NormBin = Bin & {
  /** 0..1 normalized features */
  scene: number;
  motion: number;
  loudness: number;
  /** sudden audio rise (transient / impact) 0..1 */
  onset: number;
  /** brightness flash above the local level (explosions, hits) 0..1 */
  flash: number;
  /** 0..1, 1 = visually dead (near-black, static, fade) */
  dead: number;
};

export const DEFAULT_BIN_SEC = 0.5;

export function binFeatures(raw: RawFeatures, durationSec: number, binSec = DEFAULT_BIN_SEC): Bin[] {
  const n = Math.max(1, Math.ceil(durationSec / binSec - 1e-6));
  const acc = Array.from({ length: n }, () => ({
    scene: 0,
    motion: 0,
    luma: 0,
    sat: 0,
    nv: 0,
    shift: 0,
    pow: 0,
    peak: -100,
    rmsMax: -100,
    na: 0,
  }));
  const idx = (t: number) => Math.min(n - 1, Math.max(0, Math.floor(t / binSec)));
  raw.video.forEach((f: VideoFrameStat, i) => {
    const a = acc[idx(f.t)]!;
    // frame 0 has no predecessor -> its diff is meaningless
    if (i > 0) a.scene = Math.max(a.scene, f.scene);
    // fades / global brightness ramps change every pixel by ~the same amount: mafd ≈ |ΔYAVG|
    const prev = raw.video[i - 1];
    a.shift += prev ? Math.min(f.mafd, Math.abs(f.yavg - prev.yavg)) : 0;
    a.motion += f.mafd;
    a.luma += f.yavg;
    a.sat += f.sat;
    a.nv++;
  });
  raw.audio.forEach((f: AudioFrameStat) => {
    const a = acc[idx(f.t)]!;
    a.pow += Math.pow(10, f.rms / 10);
    a.peak = Math.max(a.peak, f.peak);
    a.rmsMax = Math.max(a.rmsMax, f.rms);
    a.na++;
  });
  // fill empty video bins (VFR / rounding) from the previous bin
  const bins: Bin[] = [];
  for (let i = 0; i < n; i++) {
    const a = acc[i]!;
    const prev = bins[i - 1];
    bins.push({
      t: i * binSec,
      sceneRaw: a.scene,
      motionRaw: a.nv ? a.motion / a.nv : (prev?.motionRaw ?? 0),
      luma: a.nv ? a.luma / a.nv : (prev?.luma ?? 0),
      sat: a.nv ? a.sat / a.nv : (prev?.sat ?? 0),
      rmsDb: a.na ? Math.max(-100, 10 * Math.log10(a.pow / a.na || 1e-10)) : -100,
      peakDb: a.na ? a.peak : -100,
      rmsMaxDb: a.na ? a.rmsMax : -100,
      fadeRatio: a.motion > 1e-6 ? a.shift / a.motion : 0,
      hasVideo: a.nv > 0,
      hasAudio: a.na > 0,
    });
  }
  return bins;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = Math.min(s.length - 1, Math.max(0, (p / 100) * (s.length - 1)));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** (v - p_lo) / (p_hi - p_lo) clamped to 0..1; flat signals map to 0. */
export function robustNormalize(values: number[], pLo = 10, pHi = 95, minSpan = 1e-6): number[] {
  const lo = percentile(values, pLo);
  const hi = percentile(values, pHi);
  const span = hi - lo;
  if (span < minSpan) return values.map(() => 0);
  return values.map((v) => clamp01((v - lo) / span));
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Centered moving average over `radius` bins on each side. */
export function smooth(values: number[], radius: number): number[] {
  if (radius <= 0) return [...values];
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      s += values[j]!;
      c++;
    }
    out.push(s / c);
  }
  return out;
}

export function normalizeBins(bins: Bin[], binSec = DEFAULT_BIN_SEC): NormBin[] {
  // scene: scdet score is mostly ~0 with spikes at cuts/flashes; compress with sqrt then normalize against high percentiles
  const sceneRaw = bins.map((b) => Math.sqrt(b.sceneRaw));
  const scene = robustNormalize(sceneRaw, 50, 99, 0.5);
  // motion: frame difference, log-compressed (game footage spans orders of magnitude)
  const motion = robustNormalize(
    bins.map((b) => Math.log1p(b.motionRaw * 4)),
    10,
    95,
    0.05,
  );
  const audioPresent = bins.some((b) => b.hasAudio && b.rmsDb > -90);
  // loudness in dB; ignore digital silence when choosing the low percentile
  const rms = bins.map((b) => b.rmsDb);
  const audible = rms.filter((v) => v > -90);
  const loLoud = audible.length ? percentile(audible, 10) : -60;
  const hiLoud = audible.length ? percentile(audible, 97) : -10;
  const loudSpan = Math.max(6, hiLoud - loLoud); // at least 6 dB of range, so a flat mix doesn't explode noise
  const loudness = rms.map((v) => (audioPresent ? clamp01((v - loLoud) / loudSpan) : 0));
  // onset: loudest 0.1 s window vs. the median level of the preceding ~2 s (impacts, explosions, roars)
  const win = Math.max(1, Math.round(2 / binSec));
  const onsetRaw = bins.map((b, i) => {
    const from = Math.max(0, i - win);
    if (i === from) return 0;
    const base = percentile(
      bins.slice(from, i).map((x) => x.rmsDb),
      50,
    );
    return Math.max(0, b.rmsMaxDb - base);
  });
  const onset = audioPresent ? robustNormalize(onsetRaw, 50, 98, 3) : bins.map(() => 0);
  // flash: mean luma above the local (±3 s) median
  const lw = Math.max(1, Math.round(3 / binSec));
  const flashRaw = bins.map((b, i) => {
    const local = percentile(
      bins.slice(Math.max(0, i - lw), Math.min(bins.length, i + lw + 1)).map((x) => x.luma),
      50,
    );
    return Math.max(0, b.luma - local);
  });
  const flash = robustNormalize(flashRaw, 50, 99, 4);

  // "dead" picture: near-black / very dark, or almost no motion (title card, pause, fade)
  const lumaHi = percentile(
    bins.map((b) => b.luma),
    90,
  );
  return bins.map((b, i) => {
    const dark = clamp01((Math.min(40, lumaHi * 0.35) - b.luma) / 20); // 1 when far below the source's bright level
    const still = clamp01((0.06 - motion[i]!) / 0.06);
    // mostly-global change (fade in/out, brightness ramp of a menu) with little real motion
    // (explosion blooms are global too, but loud: fades in captures are quiet transitions)
    const fade = clamp01((b.fadeRatio - 0.5) / 0.3) * (1 - loudness[i]!);
    return {
      ...b,
      scene: scene[i]!,
      motion: motion[i]!,
      loudness: loudness[i]!,
      onset: onset[i]!,
      flash: flash[i]!,
      // a white-out flash (explosion) is not "dead" even though little moves inside it
      dead: Math.max(dark, still, fade) * (1 - flash[i]!),
    };
  });
}
