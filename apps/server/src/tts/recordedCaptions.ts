import type { Caption } from "@gas/shared";
import { parseEmText } from "./emphasisText";
import { chunkJaText, isReadableJaChar, jaCharWeight } from "./jaCaptions";
import type { TimedSegment } from "./whisper";

/**
 * Japanese captions for recorded narration (ARCHITECTURE §6.10). Pure.
 *
 * - With script text: the script's readable characters are aligned to the whisper transcript's characters with an
 *   LCS on normalized characters (NFKC, katakana -> hiragana, punctuation/space dropped), so identical kana/kanji
 *   take the transcript's time; unmatched characters (e.g. 抗え vs あらがえ) are interpolated by spoken weight between
 *   matched neighbours (speech start/end at the ends). The script is then chunked like VOICEVOX lines (chunkJaText)
 *   and each chunk starts at its first character's time.
 * - Without script text: the transcript itself (whisper's punctuation helps) is chunked the same way.
 * - segments null/empty: proportional by spoken weight over the whole audio (fallback).
 * Each caption shows until the next one starts; the last one until the end of the audio. Times are line-relative.
 * v4 (§6.13): script 【】 markers are not spoken: alignment uses the stripped script, caption texts keep the markers.
 */

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function normChar(ch: string): string {
  const n = ch.normalize("NFKC");
  const c = n.codePointAt(0) ?? 0;
  if (c >= 0x30a1 && c <= 0x30f6) return String.fromCodePoint(c - 0x60); // katakana -> hiragana
  return n.toLowerCase();
}

function toCaptions(raw: { text: string; start: number }[], durationSec: number): Caption[] {
  const out: Caption[] = [];
  for (let i = 0; i < raw.length; i++) {
    const start = Math.max(0, Math.min(raw[i]!.start, durationSec));
    const next = raw[i + 1];
    const end = next ? Math.max(Math.min(next.start, durationSec), start + 0.05) : Math.max(durationSec, start + 0.05);
    out.push({ text: raw[i]!.text, startSec: round3(start), endSec: round3(end) });
  }
  return out;
}

/** Proportional (by spoken weight) char start times over [t0, t1]. */
function proportionalTimes(chars: string[], t0: number, t1: number): number[] {
  const w = chars.map(jaCharWeight);
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const out: number[] = [];
  let acc = 0;
  for (const x of w) {
    out.push(t0 + ((t1 - t0) * acc) / total);
    acc += x;
  }
  return out;
}

/** Start time for every char of `chars` aligned to the timed transcript characters. */
export function alignJaChars(chars: string[], tc: { ch: string; t: number }[], speechStart: number, speechEnd: number): number[] {
  const sIdx: number[] = [];
  const sNorm: string[] = [];
  chars.forEach((ch, i) => {
    if (isReadableJaChar(ch)) {
      sIdx.push(i);
      sNorm.push(normChar(ch));
    }
  });
  const tNorm = tc.map((x) => normChar(x.ch));
  const n = sNorm.length;
  const m = tNorm.length;
  const times: number[] = new Array(chars.length).fill(NaN);
  if (n && m) {
    const W = m + 1;
    const dp = new Uint16Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * W + j] = sNorm[i] === tNorm[j] ? dp[(i + 1) * W + j + 1]! + 1 : Math.max(dp[(i + 1) * W + j]!, dp[i * W + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (sNorm[i] === tNorm[j] && dp[i * W + j] === dp[(i + 1) * W + j + 1]! + 1) {
        times[sIdx[i]!] = tc[j]!.t;
        i++;
        j++;
      } else if (dp[(i + 1) * W + j]! >= dp[i * W + j + 1]!) i++;
      else j++;
    }
  }
  // interpolate unmatched chars by weight between known neighbours
  const w = chars.map(jaCharWeight);
  let k = 0;
  while (k < chars.length) {
    if (!Number.isNaN(times[k]!)) {
      k++;
      continue;
    }
    let j = k;
    while (j < chars.length && Number.isNaN(times[j]!)) j++;
    const t0 = k > 0 ? times[k - 1]! : speechStart;
    const t1 = j < chars.length ? times[j]! : speechEnd;
    const from = k > 0 ? k - 1 : k;
    const total = w.slice(from, j).reduce((a, b) => a + b, 0) || 1;
    let acc = k > 0 ? w[k - 1]! : 0;
    for (let q = k; q < j; q++) {
      times[q] = t0 + ((t1 - t0) * acc) / total;
      acc += w[q]!;
    }
    k = j;
  }
  for (let q = 1; q < times.length; q++) if (times[q]! < times[q - 1]!) times[q] = times[q - 1]!;
  return times;
}

