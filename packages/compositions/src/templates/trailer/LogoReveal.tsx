import type React from "react";
import { AbsoluteFill, Easing, Img, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format, Lang, Project } from "@gas/shared";
import { Backdrop } from "../../common/Backdrop";
import { displayFont } from "../../common/fonts";
import { assetUrl } from "../../common/urls";
import { isVertical, unitFor, withAlpha } from "../../common/theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Rising embers (deterministic). */
const Embers: React.FC<{ accent: string; count: number }> = ({ accent, count }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const u = unitFor(width, height);
  return (
    <AbsoluteFill>
      {Array.from({ length: count }, (_, i) => {
        const x0 = random(`ember-x-${i}`) * width;
        const y0 = height * (0.45 + random(`ember-y-${i}`) * 0.6);
        const speed = (0.6 + random(`ember-s-${i}`) * 1.4) * height * 0.25;
        const size = (2 + random(`ember-r-${i}`) * 5) * u;
        const t = frame / Math.max(1, durationInFrames);
        const y = y0 - speed * t;
        const x = x0 + Math.sin(frame * 0.05 + i) * 12 * u;
        const tw = 0.45 + 0.55 * Math.abs(Math.sin(frame * 0.18 + i * 1.7));
        const fade = interpolate(frame, [0, 10, durationInFrames - 8, durationInFrames], [0, 1, 1, 0], clamp);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: "50%",
              backgroundColor: i % 3 === 0 ? "#ffffff" : accent,
              boxShadow: `0 0 ${size * 3}px ${withAlpha(accent, 0.9)}`,
              opacity: tw * fade * 0.8,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/**
 * Logo reveal before the end card (LOGO_REVEAL_SEC): flare line snaps open, the logo (or the title) scales in
 * out of a hot blur with an accent glow, a light sweep runs across it, embers drift up; dips to black at the end.
 */
export const LogoReveal: React.FC<{ project: Project; format: Format; lang: Lang; assetBaseUrl: string }> = ({
  project,
  format,
  lang,
  assetBaseUrl,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const u = unitFor(width, height);
  const vertical = isVertical(format);
  const accent = project.style.accentColor;
  const f = (sec: number) => Math.max(2, Math.round(sec * fps));
  const D = durationInFrames;

  // timing (scaled to the section so it still works if LOGO_REVEAL_SEC changes)
  const flareEnd = f(0.3);
  const logoIn = f(0.12);
  const logoSettle = logoIn + f(0.75);
  const sweepFrom = Math.min(D - 2, logoIn + f(0.55));
  const sweepTo = Math.min(D - 1, sweepFrom + f(0.6));

  const flareW = interpolate(frame, [0, flareEnd], [0, 1], { ...clamp, easing: Easing.out(Easing.exp) });
  const flareA = interpolate(frame, [0, f(0.05), f(0.9)], [0, 1, 0.15], clamp);
  const flash = interpolate(frame, [logoIn, logoIn + f(0.18)], [0.6, 0], clamp) * (frame >= logoIn ? 1 : 0);

  const inP = interpolate(frame, [logoIn, logoSettle], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const scale = interpolate(inP, [0, 1], [1.35, 1]) * interpolate(frame, [logoSettle, D], [1, 1.035], clamp);
  const blur = (1 - inP) * 22 * u;
  const bright = 1 + (1 - inP) * 2.2;
  const opacity = interpolate(frame, [logoIn, logoIn + f(0.2)], [0, 1], clamp);
  const glow = interpolate(frame, [logoIn, logoSettle, D], [1, 0.55, 0.75], clamp);
  const sweep = interpolate(frame, [sweepFrom, sweepTo], [-30, 130], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const sweepOn = frame >= sweepFrom && frame <= sweepTo;
  const dip = interpolate(frame, [D - f(0.2), D], [0, 1], clamp);
  const haze = interpolate(frame, [0, logoSettle], [0, 1], clamp);

  const boxW = vertical ? width * 0.84 : 1100 * u;
  const boxH = vertical ? 460 * u : 400 * u;
  const mask = `linear-gradient(105deg, rgba(0,0,0,0) ${sweep - 14}%, rgba(0,0,0,1) ${sweep}%, rgba(0,0,0,0) ${sweep + 14}%)`;
  const glowFilter = `drop-shadow(0 0 ${(28 * glow * u).toFixed(1)}px ${withAlpha(accent, 0.75)}) drop-shadow(0 0 ${(80 * glow * u).toFixed(1)}px ${withAlpha(accent, 0.35)})`;

  const { logo } = project.game;
  const title = project.game.title.trim() || project.name;
  const font = displayFont(lang);

  const content = (extra: React.CSSProperties) => {
    if (logo) {
      return (
        <Img
          src={assetUrl(assetBaseUrl, project.id, logo)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", ...extra }}
        />
      );
    }
    const text = font.uppercase ? title.toUpperCase() : title;
    let em = 0;
    for (const ch of text) em += ((ch.codePointAt(0) ?? 0) > 0x2e80 ? 1 : lang === "en" ? 0.5 : 0.6) + 0.12;
    const fontSize = Math.min((lang === "en" ? 210 : 160) * u, boxW / Math.max(1, em), boxH * 0.8);
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontFamily: font.fontFamily,
          fontWeight: font.fontWeight,
          fontSize,
          letterSpacing: "0.12em",
          paddingLeft: "0.12em",
          color: project.style.primaryColor,
          textAlign: "center",
          whiteSpace: "nowrap",
          ...extra,
        }}
      >
        {text}
      </div>
    );
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      <AbsoluteFill style={{ opacity: 0.55 * haze }}>
        <Backdrop project={project} assetBaseUrl={assetBaseUrl} blurPx={18} brightness={0.32} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse ${vertical ? "80% 35%" : "55% 45%"} at 50% 50%, ${withAlpha(accent, 0.22 * haze)} 0%, rgba(0,0,0,0) 65%), radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%)`,
        }}
      />
      <Embers accent={accent} count={vertical ? 34 : 40} />
      {/* anamorphic flare line */}
      <div
        style={{
          position: "absolute",
          left: width * (0.5 - 0.5 * flareW),
          width: width * flareW,
          top: height / 2 - 2 * u,
          height: 4 * u,
          background: `linear-gradient(90deg, rgba(255,255,255,0) 0%, ${withAlpha(accent, 0.85)} 25%, #ffffff 50%, ${withAlpha(accent, 0.85)} 75%, rgba(255,255,255,0) 100%)`,
          boxShadow: `0 0 ${40 * u}px ${16 * u}px ${withAlpha(accent, 0.3)}`,
          opacity: flareA,
        }}
      />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            position: "relative",
            width: boxW,
            height: boxH,
            transform: `scale(${scale.toFixed(4)})`,
            opacity,
          }}
        >
          {content({ filter: `blur(${blur.toFixed(2)}px) brightness(${bright.toFixed(3)}) ${glowFilter}` })}
          {sweepOn
            ? content({
                filter: "brightness(2.6) saturate(0.4)",
                WebkitMaskImage: mask,
                maskImage: mask,
                mixBlendMode: "screen",
                textShadow: "none",
              })
            : null}
        </div>
      </AbsoluteFill>
      {flash > 0.01 ? <AbsoluteFill style={{ backgroundColor: "white", opacity: flash, mixBlendMode: "screen" }} /> : null}
      {dip > 0.01 ? <AbsoluteFill style={{ backgroundColor: "black", opacity: dip }} /> : null}
    </AbsoluteFill>
  );
};
