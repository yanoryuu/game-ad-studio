import type React from "react";
import { AbsoluteFill, interpolate, Sequence } from "remotion";
import type { Lang, Project } from "@gas/shared";
import { withAlpha } from "../../../common/theme";
import type { TemplateRenderProps } from "../../types";
import type { PlacedClip } from "../../../common/clips";
import { BigText, clamp, CtaBar, fitFont, gameLayout, SAFE916, ShortGameplay, ShortShell, useShortFrame } from "../common";
import type { LoopTimeline } from "./timeline";

type Props = TemplateRenderProps<LoopTimeline>;

/**
 * Small loop ring: a circular progress (playback position) around a "↻" glyph. Full at the very end, empty at
 * frame 0 — so the loop point is visually continuous (the ring wraps around).
 */
const LoopRing: React.FC<{ project: Project; size: number; progress: number }> = ({ project, size, progress }) => {
  const accent = project.style.accentColor;
  const r = size / 2 - size * 0.08;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.25)" strokeWidth={size * 0.09} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth={size * 0.09}
          strokeLinecap="round"
          strokeDasharray={`${c * Math.max(0.001, progress)} ${c}`}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          color: "#ffffff",
          fontSize: size * 0.5,
          fontWeight: 900,
          lineHeight: 1,
          transform: `rotate(${progress * 360}deg)`,
        }}
      >
        ↻
      </div>
    </div>
  );
};

/** Small headline pill (title) + loop ring. Same on the first and the last frame (seamless). */
const Header: React.FC<{ project: Project; lang: Lang; title: string; total: number; vertical: boolean }> = ({ project, lang, title, total, vertical }) => {
  const { frame, width, u } = useShortFrame();
  const progress = total > 1 ? frame / (total - 1) : 1;
  const ring = (vertical ? 76 : 64) * u;
  const maxW = vertical ? width - 2 * 40 * u - SAFE916.right * u : width * 0.5;
  const size = title ? fitFont(title, lang, { base: (lang === "en" ? 60 : 48) * u, maxWidth: maxW - ring - 60 * u, maxHeight: 150 * u, minRatio: 0.45 }) : 0;
  return (
    <div style={{ position: "absolute", left: (vertical ? 40 : 44) * u, top: vertical ? (SAFE916.top + 10) * u : 36 * u, display: "flex", alignItems: "center", gap: 18 * u, maxWidth: maxW }}>
      <LoopRing project={project} size={ring} progress={progress} />
      {title ? (
        <div style={{ padding: `${10 * u}px ${24 * u}px ${12 * u}px`, borderRadius: 18 * u, backgroundColor: "rgba(0,0,0,0.5)", border: `${2 * u}px solid ${withAlpha("#ffffff", 0.18)}` }}>
          <BigText text={title} lang={lang} fontSize={size} emphasisColor={project.style.emphasisColor} align="left" stroke={0.06} />
        </div>
      ) : null}
    </div>
  );
};

/** Small CTA card over the last seconds; leaves (slides down + fades) during the seam cross-fade. */
const LoopCta: React.FC<Props & { vertical: boolean; ctaTop: number | null }> = ({ project, lang, timeline, assetBaseUrl, vertical, ctaTop }) => {
  const { frame, width, height, u } = useShortFrame();
  const { ctaFrom, xfadeFrom, totalFrames } = timeline;
  // frame is relative to ctaFrom (inside the Sequence)
  const leaveFrom = xfadeFrom - ctaFrom;
  const leave = xfadeFrom < totalFrames ? interpolate(frame, [leaveFrom, leaveFrom + Math.max(2, Math.round((totalFrames - xfadeFrom) * 0.8))], [0, 1], clamp) : 0;
  const style: React.CSSProperties = vertical
    ? ctaTop !== null
      ? { position: "absolute", left: 40 * u, right: (SAFE916.right + 10) * u, top: ctaTop }
      : { position: "absolute", left: 40 * u, right: (SAFE916.right + 10) * u, top: height * 0.5 - 300 * u }
    : { position: "absolute", right: 56 * u, bottom: 230 * u, width: width * 0.36 };
  return (
    <div style={{ ...style, opacity: 1 - leave, transform: `translateY(${leave * 60 * u}px)` }}>
      <CtaBar project={project} lang={lang} assetBaseUrl={assetBaseUrl} cta={timeline.cta} compact />
    </div>
  );
};

