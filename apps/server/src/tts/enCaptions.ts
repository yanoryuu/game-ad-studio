import type { Caption } from "@gas/shared";
import { decorate, parseEmText } from "./emphasisText";
import type { WordTiming } from "./whisper";

/**
 * English caption chunks from the ORIGINAL script words + whisper word timings.
 *
 * Alignment is done at character level (lowercase a-z0-9 only) with an LCS between the script and the
 * whisper transcript, so split/joined words ("wishlist" vs "wish list") still line up; each script word
 * takes the time of its first matched character, unmatched words (e.g. numbers whisper spelled out)
 * are interpolated by character length between their neighbours.
 * Words are grouped into chunks: phrases end at , . ! ? ; : ; a phrase longer than MAX_WORDS (or
 * MAX_CHARS) is split into balanced parts, preferring a break before a function word (in, of, the, and…);
 * a 1–2 word phrase ending with a comma is merged with the next phrase when the result still fits.
 * Each chunk shows until the next one starts; the last one until the end of the audio.
 * v4 (§6.13): words, alignment and chunking use stripEmphasis(text) (what was spoken); each word remembers which
 * characters were inside 【】 and each chunk text gets its markers back (closed / reopened at chunk boundaries).
 * Balanced splits avoid breaking inside an emphasis run.
 */

const MAX_WORDS = 6;
const MAX_CHARS = 34;
const BREAK_BEFORE = new Set([
  "a", "an", "the", "in", "on", "at", "of", "to", "for", "with", "and", "but", "or", "from", "into", "as",
  "that", "where", "when", "while", "before", "after", "until", "so", "because", "if", "than", "like", "through",
]);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const round3 = (x: number) => Math.round(x * 1000) / 1000;

type ScriptWord = { text: string; start: number };

/**
 * Words of the stripped text with per-character emphasis flags. joinEmph[k] = the gap before word k is inside an
 * emphasis run (the characters on both sides and the whitespace are all emphasized): breaking there cuts the run.
 */
type EmWords = { words: string[]; emph: boolean[][]; joinEmph: boolean[] };

function scriptWords(text: string): EmWords {
  const { chars, emph } = parseEmText(text);
  const out: EmWords = { words: [], emph: [], joinEmph: [] };
  let i = 0;
  while (i < chars.length) {
    const gap = i;
    while (i < chars.length && /\s/.test(chars[i]!)) i++;
    if (i >= chars.length) break;
    const a = i;
    while (i < chars.length && !/\s/.test(chars[i]!)) i++;
    out.words.push(chars.slice(a, i).join(""));
    out.emph.push(emph.slice(a, i));
    out.joinEmph.push(a > 0 && emph.slice(gap - 1, a + 1).every(Boolean));
  }
  return out;
}

/** edge[k] = the gap before word k is the start or end of an emphasis run (a good place to break). */
function runEdges(ew: EmWords): boolean[] {
  return ew.words.map((_, k) => {
    if (k === 0 || ew.joinEmph[k]) return false;
    const prev = ew.emph[k - 1]!;
    return !!prev[prev.length - 1] || !!ew.emph[k]![0];
  });
}

/** Start time per script word (seconds), aligned to whisper words. */
function alignStarts(words: string[], whisper: WordTiming[]): number[] {
  // whisper chars with times
  const wc: { ch: string; t: number }[] = [];
  for (const w of whisper) {
    const n = norm(w.text);
    for (let k = 0; k < n.length; k++) wc.push({ ch: n[k]!, t: w.startSec + ((w.endSec - w.startSec) * k) / n.length });
  }
  // script chars with word index
  const sc: { ch: string; wi: number }[] = [];
  words.forEach((w, wi) => {
    for (const ch of norm(w)) sc.push({ ch, wi });
  });
  const n = sc.length;
  const m = wc.length;
  const starts: number[] = new Array(words.length).fill(NaN);
  if (n && m) {
    // LCS table (Uint16 is enough: lines are <= a few hundred chars)
    const dp = new Uint16Array((n + 1) * (m + 1));
    const W = m + 1;
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * W + j] = sc[i]!.ch === wc[j]!.ch ? dp[(i + 1) * W + j + 1]! + 1 : Math.max(dp[(i + 1) * W + j]!, dp[i * W + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (sc[i]!.ch === wc[j]!.ch && dp[i * W + j] === dp[(i + 1) * W + j + 1]! + 1) {
        const wi = sc[i]!.wi;
        if (Number.isNaN(starts[wi]!)) starts[wi] = wc[j]!.t;
        i++;
        j++;
      } else if (dp[(i + 1) * W + j]! >= dp[i * W + j + 1]!) i++;
      else j++;
    }
  }
  return starts;
}

