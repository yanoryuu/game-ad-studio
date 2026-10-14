import type { Lang } from "@gas/shared";
import { estimateRichEm, richLines } from "../../common/RichText";

/** 9:16 geometry (1080×1920 reference px, ARCHITECTURE §5.8) */
export const V = {
  bandH: 656,
  safeTop: 120,
  stripTop: 656,
  stripH: 608,
  stripBottom: 1264,
} as const;

/** Points badge label: ja おすすめ① … / en POINT 1 … */
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];
export function pointLabel(n: number, lang: Lang): { prefix: string; num: string } {
  if (lang === "ja") return { prefix: "おすすめ", num: CIRCLED[n - 1] ?? String(n) };
  return { prefix: "POINT", num: String(n) };
}

/**
 * Largest font size <= `base` (and >= base*minRatio) so that rich `text` fits `maxWidth` per explicit line.
 * `charW` scales the em estimate (e.g. ~0.9 for a condensed latin display font).
 */
export function fitRich(text: string, base: number, maxWidth: number, minRatio = 0.4, charW = 1): number {
  const em = estimateRichEm(text) * charW;
  return Math.max(base * minRatio, Math.min(base, maxWidth / Math.max(1, em)));
}

export const lineCount = (text: string) => Math.max(1, richLines(text).length);

/** Readable "#rrggbb" -> hue-ish check: true if the color is clearly red (so a red band would swallow it). */
export function isReddish(color: string): boolean {
  const m = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return false;
  const v = parseInt(m[1]!, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return r > 150 && g < 120 && b < 140;
}

/** Headline band palette: red (classic telop) unless the emphasis color is red itself -> deep blue. */
export function bandPalette(emphasisColor: string): { a: string; b: string; edge: string; ink: string } {
  if (isReddish(emphasisColor)) return { a: "#1d3bd1", b: "#0a1658", edge: "#061036", ink: "#020615" };
  return { a: "#e8162f", b: "#8c0517", edge: "#4a000b", ink: "#1a0006" };
}
