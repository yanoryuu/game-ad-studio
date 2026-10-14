/**
 * Pure DSP for BGM beat detection (no I/O). ARCHITECTURE §6.11.
 *
 * Pipeline (all on mono PCM at SAMPLE_RATE):
 *  1. onsetEnvelope: STFT (1024 Hann, hop 256 ≈ 11.6 ms) -> 40 log-spaced bands (30 Hz–11 kHz) in dB (floor = global max - 80 dB)
 *     -> half-wave rectified band-wise difference (spectral flux) averaged over bands -> minus a 0.5 s moving average
 *     -> /std. One value per frame (≈ 86 fps).
 *  2. Tempo: autocorrelation of the envelope. A BPM is scored with a comb over its first 4 multiples
 *     (sub-frame period, linear interpolation of the ACF) times a log-normal prior centred at 120 BPM (σ ≈ 0.85 octave),
 *     restricted to 60–200 BPM. That resolves the usual half/double ambiguity toward 70–180.
 *     Local tempo: the same salience over 8 s windows (hop 1 s) -> Viterbi path over a 1 % BPM grid with a cost for tempo
 *     changes (drift is cheap, jumps are expensive), so songs whose tempo changes per section are followed.
 *     Frames whose local tempo is within 4 % of the global tempo use the precise global period.
 *  3. Beat tracking: dynamic programming (Ellis 2007): C(t) = O(t) + max_τ [C(τ) − α·log²((t−τ)/P(t))], τ ∈ [t−2P, t−P/2],
 *     backtracked from the best score in the final period. Beats therefore follow onsets with a slight drift allowed and
 *     continue at the tempo period through quiet passages / silent intros (the whole file is covered).
 *  4. Each beat is refined to the sub-frame onset peak (parabolic interpolation within ±1 frame), times are shifted by
 *     the envelope latency, and the reported BPM is a least-squares fit of the beat grid when it is steady
 *     (else the median inter-beat interval).
 */

export const SAMPLE_RATE = 22050;
export const FFT_SIZE = 1024;
export const HOP = 256;
export const FPS = SAMPLE_RATE / HOP;
/** Calibrated (synthetic tracks): envelope frame i's onset corresponds to time i*HOP/SR + this. */
export const ENVELOPE_LATENCY_SEC = (FFT_SIZE / 2) / SAMPLE_RATE + 0.008;

const MIN_BPM = 60;
const MAX_BPM = 200;
const PRIOR_CENTER_BPM = 120;
const PRIOR_SIGMA_OCT = 0.85;

/* ------------------------------------------------------------------ */
/* FFT                                                                 */
/* ------------------------------------------------------------------ */

type FftPlan = { n: number; rev: Uint32Array; cos: Float64Array; sin: Float64Array };

function fftPlan(n: number): FftPlan {
  const bits = Math.log2(n);
  if (!Number.isInteger(bits)) throw new Error("FFT size must be a power of 2");
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n);
    sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }
  return { n, rev, cos, sin };
}

/** In-place iterative radix-2 complex FFT. */
function fft(plan: FftPlan, re: Float64Array, im: Float64Array): void {
  const { n, rev, cos, sin } = plan;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Onset envelope                                                      */
/* ------------------------------------------------------------------ */

const N_BANDS = 40;
const BAND_LO_HZ = 30;
const BAND_HI_HZ = 11000;

function bandEdges(): Int32Array {
  const edges = new Int32Array(N_BANDS + 1);
  const binHz = SAMPLE_RATE / FFT_SIZE;
  let prev = 0;
  for (let b = 0; b <= N_BANDS; b++) {
    const hz = BAND_LO_HZ * Math.pow(BAND_HI_HZ / BAND_LO_HZ, b / N_BANDS);
    let bin = Math.round(hz / binHz);
    if (b > 0 && bin <= prev) bin = prev + 1; // at least one bin per band
    edges[b] = Math.min(bin, FFT_SIZE / 2);
    prev = edges[b];
  }
  return edges;
}

function movingAverage(x: Float32Array, radius: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - radius);
    const b = Math.min(n, i + radius + 1);
    out[i] = (pre[b] - pre[a]) / (b - a);
  }
  return out;
}