/** Flattens whisper segments into timed characters (+ speech start/end estimate). */
function flatten(segments: TimedSegment[], durationSec: number): { tc: { ch: string; t: number }[]; start: number; end: number } {
  const tc: { ch: string; t: number }[] = [];
  for (const s of segments) [...s.text].forEach((ch, i) => tc.push({ ch, t: s.charStarts[i] ?? 0 }));
  const readable = tc.filter((x) => isReadableJaChar(x.ch));
  const start = readable.length ? Math.min(readable[0]!.t, durationSec) : 0;
  const end = readable.length ? Math.min(readable[readable.length - 1]!.t + 0.3, durationSec) : durationSec;
  return { tc, start, end: Math.max(end, start) };
}

/**
 * Captions for a recorded Japanese line. `text` = the script text ("" -> use the transcript),
 * `segments` = whisper result (null = whisper failed -> proportional / none).
 */
export function buildRecordedJaCaptions(text: string, durationSec: number, segments: TimedSegment[] | null): Caption[] {
  // v4: the script may contain 【】 — timing is aligned on the stripped characters (chunkJaText indexes the same
  // [...stripEmphasis(text).trim()]), the chunk texts keep the markers
  const chars = parseEmText(text).chars;
  if (!chars.length) {
    if (!segments || !segments.length) return [];
    // transcript chars with times; whisper's spaces (often used instead of 。) and segment boundaries become breaks
    const tc: { ch: string; t: number }[] = [];
    for (const s of segments) {
      const chars = [...s.text.trim()];
      if (tc.length && !/[、。！？!?]/.test(tc[tc.length - 1]!.ch)) tc.push({ ch: "、", t: s.charStarts[0] ?? 0 });
      chars.forEach((ch, i) => {
        const t = s.charStarts[i] ?? 0;
        if (/\s/.test(ch)) {
          if (tc.length && tc[tc.length - 1]!.ch !== "、") tc.push({ ch: "、", t });
        } else if (ch !== "【" && ch !== "】") tc.push({ ch, t }); // (markers would shift chunkJaText indexes)
      });
    }
    while (tc.length && tc[tc.length - 1]!.ch === "、") tc.pop();
    const transcript = tc.map((x) => x.ch).join("");
    const chunks = chunkJaText(transcript); // indexes [...transcript] (no outer whitespace)
    return toCaptions(chunks.map((c) => ({ text: c.text, start: tc[c.first]?.t ?? 0 })), durationSec);
  }
  let times: number[];
  if (segments && segments.length) {
    const { tc, start, end } = flatten(segments, durationSec);
    times = alignJaChars(chars, tc, start, end);
  } else {
    times = proportionalTimes(chars, 0, durationSec);
  }
  return toCaptions(chunkJaText(text).map((c) => ({ text: c.text, start: times[c.first]! })), durationSec);
}

/* ------------------------------------------------------------------ */
/* Sanity checks on whisper output for recordings                       */
/* ------------------------------------------------------------------ */

const keyChars = (s: string) =>
  [...s.normalize("NFKC").toLowerCase()].map(normChar).filter((c) => /[\p{L}\p{N}]/u.test(c));

/** Fraction of the script's letters/digits/kana/kanji found (in order) in the transcript (char LCS). 1 = all. */
export function scriptMatchRatio(script: string, transcript: string): number {
  const a = keyChars(script);
  const b = keyChars(transcript);
  if (!a.length) return 1;
  if (!b.length) return 0;
  let prev = new Uint16Array(b.length + 1);
  let cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]! / a.length;
}

/** Typical whisper hallucinations on silence / noise / music (the whole transcript is one of these). */
const HALLUCINATIONS = [
  /^ご視聴ありがとうございました$/, /^ありがとうございました$/, /^チャンネル登録/, /^おやすみなさい$/, /^お疲れ様でした$/,
  /^thank you( so much)?( for watching)?$/, /^thanks for watching$/, /^you$/, /^bye$/,
];
export function isLikelyHallucination(transcript: string): boolean {
  const t = transcript.normalize("NFKC").toLowerCase().replace(/[\s、。,.!！?？…・「」"']/g, "");
  if (!t || !keyChars(transcript).length) return true; // empty or only symbols (♪~, ...)
  const spaced = transcript.normalize("NFKC").toLowerCase().replace(/[、。,.!！?？…]/g, "").trim().replace(/\s+/g, " ");
  return HALLUCINATIONS.some((re) => re.test(t) || re.test(spaced));
}
