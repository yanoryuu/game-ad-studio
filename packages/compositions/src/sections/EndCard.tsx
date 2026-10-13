import type React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format, Lang, Project } from "@gas/shared";
import { Backdrop } from "../Backdrop";
import { assetUrl } from "../urls";
import { BODY_FONT, displayFont } from "../fonts";
import { isVertical, readableOn, unitFor, withAlpha } from "../theme";

function useEntrance(delay: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 180, mass: 0.8 } });
  const opacity = interpolate(frame - delay, [0, 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return { s, opacity };
}

const TitleBlock: React.FC<{ project: Project; lang: Lang; format: Format; assetBaseUrl: string }> = ({
  project,
  lang,
  format,
  assetBaseUrl,
}) => {
  const { width, height } = useVideoConfig();
  const u = unitFor(width, height);
  const { s, opacity } = useEntrance(0);
  const scale = interpolate(s, [0, 1], [1.35, 1]);
  const vertical = isVertical(format);
  const { logo } = project.game;
  const title = project.game.title.trim() || project.name;

  if (logo) {
    return (
      <Img
        src={assetUrl(assetBaseUrl, project.id, logo)}
        style={{
          maxWidth: vertical ? width * 0.82 : 1000 * u,
          maxHeight: vertical ? 420 * u : 360 * u,
          objectFit: "contain",
          opacity,
          transform: `scale(${scale})`,
          filter: "drop-shadow(0 10px 30px rgba(0,0,0,0.7))",
        }}
      />
    );
  }
  const font = displayFont(lang);
  const text = font.uppercase ? title.toUpperCase() : title;
  let em = 0;
  for (const ch of text) em += (ch.codePointAt(0) ?? 0) > 0x2e80 ? 1 : lang === "en" ? 0.5 : 0.6;
  const maxW = width * (vertical ? 0.86 : 0.78);
  const fontSize = Math.max(56 * u, Math.min((lang === "en" ? 200 : 150) * u, maxW / Math.max(1, em)));
  return (
    <div
      style={{
        fontFamily: font.fontFamily,
        fontWeight: font.fontWeight,
        fontSize,
        lineHeight: 1.1,
        color: project.style.primaryColor,
        textAlign: "center",
        maxWidth: maxW,
        opacity,
        transform: `scale(${scale})`,
        textShadow: `0 ${8 * u}px ${40 * u}px rgba(0,0,0,0.8), 0 0 ${60 * u}px ${withAlpha(project.style.accentColor, 0.35)}`,
        letterSpacing: lang === "en" ? "0.02em" : "0.04em",
      }}
    >
      {text}
    </div>
  );
};

const CtaButton: React.FC<{ text: string; accent: string; delay: number }> = ({ text, accent, delay }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = unitFor(width, height);
  const { s, opacity } = useEntrance(delay);
  const pop = interpolate(s, [0, 1], [0.6, 1]);
  const settle = frame - delay - Math.round(fps * 0.6);
  const pulse = settle > 0 ? 1 + 0.035 * Math.sin((settle / fps) * Math.PI * 2 * 1.2) : 1;
  // light sweep across the button
  const sweep = interpolate(frame - delay, [fps * 0.4, fps * 1.1], [-40, 140], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fg = readableOn(accent);
  // shrink long CTAs so the button always fits the frame width
  let em = 0;
  for (const ch of text) em += (ch.codePointAt(0) ?? 0) > 0x2e80 ? 1 : 0.55;
  const maxTextW = width * 0.82 - 200 * u;
  const fontSize = Math.max(30 * u, Math.min(58 * u, maxTextW / Math.max(1, em)));
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        opacity,
        transform: `scale(${pop * pulse})`,
        display: "flex",
        alignItems: "center",
        gap: 22 * u,
        padding: `${26 * u}px ${64 * u}px`,
        borderRadius: 18 * u,
        background: `linear-gradient(180deg, ${accent} 0%, ${withAlpha(accent, 0.82)} 100%)`,
        boxShadow: `0 ${16 * u}px ${50 * u}px rgba(0,0,0,0.55), 0 0 ${70 * u}px ${withAlpha(accent, 0.45)}, inset 0 ${2 * u}px 0 rgba(255,255,255,0.45)`,
      }}
    >
      <svg width={46 * u} height={46 * u} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        <path d="M12 21s-7.5-4.6-9.6-9.1C.9 8.7 2.9 4.5 6.7 4.5c2.2 0 3.6 1.2 4.3 2.4h2c.7-1.2 2.1-2.4 4.3-2.4 3.8 0 5.8 4.2 4.3 7.4C19.5 16.4 12 21 12 21z" fill={fg} />
      </svg>
      <div style={{ fontFamily: BODY_FONT, fontWeight: 900, fontSize, color: fg, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
        {text}
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${sweep}%`,
          width: "25%",
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)",
          transform: "skewX(-20deg)",
        }}
      />
    </div>
  );
};

const PlatformRow: React.FC<{ platforms: string[]; delay: number }> = ({ platforms, delay }) => {
  const { width, height } = useVideoConfig();
  const u = unitFor(width, height);
  const { s, opacity } = useEntrance(delay);
  const y = interpolate(s, [0, 1], [30 * u, 0]);
  const list = platforms.map((p) => p.trim()).filter(Boolean);
  const shown = list.length > 0 ? list : ["Steam"];
  return (
    <div style={{ display: "flex", gap: 18 * u, opacity, transform: `translateY(${y}px)`, flexWrap: "wrap", justifyContent: "center" }}>
      {shown.map((p) => (
        <div
          key={p}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12 * u,
            padding: `${10 * u}px ${28 * u}px`,
            borderRadius: 999,
            backgroundColor: "rgba(10,14,24,0.72)",
            border: `${2 * u}px solid rgba(255,255,255,0.28)`,
            fontFamily: BODY_FONT,
            fontWeight: 700,
            fontSize: 32 * u,
            color: "white",
            letterSpacing: "0.12em",
          }}
        >
          {p.toLowerCase() === "steam" ? (
            <svg width={30 * u} height={30 * u} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="11" fill="none" stroke="white" strokeWidth="2" />
              <circle cx="15" cy="9.5" r="3.2" fill="none" stroke="white" strokeWidth="2" />
              <circle cx="8.5" cy="15.5" r="2.2" fill="white" />
              <path d="M8.5 15.5 L13 11" stroke="white" strokeWidth="2" />
            </svg>
          ) : null}
          {p.toUpperCase()}
        </div>
      ))}
    </div>
  );
};

export const EndCard: React.FC<{
  project: Project;
  format: Format;
  lang: Lang;
  assetBaseUrl: string;
}> = ({ project, format, lang, assetBaseUrl }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = unitFor(width, height);
  const flash = interpolate(frame, [0, Math.round(fps * 0.2)], [0.7, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const release = project.game.releaseText.trim();
  const cta = project.texts[lang].cta.trim();
  const rel = useEntrance(7);

  return (
    <AbsoluteFill style={{ backgroundColor: "#05060a" }}>
      <Backdrop project={project} assetBaseUrl={assetBaseUrl} blurPx={14} brightness={0.45} />
      <AbsoluteFill
        style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.65) 100%)" }}
      />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: (isVertical(format) ? 56 : 40) * u,
          padding: 60 * u,
        }}
      >
        <TitleBlock project={project} lang={lang} format={format} assetBaseUrl={assetBaseUrl} />
        {release ? (
          <div
            style={{
              fontFamily: BODY_FONT,
              fontWeight: 700,
              fontSize: 46 * u,
              color: "white",
              letterSpacing: "0.08em",
              textAlign: "center",
              opacity: rel.opacity,
              transform: `translateY(${interpolate(rel.s, [0, 1], [24 * u, 0])}px)`,
              textShadow: "0 4px 18px rgba(0,0,0,0.8)",
            }}
          >
            {release}
          </div>
        ) : null}
        {cta ? <CtaButton text={cta} accent={project.style.accentColor} delay={13} /> : null}
        <PlatformRow platforms={project.game.platforms} delay={20} />
      </AbsoluteFill>
      {flash > 0 ? <AbsoluteFill style={{ backgroundColor: "white", opacity: flash }} /> : null}
    </AbsoluteFill>
  );
};
