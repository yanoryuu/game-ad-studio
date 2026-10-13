import type React from "react";
import { AbsoluteFill, Freeze, interpolate, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import type { Format, Project } from "@gas/shared";
import type { PlacedClip } from "./timeline";
import { sourceUrl } from "./urls";
import { isVertical } from "./theme";

type ClipVideoProps = {
  src: string;
  clip: PlacedClip;
  format: Format;
  /** play the clip's audio (false while holding the last frame) */
  withAudio: boolean;
};

/** One source video, laid out for the format (16:9 cover / 9:16 contain over a blurred copy). */
const ClipVideo: React.FC<ClipVideoProps> = ({ src, clip, format, withAudio }) => {
  const muted = !withAudio || !clip.hasAudio || clip.volume <= 0;
  const video = (style: React.CSSProperties, bg: boolean) => (
    <OffthreadVideo
      src={src}
      trimBefore={clip.trimBefore}
      muted={bg || muted}
      volume={bg || muted ? 0 : clip.volume}
      style={style}
      pauseWhenBuffering={!bg}
    />
  );

  if (isVertical(format)) {
    return (
      <AbsoluteFill style={{ backgroundColor: "black" }}>
        <AbsoluteFill style={{ filter: "blur(40px) brightness(0.55)", transform: "scale(1.25)" }}>
          {video({ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${clip.focusX * 100}% 50%` }, true)}
        </AbsoluteFill>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          {video({ width: "100%", height: "auto", objectFit: "contain" }, false)}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  return <AbsoluteFill>{video({ width: "100%", height: "100%", objectFit: "cover" }, false)}</AbsoluteFill>;
};

/** Quick "punch" on every cut: slight zoom-in settling + white flash. */
const CutPunch: React.FC<{ children: React.ReactNode; enabled: boolean }> = ({ children, enabled }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const len = Math.max(2, Math.round(fps * 0.22));
  const scale = enabled
    ? interpolate(frame, [0, len], [1.12, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })
    : 1;
  const flash = enabled
    ? interpolate(frame, [0, Math.max(1, Math.round(fps * 0.15))], [0.55, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 0;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>{children}</AbsoluteFill>
      {flash > 0 ? <AbsoluteFill style={{ backgroundColor: "white", opacity: flash }} /> : null}
    </AbsoluteFill>
  );
};

/** Plays a section's clips back to back. Positions are relative to the enclosing section Sequence. */
export const ClipTrack: React.FC<{
  project: Project;
  clips: PlacedClip[];
  format: Format;
  assetBaseUrl: string;
  useProxy: boolean;
  /** add a punch on the first clip as well */
  punchFirst: boolean;
}> = ({ project, clips, format, assetBaseUrl, useProxy, punchFirst }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {clips.map((clip, i) => {
        if (!project.sources.some((s) => s.id === clip.sourceId)) return null;
        const src = sourceUrl(assetBaseUrl, project, clip.sourceId, useProxy);
        const punch = i > 0 || punchFirst;
        return (
          <Sequence
            key={clip.key}
            from={clip.from}
            durationInFrames={clip.playFrames + clip.holdFrames}
            premountFor={Math.round(fps)}
            name={`clip ${clip.clipId}`}
          >
            <CutPunch enabled={punch}>
              {clip.holdFrames > 0 ? (
                <HoldAware clip={clip} src={src} format={format} />
              ) : (
                <ClipVideo src={src} clip={clip} format={format} withAudio />
              )}
            </CutPunch>
          </Sequence>
        );
      })}
    </>
  );
};

/** Clip that runs out of source material: freeze on its last played frame. */
const HoldAware: React.FC<{ clip: PlacedClip; src: string; format: Format }> = ({ clip, src, format }) => {
  const frame = useCurrentFrame();
  const holding = frame >= clip.playFrames;
  return (
    <Freeze frame={Math.max(0, clip.playFrames - 1)} active={holding}>
      <ClipVideo src={src} clip={clip} format={format} withAudio={!holding} />
    </Freeze>
  );
};
