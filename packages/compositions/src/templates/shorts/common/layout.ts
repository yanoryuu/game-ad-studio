import type { Format, Lang, Project } from "@gas/shared";
import { estimateRichEm, richLines } from "../../../common/RichText";

/**
 * Geometry for the short-form templates. All numbers are 1080-based reference px (multiply by `u` =
 * unitFor(width, height); for 9:16 u = 1, for 16:9 u = 1 as well since the short side is 1080).
 */

/** 9:16 (1080×1920) zones of the default "band / strip / captions" layout (= intro §5.8, blur-mode video position). */
export const V916 = {
  width: 1080,
  height: 1920,
  /** top text band [0, bandH) */
  bandH: 656,
  /** centered 16:9 gameplay strip [stripTop, stripTop + stripH) */
  stripTop: 656,
  stripH: 608,
  stripBottom: 1264,
} as const;

/**
 * 9:16 safe zone of TikTok / Reels / Shorts UI (§5.10): keep important text out of the top ~200px, the bottom
 * ~420px, and the right ~120px below y = 840.
 */
export const SAFE916 = { top: 200, bottom: 420, right: 120, rightFromY: 840 } as const;

/** Where the gameplay goes: 16:9 full frame / 9:16 centered strip / 9:16 full-bleed (style.vertical.mode "crop"). */
export type GameLayout = "full16" | "strip" | "full";

/**
 * Default layout decision: 16:9 -> "full16"; 9:16 -> "full" when style.vertical.mode is "crop", else "strip".
 * Pass `force` to pin a 9:16 layout regardless of the project's mode.
 */
export function gameLayout(project: Project, format: Format, force?: "strip" | "full"): GameLayout {
  if (format !== "9:16") return "full16";
  if (force) return force;
  return project.style.vertical.mode === "crop" ? "full" : "strip";
}

/** Line count of rich text (explicit "\n" only). */
export const lineCount = (text: string) => Math.max(1, richLines(text).length);

/** Display-font width factor: Anton (en, uppercase, condensed) is narrower than the em estimate. */
export const charWidth = (lang: Lang) => (lang === "en" ? 0.82 : 1);

/** Line height used by BigText */
export const bigLineHeight = (lang: Lang) => (lang === "en" ? 1.04 : 1.16);

/**
 * Largest font size <= `base` (>= base * minRatio) so that rich `text` fits `maxWidth` per explicit line and,
 * when given, `maxHeight` for all its lines (BigText line height). Estimates only (no DOM measuring).
 */
export function fitFont(text: string, lang: Lang, o: { base: number; maxWidth: number; maxHeight?: number; minRatio?: number }): number {
  // +7%: letter-spacing, marker padding and estimate error (an overflowing line would wrap)
  const em = estimateRichEm(text) * charWidth(lang) * 1.07;
  let size = Math.min(o.base, o.maxWidth / Math.max(1, em));
  if (o.maxHeight) size = Math.min(size, o.maxHeight / (lineCount(text) * bigLineHeight(lang) * 1.08));
  return Math.max(o.base * (o.minRatio ?? 0.35), size);
}

/** Estimated rendered width (px) of rich `text` at `fontSize`. */
export const textWidth = (text: string, lang: Lang, fontSize: number) => estimateRichEm(text) * charWidth(lang) * fontSize;

/** Estimated rendered height (px) of rich `text` at `fontSize` (BigText line height). */
export const textHeight = (text: string, lang: Lang, fontSize: number) => lineCount(text) * bigLineHeight(lang) * 1.08 * fontSize;

/** true if a "#rrggbb" color is clearly red */
export function isReddish(color: string): boolean {
  const m = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return false;
  const v = parseInt(m[1]!, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return r > 150 && g < 120 && b < 140;
}

/** true if a "#rgb"/"#rrggbb" color is light (luminance > 0.55) */
export function isLight(color: string): boolean {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return false;
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const v = parseInt(h, 16);
  const lum = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return lum > 0.55;
}
