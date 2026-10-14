import type React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { withAlpha } from "../../common/theme";

/** Frames of each half of the accent wipe between two sections. */
export const wipeFrames = (fps: number) => Math.max(3, Math.round(fps * 0.2));

/**
 * Skewed accent panel sweeping left -> right. "in": covers the screen by the end of the window
 * (placed over the last frames of a section); "out": starts covering and uncovers (first frames of
 * the next section). Together they read as one continuous swipe across the cut.
 */
export const Wipe: React.FC<{ dir: "in" | "out"; accent: string }> = ({ dir, accent }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const n = wipeFrames(fps);
  const t = interpolate(frame, [0, n], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: dir === "in" ? Easing.in(Easing.cubic) : Easing.out(Easing.cubic),
  });
  // panel is 1.6x wide + skewed; x = 0 means fully covering
  const span = width * 1.75;
  const x = dir === "in" ? interpolate(t, [0, 1], [-span, 0]) : interpolate(t, [0, 1], [0, span]);
  const panel = (offset: number, color: string): React.CSSProperties => ({
    position: "absolute",
    top: "-10%",
    bottom: "-10%",
    left: "-30%",
    width: "160%",
    transform: `translateX(${x + offset}px) skewX(-16deg)`,
    background: color,
  });
  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      {/* trailing dark panel, leading accent panel with a bright edge */}
      <div style={panel(-width * 0.1, "#07080c")} />
      <div style={{ ...panel(0, accent), boxShadow: `0 0 ${width * 0.03}px ${withAlpha(accent, 0.9)}` }} />
    </AbsoluteFill>
  );
};
