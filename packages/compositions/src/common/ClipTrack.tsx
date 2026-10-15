import type React from "react";
import { AbsoluteFill, Freeze, Img, interpolate, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { DEFAULT_IMAGE_MOTION, isStillImageSource, type Format, type ImageMotion, type Project, type Source } from "@gas/shared";
import type { PlacedClip } from "./clips";
import { sourceImageUrl, sourceUrl } from "./urls";
import { isVertical, unitFor } from "./theme";
import { BODY_FONT } from "./fonts";
import { gameDuckGain } from "./audioMix";
import { useDuckEnvelope } from "./mixContext";
import { TransitionLayer, useCutTransition } from "./CutTransition";

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

/** Zoom of the image motions: 1.00 <-> IMAGE_MOTION_ZOOM (pans run at this zoom). */
const IMAGE_MOTION_ZOOM = 1.08;
/**
 * Non-vertical formats: an image whose aspect differs so much from the frame that "cover" would cut off more
 * than this fraction of it (e.g. a wide logo, a portrait screenshot) is shown whole (contain) over a blurred
 * copy instead, like 9:16 "blur" mode. 16:9-ish images (16:10 and closer) are covered like video.
 */
const IMAGE_COVER_MAX_CROP = 0.12;
const easeInOutSine = Easing.bezier(0.37, 0, 0.63, 1);

/** CSS transform of an image motion at clip progress t (0..1); `w` = layer width in px. */
export function imageMotionTransform(motion: ImageMotion, t: number, w: number): string {
  const p = easeInOutSine(Math.min(1, Math.max(0, t)));
  const z = IMAGE_MOTION_ZOOM;
  const d = ((z - 1) / 2) * w; // max shift that keeps the zoomed layer covering its box
  switch (motion) {
    case "none":
      return "none";
    case "zoomIn":
      return `scale(${1 + (z - 1) * p})`;
    case "zoomOut":
      return `scale(${z - (z - 1) * p})`;
    case "panLeft": // view travels toward the left edge -> picture slides right
      return `translateX(${(-d + 2 * d * p).toFixed(3)}px) scale(${z})`;
    case "panRight":
      return `translateX(${(d - 2 * d * p).toFixed(3)}px) scale(${z})`;
  }
}

/**
 * One native image source (isStillImageSource) shown for the whole clip (play + hold: nothing "runs out"),
 * laid out like ClipVideo — 16:9 cover (contain over a blurred copy when cover would crop too much, see
 * IMAGE_COVER_MAX_CROP); 9:16 "blur": contain over a blurred copy; "crop": cover centered at clip.focusX —
 * with clip.imageMotion driven by the clip-local frame. No audio.
 */
const ClipImage: React.FC<{ project: Project; source: Source; clip: PlacedClip; format: Format; src: string; motion: ImageMotion }> = ({
  project,
  source,
  clip,
  format,
  src,
  motion,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const total = clip.playFrames + clip.holdFrames;
  const t = total > 1 ? frame / (total - 1) : 0;
  const transform = imageMotionTransform(motion, t, width);
  const moving: React.CSSProperties = { transform, transformOrigin: "50% 50%" };
  const pos = `${clip.focusX * 100}% 50%`;
  const img = (style: React.CSSProperties) => <Img src={src} style={{ width: "100%", height: "100%", ...style }} />;

  const vertical = isVertical(format);
  const imgAspect = source.width / source.height;
  const frameAspect = width / height;
  const coverCrop = 1 - Math.min(imgAspect / frameAspect, frameAspect / imgAspect);
  const cover = vertical ? project.style.vertical.mode === "crop" : coverCrop <= IMAGE_COVER_MAX_CROP;

  if (cover) {
    return (
      <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
        <AbsoluteFill style={moving}>{img({ objectFit: "cover", objectPosition: vertical ? pos : "50% 50%" })}</AbsoluteFill>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      <AbsoluteFill style={{ filter: "blur(40px) brightness(0.55)", transform: "scale(1.25)" }}>
        {img({ objectFit: "cover", objectPosition: pos })}
      </AbsoluteFill>
      <AbsoluteFill style={moving}>{img({ objectFit: "contain" })}</AbsoluteFill>
    </AbsoluteFill>
  );
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
  // §5.11 cut transitions: the footage layer gets the effect while one of these clips is on screen; a cut that
  // has a transition skips the quick punch (the transition replaces it)
  const tr = useCutTransition();
  // absolute output frame (sectionFrom = absolute start of the enclosing Sequence, as for the ducking envelope)
  const abs = useCurrentFrame() + sectionFrom;
  const active =
    !!tr &&
    tr.schedule.length > 0 &&
    clips.some((c) => {
      const a = sectionFrom + c.from;
      return abs >= a && abs < a + c.playFrames + c.holdFrames;
    });
  return (
    <TransitionLayer active={active} absFrame={abs}>
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
        const punch = (i > 0 || punchFirst) && !(tr?.covered.has(sectionFrom + clip.from) ?? false);
        if (isStillImageSource(source)) {
          const motion = project.clips.find((c) => c.id === clip.clipId)?.imageMotion ?? DEFAULT_IMAGE_MOTION;
          return (
            <Sequence key={clip.key} from={clip.from} durationInFrames={duration} premountFor={Math.round(fps)} name={`image ${clip.clipId}`}>
              <CutPunch enabled={punch}>
                <ClipImage
                  project={project}
                  source={source}
                  clip={clip}
                  format={format}
                  src={sourceImageUrl(assetBaseUrl, project, clip.sourceId, useProxy)}
                  motion={motion}
                />
              </CutPunch>
            </Sequence>
          );
        }
        const src = sourceUrl(assetBaseUrl, project, clip.sourceId, useProxy);
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
    </TransitionLayer>
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
