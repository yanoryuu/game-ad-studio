import { clamp01, DEFAULT_BIN_SEC, smooth, type NormBin } from "./features";

/**
 * Pure scoring + segmentation: normalized bins -> ranked, non-overlapping 2..6 s highlight candidates.
 */

export type ScoreWeights = {
  motion: number;
  loudness: number;
  onset: number;
  scene: number;
};

/** scene = visual impact: max(scene-change score, brightness flash) */
export const DEFAULT_WEIGHTS: ScoreWeights = { motion: 0.3, loudness: 0.25, onset: 0.15, scene: 0.3 };

export type SegmentOptions = {
  binSec: number;
  minLenSec: number;
  maxLenSec: number;
  /** initial window length around a peak */
  baseLenSec: number;
  /** a neighbouring bin is absorbed while its smoothed score >= peak * extendRatio */
  extendRatio: number;
  /** min gap between candidates */
  gapSec: number;
  /** snap boundaries to cuts closer than this */
  snapSec: number;
  maxCandidates: number;
  /** stop when the peak falls below max(minScore, best * relFloor) */
  minScore: number;
  relFloor: number;
  weights: ScoreWeights;
};

export function defaultMaxCandidates(durationSec: number): number {
  return Math.max(4, Math.min(20, Math.round(4 + durationSec / 12)));
}

export function defaultSegmentOptions(durationSec: number): SegmentOptions {
  return {
    binSec: DEFAULT_BIN_SEC,
    minLenSec: 2,
    maxLenSec: 6,
    baseLenSec: 3,
    extendRatio: 0.85,
    gapSec: 0.5,
    snapSec: 0.75,
    maxCandidates: defaultMaxCandidates(durationSec),
    minScore: 0.12,
    relFloor: 0.3,
    weights: DEFAULT_WEIGHTS,
  };
}

export type CandidateRange = {
  startSec: number;
  endSec: number;
  score: number;
  features: { scene: number; motion: number; loudness: number };
};

/** Per-bin highlight score 0..1 (before smoothing). */
export function scoreBins(bins: NormBin[], weights: ScoreWeights, binSec = DEFAULT_BIN_SEC): number[] {
  // no audio track: score on the video features only (instead of capping every score)
  const w = bins.some((b) => b.hasAudio) ? weights : { ...weights, loudness: 0, onset: 0 };
  const total = w.motion + w.loudness + w.onset + w.scene || 1;
  // spread transients / cuts over ~1 s so they reward the surrounding action, not a single bin
  const r = Math.max(1, Math.round(0.5 / binSec));
  const onset = smooth(
    bins.map((b) => b.onset),
    r,
  ).map((v, i) => Math.max(v, bins[i]!.onset * 0.7));
  const impact = bins.map(impactOf);
  const scene = smooth(impact, r).map((v, i) => Math.max(v, impact[i]! * 0.7));
  return bins.map((b, i) => {
    const s = (w.motion * b.motion + w.loudness * b.loudness + w.onset * onset[i]! + w.scene * scene[i]!) / total;
    return clamp01(s * (1 - 0.85 * b.dead));
  });
}

/** visual impact of a bin: hard scene change or brightness flash (explosion) */
export const impactOf = (b: NormBin) => Math.max(b.scene, b.flash);

type Win = { a: number; b: number }; // bin indices [a, b)