/** Fills NaN starts by char-length interpolation between known neighbours (and [0, end]); enforces monotonic. */
function fillStarts(words: string[], starts: number[], speechStart: number, speechEnd: number): number[] {
  const len = words.map((w) => Math.max(1, w.length + 1));
  const out = starts.slice();
  let i = 0;
  while (i < out.length) {
    if (!Number.isNaN(out[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && Number.isNaN(out[j]!)) j++;
    const t0 = i > 0 ? out[i - 1]! : speechStart;
    const t1 = j < out.length ? out[j]! : speechEnd;
    // span from word i-1 (already started) .. word j: weights of words i-1..j-1
    const from = i > 0 ? i - 1 : i;
    const total = len.slice(from, j).reduce((a, b) => a + b, 0) || 1;
    let acc = i > 0 ? len[i - 1]! : 0;
    for (let k = i; k < j; k++) {
      out[k] = t0 + ((t1 - t0) * acc) / total;
      acc += len[k]!;
    }
    i = j;
  }
  for (let k = 1; k < out.length; k++) if (out[k]! < out[k - 1]!) out[k] = out[k - 1]!;
  return out;
}

/** inRun[k] / edge[k]: the break before word k cuts an emphasis run / is a run boundary (v4). */
type RunInfo = { inRun: boolean[]; edge: boolean[] };

function chunkWords(words: string[], runs: RunInfo = { inRun: [], edge: [] }): string[][] {
  // phrases at punctuation
  const phrases: { words: string[]; comma: boolean }[] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    if (/[,.!?;:…]["')\]]*$/.test(w)) {
      phrases.push({ words: cur, comma: /[,;:]["')\]]*$/.test(w) });
      cur = [];
    }
  }
  if (cur.length) phrases.push({ words: cur, comma: false });
  // merge tiny comma phrases forward
  const merged: string[][] = [];
  for (let i = 0; i < phrases.length; i++) {
    const p = phrases[i]!;
    const next = phrases[i + 1];
    if (next && p.comma && p.words.length <= 2 && p.words.length + next.words.length <= MAX_WORDS) {
      next.words = [...p.words, ...next.words];
      continue;
    }
    merged.push(p.words);
  }
  // split long phrases into balanced parts
  const out: string[][] = [];
  let base = 0;
  for (const ph of merged) {
    out.push(...splitBalanced(ph, { inRun: runs.inRun.slice(base, base + ph.length), edge: runs.edge.slice(base, base + ph.length) }));
    base += ph.length;
  }
  return out;
}

function splitBalanced(ws: string[], runs: RunInfo): string[][] {
  const chars = ws.join(" ").length;
  if (ws.length <= MAX_WORDS && chars <= MAX_CHARS) return [ws];
  const parts = Math.max(Math.ceil(ws.length / MAX_WORDS), Math.ceil(chars / MAX_CHARS), 2);
  const ideal = ws.length / parts;
  // choose the first break near `ideal`, preferring a break before a function word
  let best = Math.round(ideal);
  let bestScore = -Infinity;
  for (let p = Math.max(1, Math.floor(ideal) - 1); p <= Math.min(ws.length - 1, Math.ceil(ideal) + 1); p++) {
    let s = -Math.abs(p - ideal);
    if (BREAK_BEFORE.has(norm(ws[p]!))) s += 1.2;
    if (BREAK_BEFORE.has(norm(ws[p - 1]!))) s -= 1.5; // never end a chunk on "the"/"a"/"of"...
    if (p < 2 || ws.length - p < 2) s -= 1; // avoid 1-word orphans
    if (runs.inRun[p]) s -= 2.5; // v4: keep emphasis runs together
    else if (runs.edge[p]) s += 0.6;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return [ws.slice(0, best), ...splitBalanced(ws.slice(best), { inRun: runs.inRun.slice(best), edge: runs.edge.slice(best) })];
}

function displayText(ws: string[]): string {
  return ws.join(" ").replace(/(?<!\.)[,;:.]+$/u, "").trim();
}

/** displayText of words [from, to) with the emphasis markers put back (v4). */
function displayRich(ew: EmWords, from: number, to: number): string {
  const chars: string[] = [];
  const emph: boolean[] = [];
  for (let k = from; k < to; k++) {
    if (k > from) {
      chars.push(" ");
      emph.push(!!ew.joinEmph[k]);
    }
    chars.push(...ew.words[k]!);
    emph.push(...ew.emph[k]!);
  }
  return decorate(chars, emph, (plain) => displayText([plain]));
}

/**
 * Captions (line-relative seconds). `text` = the line text (v4: may contain 【】; `whisper` = timings of what was
 * spoken = its stripped text). `whisper` null -> proportional-by-characters timing.
 */
export function buildEnCaptions(text: string, durationSec: number, whisper: WordTiming[] | null): Caption[] {
  const ew = scriptWords(text);
  const words = ew.words;
  if (!words.length) return [];
  let starts: number[];
  if (whisper && whisper.length) {
    const first = whisper[0]!.startSec;
    const last = whisper[whisper.length - 1]!.endSec;
    starts = fillStarts(words, alignStarts(words, whisper), Math.min(first, durationSec), Math.min(Math.max(last, first), durationSec));
  } else {
    starts = fillStarts(words, new Array(words.length).fill(NaN), 0, durationSec);
  }
  const sw: ScriptWord[] = words.map((w, i) => ({ text: w, start: starts[i]! }));
  const chunks = chunkWords(words, { inRun: ew.joinEmph, edge: runEdges(ew) });
  const out: Caption[] = [];
  let idx = 0;
  const raw: { text: string; start: number }[] = [];
  for (const c of chunks) {
    raw.push({ text: displayRich(ew, idx, idx + c.length), start: sw[idx]!.start });
    idx += c.length;
  }
  for (let i = 0; i < raw.length; i++) {
    const start = Math.max(0, Math.min(raw[i]!.start, durationSec));
    const next = raw[i + 1];
    const end = next ? Math.max(Math.min(next.start, durationSec), start + 0.05) : Math.max(durationSec, start + 0.05);
    if (raw[i]!.text) out.push({ text: raw[i]!.text, startSec: round3(start), endSec: round3(end) });
  }
  return out;
}
