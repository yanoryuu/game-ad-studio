import type React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import type { Lang, Project } from "@gas/shared";
import { withAlpha } from "../../../common/theme";
import { clamp, pop, useShortFrame } from "./anim";
import { BigText, surface, type SurfaceVariant } from "./BigText";
import { fitFont, SAFE916, V916 } from "./layout";

/** Band surface: the solid variants, or "scrim" = transparent band over full-bleed footage (dark top gradient). */
export type BandVariant = SurfaceVariant | "scrim";

/**
 * Text geometry of a TopBand (reference px * u): the text block is centered in [safeTop + kickerSpace, height - 40].
 * Exposed so templates can animate text INTO the band (e.g. question: big slam -> shrinks into the band).
 */
export function bandTextLayout(text: string, lang: Lang, o: { u: number; width: number; height?: number; kicker?: boolean; maxBase?: number }) {
  const h = (o.height ?? V916.bandH) * o.u;
  const top = (SAFE916.top + (o.kicker ? 96 : 0)) * o.u;
  const bottom = h - 40 * o.u;
  const maxW = o.width - 100 * o.u;
  const fontSize = fitFont(text, lang, {
    base: (o.maxBase ?? (lang === "en" ? 150 : 124)) * o.u,
    maxWidth: maxW,
    maxHeight: bottom - top,
    minRatio: 0.3,
  });
  return { top, bottom, centerY: (top + bottom) / 2, maxW, fontSize, bandH: h };
}

/**
 * 9:16 top text band [0, height) with big outlined RichText, safe-zone aware (text below y = 200).
 * Visible and legible on frame 0 (pops from scale 0.86, no fade). Idle: slow shine sweep.
 * - `variant`: surface (accent / red / dark / light) or "scrim" (over full-bleed footage).
 * - `kicker`: node above the text (e.g. <Badge/>); `deco`: decoration behind the text (e.g. giant "?").
 * - `textStyle`: merged onto the text wrapper (transform / opacity) — for custom entrances.
 * - `hideText` / `hideBackground`: draw only one half (for morphs).
 */
export const TopBand: React.FC<{
  project: Project;
  lang: Lang;
  text: string;
  variant?: BandVariant;
  /** band height in reference px. Default 656 (= top of the centered strip) */
  height?: number;
  kicker?: React.ReactNode;
  deco?: React.ReactNode;
  /** max font size in reference px (default 150 en / 124 ja) */
  maxFont?: number;
  textStyle?: React.CSSProperties;
  hideText?: boolean;
  hideBackground?: boolean;
  /** frame the entrance starts at (relative to the Sequence). Default 0 */
  delay?: number;
}> = ({ project, lang, text, variant = "red", height = V916.bandH, kicker, deco, maxFont, textStyle, hideText, hideBackground, delay = 0 }) => {
  const { frame, fps, width, u } = useShortFrame();
  const accent = project.style.accentColor;
  const s = variant === "scrim" ? null : surface(project, variant);
  const lay = bandTextLayout(text, lang, { u, width, height, kicker: !!kicker, maxBase: maxFont });
  const p = pop(frame, fps, delay, { stiff: true });
  const shineStart = delay + Math.round(fps * 0.9);
  const period = Math.round(fps * 2.8);
  const local = frame >= shineStart ? (frame - shineStart) % period : -1;
  const shine = local >= 0 && local <= fps * 0.55 ? interpolate(local, [0, fps * 0.55], [-30, 130], clamp) : null;
  const stripes =
    variant === "light"
      ? `repeating-linear-gradient(0deg, rgba(0,0,0,0.035) 0px, rgba(0,0,0,0.035) ${2 * u}px, transparent ${2 * u}px, transparent ${44 * u}px)`
      : `repeating-linear-gradient(115deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) ${18 * u}px, transparent ${18 * u}px, transparent ${46 * u}px)`;

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width, height: lay.bandH, overflow: "visible" }}>
      {hideBackground ? null : s ? (
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `${stripes}, radial-gradient(ellipse at 50% 65%, ${withAlpha("#ffffff", variant === "light" ? 0 : 0.14)} 0%, transparent 60%), linear-gradient(170deg, ${s.a} 0%, ${s.b} 100%)`,
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
                background: `linear-gradient(90deg, transparent, ${variant === "light" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.2)"}, transparent)`,
                transform: "skewX(-22deg)",
              }}
            />
          ) : null}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 12 * u, backgroundColor: s.edge }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 12 * u, height: 6 * u, backgroundColor: accent, boxShadow: `0 0 ${18 * u}px ${withAlpha(accent, 0.8)}` }} />
        </div>
      ) : (
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: lay.bandH * 1.15, background: "linear-gradient(180deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0) 100%)" }} />
      )}
      {deco ? <AbsoluteFill style={{ overflow: "hidden" }}>{deco}</AbsoluteFill> : null}
      <AbsoluteFill style={{ top: SAFE916.top * u, bottom: 40 * u, height: "auto", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 22 * u }}>
        {kicker}
        {hideText ? null : (
          <div style={{ maxWidth: lay.maxW, transform: `scale(${interpolate(p, [0, 1], [0.86, 1])})`, ...textStyle }}>
            <BigText
              text={text}
              lang={lang}
              fontSize={lay.fontSize}
              emphasisColor={project.style.emphasisColor}
              color={s?.fg ?? "#ffffff"}
              ink={s ? s.ink : "#000000"}
              marker={s?.marker}
            />
          </div>
        )}
      </AbsoluteFill>
    </div>
  );
};