export function segmentCandidates(bins: NormBin[], cutTimes: number[], opt: SegmentOptions): CandidateRange[] {
  const n = bins.length;
  if (n === 0) return [];
  const bs = opt.binSec;
  const durationSec = n * bs;
  const minBins = Math.max(1, Math.round(opt.minLenSec / bs));
  const maxBins = Math.max(minBins, Math.floor(opt.maxLenSec / bs));
  const baseBins = Math.min(maxBins, Math.max(minBins, Math.round(opt.baseLenSec / bs)));
  const gapBins = Math.round(opt.gapSec / bs);
  if (durationSec < opt.minLenSec) return [];

  const s = scoreBins(bins, opt.weights, bs);
  const ss = smooth(s, Math.max(1, Math.round(1 / bs))); // ±1 s: peak picking / growth
  const sp = smooth(s, Math.max(1, Math.round(0.5 / bs))); // ±0.5 s: the window's best moment
  // a bin "contains a cut" -> segments don't grow across it
  const cutBin = new Set(cutTimes.map((t) => Math.floor(t / bs)));

  const taken: Win[] = [];
  const blocked = new Uint8Array(n); // covered by a candidate (+gap)
  const order = ss.map((v, i) => i).sort((x, y) => ss[y]! - ss[x]! || x - y);
  const best = ss[order[0]!] ?? 0;
  const floor = Math.max(opt.minScore, best * opt.relFloor);
  const wins: { win: Win; peak: number }[] = [];

  for (const p of order) {
    if (wins.length >= opt.maxCandidates) break;
    const peak = ss[p]!;
    if (peak < floor) break;
    if (blocked[p]) continue;
    // initial window centered on the peak, clipped to free space
    let a = p - Math.floor(baseBins / 2);
    let b = a + baseBins;
    if (a < 0) {
      b -= a;
      a = 0;
    }
    if (b > n) {
      a -= b - n;
      b = n;
    }
    a = Math.max(0, a);
    // shrink away from blocked bins
    while (a < p && blocked[a]) a++;
    while (b - 1 > p && blocked[b - 1]) b--;
    // grow (into free space) to the min length
    while (b - a < minBins) {
      const canL = a > 0 && !blocked[a - 1];
      const canR = b < n && !blocked[b];
      if (!canL && !canR) break;
      if (canR && (!canL || s[b]! >= s[a - 1]!)) b++;
      else a--;
    }
    if (b - a < minBins) {
      blocked[p] = 1;
      continue;
    }
    // extend while the neighbourhood stays hot, not across cuts
    const thr = peak * opt.extendRatio;
    while (b - a < maxBins) {
      const canL = a > 0 && !blocked[a - 1] && ss[a - 1]! >= thr && !cutBin.has(a);
      const canR = b < n && !blocked[b] && ss[b]! >= thr && !cutBin.has(b);
      if (!canL && !canR) break;
      if (canR && (!canL || ss[b]! >= ss[a - 1]!)) b++;
      else a--;
    }
    // reject visually dead windows (title cards, fades, pauses)
    let dead = 0;
    for (let i = a; i < b; i++) dead += bins[i]!.dead;
    if (dead / (b - a) > 0.5) {
      for (let i = a; i < b; i++) blocked[i] = 1;
      continue;
    }
    const win = { a, b };
    wins.push({ win, peak });
    taken.push(win);
    for (let i = Math.max(0, a - gapBins); i < Math.min(n, b + gapBins); i++) blocked[i] = 1;
  }

  const out: CandidateRange[] = wins.map(({ win }) => {
    let start = win.a * bs;
    let end = Math.min(durationSec, win.b * bs);
    // snap boundaries to nearby cuts (keeping 2..6 s and not overlapping neighbours)
    const others = taken.filter((w) => w !== win);
    const lo = Math.max(0, ...others.filter((w) => w.b <= win.a).map((w) => w.b * bs));
    const hi = Math.min(durationSec, ...others.filter((w) => w.a >= win.b).map((w) => w.a * bs));
    const nearest = (t: number) => {
      let bestT: number | null = null;
      for (const c of cutTimes) if (Math.abs(c - t) <= opt.snapSec && (bestT === null || Math.abs(c - t) < Math.abs(bestT - t))) bestT = c;
      return bestT;
    };
    const cs = nearest(start);
    if (cs !== null && cs >= lo && end - cs >= opt.minLenSec && end - cs <= opt.maxLenSec) start = cs;
    const ce = nearest(end);
    if (ce !== null && ce <= hi && ce - start >= opt.minLenSec && ce - start <= opt.maxLenSec) end = ce;

    const i0 = Math.floor(start / bs + 1e-6);
    const i1 = Math.max(i0 + 1, Math.ceil(end / bs - 1e-6));
    let sum = 0;
    let mx = 0;
    let motion = 0;
    let loud = 0;
    let scene = 0;
    for (let i = i0; i < i1; i++) {
      sum += s[i]!;
      mx = Math.max(mx, sp[i]!);
      motion += bins[i]!.motion;
      loud += bins[i]!.loudness;
      scene = Math.max(scene, impactOf(bins[i]!));
    }
    const k = i1 - i0;
    return {
      startSec: round3(start),
      endSec: round3(end),
      score: round3(clamp01(0.55 * (sum / k) + 0.45 * mx)),
      features: { scene: round3(scene), motion: round3(motion / k), loudness: round3(loud / k) },
    };
  });
  out.sort((x, y) => y.score - x.score || x.startSec - y.startSec);
  return out;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
