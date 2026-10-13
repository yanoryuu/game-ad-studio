import type React from "react";
import { Audio, interpolate, useVideoConfig } from "remotion";
import type { Project } from "@gas/shared";
import { assetUrl } from "./urls";

/** Background music: looped, project volume, short fade-in and fadeOutSec at the end. */
export const Bgm: React.FC<{ project: Project; assetBaseUrl: string }> = ({ project, assetBaseUrl }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const bgm = project.bgm;
  if (!bgm || bgm.volume <= 0) return null;
  const fadeOut = Math.min(durationInFrames - 1, Math.round(bgm.fadeOutSec * fps));
  const fadeIn = Math.min(Math.round(0.15 * fps), Math.max(1, durationInFrames - fadeOut - 1));
  return (
    <Audio
      src={assetUrl(assetBaseUrl, project.id, bgm.path)}
      loop
      volume={(f) => {
        const inGain = interpolate(f, [0, fadeIn], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const outGain =
          fadeOut > 0
            ? interpolate(f, [durationInFrames - fadeOut, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
            : 1;
        return bgm.volume * inGain * outGain;
      }}
    />
  );
};
