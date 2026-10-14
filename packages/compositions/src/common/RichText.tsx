import type React from "react";
import { parseEmphasis, type EmphasisSegment, type Lang } from "@gas/shared";
import { jaPhrases } from "./phrases";

/**
 * v4 emphasis rendering (ARCHITECTURE §4.4): 【…】 runs are drawn in `emphasisColor` at EMPHASIS_SCALE × the
 * surrounding font size; the brackets are never shown. "\n" = line break. Japanese text keeps the caption
 * phrase wrapping (lines only break between jaPhrases() phrases; an emphasized run inside a phrase stays in it).
 * Text without 【】 renders exactly the same DOM as before v4.
 */
export const EMPHASIS_SCALE = 1.15;

/** Lines (split at \r?\n) of emphasis runs. Empty lines are kept as []. */
export function richLines(text: string): EmphasisSegment[][] {
  const lines: EmphasisSegment[][] = [[]];
  for (const seg of parseEmphasis(text)) {
    const parts = seg.text.split(/\r?\n/);
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push({ text: part, emph: seg.emph });
    });
  }
  return lines;
}

/** Rough width of `text` in em (CJK = 1, others ~0.56). */
export function estimateEm(text: string): number {
  let em = 0;
  for (const ch of text) em += (ch.codePointAt(0) ?? 0) > 0x2e80 ? 1 : 0.56;
  return em;
}

/** Rough width in em of the widest line of rich `text` (emphasis runs count EMPHASIS_SCALE × wider). */
export function estimateRichEm(text: string, emphasisScale = EMPHASIS_SCALE): number {
  return Math.max(
    ...richLines(text).map((segs) => segs.reduce((a, s) => a + estimateEm(s.text) * (s.emph ? emphasisScale : 1), 0)),
    1,
  );
}

/**
 * Rough width in em of the widest unbreakable unit of rich `text` (ja: a jaPhrases() phrase, others: a word).
 * Lines can't wrap inside such a unit, so a caption must be small enough for it to fit on one line.
 * Conservative: a unit on a line with emphasis counts EMPHASIS_SCALE × wider.
 */
export function estimateWidestUnitEm(text: string, lang: Lang, emphasisScale = EMPHASIS_SCALE): number {
  let widest = 1;
  for (const segs of richLines(text)) {
    const plain = segs.map((s) => s.text).join("");
    const k = segs.some((s) => s.emph) ? emphasisScale : 1;
    const units = lang === "ja" ? jaPhrases(plain) : plain.split(/\s+/);
    for (const u of units) widest = Math.max(widest, estimateEm(u.trim()) * k);
  }
  return widest;
}

/** One Japanese line: phrases as unbreakable inline-blocks, emphasis runs as styled spans inside them. */
function jaLine(segs: EmphasisSegment[], emphStyle: React.CSSProperties): React.ReactNode {
  const plain = segs.map((s) => s.text).join("");
  const phrases = jaPhrases(plain);
  const hasEmph = segs.some((s) => s.emph);
  if (!hasEmph) {
    return phrases.map((ph, j) => (
      <span key={j} style={{ display: "inline-block", whiteSpace: "pre" }}>
        {ph}
      </span>
    ));
  }
  // char ranges of the runs
  const runs: { s: number; e: number; emph: boolean }[] = [];
  let pos = 0;
  for (const seg of segs) {
    runs.push({ s: pos, e: pos + seg.text.length, emph: seg.emph });
    pos += seg.text.length;
  }
  let ps = 0;
  return phrases.map((ph, j) => {
    const pe = ps + ph.length;
    const pieces: React.ReactNode[] = [];
    for (const r of runs) {
      const s = Math.max(ps, r.s);
      const e = Math.min(pe, r.e);
      if (s >= e) continue;
      const t = plain.slice(s, e);
      pieces.push(
        r.emph ? (
          <span key={s} style={emphStyle}>
            {t}
          </span>
        ) : (
          t
        ),
      );
    }
    ps = pe;
    return (
      <span key={j} style={{ display: "inline-block", whiteSpace: "pre" }}>
        {pieces}
      </span>
    );
  });
}

export const RichText: React.FC<{
  text: string;
  lang: Lang;
  /** CSS color of emphasis runs (project.style.emphasisColor) */
  emphasisColor: string;
  emphasisScale?: number;
  /** extra style for emphasis runs (merged over color / fontSize) */
  emphasisStyle?: React.CSSProperties;
}> = ({ text, lang, emphasisColor, emphasisScale = EMPHASIS_SCALE, emphasisStyle }) => {
  const emphStyle: React.CSSProperties = { color: emphasisColor, fontSize: `${emphasisScale}em`, ...emphasisStyle };
  return (
    <>
      {richLines(text).map((segs, i) => (
        <span key={i}>
          {i > 0 ? <br /> : null}
          {lang === "ja"
            ? jaLine(segs, emphStyle)
            : segs.map((s, j) =>
                s.emph ? (
                  <span key={j} style={emphStyle}>
                    {s.text}
                  </span>
                ) : (
                  s.text
                ),
              )}
        </span>
      ))}
    </>
  );
};
