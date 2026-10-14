import type React from "react";
import type { Lang, Project } from "@gas/shared";
import { displayFont } from "../../../common/fonts";
import { RichText } from "../../../common/RichText";
import { outline } from "../../../common/theme";
import { bigLineHeight, isLight, isReddish } from "./layout";

/* ------------------------------------------------------------------ */
/* Palettes                                                             */
/* ------------------------------------------------------------------ */

/**
 * Surface variants of bands / cards / badges:
 *  - "accent": style.accentColor gradient  - "red": classic TV-telop red (deep blue if the emphasis color is red)
 *  - "dark": near-black glass              - "light": white paper with dark ink (emphasis = highlighter marker)
 */
export type SurfaceVariant = "accent" | "red" | "dark" | "light";

export type Surface = {
  /** background gradient stops (top/left -> bottom/right) */
  a: string;
  b: string;
  /** edge / shadow color */
  edge: string;
  /** text fill */
  fg: string;
  /** text outline color ("" = no outline, e.g. on light paper) */
  ink: string;
  /** true -> emphasis runs drawn as a highlighter marker behind dark text instead of colored text */
  marker: boolean;
};

export function surface(project: Project, variant: SurfaceVariant): Surface {
  const accent = project.style.accentColor;
  switch (variant) {
    case "red":
      return isReddish(project.style.emphasisColor)
        ? { a: "#1d3bd1", b: "#0a1658", edge: "#061036", fg: "#ffffff", ink: "#020615", marker: false }
        : { a: "#e8162f", b: "#8c0517", edge: "#4a000b", fg: "#ffffff", ink: "#1a0006", marker: false };
    case "dark":
      return { a: "#171a26", b: "#07080d", edge: "#000000", fg: "#ffffff", ink: "#000000", marker: false };
    case "light":
      return { a: "#ffffff", b: "#eef0f5", edge: "#c9ccd6", fg: "#111318", ink: "", marker: true };
    case "accent":
    default:
      return isLight(accent)
        ? { a: accent, b: accent, edge: "#000000", fg: "#111318", ink: "", marker: false }
        : { a: accent, b: accent, edge: "#000000", fg: "#ffffff", ink: "#000000", marker: false };
  }
}

/* ------------------------------------------------------------------ */
/* BigText                                                              */
/* ------------------------------------------------------------------ */

/**
 * The big display type of the shorts: display font (Anton uppercase for en, Noto Sans JP Black for ja), RichText
 * (【emphasis】 in `emphasisColor`, "\n" breaks), thick outline in `ink` + drop shadow ("raw screen-record +
 * fat outlined telop" look). `ink` "" = no outline (dark text on light surfaces). `marker` = emphasis as a
 * highlighter stripe behind the text (use with light surfaces, where a yellow text color would not read).
 * Size it with fitFont() from ./layout.
 */
export const BigText: React.FC<{
  text: string;
  lang: Lang;
  fontSize: number;
  emphasisColor: string;
  color?: string;
  ink?: string;
  /** outline thickness relative to the font size (default 0.085 ja / 0.075 en) */
  stroke?: number;
  align?: "center" | "left" | "right";
  marker?: boolean;
  /** extra style for emphasis runs */
  emphasisStyle?: React.CSSProperties;
  style?: React.CSSProperties;
  /** body font (Noto 900) instead of the display font — for long sentences / small labels */
  body?: boolean;
}> = ({ text, lang, fontSize, emphasisColor, color = "#ffffff", ink = "#000000", stroke, align = "center", marker, emphasisStyle, style, body }) => {
  const font = body ? displayFont("ja") : displayFont(lang);
  const st = ink ? Math.max(2, fontSize * (stroke ?? (lang === "en" && !body ? 0.075 : 0.085))) : 0;
  const shadow = ink
    ? `${outline(st, ink)}, 0 ${st * 1.3}px 0 ${ink}, 0 ${st * 2}px ${st * 3}px rgba(0,0,0,0.6)`
    : "none";
  const emph: React.CSSProperties = marker
    ? {
        color,
        backgroundImage: `linear-gradient(transparent 58%, ${emphasisColor} 58%, ${emphasisColor} 92%, transparent 92%)`,
        padding: "0 0.06em",
        ...emphasisStyle,
      }
    : { ...emphasisStyle };
  return (
    <div
      lang={lang}
      style={{
        fontFamily: font.fontFamily,
        fontWeight: font.fontWeight,
        fontSize,
        lineHeight: body ? 1.25 : bigLineHeight(lang),
        letterSpacing: lang === "en" ? "0.01em" : "0.02em",
        textTransform: !body && font.uppercase ? "uppercase" : "none",
        color,
        textAlign: align,
        wordBreak: lang === "ja" ? "keep-all" : "normal",
        overflowWrap: "anywhere",
        textShadow: shadow,
        ...style,
      }}
    >
      <RichText text={text} lang={lang} emphasisColor={marker ? color : emphasisColor} emphasisStyle={emph} />
    </div>
  );
};