/**
 * 16:9 top-left banner over full-frame gameplay (<= 22% of the height, text <= 58% of the width), skewed right
 * edge, accent underline; slides in from the left on frame 0 but is already readable there.
 */
export const TopBanner: React.FC<{
  project: Project;
  lang: Lang;
  text: string;
  variant?: SurfaceVariant;
  kicker?: React.ReactNode;
  /** max font size (reference px). Default 76 en / 60 ja */
  maxFont?: number;
  /** "left" (default) or "center" */
  align?: "left" | "center";
  delay?: number;
  style?: React.CSSProperties;
}> = ({ project, lang, text, variant = "red", kicker, maxFont, align = "left", delay = 0, style }) => {
  const { frame, fps, width, height, u } = useShortFrame();
  const s = surface(project, variant);
  const accent = project.style.accentColor;
  const slide = pop(frame, fps, delay);
  const maxH = height * 0.22 - 40 * u;
  const fontSize = fitFont(text, lang, { base: (maxFont ?? (lang === "en" ? 76 : 60)) * u, maxWidth: width * 0.58, maxHeight: maxH, minRatio: 0.4 });
  const center = align === "center";
  return (
    <div
      style={{
        position: "absolute",
        top: 28 * u,
        left: center ? "50%" : 0,
        maxHeight: height * 0.22,
        transform: center ? `translateX(-50%) scale(${interpolate(slide, [0, 1], [0.9, 1])})` : `translateX(${interpolate(slide, [0, 1], [-10, 0])}%)`,
        display: "flex",
        alignItems: "center",
        gap: 24 * u,
        padding: center ? `${14 * u}px ${48 * u}px ${18 * u}px` : `${14 * u}px ${70 * u}px ${18 * u}px ${44 * u}px`,
        background: `linear-gradient(100deg, ${withAlpha(s.a, 0.95)} 0%, ${withAlpha(s.b, 0.92)} 100%)`,
        clipPath: center ? undefined : `polygon(0 0, 100% 0, calc(100% - ${40 * u}px) 100%, 0 100%)`,
        borderRadius: center ? 18 * u : 0,
        borderBottom: `${6 * u}px solid ${accent}`,
        boxShadow: `0 ${10 * u}px ${30 * u}px rgba(0,0,0,0.45)`,
        ...style,
      }}
    >
      {kicker}
      <BigText
        text={text}
        lang={lang}
        fontSize={fontSize}
        emphasisColor={project.style.emphasisColor}
        color={s.fg}
        ink={s.ink}
        marker={s.marker}
        align={center ? "center" : "left"}
      />
    </div>
  );
};
