import type { Caption } from "@gas/shared";
import type { VvAudioQuery } from "./voicevox";

/**
 * Japanese caption timing from a VOICEVOX audio_query (no ASR needed).
 *
 * 1. Mora timeline: walk accent_phrases; every mora lasts consonant_length + vowel_length, a phrase's
 *    pause_mora adds a pause (pauseLength ?? vowel_length * pauseLengthScale). Everything starts after
 *    prePhonemeLength and is divided by speedScale (the engine scales all phoneme lengths by it).
 *    The timeline is then stretched by (real wav duration / predicted duration) to absorb the engine's
 *    frame rounding (typically < 0.5 %).
 * 2. Pause groups: accent phrases are grouped at pause_moras. The ORIGINAL text (kanji etc.) is split into
 *    segments at pause punctuation (、。！？!?,.…). VOICEVOX usually emits one pause per such break, but not
 *    always (text-final punctuation: none; 「」 can add one), so segments are matched to groups with a small
 *    DP: each step maps 1–3 consecutive segments to 1–3 consecutive groups, cost = relative difference
 *    between the segment's estimated mora count (kana = 1, kanji/digits/latin ≈ 1.8) and the groups' real
 *    mora count, + a penalty per merge. Normally this is the 1:1 mapping.
 * 3. Character -> mora alignment inside a matched unit: kana count 1 mora each (small ゃゅょぁ… 0,
 *    ー/っ/ん 1), punctuation/brackets 0, and the remaining moras of the unit are shared equally by the
 *    "variable" characters (kanji, digits, latin). The cumulative weight of a character position is a
 *    fractional mora index, converted to seconds through the per-mora times (so long vowels, slow moras
 *    and pauses are honoured).
 * 4. Chunks: units are cut at punctuation; a piece longer than MAX_CHARS is split with a DP into the
 *    minimum number of chunks (each <= MAX_CHARS) maximising break quality: close to an accent-phrase
 *    boundary (≈ bunsetsu) and at a kana->kanji/katakana transition (after a particle) is good; breaks inside
 *    kanji/katakana words, before okurigana or small kana are penalised; balanced lengths preferred.
 *    Chunk boundaries within ~0.75 mora of an accent-phrase boundary snap to it.
 * 5. Display: trailing 、。 are removed (！？… kept). Each caption stays visible until the next one starts
 *    (covering pauses); the last one until the end of the audio. Times are relative to the line start.
 */

export const JA_MAX_CHARS = 14;