/** Onset-strength envelope at FPS frames/s (zero-ish mean, unit std). Frame i ≈ time i / FPS (+ latency). */
export function onsetEnvelope(samples: Float32Array): Float32Array {
  const nFrames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP) + 1);
  if (nFrames < 2) return new Float32Array(0);
  const plan = fftPlan(FFT_SIZE);
  const win = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
  const edges = bandEdges();
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const bands = new Float32Array(nFrames * N_BANDS); // power -> dB
  let maxDb = -Infinity;
  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = samples[off + i] * win[i];
      im[i] = 0;
    }
    fft(plan, re, im);
    for (let b = 0; b < N_BANDS; b++) {
      let p = 0;
      for (let k = edges[b]; k < edges[b + 1]; k++) p += re[k] * re[k] + im[k] * im[k];
      const db = 10 * Math.log10(p + 1e-12);
      bands[f * N_BANDS + b] = db;
      if (db > maxDb) maxDb = db;
    }
  }
  const floor = maxDb - 80;
  const flux = new Float32Array(nFrames);
  for (let f = 1; f < nFrames; f++) {
    let s = 0;
    for (let b = 0; b < N_BANDS; b++) {
      const cur = Math.max(bands[f * N_BANDS + b], floor);
      const prev = Math.max(bands[(f - 1) * N_BANDS + b], floor);
      if (cur > prev) s += cur - prev;
    }
    flux[f] = s / N_BANDS;
  }
  const local = movingAverage(flux, Math.round(0.25 * FPS));
  const env = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) env[f] = Math.max(0, flux[f] - local[f]);
  let mean = 0;
  for (let f = 0; f < nFrames; f++) mean += env[f];
  mean /= nFrames;
  let v = 0;
  for (let f = 0; f < nFrames; f++) v += (env[f] - mean) ** 2;
  const std = Math.sqrt(v / nFrames) || 1;
  for (let f = 0; f < nFrames; f++) env[f] /= std;
  return env;
}

/* ------------------------------------------------------------------ */
/* Tempo                                                               */
/* ------------------------------------------------------------------ */

/** Normalized autocorrelation of x[from, to) (mean removed) for lags 0..maxLag. */
function autocorr(x: Float32Array, from: number, to: number, maxLag: number): Float64Array {
  const n = to - from;
  const acf = new Float64Array(maxLag + 1);
  if (n <= 1) return acf;
  let mean = 0;
  for (let i = from; i < to; i++) mean += x[i];
  mean /= n;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = x[from + i] - mean;
  for (let lag = 0; lag <= maxLag && lag < n; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += y[i] * y[i + lag];
    acf[lag] = s / (n - lag); // unbiased
  }
  const z = acf[0] || 1;
  for (let lag = 0; lag <= maxLag; lag++) acf[lag] /= z;
  return acf;
}

function interp(acf: Float64Array, lag: number): number {
  const i = Math.floor(lag);
  if (i + 1 >= acf.length) return 0;
  const f = lag - i;
  return acf[i] * (1 - f) + acf[i + 1] * f;
}

const COMB_WEIGHTS = [1, 0.75, 0.5, 0.35];

/** Raw (prior-free) tempo salience of a period in frames: comb over its multiples. */
function salience(acf: Float64Array, period: number): number {
  let s = 0;
  let w = 0;
  for (let k = 0; k < COMB_WEIGHTS.length; k++) {
    const lag = period * (k + 1);
    if (lag >= acf.length - 1) break;
    // max over ±0.5 frame tolerates slight tempo drift in the comb
    s += COMB_WEIGHTS[k] * Math.max(interp(acf, lag), interp(acf, Math.max(0, lag - 0.5)), interp(acf, lag + 0.5));
    w += COMB_WEIGHTS[k];
  }
  return w ? s / w : 0;
}

