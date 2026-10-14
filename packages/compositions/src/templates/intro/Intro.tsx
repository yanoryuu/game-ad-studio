import type React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { ClipTrack } from "../../common/ClipTrack";
import { EndCard } from "../../common/EndCard";
import { NoFootage } from "../../common/NoFootage";
import { isVertical, unitFor, withAlpha } from "../../common/theme";
import type { TemplateRenderProps } from "../types";
import { HeadlineBannerHorizontal, HeadlineBandVertical } from "./Headline";
import { InfoCard } from "./InfoCard";
import { PointBadge } from "./PointBadge";
import type { IntroTimeline } from "./timeline";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0..1 flash right after the most recent cut (strip frame glow). */
function cutFlash(cuts: number[], frame: number, fps: number): number {
  let last = -1;
  for (const c of cuts) if (c <= frame && c > last) last = c;
  if (last < 0) return 0;
  return interpolate(frame - last, [0, Math.round(fps * 0.3)], [1, 0], clamp);
}

/** The gameplay (clips of the body, or a placeholder when there is no usable footage). */
const Gameplay: React.FC<TemplateRenderProps<IntroTimeline>> = ({ project, assetBaseUrl, useProxy, timeline }) =>
  timeline.body.clips.length > 0 ? (
    <ClipTrack project={project} clips={timeline.body.clips} format="16:9" assetBaseUrl={assetBaseUrl} useProxy={useProxy} sectionFrom={0} punchFirst={false} />
  ) : (
    <NoFootage project={project} assetBaseUrl={assetBaseUrl} />
  );

/** 9:16 body: headline band / 16:9 strip with accent frame / designed caption band. */
const BodyVertical: React.FC<TemplateRenderProps<IntroTimeline>> = (props) => {
  const { project, timeline } = props;
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = unitFor(width, height);
  const accent = project.style.accentColor;
  const stripH = (width * 9) / 16;
  const stripTop = (height - stripH) / 2;
  const stripBottom = stripTop + stripH;
  const flash = cutFlash(timeline.cuts, frame, fps);
  const lineH = (6 + 6 * flash) * u;
  const glow = `0 0 ${(16 + 30 * flash) * u}px ${withAlpha(accent, 0.65 + 0.35 * flash)}`;

  return (
    <AbsoluteFill style={{ backgroundColor: "#06070c" }}>
      {/* caption band below the strip: dark gradient + faint grid + accent glow from the strip */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: stripBottom,
          bottom: 0,
          background: [
            `radial-gradient(ellipse at 50% 0%, ${withAlpha(accent, 0.22)} 0%, transparent 55%)`,
            `repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) ${2 * u}px, transparent ${2 * u}px, transparent ${10 * u}px)`,
            "linear-gradient(180deg, #161927 0%, #0a0b12 55%, #030306 100%)",
          ].join(", "),
        }}
      />
      {/* gameplay strip */}
      <div style={{ position: "absolute", left: 0, top: stripTop, width, height: stripH, overflow: "hidden", backgroundColor: "#000" }}>
        <Gameplay {...props} />
        {/* edge vignette so the overlays read */}
        <AbsoluteFill style={{ boxShadow: `inset 0 0 ${60 * u}px rgba(0,0,0,0.55)`, pointerEvents: "none" }} />
      </div>
      {/* accent frame lines (thicker + glow on every cut) */}
      <div style={{ position: "absolute", left: 0, right: 0, top: stripTop - lineH / 2, height: lineH, backgroundColor: accent, boxShadow: glow }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: stripBottom - lineH / 2, height: lineH, backgroundColor: accent, boxShadow: glow }} />
      <HeadlineBandVertical project={project} lang={props.lang} />
      <Overlays {...props} vertical />
    </AbsoluteFill>
  );
};

/** 16:9 body: full-frame gameplay, top-left headline banner, info panel right, points left. */
const BodyHorizontal: React.FC<TemplateRenderProps<IntroTimeline>> = (props) => {
  const { project, timeline } = props;
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = unitFor(width, height);
  const flash = cutFlash(timeline.cuts, frame, fps);
  return (
    <AbsoluteFill>
      <Gameplay {...props} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.35) 100%)" }} />
      {flash > 0 ? <AbsoluteFill style={{ boxShadow: `inset 0 0 0 ${8 * flash * u}px ${project.style.accentColor}` }} /> : null}
      <HeadlineBannerHorizontal project={project} lang={props.lang} />
      <Overlays {...props} vertical={false} />
    </AbsoluteFill>
  );
};

/** Info card + numbered points, each in its own window. */
const Overlays: React.FC<TemplateRenderProps<IntroTimeline> & { vertical: boolean }> = ({ project, lang, timeline, vertical }) => {
  const { info, points } = timeline;
  const accent = project.style.accentColor;
  const emph = project.style.emphasisColor;
  return (
    <>
      {points.map((p) => (
        <Sequence key={p.id} from={p.from} durationInFrames={p.to - p.from} name={`point ${p.number}`} layout="none">
          <PointBadge number={p.number} text={p.text} lang={lang} vertical={vertical} accent={accent} emphasisColor={emph} durationInFrames={p.to - p.from} />
        </Sequence>
      ))}
      {info ? (
        <Sequence from={info.from} durationInFrames={info.to - info.from} name="info card" layout="none">
          <InfoCard rows={info.rows} lang={lang} vertical={vertical} accent={accent} emphasisColor={emph} durationInFrames={info.to - info.from} />
        </Sequence>
      ) : null}
    </>
  );
};

/** Template "intro" visuals: body (headline + gameplay + overlays) then the common end card. */
export const Intro: React.FC<TemplateRenderProps<IntroTimeline>> = (props) => {
  const { project, format, lang, assetBaseUrl, timeline } = props;
  const { body, endCard } = timeline;
  return (
    <AbsoluteFill>
      {body.durationInFrames > 0 ? (
        <Sequence from={0} durationInFrames={body.durationInFrames} name="body">
          {isVertical(format) ? <BodyVertical {...props} /> : <BodyHorizontal {...props} />}
        </Sequence>
      ) : null}
      {endCard.durationInFrames > 0 ? (
        <Sequence from={endCard.from} durationInFrames={endCard.durationInFrames} name="end card">
          <EndCard project={project} format={format} lang={lang} assetBaseUrl={assetBaseUrl} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
