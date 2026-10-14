import type React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format, Project } from "@gas/shared";
import { ClipTrack } from "../../common/ClipTrack";
import { isVertical } from "../../common/theme";
import type { TrailerElement } from "./timeline";

type CutEl = Extract<TrailerElement, { type: "cut" }>;

/** How a cut comes in. Hard cuts land on the beat; the entrance only dresses the first few frames. */
type Entrance = "fromBlack" | "flash" | "whipLeft" | "pop" | "whipRight";

function entranceFor(cutNo: number, afterCard: boolean): Entrance {
  if (cutNo === 0) return "fromBlack";
  if (afterCard) return "flash";
  return (["flash", "whipLeft", "pop", "whipRight"] as const)[cutNo % 4]!;
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * One trailer cut: the clip (via common ClipTrack -> 16:9 cover / 9:16 blur|crop, ducking, proxy placeholder),
 * a slow camera push, a cinematic grade + vignette, letterbox bars (16:9) and a quick entrance
 * (flash / whip with directional motion blur / exposure pop). Micro "kick" on every beat inside the cut.
 */
export const TrailerCut: React.FC<{
  project: Project;
  format: Format;
  el: CutEl;
  assetBaseUrl: string;
  useProxy: boolean;
  afterCard: boolean;
  /** beat frames relative to this cut (excluding its start) */
  beatFrames: number[];
}> = ({ project, format, el, assetBaseUrl, useProxy, afterCard, beatFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const vertical = isVertical(format);
  const kind = entranceFor(el.cutNo, afterCard);
  const f = (sec: number) => Math.max(2, Math.round(sec * fps));

  // slow camera push (alternating in / out and drifting origin, so consecutive cuts feel different)
  const pushIn = el.cutNo % 2 === 0;
  const push = interpolate(frame, [0, Math.max(1, durationInFrames)], pushIn ? [1.0, 1.075] : [1.075, 1.0], clamp);
  const origins = ["50% 50%", "42% 48%", "58% 52%", "50% 40%"];
  const origin = origins[el.cutNo % origins.length]!;

  // beat kick: tiny zoom bump decaying over ~0.15 s
  let kick = 0;
  for (const b of beatFrames) {
    const d = frame - b;
    if (d >= 0 && d < f(0.15)) kick = Math.max(kick, interpolate(d, [0, f(0.15)], [0.025, 0], clamp));
  }

  // entrance
  const whipLen = f(0.2);
  let x = 0;
  let blurX = 0;
  let flash = 0;
  let black = 0;
  let exposure = 1;
  let entranceScale = 1;
  if (kind === "whipLeft" || kind === "whipRight") {
    const dir = kind === "whipLeft" ? 1 : -1;
    const p = interpolate(frame, [0, whipLen], [1, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
    x = dir * p * width * 0.42;
    blurX = p * 70 * (width / 1920);
    exposure = 1 + p * 0.35;
  } else if (kind === "flash") {
    flash = interpolate(frame, [0, f(0.16)], [0.95, 0], { ...clamp, easing: Easing.out(Easing.quad) });
    entranceScale = interpolate(frame, [0, f(0.3)], [1.1, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  } else if (kind === "pop") {
    exposure = interpolate(frame, [0, f(0.14)], [1.9, 1], clamp);
    entranceScale = interpolate(frame, [0, f(0.25)], [1.16, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  } else {
    black = interpolate(frame, [0, f(0.25)], [1, 0], clamp);
  }

  const filterId = `trailer-mb-${el.clip.key}`;
  const grade = `contrast(1.12) saturate(1.12) brightness(${(0.96 * exposure).toFixed(3)})`;
  const letterbox = vertical ? 0 : Math.round(height * 0.068);

  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      {blurX > 0.5 ? (
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <filter id={filterId} x="-10%" y="0%" width="120%" height="100%">
            <feGaussianBlur stdDeviation={`${blurX.toFixed(1)} 0`} />
          </filter>
        </svg>
      ) : null}
      <AbsoluteFill
        style={{
          transform: `translateX(${x.toFixed(1)}px) scale(${(push * entranceScale + kick).toFixed(4)})`,
          transformOrigin: origin,
          filter: `${blurX > 0.5 ? `url(#${filterId}) ` : ""}${grade}`,
        }}
      >
        <ClipTrack
          project={project}
          clips={[el.clip]}
          format={format}
          assetBaseUrl={assetBaseUrl}
          useProxy={useProxy}
          sectionFrom={el.from}
          punchFirst={false}
        />
      </AbsoluteFill>
      {/* cinematic vignette + slight cool shadows / warm highlights */}
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(10,30,60,0.18) 0%, rgba(0,0,0,0) 40%, rgba(60,25,0,0.12) 100%)", mixBlendMode: "soft-light" }} />
      {letterbox > 0 ? (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: letterbox, backgroundColor: "black" }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: letterbox, backgroundColor: "black" }} />
        </>
      ) : null}
      {flash > 0.01 ? <AbsoluteFill style={{ backgroundColor: "white", opacity: flash, mixBlendMode: "screen" }} /> : null}
      {black > 0.01 ? <AbsoluteFill style={{ backgroundColor: "black", opacity: black }} /> : null}
    </AbsoluteFill>
  );
};
