import type React from "react";
import { Audio, interpolate, useVideoConfig } from "remotion";
import type { Project } from "@gas/shared";
import { assetUrl } from "./urls";
import { bgmBandDuckGains, bgmDuckGain } from "./audioMix";
import { useDuckEnvelope } from "./mixContext";

const FADE_IN_SEC = 0.15;

/**
 * Background music: bgm.volume, ducked while narration plays (smooth ramps),
 * loop (or play once), short fade-in and fadeOutSec at the end of the video.
 * Mounted at the top level, so the volume-callback frame is the absolute output frame
 * (loopVolumeCurveBehavior="extend" keeps counting across loop iterations).
 *
 * Ducking (ARCHITECTURE §5.3 / §5.3.1):
 *  - "volume": one <Audio>, × 10^(duckingDb/20) under narration.
 *  - "band" (default; needs bgm.voiceCarvePath and duckingDb < 0): the original and its voice-carved copy play
 *    in sync (same loop / fades) and are crossfaded by the duck envelope — original × (1 - env),
 *    carved × env × 10^(duckingDb/2/20). Falls back to "volume" while the carved file is missing.
 */
export const Bgm: React.FC<{ project: Project; assetBaseUrl: string }> = ({ project, assetBaseUrl }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const env = useDuckEnvelope();
  const bgm = project.audio.bgm;
  if (!bgm || bgm.volume <= 0) return null;
  const fadeOut = Math.min(durationInFrames - 1, Math.round(bgm.fadeOutSec * fps));
  const fadeIn = Math.min(Math.round(FADE_IN_SEC * fps), Math.max(1, durationInFrames - fadeOut - 1));
  const base = (f: number) => {
    const inGain = fadeIn > 0 ? interpolate(f, [0, fadeIn], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
    const outGain =
      fadeOut > 0
        ? interpolate(f, [durationInFrames - fadeOut, durationInFrames - 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        : 1;
    return bgm.volume * inGain * outGain;
  };
  const band = (bgm.duckMode ?? "band") === "band" && !!bgm.voiceCarvePath && bgm.duckingDb < 0;
  if (!band) {
    return (
      <Audio
        src={assetUrl(assetBaseUrl, project.id, bgm.path)}
        loop={bgm.loop}
        loopVolumeCurveBehavior="extend"
        volume={(f) => base(f) * bgmDuckGain(bgm.duckingDb, env, f)}
      />
    );
  }
  return (
    <>
      <Audio
        src={assetUrl(assetBaseUrl, project.id, bgm.path)}
        loop={bgm.loop}
        loopVolumeCurveBehavior="extend"
        volume={(f) => base(f) * bgmBandDuckGains(bgm.duckingDb, env, f).dry}
      />
      <Audio
        src={assetUrl(assetBaseUrl, project.id, bgm.voiceCarvePath!)}
        loop={bgm.loop}
        loopVolumeCurveBehavior="extend"
        volume={(f) => base(f) * bgmBandDuckGains(bgm.duckingDb, env, f).wet}
      />
    </>
  );
};
