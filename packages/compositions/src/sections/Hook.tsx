import type React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format, Lang, Project } from "@gas/shared";
import type { TimelineSection } from "../timeline";
import { ClipTrack } from "../ClipTrack";
import { Backdrop } from "../Backdrop";
import { displayFont } from "../fonts";
import { isVertical, readableOn, unitFor } from "../theme";

/** Rough per-character width (in em) used to auto-fit the hook text. */
function estimateEm(text: string, lang: Lang): number {
  let em = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0x2e80) em += 1; // CJK / kana: full width
    else em += lang === "en" ? 0.5 : 0.6;
  }
  return em;
}

const HookText: React.FC<{ text: string; lang: Lang; format: Format; accent: string }> = ({ text, lang, format, accent }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const u = unitFor(width, height);
  const font = displayFont(lang);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (font.uppercase ? l.toUpperCase() : l));
  if (lines.length === 0) return null;

  const maxWidth = width * (isVertical(format) ? 0.86 : 0.8);
  const base = (lang === "en" ? 190 : 140) * u;
  const widest = Math.max(...lines.map((l) => estimateEm(l, lang)));
  // Lines that are still too long after shrinking to 60% will wrap.
  const fontSize = Math.max(base * 0.6, Math.min(base, maxWidth / Math.max(1, widest)) * 0.95);
  const textColor = readableOn(accent);

  // impact shake right after the slam
  const shakeAmp = interpolate(frame, [3, 12], [10 * u, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const shakeX = Math.sin(frame * 2.7) * shakeAmp;
  const shakeY = Math.cos(frame * 3.3) * shakeAmp * 0.6;
  // gentle push-in during the hold, quick fade at the very end
  const push = interpolate(frame, [0, durationInFrames], [1, 1.06]);
  const outro = interpolate(frame, [durationInFrames - 4, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        transform: `translate(${shakeX}px, ${shakeY}px) scale(${push})`,
        opacity: outro,
        paddingBottom: isVertical(format) ? height * 0.12 : 0,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * u, transform: "rotate(-3deg)" }}>
        {lines.map((line, i) => {
          const delay = i * 4;
          const slam = spring({ frame: frame - delay, fps, config: { damping: 13, stiffness: 220, mass: 0.7 } });
          const band = spring({ frame: frame - delay + 2, fps, config: { damping: 200, stiffness: 300 } });
          const scale = interpolate(slam, [0, 1], [2.4, 1]);
          const opacity = interpolate(frame - delay, [0, 3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div key={i} style={{ position: "relative", maxWidth, opacity, transform: `scale(${scale})` }}>
              <div
                style={{
                  position: "absolute",
                  inset: `${-0.04 * fontSize}px ${-0.28 * fontSize}px`,
                  backgroundColor: accent,
                  transform: `scaleX(${band}) skewX(-8deg)`,
                  transformOrigin: "left center",
                  boxShadow: `0 ${14 * u}px ${40 * u}px rgba(0,0,0,0.55)`,
                }}
              />
              <div
                style={{
                  position: "relative",
                  fontFamily: font.fontFamily,
                  fontWeight: font.fontWeight,
                  fontSize,
                  lineHeight: lang === "en" ? 1.05 : 1.2,
                  letterSpacing: lang === "en" ? "0.01em" : "0.02em",
                  color: textColor,
                  textAlign: "center",
                  whiteSpace: "pre-wrap",
                  wordBreak: lang === "en" ? "normal" : "break-all",
                }}
              >
                {line}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const HookSection: React.FC<{
  project: Project;
  section: TimelineSection;
  format: Format;
  lang: Lang;
  assetBaseUrl: string;
  useProxy: boolean;
}> = ({ project, section, format, lang, assetBaseUrl, useProxy }) => {
  const hasFootage = section.clips.length > 0;
  const hookText = project.texts[lang].hook.trim() || (hasFootage ? "" : project.game.title || project.name);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {hasFootage ? (
        <ClipTrack project={project} clips={section.clips} format={format} assetBaseUrl={assetBaseUrl} useProxy={useProxy} punchFirst={false} />
      ) : (
        <Backdrop project={project} assetBaseUrl={assetBaseUrl} blurPx={6} brightness={0.6} />
      )}
      {hookText ? (
        <>
          <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 100%)" }} />
          <HookText text={hookText} lang={lang} format={format} accent={project.style.accentColor} />
        </>
      ) : null}
    </AbsoluteFill>
  );
};
