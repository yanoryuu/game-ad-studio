import { EMPHASIS_CLOSE, EMPHASIS_OPEN } from "@gas/shared";

/**
 * v4 (ARCHITECTURE §6.13): emphasis-aware text for TTS captions. Pure.
 *
 * TTS reads stripEmphasis(text); all timing alignment (mora / word / transcript) is computed on that stripped text.
 * `parseEmText` gives the stripped text as code points plus a per-character emphasis flag (same rules as
 * parseEmphasis: no nesting, stray 】 dropped, unclosed 【 runs to the end), so a caption chunk = a range of the
 * stripped characters can be turned back into markup with `decorate`: markers are re-inserted around the
 * emphasized characters of the chunk only, i.e. closed at the chunk end and reopened at the next chunk's start.
 */

export type EmText = {
  /** stripEmphasis(text).trim() as code points */
  chars: string[];
  /** emph[i] = chars[i] is inside an emphasis run */
  emph: boolean[];
};

/** Parses `text` into stripped (and trimmed) code points + emphasis flags. */
export function parseEmText(text: string): EmText {
  let chars: string[] = [];
  let emph: boolean[] = [];
  let on = false;
  for (const ch of text) {
    if (ch === EMPHASIS_OPEN) on = true; // nested 【 inside a run: dropped (stays on)
    else if (ch === EMPHASIS_CLOSE) on = false; // stray 】: dropped (stays off)
    else {
      chars.push(ch);
      emph.push(on);
    }
  }
  // trim like String.prototype.trim (\s = the same whitespace set)
  let a = 0;
  let b = chars.length;
  while (a < b && /\s/.test(chars[a]!)) a++;
  while (b > a && /\s/.test(chars[b - 1]!)) b--;
  chars = chars.slice(a, b);
  emph = emph.slice(a, b);
  return { chars, emph };
}

/** True when a break between chars[p-1] and chars[p] would cut an emphasis run. */
export function breaksRun(emph: readonly boolean[] | undefined, p: number): boolean {
  return !!emph && p > 0 && p < emph.length && !!emph[p - 1] && !!emph[p];
}

/** True when p is the start or end of an emphasis run (a natural break). */
export function atRunEdge(emph: readonly boolean[] | undefined, p: number): boolean {
  return !!emph && p > 0 && p < emph.length && !!emph[p - 1] !== !!emph[p];
}

/** Inserts 【】 around the emphasized parts of `s` (flags per UTF-16 unit); whitespace at run edges stays outside. */
function markup(units: string, flags: boolean[]): string {
  const f = flags.slice();
  // move whitespace at the edges of each run outside the markers
  let i = 0;
  while (i < f.length) {
    if (!f[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < f.length && f[j]) j++;
    for (let k = i; k < j && /\s/.test(units[k]!); k++) f[k] = false;
    for (let k = j - 1; k >= i && /\s/.test(units[k]!); k--) f[k] = false;
    i = j;
  }
  let out = "";
  let on = false;
  for (let k = 0; k < units.length; k++) {
    if (f[k] && !on) out += EMPHASIS_OPEN;
    if (!f[k] && on) out += EMPHASIS_CLOSE;
    on = !!f[k];
    out += units[k];
  }
  if (on) out += EMPHASIS_CLOSE;
  return out;
}

/**
 * Caption text for a chunk: `display` (which may only trim characters at both ends of the plain string, e.g. trailing
 * 、。) is applied to the plain text of `chars`, then the emphasis markers are put back on the kept part.
 */
export function decorate(chars: readonly string[], emph: readonly boolean[], display: (plain: string) => string): string {
  const plain = chars.join("");
  const d = display(plain);
  if (!d) return "";
  const units: boolean[] = [];
  chars.forEach((ch, i) => {
    for (let k = 0; k < ch.length; k++) units.push(!!emph[i]);
  });
  const at = plain.indexOf(d); // display only trims: the first occurrence is the kept part (d starts with non-space)
  if (at < 0) return d; // display did more than trimming: no markup (never happens with our display functions)
  return markup(d, units.slice(at, at + d.length));
}