const PAUSE_PUNCT = /[、。，．,.！？!?…‥]/;
const ZERO_CHARS = /[\s「」『』（）()［］[\]〈〉《》【】〔〕"'“”‘’・〜~\-―—:：;；]/;
const SMALL_KANA = /[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]/;
const KANA = /[ぁ-ゖァ-ヺー]/;
const HIRAGANA = /[ぁ-ゖ]/;
const KATAKANA = /[ァ-ヺー]/;
const KANJI = /[㐀-鿿豈-﫿々〆ヶ]/;
const VAR_MORA_ESTIMATE = 1.8;

type CharKind = "pause" | "zero" | "small" | "kana" | "var";
function kindOf(ch: string): CharKind {
  if (PAUSE_PUNCT.test(ch)) return "pause";
  if (ZERO_CHARS.test(ch)) return "zero";
  if (SMALL_KANA.test(ch)) return "small";
  if (KANA.test(ch)) return "kana";
  return "var";
}
const readable = (ch: string) => {
  const k = kindOf(ch);
  return k === "kana" || k === "var";
};

type Mora = { start: number; end: number };
/** moras with absolute times; phraseStarts = mora indices (excl. 0) where an accent phrase / group starts */
type Group = { moras: Mora[]; phraseStarts: number[] };

function buildGroups(q: VvAudioQuery): { groups: Group[]; predicted: number } {
  const speed = q.speedScale > 0 ? q.speedScale : 1;
  let t = q.prePhonemeLength / speed;
  const groups: Group[] = [];
  let cur: Group = { moras: [], phraseStarts: [] };
  for (const ap of q.accent_phrases) {
    if (cur.moras.length > 0) cur.phraseStarts.push(cur.moras.length);
    for (const m of ap.moras) {
      const d = ((m.consonant_length ?? 0) + m.vowel_length) / speed;
      cur.moras.push({ start: t, end: t + d });
      t += d;
    }
    if (ap.pause_mora) {
      const p = q.pauseLength ?? ap.pause_mora.vowel_length * (q.pauseLengthScale ?? 1);
      t += Math.max(0, p) / speed;
      if (cur.moras.length) groups.push(cur);
      cur = { moras: [], phraseStarts: [] };
    }
  }
  if (cur.moras.length) groups.push(cur);
  return { groups, predicted: t + q.postPhonemeLength / speed };
}

function mergeGroups(gs: Group[]): Group {
  const merged: Group = { moras: [], phraseStarts: [] };
  for (const g of gs) {
    if (merged.moras.length) merged.phraseStarts.push(merged.moras.length);
    for (const s of g.phraseStarts) merged.phraseStarts.push(merged.moras.length + s);
    merged.moras.push(...g.moras);
  }
  return merged;
}

/** Splits the text into segments at runs of pause punctuation (punctuation stays with the left segment). */
function segmentText(text: string): string[] {
  const chars = [...text.trim()];
  const segs: string[] = [];
  let cur = "";
  for (let i = 0; i < chars.length; i++) {
    cur += chars[i];
    const isPause = kindOf(chars[i]!) === "pause";
    const nextIsPauseOrZero = i + 1 < chars.length && !readable(chars[i + 1]!) && !/[「『（(［[〈《【〔“‘]/.test(chars[i + 1]!);
    if (isPause && !nextIsPauseOrZero) {
      segs.push(cur);
      cur = "";
    }
  }
  if (cur) segs.push(cur);
  const out: string[] = [];
  for (const s of segs) {
    if (![...s].some(readable) && out.length) out[out.length - 1] += s;
    else out.push(s);
  }
  return out;
}

function estimateMoras(seg: string): number {
  let n = 0;
  for (const ch of seg) {
    const k = kindOf(ch);
    if (k === "kana") n += 1;
    else if (k === "var") n += VAR_MORA_ESTIMATE;
  }
  return n;
}

/** DP matching of text segments to pause groups (runs of 1..3 on each side). */
function matchSegments(segments: string[], groups: Group[]): { seg: string; group: Group }[] {
  const S = segments.length;
  const G = groups.length;
  const est = segments.map(estimateMoras);
  const cnt = groups.map((g) => g.moras.length);
  const INF = Number.POSITIVE_INFINITY;
  const cost: number[][] = Array.from({ length: S + 1 }, () => new Array<number>(G + 1).fill(INF));
  const back: [number, number][][] = Array.from({ length: S + 1 }, () => new Array<[number, number]>(G + 1).fill([0, 0]));
  cost[0]![0] = 0;
  for (let i = 0; i <= S; i++) {
    for (let j = 0; j <= G; j++) {
      const c0 = cost[i]![j]!;
      if (c0 === INF) continue;
      for (let a = 1; a <= 3 && i + a <= S; a++) {
        for (let b = 1; b <= 3 && j + b <= G; b++) {
          let e = 0;
          for (let k = i; k < i + a; k++) e += est[k]!;
          let m = 0;
          for (let k = j; k < j + b; k++) m += cnt[k]!;
          const c = c0 + Math.abs(e - m) / Math.max(e, m, 1) + 0.35 * (a - 1 + b - 1);
          if (c < cost[i + a]![j + b]!) {
            cost[i + a]![j + b] = c;
            back[i + a]![j + b] = [a, b];
          }
        }
      }
    }
  }
  if (cost[S]![G] === INF) return [{ seg: segments.join(""), group: mergeGroups(groups) }];
  const out: { seg: string; group: Group }[] = [];
  let i = S;
  let j = G;
  while (i > 0 && j > 0) {
    const [a, b] = back[i]![j]!;
    out.unshift({ seg: segments.slice(i - a, i).join(""), group: mergeGroups(groups.slice(j - b, j)) });
    i -= a;
    j -= b;
  }
  return out;
}

/** Cumulative fractional-mora positions for each char boundary of `chars` (length chars.length + 1). */
function charMoraPositions(chars: string[], moraCount: number): number[] {
  const kinds = chars.map(kindOf);
  const fixed = kinds.reduce((s, k) => s + (k === "kana" ? 1 : 0), 0);
  const nVar = kinds.filter((k) => k === "var").length;
  const varW = nVar ? Math.max(0.5, (moraCount - fixed) / nVar) : 0;
  const w = kinds.map((k) => (k === "kana" ? 1 : k === "var" ? varW : 0));
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const scale = moraCount / total;
  const pos = [0];
  for (const x of w) pos.push(pos[pos.length - 1]! + x * scale);
  return pos;
}

function moraToTime(g: Group, m: number): number {
  const n = g.moras.length;
  if (m <= 0) return g.moras[0]!.start;
  if (m >= n) return g.moras[n - 1]!.end;
  const i = Math.floor(m);
  const mo = g.moras[i]!;
  return mo.start + (mo.end - mo.start) * (m - i);
}

/** Quality of a break between chars[p-1] and chars[p] (higher = better). */
function breakScore(chars: string[], p: number, moraPos: number[], phraseStarts: number[]): number {
  const a = chars[p - 1]!;
  const b = chars[p]!;
  let s = 0;
  const m = moraPos[p]!;
  const dist = phraseStarts.length ? Math.min(...phraseStarts.map((x) => Math.abs(x - m))) : 3;
  s -= Math.min(dist, 3) * 1.5;
  if (HIRAGANA.test(a) && (KANJI.test(b) || KATAKANA.test(b) || /[「『（(]/.test(b))) s += 2; // particle -> content word
  if (KANJI.test(a) && KANJI.test(b)) s -= 3; // inside a compound
  if (KANJI.test(a) && HIRAGANA.test(b)) s -= 2; // before okurigana
  if (KATAKANA.test(a) && KATAKANA.test(b)) s -= 3; // inside a katakana word
  if (/[「『（(]/.test(a)) s -= 5; // right after an opening bracket
  if (SMALL_KANA.test(b) || /[ーっッんン」』）)]/.test(b)) s -= 4;
  return s;
}

/** Splits [from, to) into the minimum number of chunks of <= maxChars with the best breaks (DP). */
function splitRange(chars: string[], from: number, to: number, moraPos: number[], phraseStarts: number[], maxChars: number): [number, number][] {
  const len = to - from;
  if (len <= maxChars) return [[from, to]];
  const minParts = Math.ceil(len / maxChars);
  for (let parts = minParts; parts <= len; parts++) {
    const target = len / parts;
    // dp[k][p]: best score splitting [from, p) into k chunks
    const dp: Map<number, { score: number; prev: number }>[] = Array.from({ length: parts + 1 }, () => new Map());
    dp[0]!.set(from, { score: 0, prev: -1 });
    for (let k = 1; k <= parts; k++) {
      for (const [p0, v] of dp[k - 1]!) {
        for (let p = p0 + 1; p <= Math.min(to, p0 + maxChars); p++) {
          if (k === parts && p !== to) continue;
          if (k < parts && p === to) continue;
          const sizePen = -Math.abs(p - p0 - target) * 0.35;
          const brk = p === to ? 0 : breakScore(chars, p, moraPos, phraseStarts);
          const sc = v.score + sizePen + brk;
          const cur = dp[k]!.get(p);
          if (!cur || sc > cur.score) dp[k]!.set(p, { score: sc, prev: p0 });
        }
      }
    }
    const end = dp[parts]!.get(to);
    if (!end) continue;
    const cuts: number[] = [to];
    let p = to;
    for (let k = parts; k > 0; k--) {
      p = dp[k]!.get(p)!.prev;
      cuts.unshift(p);
    }
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < cuts.length; i++) out.push([cuts[i]!, cuts[i + 1]!]);
    return out;
  }
  return [[from, to]];
}

function splitAtPunct(chars: string[]): [number, number][] {
  const out: [number, number][] = [];
  let from = 0;
  for (let i = 0; i < chars.length; i++) {
    const endsHere = kindOf(chars[i]!) === "pause" && (i + 1 >= chars.length || kindOf(chars[i + 1]!) !== "pause");
    if (endsHere && [...chars.slice(i + 1)].some(readable)) {
      out.push([from, i + 1]);
      from = i + 1;
    }
  }
  if (from < chars.length) out.push([from, chars.length]);
  return out;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function displayText(s: string): string {
  return s.trim().replace(/[、。，．,.]+$/u, "").trim();
}

/** Builds line-relative captions for `text` synthesized from `query` whose real wav length is `durationSec`. */
export function buildJaCaptions(text: string, query: VvAudioQuery, durationSec: number, maxChars = JA_MAX_CHARS): Caption[] {
  const { groups, predicted } = buildGroups(query);
  const stretch = predicted > 0 && durationSec > 0 && Math.abs(durationSec / predicted - 1) < 0.25 ? durationSec / predicted : 1;
  for (const g of groups) for (const m of g.moras) { m.start *= stretch; m.end *= stretch; }

  const segments = segmentText(text);
  if (!groups.length || !segments.length) {
    const t = displayText(text);
    return t ? [{ text: t, startSec: 0, endSec: round3(durationSec) }] : [];
  }

  const raw: { text: string; start: number }[] = [];
  for (const { seg, group } of matchSegments(segments, groups)) {
    const chars = [...seg];
    const moraPos = charMoraPositions(chars, group.moras.length);
    const snap = (m: number) => group.phraseStarts.find((x) => Math.abs(x - m) <= 0.75) ?? m;
    for (const [a, b] of splitAtPunct(chars)) {
      for (const [from, to] of splitRange(chars, a, b, moraPos, group.phraseStarts, maxChars)) {
        const t = displayText(chars.slice(from, to).join(""));
        if (!t) continue;
        let first = from;
        while (first < to && !readable(chars[first]!)) first++;
        if (first >= to) continue;
        raw.push({ text: t, start: moraToTime(group, snap(moraPos[first]!)) });
      }
    }
  }

  // continuous display: each caption lasts until the next starts; the last one until the end of the audio
  const out: Caption[] = [];
  for (let i = 0; i < raw.length; i++) {
    const start = Math.max(0, Math.min(raw[i]!.start, durationSec));
    const next = raw[i + 1];
    const end = next ? Math.max(Math.min(next.start, durationSec), start + 0.05) : Math.max(durationSec, start + 0.05);
    out.push({ text: raw[i]!.text, startSec: round3(start), endSec: round3(end) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* v3: chunking without mora information (recorded narration)           */
/* ------------------------------------------------------------------ */

/** Relative spoken length of a character (kana 1, small kana 0, kanji/digits/latin ≈ 1.8, punctuation 0). */
export function jaCharWeight(ch: string): number {
  const k = kindOf(ch);
  return k === "kana" ? 1 : k === "var" ? VAR_MORA_ESTIMATE : 0;
}

export const isReadableJaChar = readable;

/**
 * Splits plain Japanese text into readable caption chunks (same rules as buildJaCaptions: cut at punctuation, long
 * pieces split by the break-quality DP, trailing 、。 removed). `first` = index in [...text.trim()] of the chunk's
 * first readable character (used to look up its time).
 */
export function chunkJaText(text: string, maxChars = JA_MAX_CHARS): { text: string; first: number }[] {
  const chars = [...text.trim()];
  const pos = chars.map((_, i) => i).concat(chars.length);
  const out: { text: string; first: number }[] = [];
  for (const [a, b] of splitAtPunct(chars)) {
    for (const [from, to] of splitRange(chars, a, b, pos, [], maxChars)) {
      const t = displayText(chars.slice(from, to).join(""));
      if (!t) continue;
      let first = from;
      while (first < to && !readable(chars[first]!)) first++;
      if (first >= to) continue;
      out.push({ text: t, first });
    }
  }
  return out;
}
