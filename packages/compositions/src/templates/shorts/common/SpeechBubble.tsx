import type React from "react";
import { interpolate } from "remotion";
import type { Lang, Project } from "@gas/shared";
import { BODY_FONT } from "../../../common/fonts";
import { RichText } from "../../../common/RichText";
import { pop, useShortFrame } from "./anim";

/**
 * Generic speech bubble (comment sticker / call-to-comment / dev remark): rounded box with a triangular tail,
 * RichText body in Noto Black, optional `author` line (with a colored avatar dot) above the text.
 * Pops from the tail tip (scale 0.5 -> 1, legible from its first frame). Position it with `style`.
 * `tail`: side the tail points to ("down" = bubble above its speaker); `tailAt` 0..1 along that side.
 */
export const SpeechBubble: React.FC<{
  project: Project;
  lang: Lang;
  text: string;
  author?: string;
  /** font size of the text in px (already × u) */
  fontSize: number;
  maxWidth?: number;
  bg?: string;
  fg?: string;
  /** emphasis color (default: style.accentColor on white, style.emphasisColor on dark) */
  emphasisColor?: string;
  tail?: "down" | "up" | "left" | "right" | "none";
  tailAt?: number;
  delay?: number;
  /** avatar dot color next to the author. Default accent */
  avatarColor?: string;
  style?: React.CSSProperties;
}> = ({ project, lang, text, author, fontSize, maxWidth, bg = "#ffffff", fg = "#111318", emphasisColor, tail = "down", tailAt = 0.2, delay = 0, avatarColor, style }) => {
  const { frame, fps, u } = useShortFrame();
  const p = pop(frame, fps, delay, { stiff: true });
  const t = fontSize * 0.55;
  const origin =
    tail === "down" ? `${tailAt * 100}% 100%` : tail === "up" ? `${tailAt * 100}% 0%` : tail === "left" ? `0% ${tailAt * 100}%` : tail === "right" ? `100% ${tailAt * 100}%` : "50% 50%";
  const tailStyle: React.CSSProperties = { position: "absolute", width: 0, height: 0, borderStyle: "solid" };
  if (tail === "down") Object.assign(tailStyle, { bottom: -t + 1, left: `calc(${tailAt * 100}% - ${t * 0.6}px)`, borderWidth: `${t}px ${t * 0.6}px 0 ${t * 0.6}px`, borderColor: `${bg} transparent transparent transparent` });
  if (tail === "up") Object.assign(tailStyle, { top: -t + 1, left: `calc(${tailAt * 100}% - ${t * 0.6}px)`, borderWidth: `0 ${t * 0.6}px ${t}px ${t * 0.6}px`, borderColor: `transparent transparent ${bg} transparent` });
  if (tail === "left") Object.assign(tailStyle, { left: -t + 1, top: `calc(${tailAt * 100}% - ${t * 0.6}px)`, borderWidth: `${t * 0.6}px ${t}px ${t * 0.6}px 0`, borderColor: `transparent ${bg} transparent transparent` });
  if (tail === "right") Object.assign(tailStyle, { right: -t + 1, top: `calc(${tailAt * 100}% - ${t * 0.6}px)`, borderWidth: `${t * 0.6}px 0 ${t * 0.6}px ${t}px`, borderColor: `transparent transparent transparent ${bg}` });
  const light = bg.toLowerCase() === "#ffffff" || bg.toLowerCase() === "#fff" || bg.toLowerCase() === "white";
  return (
    <div
      style={{
        position: "relative",
        maxWidth,
        padding: `${fontSize * 0.42}px ${fontSize * 0.62}px ${fontSize * 0.46}px`,
        borderRadius: fontSize * 0.55,
        backgroundColor: bg,
        color: fg,
        boxShadow: `0 ${10 * u}px ${30 * u}px rgba(0,0,0,0.45)`,
        transform: `scale(${interpolate(p, [0, 1], [0.5, 1])}) rotate(${interpolate(p, [0, 1], [-4, 0])}deg)`,
        transformOrigin: origin,
        ...style,
      }}
    >
      {tail !== "none" ? <div style={tailStyle} /> : null}
      {author ? (
        <div style={{ display: "flex", alignItems: "center", gap: fontSize * 0.25, marginBottom: fontSize * 0.18 }}>
          <div style={{ width: fontSize * 0.62, height: fontSize * 0.62, borderRadius: "50%", background: `linear-gradient(140deg, ${avatarColor ?? project.style.accentColor}, #555)`, flexShrink: 0 }} />
          <div style={{ fontFamily: BODY_FONT, fontWeight: 700, fontSize: fontSize * 0.5, opacity: 0.65, whiteSpace: "nowrap" }}>{author}</div>
        </div>
      ) : null}
      <div
        lang={lang}
        style={{
          fontFamily: BODY_FONT,
          fontWeight: 900,
          fontSize,
          lineHeight: 1.28,
          wordBreak: lang === "ja" ? "keep-all" : "normal",
          overflowWrap: "anywhere",
        }}
      >
        <RichText text={text} lang={lang} emphasisColor={emphasisColor ?? (light ? project.style.accentColor : project.style.emphasisColor)} />
      </div>
    </div>
  );
};
