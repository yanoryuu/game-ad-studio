import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Lang } from "@gas/shared";
import { BODY_FONT, displayFont } from "../../common/fonts";
import { RichText } from "../../common/RichText";
import { outline, readableOn, unitFor, withAlpha } from "../../common/theme";
import type { IntroInfoRow } from "./timeline";
import { fitRich, V } from "./layout";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * Game info card (ジャンル / 価格 / 対応機種 / 発売日 …). Lives in a <Sequence> = its display window.
 * 9:16: slides in from the right over the right part of the 16:9 gameplay strip. 16:9: right-side panel.
 * Rows stagger in; the card slides out during its last frames.
 */
export const InfoCard: React.FC<{
  rows: IntroInfoRow[];
  lang: Lang;
  vertical: boolean;
  accent: string;
  emphasisColor: string;
  durationInFrames: number;
}> = ({ rows, lang, vertical, accent, emphasisColor, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = unitFor(width, height);
  const inS = spring({ frame, fps, config: { damping: 15, stiffness: 240, mass: 0.7 } });
  const outLen = Math.min(Math.round(fps * 0.22), Math.floor(durationInFrames / 3));
  const out = interpolate(frame, [durationInFrames - outLen, durationInFrames], [0, 1], clamp);
  const en = displayFont("en");
  const fg = readableOn(accent);

  const cardW = (vertical ? 600 : 560) * u;
  const header = lang === "ja" ? "ゲーム情報" : "GAME INFO";
  const headerH = (vertical ? 54 : 58) * u;
  const availRows = vertical ? 310 * u : height * 0.5;
  const rowH = Math.min((vertical ? 76 : 88) * u, availRows / Math.max(1, rows.length));
  const labelW = (lang === "ja" ? 200 : 210) * u;
  const valueMax = cardW - labelW - 56 * u;

  const pos: React.CSSProperties = vertical
    ? { right: 22 * u, top: (V.stripTop + 26) * u }
    : { right: 48 * u, top: height * 0.27 };

  return (
    <div
      style={{
        position: "absolute",
        ...pos,
        width: cardW,
        transform: `translateX(${interpolate(inS, [0, 1], [cardW + 60 * u, 0]) + out * (cardW + 60 * u)}px) skewX(${interpolate(inS, [0, 1], [-8, 0])}deg)`,
        filter: `drop-shadow(0 ${14 * u}px ${26 * u}px rgba(0,0,0,0.6))`,
      }}
    >
      {/* header ribbon */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14 * u,
          height: headerH,
          padding: `0 ${26 * u}px`,
          backgroundColor: accent,
          color: fg,
          fontFamily: lang === "en" ? en.fontFamily : BODY_FONT,
          fontWeight: lang === "en" ? en.fontWeight : 900,
          fontSize: (lang === "en" ? 38 : 34) * u,
          letterSpacing: lang === "en" ? "0.14em" : "0.1em",
          clipPath: `polygon(0 0, 100% 0, calc(100% - ${26 * u}px) 100%, 0 100%)`,
          width: "72%",
        }}
      >
        <svg width={30 * u} height={30 * u} viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke={fg} strokeWidth="2.4" />
          <path d="M7 10h6M7 14h10" stroke={fg} strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        {header}
      </div>
      <div
        style={{
          backgroundColor: "rgba(8,10,20,0.9)",
          borderLeft: `${8 * u}px solid ${accent}`,
          borderBottom: `${3 * u}px solid ${withAlpha(accent, 0.6)}`,
          padding: `${12 * u}px ${18 * u}px ${12 * u}px ${18 * u}px`,
        }}
      >
        {rows.map((r, i) => {
          const s = spring({ frame: frame - 3 - i * 2, fps, config: { damping: 16, stiffness: 260, mass: 0.6 } });
          const valueSize = fitRich(r.value, (vertical ? 42 : 46) * u, valueMax, 0.5);
          return (
            <div
              key={r.id}
              style={{
                display: "flex",
                alignItems: "center",
                height: rowH,
                gap: 18 * u,
                borderTop: i > 0 ? `${2 * u}px solid rgba(255,255,255,0.1)` : "none",
                opacity: interpolate(s, [0, 0.4], [0, 1], clamp),
                transform: `translateX(${interpolate(s, [0, 1], [50 * u, 0])}px)`,
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: labelW,
                  textAlign: "center",
                  padding: `${6 * u}px 0`,
                  borderRadius: 8 * u,
                  backgroundColor: withAlpha(accent, 0.16),
                  border: `${2 * u}px solid ${withAlpha(accent, 0.75)}`,
                  color: accent,
                  fontFamily: BODY_FONT,
                  fontWeight: 900,
                  fontSize: fitRich(r.label, (lang === "ja" ? 30 : 28) * u, labelW - 16 * u, 0.6),
                  letterSpacing: "0.04em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
              >
                {r.label}
              </div>
              <div
                lang={lang}
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: "#fff",
                  fontFamily: BODY_FONT,
                  fontWeight: 900,
                  fontSize: valueSize,
                  lineHeight: 1.1,
                  whiteSpace: "nowrap",
                  textShadow: outline(Math.max(2, valueSize * 0.06), "rgba(0,0,0,0.9)"),
                }}
              >
                <RichText text={r.value} lang={lang} emphasisColor={emphasisColor} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
