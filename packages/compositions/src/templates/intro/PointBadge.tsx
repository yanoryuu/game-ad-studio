import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Lang } from "@gas/shared";
import { BODY_FONT, displayFont } from "../../common/fonts";
import { RichText } from "../../common/RichText";
import { outline, readableOn, unitFor } from "../../common/theme";
import { fitRich, pointLabel, V } from "./layout";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * Numbered recommended point (おすすめ① / POINT 1 + text). Lives in a <Sequence> = its display window.
 * 9:16: ribbon along the bottom edge of the gameplay strip (captions own the band below). 16:9: left side,
 * under the headline banner.
 */
export const PointBadge: React.FC<{
  number: number;
  text: string;
  lang: Lang;
  vertical: boolean;
  accent: string;
  emphasisColor: string;
  durationInFrames: number;
}> = ({ number, text, lang, vertical, accent, emphasisColor, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = unitFor(width, height);
  const badgeIn = spring({ frame, fps, config: { damping: 11, stiffness: 300, mass: 0.6 } });
  const textIn = spring({ frame: frame - 3, fps, config: { damping: 16, stiffness: 240, mass: 0.6 } });
  const outLen = Math.min(Math.round(fps * 0.18), Math.floor(durationInFrames / 3));
  const out = interpolate(frame, [durationInFrames - outLen, durationInFrames], [0, 1], clamp);
  const en = displayFont("en");
  const fg = readableOn(accent);
  const label = pointLabel(number, lang);

  const badgeSize = (vertical ? 40 : 34) * u;
  const numSize = badgeSize * (lang === "ja" ? 1.35 : 1.25);
  const textBase = (vertical ? 62 : 54) * u;
  const textMax = vertical ? width - 120 * u : width * 0.48;
  const textSize = fitRich(text, textBase, textMax, 0.5);

  const pos: React.CSSProperties = vertical
    ? { left: 26 * u, bottom: height - (V.stripBottom - 22) * u }
    : { left: 44 * u, top: height * 0.22 + 52 * u };

  return (
    <div
      style={{
        position: "absolute",
        ...pos,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8 * u,
        opacity: 1 - out,
        transform: `translateX(${-out * 80 * u}px)`,
      }}
    >
      {/* badge: おすすめ① / POINT 1 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10 * u,
          padding: `${4 * u}px ${24 * u}px ${6 * u}px ${18 * u}px`,
          backgroundColor: accent,
          color: fg,
          transform: `skewX(-12deg) scale(${interpolate(badgeIn, [0, 1], [0.3, 1])}) rotate(${interpolate(badgeIn, [0, 1], [-10, -2])}deg)`,
          transformOrigin: "left center",
          boxShadow: `${5 * u}px ${5 * u}px 0 rgba(0,0,0,0.75)`,
          border: `${3 * u}px solid #fff`,
        }}
      >
        <div
          style={{
            transform: "skewX(12deg)",
            display: "flex",
            alignItems: "baseline",
            gap: 8 * u,
            fontFamily: lang === "en" ? en.fontFamily : BODY_FONT,
            fontWeight: lang === "en" ? en.fontWeight : 900,
            letterSpacing: lang === "en" ? "0.1em" : "0.04em",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: badgeSize }}>{label.prefix}</span>
          <span style={{ fontSize: numSize, lineHeight: 1 }}>{label.num}</span>
        </div>
      </div>
      {/* point text */}
      <div
        lang={lang}
        style={{
          maxWidth: textMax + 60 * u,
          padding: `${8 * u}px ${26 * u}px ${10 * u}px ${22 * u}px`,
          background: "linear-gradient(90deg, rgba(5,6,12,0.86) 0%, rgba(5,6,12,0.7) 75%, rgba(5,6,12,0) 100%)",
          borderLeft: `${8 * u}px solid ${accent}`,
          clipPath: `inset(0 ${(1 - textIn) * 100}% 0 0)`,
          fontFamily: BODY_FONT,
          fontWeight: 900,
          fontSize: textSize,
          lineHeight: 1.15,
          color: "#fff",
          whiteSpace: "nowrap",
          textShadow: `${outline(Math.max(2, textSize * 0.07), "#000")}`,
        }}
      >
        <RichText text={text} lang={lang} emphasisColor={emphasisColor} />
      </div>
    </div>
  );
};
