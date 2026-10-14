import type React from "react";
import { Audio, interpolate, useVideoConfig } from "remotion";
import type { Project } from "@gas/shared";
import { assetUrl } from "./urls";
import { bgmDuckGain } from "./audioMix";
import { useDuckEnvelope } from "./mixContext";

const FADE_IN_SEC = 0.15;

/**
 * Background music: bgm.volume, ducked by bgm.duckingDb while narration plays (smooth ramps),
 * loop (or play once), short fade-in and fadeOutSec at the end of the video.
 * Mounted at the top level, so the volume-callback frame is the absolute output frame
 * (loopVolumeCurveBehavior="extend" keeps counting across loop iterations).
 */
export const Bgm: React.FC<{ project: Project; assetBaseUrl: string }> = ({ project, assetBaseUrl }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const env = useDuckEnvelope();
  const bgm = project.audio.bgm;
  if (!bgm || bgm.volume <= 0) return null;
  const fadeOut = Math.min(durationInFrames - 1, Math.round(bgm.fadeOutSec * fps));
  const fadeIn = Math.min(Math.round(FADE_IN_SEC * fps), Math.max(1, durationInFrames - fadeOut - 1));
  return (
    <Audio
      src={assetUrl(assetBaseUrl, project.id, bgm.path)}
      loop={bgm.loop}
      loopVolumeCurveBehavior="extend"
      volume={(f) => {
        const inGain = fadeIn > 0 ? interpolate(f, [0, fadeIn], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
        const outGain =
          fadeOut > 0
            ? interpolate(f, [durationInFrames - fadeOut, durationInFrames - 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
            : 1;
        return bgm.volume * inGain * outGain * bgmDuckGain(bgm.duckingDb, env, f);
      }}
    />
  );
};
