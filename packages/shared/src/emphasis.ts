/**
 * v4 emphasis markup (ARCHITECTURE §4.4).
 *
 * In script lines, caption chunks, manual captions and the intro headline / points / info values, text wrapped
 * in 【 】 is an EMPHASIS span: rendered in style.emphasisColor and slightly larger, brackets never shown,
 * never read aloud (TTS synthesizes stripEmphasis(text)).
 *
 * Rules (lenient, never throws):
 *  - "【" opens emphasis, "】" closes it. Both characters are always markup (never displayed).
 *  - No nesting: a "【" inside an open emphasis is dropped; a "】" without an open emphasis is dropped.
 *  - An unclosed "【" emphasizes to the end of the text.
 *  - Newlines are kept inside the segment texts.
 */

export const EMPHASIS_OPEN = "【";
export const EMPHASIS_CLOSE = "】";

export type EmphasisSegment = { text: string; emph: boolean };

/** Splits `text` into plain / emphasized runs (markers removed, adjacent runs merged, empty runs dropped). */
export function parseEmphasis(text: string): EmphasisSegment[] {
  const out: EmphasisSegment[] = [];
  let emph = false;
  let cur = "";
  const flush = () => {
    if (!cur) return;
    const last = out[out.length - 1];
    if (last && last.emph === emph) last.text += cur;
    else out.push({ text: cur, emph });
    cur = "";
  };
  for (const ch of text) {
    if (ch === EMPHASIS_OPEN) {
      if (!emph) {
        flush();
        emph = true;
      }
    } else if (ch === EMPHASIS_CLOSE) {
      if (emph) {
        flush();
        emph = false;
      }
    } else {
      cur += ch;
    }
  }
  flush();
  return out;
}

/** `text` without emphasis markers: what TTS reads and what text-matching (whisper) compares against. */
export function stripEmphasis(text: string): string {
  return text.replace(/[【】]/g, "");
}

/** True when `text` contains at least one emphasized (non-empty) run. */
export function hasEmphasis(text: string): boolean {
  return parseEmphasis(text).some((s) => s.emph);
}

/** Preset emphasis colors offered by the UI (style.emphasisColor may be any CSS color). */
export const EMPHASIS_COLORS = {
  yellow: "#FFE14D",
  red: "#FF4B4B",
} as const;