export function tempoPrior(bpm: number): number {
  const o = Math.log2(bpm / PRIOR_CENTER_BPM) / PRIOR_SIGMA_OCT;
  return Math.exp(-0.5 * o * o);
}

const periodOf = (bpm: number) => (60 * FPS) / bpm;
const bpmOf = (period: number) => (60 * FPS) / period;

/** Global tempo (BPM) from the whole envelope, sub-frame precision. */
export function estimateGlobalTempo(env: Float32Array): number {
  const maxLag = Math.ceil(periodOf(MIN_BPM) * COMB_WEIGHTS.length) + 2;
  const acf = autocorr(env, 0, env.length, Math.min(maxLag, env.length - 1));
  let best = PRIOR_CENTER_BPM;
  let bestScore = -Infinity;
  // coarse: 0.5 % steps
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm *= 1.005) {
    const sc = Math.max(0, salience(acf, periodOf(bpm))) * tempoPrior(bpm);
    if (sc > bestScore) {
      bestScore = sc;
      best = bpm;
    }
  }
  // fine: ±0.6 % in 0.02 % steps, prior-free (no bias inside the peak)
  let fine = best;
  let fineScore = -Infinity;
  for (let bpm = best * 0.994; bpm <= best * 1.006; bpm *= 1.0002) {
    const p = periodOf(bpm);
    let s = 0;
    for (let k = 0; k < COMB_WEIGHTS.length; k++) {
      const lag = p * (k + 1);
      if (lag >= acf.length - 1) break;
      s += COMB_WEIGHTS[k] * interp(acf, lag);
    }
    if (s > fineScore) {
      fineScore = s;
      fine = bpm;
    }
  }
  return fine;
}

const LOCAL_WIN_SEC = 8;
const LOCAL_HOP_SEC = 1;

/**
 * Per-frame beat period (frames). Local tempo by Viterbi over windowed salience; within 4 % of the global tempo
 * the global period is used (precise, no jitter).
 */
