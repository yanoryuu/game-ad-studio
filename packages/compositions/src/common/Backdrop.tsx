import type React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Project } from "@gas/shared";
import { assetUrl } from "./urls";
import { withAlpha } from "./theme";

/**
 * Background used when there is no gameplay footage, and behind the end card:
 * key art (blurred/darkened, slow zoom) or, without key art, a dark gradient tinted with the accent color.
 */
export const Backdrop: React.FC<{
  project: Project;
  assetBaseUrl: string;
  blurPx: number;
  brightness: number;
}> = ({ project, assetBaseUrl, blurPx, brightness }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const zoom = interpolate(frame, [0, Math.max(1, durationInFrames)], [1.08, 1.18]);
  const accent = project.style.accentColor;
  const keyArt = project.game.keyArt;

  if (keyArt) {
    return (
      <AbsoluteFill style={{ backgroundColor: "#05060a", overflow: "hidden" }}>
        <Img
          src={assetUrl(assetBaseUrl, project.id, keyArt)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${zoom})`,
            filter: `blur(${blurPx}px) brightness(${brightness}) saturate(1.15)`,
          }}
        />
      </AbsoluteFill>
    );
  }

  const drift = interpolate(frame, [0, Math.max(1, durationInFrames)], [0, width * 0.08]);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#07080d",
        backgroundImage: [
          `radial-gradient(circle at ${30 + drift / width * 100}% 35%, ${withAlpha(accent, 0.35)} 0%, transparent 45%)`,
          `radial-gradient(circle at ${75 - drift / width * 100}% 75%, ${withAlpha(accent, 0.18)} 0%, transparent 50%)`,
          "linear-gradient(160deg, #141826 0%, #07080d 70%)",
        ].join(", "),
      }}
    />
  );
};
