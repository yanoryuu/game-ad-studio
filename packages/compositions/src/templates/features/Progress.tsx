import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BODY_FONT } from "../../common/fonts";
import { readableOn, unitFor, withAlpha } from "../../common/theme";

/**
 * Feature progress: numbered dots ①-②-③ joined by rails. Done = accent, current = accent + pop + ring,
 * upcoming = outlined. The rail after the current dot fills with the section's progress.
 */
export const FeatureProgress: React.FC<{
  index: number;
  count: number;
  accent: string;
  /** frames of the enclosing feature section */
  sectionFrames: number;
  /** frame (relative to the section) at which the indicator appears */
  delay: number;
  size?: number;
}> = ({ index, count, accent, sectionFrames, delay, size = 1 }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = unitFor(width, height) * size;
  if (count < 2) return null;
  const d = 40 * u;
  const rail = 34 * u;
  const appear = interpolate(frame - delay, [0, 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pop = spring({ frame: frame - delay - 2, fps, config: { damping: 9, stiffness: 260, mass: 0.6 } });
  const progress = interpolate(frame, [0, Math.max(1, sectionFrames)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fg = readableOn(accent);
  const items: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const done = i < index;
    const cur = i === index;
    const scale = cur ? interpolate(pop, [0, 1], [0.6, 1.18]) : 1;
    items.push(
      <div
        key={`d${i}`}
        style={{
          width: d,
          height: d,
          borderRadius: "50%",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: BODY_FONT,
          fontWeight: 900,
          fontSize: 22 * u,
          lineHeight: 1,
          transform: `scale(${scale})`,
          backgroundColor: cur ? accent : done ? withAlpha(accent, 0.55) : "rgba(0,0,0,0.45)",
          color: cur || done ? fg : "rgba(255,255,255,0.8)",
          border: cur || done ? "none" : `${2.5 * u}px solid rgba(255,255,255,0.7)`,
          boxSizing: "border-box",
          boxShadow: cur ? `0 0 0 ${4 * u}px ${withAlpha(accent, 0.3)}, 0 ${4 * u}px ${14 * u}px rgba(0,0,0,0.55)` : `0 ${3 * u}px ${10 * u}px rgba(0,0,0,0.45)`,
        }}
      >
        {i + 1}
      </div>,
    );
    if (i < count - 1) {
      const fill = i < index ? 1 : i === index ? progress : 0;
      items.push(
        <div
          key={`r${i}`}
          style={{
            width: rail,
            height: 5 * u,
            borderRadius: 3 * u,
            margin: `0 ${6 * u}px`,
            backgroundColor: "rgba(255,255,255,0.3)",
            overflow: "hidden",
            boxShadow: `0 ${2 * u}px ${6 * u}px rgba(0,0,0,0.4)`,
          }}
        >
          <div style={{ width: `${fill * 100}%`, height: "100%", backgroundColor: accent }} />
        </div>,
      );
    }
  }
  return <div style={{ display: "flex", alignItems: "center", opacity: appear }}>{items}</div>;
};
