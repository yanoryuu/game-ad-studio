import type React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Caption, Format } from "@gas/shared";
import { BODY_FONT } from "./fonts";
import { isVertical, outline, unitFor } from "./theme";

/** Bold outlined bottom captions. Caption times are seconds on the OUTPUT timeline. */
export const Captions: React.FC<{ captions: Caption[]; format: Format; color: string }> = ({ captions, format, color }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  if (captions.length === 0) return null;
  const active = captions.find((c) => frame >= Math.round(c.startSec * fps) && frame < Math.round(c.endSec * fps));
  if (!active || !active.text.trim()) return null;
  const u = unitFor(width, height);
  const local = frame - Math.round(active.startSec * fps);
  const pop = spring({ frame: local, fps, config: { damping: 15, stiffness: 260, mass: 0.6 } });
  const vertical = isVertical(format);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: (vertical ? 360 : 80) * u }}>
      <div
        style={{
          maxWidth: width * (vertical ? 0.88 : 0.8),
          textAlign: "center",
          fontFamily: BODY_FONT,
          fontWeight: 900,
          fontSize: (vertical ? 64 : 60) * u,
          lineHeight: 1.3,
          color,
          textShadow: `${outline(5 * u, "#000")}, 0 ${6 * u}px ${18 * u}px rgba(0,0,0,0.6)`,
          transform: `scale(${interpolate(pop, [0, 1], [0.85, 1])})`,
          opacity: interpolate(local, [0, 3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          whiteSpace: "pre-wrap",
        }}
      >
        {active.text}
      </div>
    </AbsoluteFill>
  );
};
