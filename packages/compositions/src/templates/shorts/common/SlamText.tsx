import type React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import type { Lang, Project } from "@gas/shared";
import { clamp, pop, shake, useShortFrame } from "./anim";
import { BigText } from "./BigText";
import { fitFont } from "./layout";

/**
 * Big "slam" text: lands from scale `fromScale` (default 1.35) to 1 with a hard spring, a short screen-shake and
 * an impact ring — but it is fully opaque from its first frame (legible on frame 0, no fade from black).
 * Centered in its parent box by default (`AbsoluteFill`); size with `fontSize` or let it fit `maxWidth` / `maxHeight`.
 * Optional `exitAt` (frames, relative): scales/fades out over `exitFrames` from there.
 */
export const SlamText: React.FC<{
  project: Project;
  lang: Lang;
  text: string;
  /** fixed size (px). Default: fitted to maxWidth/maxHeight from base 190 en / 150 ja (× u) */
  fontSize?: number;
  maxWidth?: number;
  maxHeight?: number;
  color?: string;
  ink?: string;
  emphasisColor?: string;
  delay?: number;
  fromScale?: number;
  /** rotate a few degrees while landing (default -4) */
  tilt?: number;
  /** screen-shake amplitude (px × u) at the impact; 0 = off. Default 14 */
  shakeAmp?: number;
  /** a burst ring behind the text at the impact. Default true */
  ring?: boolean;
  exitAt?: number;
  exitFrames?: number;
  /** wrapper style (position it with top/left/... — default: centered AbsoluteFill) */
  style?: React.CSSProperties;
}> = ({
  project,
  lang,
  text,
  fontSize,
  maxWidth,
  maxHeight,
  color = "#ffffff",
  ink = "#000000",
  emphasisColor,
  delay = 0,
  fromScale = 1.35,
  tilt = -4,
  shakeAmp = 14,
  ring = true,
  exitAt,
  exitFrames = 6,
  style,
}) => {
  const { frame, fps, width, height, u } = useShortFrame();
  if (frame < delay) return null;
  const p = pop(frame, fps, delay, { stiff: true });
  const mw = maxWidth ?? width * 0.88;
  const size = fontSize ?? fitFont(text, lang, { base: (lang === "en" ? 190 : 150) * u, maxWidth: mw, maxHeight: maxHeight ?? height * 0.5, minRatio: 0.3 });
  const sh = shake(frame, delay + 2, Math.round(fps * 0.35), shakeAmp * u);
  const exit = exitAt !== undefined ? interpolate(frame, [exitAt, exitAt + exitFrames], [0, 1], clamp) : 0;
  const scale = interpolate(p, [0, 1], [fromScale, 1]) * (1 - 0.25 * exit);
  const ringT = interpolate(frame - delay, [1, Math.round(fps * 0.45)], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: 1 - exit, ...style }}>
      {ring && ringT > 0 && ringT < 1 ? (
        <div
          style={{
            position: "absolute",
            width: size * 3.2 * (0.5 + ringT),
            height: size * 3.2 * (0.5 + ringT),
            borderRadius: "50%",
            border: `${(1 - ringT) * 18 * u}px solid ${project.style.accentColor}`,
            opacity: 1 - ringT,
          }}
        />
      ) : null}
      <div style={{ maxWidth: mw, transform: `translate(${sh.x}px, ${sh.y}px) rotate(${interpolate(p, [0, 1], [tilt, 0]) + sh.r}deg) scale(${scale})` }}>
        <BigText text={text} lang={lang} fontSize={size} emphasisColor={emphasisColor ?? project.style.emphasisColor} color={color} ink={ink} />
      </div>
    </AbsoluteFill>
  );
};