export function localPeriods(env: Float32Array, globalBpm: number): Float32Array {
  const n = env.length;
  const gP = periodOf(globalBpm);
  const out = new Float32Array(n).fill(gP);
  const win = Math.round(LOCAL_WIN_SEC * FPS);
  const hop = Math.round(LOCAL_HOP_SEC * FPS);
  if (n < win * 2) return out;

  const grid: number[] = [];
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm *= 1.01) grid.push(bpm);
  const S = grid.length;
  const maxLag = Math.min(win - 1, Math.ceil(periodOf(MIN_BPM) * 2) + 2);
  const obs: Float64Array[] = [];
  for (let start = 0; start + win <= n; start += hop) {
    const acf = autocorr(env, start, start + win, maxLag);
    // energy check: silent windows carry no tempo information -> flat observation
    let e = 0;
    for (let i = start; i < start + win; i++) e += env[i];
    const o = new Float64Array(S);
    if (e / win < 0.05) {
      o.fill(0);
    } else {
      let mx = 1e-9;
      for (let s = 0; s < S; s++) {
        // local comb uses 2 multiples (8 s window)
        const p = periodOf(grid[s]);
        const v = Math.max(0, (interp(acf, p) + 0.5 * interp(acf, 2 * p)) / 1.5) * tempoPrior(grid[s]);
        o[s] = v;
        if (v > mx) mx = v;
      }
      for (let s = 0; s < S; s++) o[s] = Math.log(o[s] / mx + 0.02); // relative log-salience, max 0
    }
    // mild pull toward the global tempo (keeps the octave consistent with the global estimate)
    for (let s = 0; s < S; s++) o[s] += 0.4 * -Math.abs(Math.log2(grid[s] / globalBpm)) * 4;
    obs.push(o);
  }
  const W = obs.length;
  if (W < 2) return out;

  // Viterbi: drift (≤ 2 grid steps) is cheap, larger jumps cost JUMP
  const JUMP = 6;
  const DRIFT = 0.6;
  let score = Float64Array.from(obs[0]);
  const back: Int32Array[] = [];
  for (let w = 1; w < W; w++) {
    let bestAll = -Infinity;
    let bestAllIdx = 0;
    for (let s = 0; s < S; s++) if (score[s] > bestAll) { bestAll = score[s]; bestAllIdx = s; }
    const next = new Float64Array(S);
    const bk = new Int32Array(S);
    for (let s = 0; s < S; s++) {
      let b = bestAll - JUMP;
      let bi = bestAllIdx;
      for (let d = -2; d <= 2; d++) {
        const q = s + d;
        if (q < 0 || q >= S) continue;
        const v = score[q] - DRIFT * Math.abs(d);
        if (v > b) { b = v; bi = q; }
      }
      next[s] = b + obs[w][s];
      bk[s] = bi;
    }
    back.push(bk);
    score = next;
  }
  const path = new Int32Array(W);
  let cur = 0;
  for (let s = 1; s < S; s++) if (score[s] > score[cur]) cur = s;
  path[W - 1] = cur;
  for (let w = W - 1; w > 0; w--) {
    cur = back[w - 1][cur];
    path[w - 1] = cur;
  }
  // per frame: nearest window centre's state
  for (let f = 0; f < n; f++) {
    const w = Math.min(W - 1, Math.max(0, Math.round((f - win / 2) / hop)));
    const bpm = grid[path[w]];
    out[f] = Math.abs(bpm / globalBpm - 1) <= 0.04 ? gP : periodOf(bpm);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Beat tracking (Ellis 2007 dynamic programming)                       */
/* ------------------------------------------------------------------ */

const TIGHTNESS = 100;

/** Beat frame indices (ascending) for an envelope and per-frame periods. */
export function trackBeats(env: Float32Array, period: Float32Array): number[] {
  const n = env.length;
  if (!n) return [];
  const C = new Float64Array(n);
  const prev = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    const P = period[t];
    const lo = Math.max(0, Math.floor(t - 2 * P));
    const hi = Math.round(t - P / 2);
    // always chain (also through silence, where only the transition penalty counts) so the grid covers the file
    let best = -Infinity;
    let bi = -1;
    for (let tau = lo; tau <= hi; tau++) {
      const r = Math.log((t - tau) / P);
      const v = C[tau] - TIGHTNESS * r * r;
      if (v > best) {
        best = v;
        bi = tau;
      }
    }
    C[t] = env[t] + (bi >= 0 ? best : 0);
    prev[t] = bi;
  }
  // last beat: best cumulative score within the final period
  const Pend = period[n - 1];
  let end = n - 1;
  for (let t = Math.max(0, Math.floor(n - 1 - Pend)); t < n; t++) if (C[t] > C[end]) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = prev[t]) beats.push(t);
  beats.reverse();
  return beats;
}

/** Sub-frame position of the onset peak near frame b (parabolic interpolation within ±1 frame). */
function refinePeak(env: Float32Array, b: number): number {
  let m = b;
  for (const c of [b - 1, b + 1]) if (c >= 0 && c < env.length && env[c] > env[m]) m = c;
  if (m <= 0 || m >= env.length - 1) return m;
  const a = env[m - 1];
  const c = env[m];
  const d = env[m + 1];
  const den = a - 2 * c + d;
  if (den >= 0) return m;
  const off = (0.5 * (a - d)) / den;
  return m + Math.max(-0.5, Math.min(0.5, off));
}

const PREFERRED_MIN_BPM = 70;
const PREFERRED_MAX_BPM = 180;

function strengthAt(env: Float32Array, pos: number): number {
  let m = 0;
  const c = Math.round(pos);
  for (let i = Math.max(0, c - 2); i <= Math.min(env.length - 1, c + 2); i++) if (env[i] > m) m = env[i];
  return m;
}

