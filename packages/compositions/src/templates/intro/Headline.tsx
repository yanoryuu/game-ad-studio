import type React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { stripEmphasis, type Lang, type Project } from "@gas/shared";
import { BODY_FONT, displayFont } from "../../common/fonts";
import { RichText } from "../../common/RichText";
import { outline, readableOn, unitFor, withAlpha } from "../../common/theme";
import { bandPalette, fitRich, lineCount, V } from "./layout";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Text of the headline band: headline[lang], or the game title when it is empty. */
export function headlineText(project: Project, lang: Lang): string {
  const h = project.templateData.intro.headline[lang];
  if (stripEmphasis(h).trim()) return h.trim();
  return project.game.title.trim() || project.name;
}

export function kickerText(project: Project, lang: Lang): string {
  return stripEmphasis(project.templateData.intro.kicker?.[lang] ?? "").trim();
}

/** Kicker badge: skewed accent label (e.g. 今話題 / TRENDING) with a small flame dot. */
const Kicker: React.FC<{ text: string; lang: Lang; accent: string; size: number; progress: number; frame: number; fps: number }> = ({
  text,
  lang,
  accent,
  size,
  progress,
  frame,
  fps,
}) => {
  const fg = readableOn(accent);
  const en = displayFont("en");
  const blink = 0.55 + 0.45 * Math.abs(Math.sin((frame / fps) * Math.PI * 1.6));
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.32,
        transform: `rotate(-3deg) scale(${interpolate(progress, [0, 1], [0.6, 1])}) skewX(-10deg)`,
        backgroundColor: accent,
        color: fg,
        padding: `${size * 0.16}px ${size * 0.55}px ${size * 0.18}px ${size * 0.45}px`,
        fontFamily: lang === "en" ? en.fontFamily : BODY_FONT,
        fontWeight: lang === "en" ? en.fontWeight : 900,
        fontSize: size,
        lineHeight: 1.05,
        letterSpacing: lang === "en" ? "0.12em" : "0.06em",
        boxShadow: `0 ${size * 0.12}px 0 rgba(0,0,0,0.55), 0 0 0 ${Math.max(2, size * 0.06)}px #fff`,
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ width: size * 0.36, height: size * 0.36, borderRadius: "50%", backgroundColor: "#ff2a2a", opacity: blink, boxShadow: `0 0 ${size * 0.3}px #ff2a2a`, transform: "skewX(10deg)" }} />
      <div style={{ transform: "skewX(10deg)" }}>{text}</div>
    </div>
  );
};

/** The big title text with thick dark outline + drop shadow; emphasis runs in emphasisColor (RichText). */
const HeadlineType: React.FC<{
  text: string;
  lang: Lang;
  fontSize: number;
  emphasisColor: string;
  ink: string;
  frame: number;
  fps: number;
  align?: "center" | "left";
}> = ({ text, lang, fontSize, emphasisColor, ink, frame, fps, align = "center" }) => {
  const font = displayFont(lang);
  const stroke = Math.max(3, fontSize * (lang === "en" ? 0.075 : 0.085));
  // idle: emphasis runs breathe a little
  const breathe = 1 + 0.035 * Math.max(0, Math.sin((frame / fps) * Math.PI * 1.25));
  return (
    <div
      lang={lang}
      style={{
        fontFamily: font.fontFamily,
        fontWeight: font.fontWeight,
        fontSize,
        lineHeight: lang === "en" ? 1.04 : 1.16,
        letterSpacing: lang === "en" ? "0.01em" : "0.02em",
        textTransform: font.uppercase ? "uppercase" : "none",
        color: "#ffffff",
        textAlign: align,
        wordBreak: lang === "ja" ? "keep-all" : "normal",
        overflowWrap: "anywhere",
        textShadow: `${outline(stroke, ink)}, 0 ${stroke * 1.4}px 0 ${ink}, 0 ${stroke * 2.2}px ${stroke * 3}px rgba(0,0,0,0.65)`,
      }}
    >
      <RichText
        text={text}
        lang={lang}
        emphasisColor={emphasisColor}
        emphasisStyle={{ display: "inline-block", transform: `scale(${breathe})`, transformOrigin: "50% 60%" }}
      />
    </div>
  );
};

/** Shine sweep across the band every ~2.6 s after the entrance. */
function shineX(frame: number, fps: number): number | null {
  const period = Math.round(fps * 2.6);
  const start = Math.round(fps * 0.8);
  if (frame < start) return null;
  const local = (frame - start) % period;
  const dur = Math.round(fps * 0.55);
  if (local > dur) return null;
  return interpolate(local, [0, dur], [-30, 130]);
}

/**
 * 9:16: the top band [0, 656) — colored gradient band with speed stripes, kicker badge + big headline,
 * accent edge. Pops in at frame 0 (the headline SE plays there), then idles (pulse + shine).
 * Everything is already legible on frame 0: it is the thumbnail of Shorts/TikTok (no fade/wipe from black).
 */
