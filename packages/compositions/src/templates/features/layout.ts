import type { Format, Lang, Project } from "@gas/shared";
import { isVertical } from "../../common/theme";

/**
 * Where the features template puts its big text (ARCHITECTURE §5.7):
 *  - "h":     16:9, full-bleed footage
 *  - "vblur": 9:16 blur mode — the 16:9 footage is a strip in the middle; text lives in the empty top band
 *  - "vcrop": 9:16 crop mode — full-bleed footage; text is outlined, avoids the top safe area and bottom 16%
 */
export type FeatLayout = "h" | "vblur" | "vcrop";

export function layoutOf(project: Project, format: Format): FeatLayout {
  if (!isVertical(format)) return "h";
  return project.style.vertical.mode === "crop" ? "vcrop" : "vblur";
}

/** Top/bottom of the centered 16:9 footage strip in 9:16 blur mode (px). */
export function stripBounds(width: number, height: number): { top: number; bottom: number } {
  const h = (width * 9) / 16;
  return { top: (height - h) / 2, bottom: (height + h) / 2 };
}

/** Rough width of `text` in em for the font used (CJK = 1; Anton is condensed). */
export function estimateEm(text: string, display: boolean, lang: Lang): number {
  let em = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0x2e80) em += 1;
    else if (ch === " ") em += 0.28;
    else em += display && lang === "en" ? 0.5 : 0.6;
  }
  return em;
}

/** Font size that fits `text` into `maxWidth` on at most `maxLines` lines, between base*minRatio and base. */
export function fitFontSize(text: string, base: number, maxWidth: number, opts: { display: boolean; lang: Lang; maxLines?: number; minRatio?: number }): number {
  const lines = text.split(/\r?\n/);
  const em = Math.max(1, ...lines.map((l) => estimateEm(l, opts.display, opts.lang)));
  const perLine = (maxWidth * (opts.maxLines ?? 1)) / em;
  return Math.max(base * (opts.minRatio ?? 0.5), Math.min(base, perLine * 0.97));
}

/** "魅力①" / "FEATURE 01" */
export function featureBadge(index: number, lang: Lang): string {
  if (lang === "ja") {
    const circled = "①②③④⑤⑥⑦⑧⑨⑩";
    return `魅力${circled[index] ?? String(index + 1)}`;
  }
  return `FEATURE ${String(index + 1).padStart(2, "0")}`;
}

export const twoDigits = (index: number) => String(index + 1).padStart(2, "0");