/** 9:16 "window" (blur mode): the footage big in a near-square window over its own blurred copy. Reference px. */
const WINDOW = { top: 380, height: 920 } as const;

/** Footage of the loop: 16:9 full frame / 9:16 crop = full-bleed cover / 9:16 blur = big window over a blurred copy. */
const Footage: React.FC<Props & { clips: PlacedClip[]; cuts?: number[]; sectionFrom?: number; mode: "full16" | "full" | "window" }> = ({
  project,
  assetBaseUrl,
  useProxy,
  clips,
  cuts,
  sectionFrom = 0,
  mode,
}) => {
  const { width, u } = useShortFrame();
  if (mode !== "window") {
    return <ShortGameplay project={project} layout={mode} clips={clips} cuts={cuts} assetBaseUrl={assetBaseUrl} useProxy={useProxy} sectionFrom={sectionFrom} />;
  }
  const muted = clips.map((c) => ({ ...c, key: c.key + "-bg", volume: 0 }));
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ transform: "scale(1.2)" }}>
        <ShortGameplay project={project} layout="full16" clips={muted} assetBaseUrl={assetBaseUrl} useProxy={useProxy} sectionFrom={sectionFrom} filter="blur(38px) brightness(0.45) saturate(1.2)" />
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: WINDOW.top * u,
          width,
          height: WINDOW.height * u,
          overflow: "hidden",
          boxShadow: `0 0 ${50 * u}px rgba(0,0,0,0.7)`,
          borderTop: `${4 * u}px solid rgba(255,255,255,0.85)`,
          borderBottom: `${4 * u}px solid rgba(255,255,255,0.85)`,
        }}
      >
        <ShortGameplay project={project} layout="full16" clips={clips} cuts={cuts} assetBaseUrl={assetBaseUrl} useProxy={useProxy} sectionFrom={sectionFrom} />
      </div>
    </AbsoluteFill>
  );
};

const Body: React.FC<Props> = (props) => {
  const { project, format, lang, timeline } = props;
  const { u } = useShortFrame();
  const layout = gameLayout(project, format, "full");
  const vertical = layout !== "full16";
  const mode = layout === "full16" ? "full16" : project.style.vertical.mode === "crop" ? "full" : "window";
  const { xfadeFrom, totalFrames, seamClip } = timeline;
  return (
    <AbsoluteFill>
      <Footage {...props} clips={timeline.clips} cuts={timeline.cuts} mode={mode} />
      {seamClip ? (
        <Sequence from={xfadeFrom} durationInFrames={totalFrames - xfadeFrom} name="loop seam">
          <SeamFade>
            <Footage {...props} clips={[seamClip]} sectionFrom={xfadeFrom} mode={mode} />
          </SeamFade>
        </Sequence>
      ) : null}
      <Header project={project} lang={lang} title={timeline.title} total={totalFrames} vertical={vertical} />
      {timeline.ctaFrom < totalFrames ? (
        <Sequence from={timeline.ctaFrom} durationInFrames={totalFrames - timeline.ctaFrom} name="cta">
          <LoopCta {...props} vertical={vertical} ctaTop={mode === "window" ? (WINDOW.top + WINDOW.height + 28) * u : null} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

/** Cross-fade of the seam: opacity 0 -> 1 over the Sequence, reaching 1 on the very last frame. */
const SeamFade: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { frame, durationInFrames } = useShortFrame();
  const o = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], { ...clamp, easing: (t) => t * t * (3 - 2 * t) });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

/** Template "loop" visuals: footage only (small headline + loop ring), small CTA at the end, seamless seam. */
export const Loop: React.FC<Props> = (props) => (
  <ShortShell project={props.project} format={props.format} lang={props.lang} assetBaseUrl={props.assetBaseUrl} timeline={props.timeline}>
    <Body {...props} />
  </ShortShell>
);