export const HeadlineBandVertical: React.FC<{ project: Project; lang: Lang }> = ({ project, lang }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = unitFor(width, height);
  const pal = bandPalette(project.style.emphasisColor);
  const accent = project.style.accentColor;
  const text = headlineText(project, lang);
  const kicker = kickerText(project, lang);

  const slam = spring({ frame, fps, config: { damping: 11, stiffness: 260, mass: 0.7 } });
  const kick = spring({ frame: frame - 2, fps, config: { damping: 10, stiffness: 300, mass: 0.6 } });
  const settled = Math.max(0, frame - Math.round(fps * 0.7));
  const pulse = 1 + 0.012 * Math.sin((settled / fps) * Math.PI * 2 * 0.9);
  const shine = shineX(frame, fps);

  const maxW = width - 90 * u;
  const lines = lineCount(text);
  const contentH = (V.bandH - V.safeTop - 50) * u - (kicker ? 120 * u : 0);
  const lh = lang === "en" ? 1.04 : 1.16;
  const base = Math.min((lang === "en" ? 190 : 150) * u, contentH / (lines * lh * 1.12));
  const fontSize = fitRich(text, base, maxW, 0.35, lang === "en" ? 0.82 : 1);
  const stripes = `repeating-linear-gradient(115deg, rgba(255,255,255,0.07) 0px, rgba(255,255,255,0.07) ${18 * u}px, transparent ${18 * u}px, transparent ${46 * u}px)`;

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width, height: V.bandH * u, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `${stripes}, radial-gradient(ellipse at 50% 62%, ${withAlpha("#ffffff", 0.16)} 0%, transparent 60%), linear-gradient(170deg, ${pal.a} 0%, ${pal.b} 100%)`,
        }}
      />
      {shine !== null ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${shine}%`,
            width: "22%",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)",
            transform: "skewX(-22deg)",
          }}
        />
      ) : null}
      {/* bottom edge: dark rule + accent line */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 14 * u, backgroundColor: pal.edge }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 14 * u, height: 6 * u, backgroundColor: accent, boxShadow: `0 0 ${18 * u}px ${withAlpha(accent, 0.8)}` }} />
      <AbsoluteFill
        style={{
          top: V.safeTop * u,
          bottom: 34 * u,
          height: "auto",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 26 * u,
        }}
      >
        {kicker ? <Kicker text={kicker} lang={lang} accent={accent} size={(lang === "en" ? 58 : 54) * u} progress={kick} frame={frame} fps={fps} /> : null}
        <div
          style={{
            maxWidth: maxW,
            transform: `scale(${interpolate(slam, [0, 1], [0.78, 1]) * pulse}) rotate(${interpolate(slam, [0, 1], [-4, 0])}deg)`,
          }}
        >
          <HeadlineType text={text} lang={lang} fontSize={fontSize} emphasisColor={project.style.emphasisColor} ink={pal.ink} frame={frame} fps={fps} />
        </div>
      </AbsoluteFill>
    </div>
  );
};

/**
 * 16:9: top-left banner over the full-frame gameplay (<= 22% of the height), smaller type, same entrance/idle.
 */
export const HeadlineBannerHorizontal: React.FC<{ project: Project; lang: Lang }> = ({ project, lang }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = unitFor(width, height);
  const pal = bandPalette(project.style.emphasisColor);
  const accent = project.style.accentColor;
  const text = headlineText(project, lang);
  const kicker = kickerText(project, lang);

  const slide = spring({ frame, fps, config: { damping: 18, stiffness: 220, mass: 0.7 } });
  const slam = spring({ frame, fps, config: { damping: 12, stiffness: 260, mass: 0.7 } });
  const kick = spring({ frame: frame - 2, fps, config: { damping: 10, stiffness: 300, mass: 0.6 } });
  const shine = shineX(frame, fps);

  const lines = lineCount(text);
  const maxH = height * 0.22 - 36 * u;
  const base = Math.min((lang === "en" ? 84 : 66) * u, maxH / (lines * 1.18));
  const fontSize = fitRich(text, base, width * 0.56, 0.4, lang === "en" ? 0.82 : 1);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 26 * u,
        maxHeight: height * 0.22,
        transform: `translateX(${interpolate(slide, [0, 1], [-14, 0])}%)`,
        display: "flex",
        alignItems: "center",
        gap: 26 * u,
        padding: `${16 * u}px ${70 * u}px ${18 * u}px ${44 * u}px`,
        background: `linear-gradient(100deg, ${withAlpha(pal.a, 0.94)} 0%, ${withAlpha(pal.b, 0.9)} 100%)`,
        clipPath: `polygon(0 0, 100% 0, calc(100% - ${40 * u}px) 100%, 0 100%)`,
        borderBottom: `${6 * u}px solid ${accent}`,
        overflow: "hidden",
        boxShadow: `0 ${10 * u}px ${30 * u}px rgba(0,0,0,0.45)`,
      }}
    >
      {shine !== null ? (
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${shine}%`, width: "20%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)", transform: "skewX(-22deg)" }} />
      ) : null}
      {kicker ? <Kicker text={kicker} lang={lang} accent={accent} size={(lang === "en" ? 34 : 32) * u} progress={kick} frame={frame} fps={fps} /> : null}
      <div style={{ transform: `scale(${interpolate(slam, [0, 1], [0.85, 1])})`, transformOrigin: "left center" }}>
        <HeadlineType text={text} lang={lang} fontSize={fontSize} emphasisColor={project.style.emphasisColor} ink={pal.ink} frame={frame} fps={fps} align="left" />
      </div>
    </div>
  );
};
