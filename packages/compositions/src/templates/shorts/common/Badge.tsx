import type React from "react";
import { interpolate } from "remotion";
import type { Lang } from "@gas/shared";
import { BODY_FONT, displayFont } from "../../../common/fonts";
import { readableOn } from "../../../common/theme";
import { pop, useShortFrame } from "./anim";

/**
 * Small label / badge: "skew" (slanted telop tag), "pill" (rounded), "tag" (square with white keyline),
 * "rec" (red dot + text, screen-recording look). `size` = font size in px (already × u). Pops in at `delay`
 * (scale only — legible from its first frame). Plain text only (labels, numbers, handles); use BigText for rich.
 */
export const Badge: React.FC<{
  text: string;
  lang: Lang;
  size: number;
  bg?: string;
  fg?: string;
  variant?: "skew" | "pill" | "tag" | "rec";
  /** display font (Anton for en) instead of Noto Black. Default true */
  display?: boolean;
  /** element before the text (icon, dot) */
  icon?: React.ReactNode;
  delay?: number;
  rotate?: number;
  style?: React.CSSProperties;
}> = ({ text, lang, size, bg = "#ffffff", fg, variant = "skew", display = true, icon, delay = 0, rotate = variant === "skew" ? -3 : 0, style }) => {
  const { frame, fps } = useShortFrame();
  const p = pop(frame, fps, delay, { stiff: true });
  const font = display ? displayFont(lang) : { fontFamily: BODY_FONT, fontWeight: 900, uppercase: false };
  const color = fg ?? readableOn(bg);
  const skew = variant === "skew" ? -10 : 0;
  const blink = 0.45 + 0.55 * Math.abs(Math.sin((frame / fps) * Math.PI * 1.4));
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.32,
        alignSelf: "center",
        backgroundColor: variant === "rec" ? "rgba(0,0,0,0.55)" : bg,
        color: variant === "rec" ? "#ffffff" : color,
        padding: `${size * 0.14}px ${size * 0.5}px ${size * 0.16}px`,
        borderRadius: variant === "pill" || variant === "rec" ? size * 2 : variant === "tag" ? size * 0.12 : 0,
        fontFamily: font.fontFamily,
        fontWeight: font.fontWeight,
        fontSize: size,
        lineHeight: 1.08,
        letterSpacing: lang === "en" || display ? "0.08em" : "0.04em",
        textTransform: font.uppercase ? "uppercase" : "none",
        whiteSpace: "nowrap",
        transform: `rotate(${rotate}deg) skewX(${skew}deg) scale(${interpolate(p, [0, 1], [0.6, 1])})`,
        boxShadow:
          variant === "tag"
            ? `0 0 0 ${Math.max(2, size * 0.07)}px #fff, 0 ${size * 0.12}px 0 rgba(0,0,0,0.5)`
            : variant === "rec"
              ? "none"
              : `0 ${size * 0.12}px 0 rgba(0,0,0,0.5)`,
        ...style,
      }}
    >
      {variant === "rec" ? (
        <div style={{ width: size * 0.5, height: size * 0.5, borderRadius: "50%", backgroundColor: "#ff2a2a", opacity: blink, boxShadow: `0 0 ${size * 0.35}px #ff2a2a` }} />
      ) : null}
      {icon ? <div style={{ transform: `skewX(${-skew}deg)`, display: "flex" }}>{icon}</div> : null}
      <div style={{ transform: `skewX(${-skew}deg)` }}>{text}</div>
    </div>
  );
};