/**
 * Half/double tempo check on the tracked grid (the autocorrelation prior alone cannot tell 75 from 150 when every
 * beat has the same onset). Returns 2 when the mid-points between beats are about as strong as the beats
 * (the grid is skipping every other beat), 0.5 when every other beat is much weaker (the grid is on the off-beats too),
 * provided the new tempo stays in 70–180 BPM. Otherwise 1.
 */
export function metricalLevel(env: Float32Array, frames: number[], bpm: number): number {
  if (frames.length < 8) return 1;
  let onBeat = 0;
  let mid = 0;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < frames.length; i++) {
    const s = strengthAt(env, frames[i]);
    onBeat += s;
    if (i % 2 === 0) even += s;
    else odd += s;
    if (i + 1 < frames.length) mid += strengthAt(env, (frames[i] + frames[i + 1]) / 2);
  }
  onBeat /= frames.length;
  mid /= frames.length - 1;
  even /= Math.ceil(frames.length / 2);
  odd /= Math.floor(frames.length / 2);
  if (onBeat <= 0) return 1;
  if (bpm * 2 <= PREFERRED_MAX_BPM && mid / onBeat > 0.7) return 2;
  if (bpm / 2 >= PREFERRED_MIN_BPM && Math.min(even, odd) / Math.max(even, odd) < 0.55) return 0.5;
  return 1;
}

export type BeatResult = { beats: number[]; bpm: number };

/** Full analysis from mono PCM at SAMPLE_RATE. */
export function detectBeats(samples: Float32Array): BeatResult {
  const duration = samples.length / SAMPLE_RATE;
  const env = onsetEnvelope(samples);
  if (env.length < FPS * 2) throw new Error("The audio is too short for beat analysis (needs at least ~2 s)");
  let peak = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > peak) peak = env[i];
  if (!(peak > 0)) throw new Error("No onsets found (the audio is silent?)");

  let globalBpm = estimateGlobalTempo(env);
  let periods = localPeriods(env, globalBpm);
  let frames = trackBeats(env, periods);
  const factor = metricalLevel(env, frames, globalBpm);
  if (factor !== 1) {
    globalBpm *= factor;
    periods = periods.map((p) => p / factor);
    frames = trackBeats(env, periods);
  }

  // onset strength around each beat decides whether to snap to the local peak (quiet passages keep the grid)
  const times: number[] = [];
  for (const f of frames) {
    const pos = env[f] > 0.5 ? refinePeak(env, f) : f;
    times.push(pos / FPS + ENVELOPE_LATENCY_SEC);
  }
  // ascending, deduplicated, inside the file
  const beats: number[] = [];
  for (const t of times) {
    const r = Math.round(t * 1000) / 1000;
    if (r < 0 || r > duration) continue;
    if (beats.length && r - beats[beats.length - 1] < 0.05) continue;
    beats.push(r);
  }
  return { beats, bpm: reportBpm(beats, globalBpm) };
}

/** Tempo of the tracked grid: least squares fit when steady, else median interval; normalized to [MIN_BPM, MAX_BPM]. */
export function reportBpm(beats: number[], fallback: number): number {
  let bpm = fallback;
  if (beats.length >= 4) {
    const n = beats.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += beats[i]; sxx += i * i; sxy += i * beats[i]; }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const icp = (sy - slope * sx) / n;
    let res = 0;
    for (let i = 0; i < n; i++) res += (beats[i] - (icp + slope * i)) ** 2;
    const rms = Math.sqrt(res / n);
    if (slope > 0 && rms < slope * 0.15) bpm = 60 / slope;
    else {
      const ibi = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b);
      const med = ibi[Math.floor(ibi.length / 2)];
      if (med > 0) bpm = 60 / med;
    }
  }
  while (bpm < MIN_BPM) bpm *= 2;
  while (bpm > MAX_BPM) bpm /= 2;
  return Math.round(bpm * 100) / 100;
}

export { bpmOf, periodOf };
