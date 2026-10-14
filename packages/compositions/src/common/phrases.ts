/** Japanese phrase segmentation for captions: lines may only break between phrases. Pure (no React). */

const segmenter: Intl.Segmenter | null =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter("ja", { granularity: "word" }) : null;

const ATTACH_START = /^[ぁ-ゟーァィゥェォッャュョヮヵヶ、。，．,.!！?？…‥」』）)】〉》〕］\]}・ー〜~:：;；%％]/;
const STARTS_HIRAGANA = /^[ぁ-ゟ]/;
const ENDS_OPEN = /[「『（(【〈《〔［[{"“]$/;
const ENDS_BREAK = /[、。，．,.!！?？…‥」』）)】〉》〕］\]}\s]$/;
const ENDS_SPACE = /\s$/;
const MAX_PHRASE = 12;
const KATAKANA = /[゠-ヿ]/;
const KANJI = /[一-鿿㐀-䶿々]/;
const DIGIT_LATIN = /[0-9A-Za-z０-９]/;

/** The word segmenter split a run that reads as one unit (katakana word, kanji compound, number + counter). */
function sameWordRun(cur: string, seg: string): boolean {
  const a = cur.slice(-1);
  const b = seg[0] ?? "";
  if (KATAKANA.test(a) && KATAKANA.test(b)) return true;
  if (KANJI.test(a) && KANJI.test(b)) return true;
  if (DIGIT_LATIN.test(a) && KANJI.test(b)) return true;
  return false;
}

/**
 * Splits Japanese text into bunsetsu-like phrases: word segments that start with hiragana (particles,
 * okurigana, auxiliaries), small kana, the long-vowel mark or closing punctuation attach to the previous
 * phrase; opening brackets attach to the next. Lines may only break between phrases.
 */
export function jaPhrases(text: string): string[] {
  const segs = segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
  const out: string[] = [];
  let cur = "";
  for (const seg of segs) {
    if (!cur) {
      cur = seg;
      continue;
    }
    let attach: boolean;
    if (ENDS_OPEN.test(cur)) attach = true;
    else if (/^[、。，．,.!！?？…‥」』）)】〉》〕］\]}ー〜~]/.test(seg)) attach = true; // never start a line with these
    else if (/[」』）)】〉》〕］]$/.test(cur) && STARTS_HIRAGANA.test(seg) && cur.length < MAX_PHRASE) attach = true; // 「…」が
    else if (ENDS_BREAK.test(cur) || ENDS_SPACE.test(cur)) attach = false;
    else if (cur.length < MAX_PHRASE && sameWordRun(cur, seg)) attach = true; // ビル+ド, 100+種類, 種類+以上
    else if (ATTACH_START.test(seg)) attach = !(STARTS_HIRAGANA.test(seg) && cur.length >= MAX_PHRASE);
    else attach = false;
    if (attach) cur += seg;
    else {
      out.push(cur);
      cur = seg;
    }
  }
  if (cur) out.push(cur);
  return out;
}

