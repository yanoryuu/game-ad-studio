import type React from "react";
import { AbsoluteFill, Freeze, interpolate, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import type { Format, Project } from "@gas/shared";
import type { PlacedClip } from "./clips";
import { sourceUrl } from "./urls";
import { isVertical, unitFor } from "./theme";
import { BODY_FONT } from "./fonts";
import { gameDuckGain } from "./audioMix";
import { useDuckEnvelope } from "./mixContext";

type ClipVideoProps = {
  project: Project;
  src: string;
  clip: PlacedClip;
  format: Format;
  /** absolute output frame where this clip's Sequence starts (for the ducking envelope) */
  absFrom: number;
  /** play the clip's audio (false while holding the last frame) */
  withAudio: boolean;
};

/**
 * One source video, laid out for the format: 16:9 cover; 9:16 per style.vertical.mode —
 * "blur" (default): contain over a blurred copy; "crop": full-bleed cover centered at clip.focusX.
 */
const ClipVideo: React.FC<ClipVideoProps> = ({ project, src, clip, format, absFrom, withAudio }) => {
  const env = useDuckEnvelope();
  const muted = !withAudio || !clip.hasAudio || clip.volume <= 0;
  // volume-callback frame is relative to the clip's Sequence start (trimBefore does not shift it)
  const volume = (f: number) => clip.volume * gameDuckGain(project, env, absFrom + f);
  const video = (style: React.CSSProperties, bg: boolean) => (
    <OffthreadVideo
      src={src}
      trimBefore={clip.trimBefore}
      muted={bg || muted}
      volume={bg || muted ? 0 : volume}
      style={style}
      pauseWhenBuffering={!bg}
    />
  );

  if (isVertical(format) && project.style.vertical.mode === "crop") {
    return (
      <AbsoluteFill style={{ backgroundColor: "black" }}>
        {video({ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${clip.focusX * 100}% 50%` }, false)}
      </AbsoluteFill>
    );
  }
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

/** Preview only: the source's proxy is not ready yet (or failed) -> dark placeholder instead of the video. */
const ProxyPlaceholder: React.FC<{ failed: boolean }> = ({ failed }) => {
  const { width, height } = useVideoConfig();
  const u = unitFor(width, height);
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0d12", justifyContent: "center", alignItems: "center" }}>
      <div style={{ fontFamily: BODY_FONT, fontWeight: 700, fontSize: 30 * u, letterSpacing: "0.15em", color: "rgba(255,255,255,0.35)" }}>
        {failed ? "PROXY ERROR" : "PREPARING PREVIEW…"}
      </div>
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
  /** absolute output frame of the enclosing section */
  sectionFrom: number;
  /** add a punch on the first clip as well */
  punchFirst: boolean;
}> = ({ project, clips, format, assetBaseUrl, useProxy, sectionFrom, punchFirst }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {clips.map((clip, i) => {
        const source = project.sources.find((s) => s.id === clip.sourceId);
        if (!source) return null;
        const duration = clip.playFrames + clip.holdFrames;
        if (useProxy && source.proxyStatus !== "ready") {
          return (
            <Sequence key={clip.key} from={clip.from} durationInFrames={duration} name={`clip ${clip.clipId} (no proxy)`}>
              <ProxyPlaceholder failed={source.proxyStatus === "error"} />
            </Sequence>
          );
        }
        const src = sourceUrl(assetBaseUrl, project, clip.sourceId, useProxy);
        const punch = i > 0 || punchFirst;
        const absFrom = sectionFrom + clip.from;
        return (
          <Sequence key={clip.key} from={clip.from} durationInFrames={duration} premountFor={Math.round(fps)} name={`clip ${clip.clipId}`}>
            <CutPunch enabled={punch}>
              {clip.holdFrames > 0 ? (
                <HoldAware project={project} clip={clip} src={src} format={format} absFrom={absFrom} />
              ) : (
                <ClipVideo project={project} src={src} clip={clip} format={format} absFrom={absFrom} withAudio />
              )}
            </CutPunch>
          </Sequence>
        );
      })}
    </>
  );
};

/** Clip that runs out of source material: freeze on its last played frame. */
const HoldAware: React.FC<{ project: Project; clip: PlacedClip; src: string; format: Format; absFrom: number }> = ({
  project,
  clip,
  src,
  format,
  absFrom,
}) => {
  const frame = useCurrentFrame();
  const holding = frame >= clip.playFrames;
  return (
    <Freeze frame={Math.max(0, clip.playFrames - 1)} active={holding}>
      <ClipVideo project={project} src={src} clip={clip} format={format} absFrom={absFrom} withAudio={!holding} />
    </Freeze>
  );
};
