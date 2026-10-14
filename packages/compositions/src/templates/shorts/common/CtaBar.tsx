import type React from "react";
import { Img, interpolate } from "remotion";
import type { Lang, Project } from "@gas/shared";
import { BODY_FONT, displayFont } from "../../../common/fonts";
import { assetUrl } from "../../../common/urls";
import { readableOn, withAlpha } from "../../../common/theme";
import { pop, pulse, useShortFrame } from "./anim";
import { gameTitle } from "./data";

/**
 * CTA bar (app-store style): [logo / initial] [game title + `sub` (e.g. developer handle)] [accent button `cta`].
 * - `compact` false (9:16): full-width bar, put it with `style` (position absolute + top/left/right).
 * - `compact` true (16:9 corner / loop overlay): smaller card.
 * Visible on its first frame (pops in by scale from `delay`), the button breathes and its arrows run.
 * Empty `cta` -> no button; empty `sub` -> title only.
 */
export const CtaBar: React.FC<{
  project: Project;
  lang: Lang;
  assetBaseUrl: string;
  cta: string;
  sub?: string;
  compact?: boolean;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ project, lang, assetBaseUrl, cta, sub, compact = false, delay = 0, style }) => {
  const { frame, fps, u } = useShortFrame();
  const accent = project.style.accentColor;
  const p = pop(frame, fps, delay);
  const k = compact ? 0.72 : 1;
  const icon = 104 * u * k;
  const title = gameTitle(project);
  const btnFg = readableOn(accent);
  const font = displayFont(lang);
  const arrowT = ((frame / fps) * 1.6) % 1;
  const logo = project.game.logo;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 22 * u * k,
        padding: `${18 * u * k}px ${20 * u * k}px`,
        borderRadius: 30 * u * k,
        background: "linear-gradient(180deg, rgba(28,31,44,0.94) 0%, rgba(10,11,18,0.94) 100%)",
        border: `${2 * u}px solid ${withAlpha("#ffffff", 0.14)}`,
        boxShadow: `0 ${14 * u}px ${40 * u}px rgba(0,0,0,0.55), 0 0 ${30 * u}px ${withAlpha(accent, 0.25)}`,
        transform: `translateY(${interpolate(p, [0, 1], [30 * u, 0])}px) scale(${interpolate(p, [0, 1], [0.94, 1])})`,
        ...style,
      }}
    >
      <div
        style={{
          width: icon,
          height: icon,
          flexShrink: 0,
          borderRadius: icon * 0.24,
          overflow: "hidden",
          background: `linear-gradient(150deg, ${accent} 0%, ${withAlpha(accent, 0.55)} 100%)`,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          boxShadow: `inset 0 0 0 ${2 * u}px rgba(255,255,255,0.25)`,
        }}
      >
        {logo ? (
          <Img src={assetUrl(assetBaseUrl, project.id, logo)} style={{ width: "86%", height: "86%", objectFit: "contain" }} />
        ) : (
          <div style={{ fontFamily: displayFont("en").fontFamily, fontSize: icon * 0.55, color: readableOn(accent) }}>{title.slice(0, 1).toUpperCase()}</div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 * u * k }}>
        <div
          style={{
            fontFamily: BODY_FONT,
            fontWeight: 900,
            fontSize: 36 * u * k,
            color: "#fff",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            lineHeight: 1.15,
          }}
        >
          {title}
        </div>
        {sub ? (
          <div style={{ fontFamily: BODY_FONT, fontWeight: 700, fontSize: 30 * u * k, color: withAlpha("#ffffff", 0.72), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>
            {sub}
          </div>
        ) : null}
      </div>
      {cta ? (
        <div
          style={{
            flexShrink: 0,
            maxWidth: compact ? 340 * u : 420 * u,
            display: "flex",
            alignItems: "center",
            gap: 12 * u * k,
            padding: `${16 * u * k}px ${20 * u * k}px`,
            borderRadius: 22 * u * k,
            backgroundColor: accent,
            color: btnFg,
            fontFamily: lang === "en" ? font.fontFamily : BODY_FONT,
            fontWeight: lang === "en" ? font.fontWeight : 900,
            fontSize: (lang === "en" ? 34 : 30) * u * k,
            letterSpacing: lang === "en" ? "0.04em" : "0.02em",
            textTransform: lang === "en" ? "uppercase" : "none",
            lineHeight: 1.12,
            textAlign: "center",
            transform: `scale(${pulse(frame, fps, 0.035, 1.1)})`,
            boxShadow: `0 ${6 * u}px 0 ${withAlpha("#000000", 0.45)}, 0 0 ${24 * u * pulse(frame, fps, 0.5, 1.1)}px ${withAlpha(accent, 0.7)}`,
          }}
        >
          <span>{cta}</span>
          <span style={{ display: "inline-flex", fontFamily: BODY_FONT, fontWeight: 900 }}>
            {[0, 1].map((i) => (
              <span key={i} style={{ opacity: 0.35 + 0.65 * Math.max(0, Math.sin((arrowT - i * 0.25) * Math.PI * 2)), marginLeft: -6 * u * k }}>
                ›
              </span>
            ))}
          </span>
        </div>
      ) : null}
    </div>
  );
};
