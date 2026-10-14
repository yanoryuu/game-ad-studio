import type React from "react";
import type { Lang } from "@gas/shared";
import { BODY_FONT, displayFont } from "../../../common/fonts";
import { withAlpha } from "../../../common/theme";
import { useShortFrame } from "./anim";

/**
 * Progress gauge (charge meter / timer bar / vote bar): rounded track, `value` 0..1 fill with gloss + moving
 * stripes, glow that grows with the value, optional `label` (left/top) and `valueText` (right).
 * `segments` > 0 draws notches. `vertical` = fills bottom -> top. Size with `width` / `height` (px, × u).
 * `value` is controlled by the caller (animate it from the frame).
 */
export const ProgressGauge: React.FC<{
  value: number;
  width: number;
  height: number;
  color: string;
  lang?: Lang;
  label?: string;
  valueText?: string;
  vertical?: boolean;
  segments?: number;
  /** track color. Default dark glass */
  track?: string;
  style?: React.CSSProperties;
}> = ({ value, width, height, color, lang = "en", label, valueText, vertical = false, segments = 0, track = "rgba(0,0,0,0.55)", style }) => {
  const { frame, u } = useShortFrame();
  const v = Math.max(0, Math.min(1, value));
  const thick = vertical ? width : height;
  const r = thick / 2;
  const move = (frame * 2 * u) % (thick * 1.2);
  const labelSize = Math.max(18 * u, thick * 0.55);
  const font = displayFont(lang);
  const fill: React.CSSProperties = vertical
    ? { left: 0, right: 0, bottom: 0, height: `${v * 100}%` }
    : { top: 0, bottom: 0, left: 0, width: `${v * 100}%` };
  return (
    <div style={{ display: "flex", flexDirection: vertical ? "column-reverse" : "column", gap: 8 * u, alignItems: vertical ? "center" : "stretch", ...style }}>
      {label || valueText ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 * u }}>
          {label ? (
            <div style={{ fontFamily: BODY_FONT, fontWeight: 900, fontSize: labelSize, color: "#fff", textShadow: "0 2px 6px rgba(0,0,0,0.9)", whiteSpace: "nowrap" }}>{label}</div>
          ) : (
            <div />
          )}
          {valueText ? (
            <div style={{ fontFamily: font.fontFamily, fontWeight: font.fontWeight, fontSize: labelSize * 1.1, color, textShadow: "0 2px 6px rgba(0,0,0,0.9)" }}>{valueText}</div>
          ) : null}
        </div>
      ) : null}
      <div
        style={{
          position: "relative",
          width,
          height,
          borderRadius: r,
          backgroundColor: track,
          border: `${Math.max(2, 3 * u)}px solid rgba(255,255,255,0.85)`,
          overflow: "hidden",
          boxShadow: `0 0 ${(10 + 40 * v) * u}px ${withAlpha(color, 0.25 + 0.6 * v)}, 0 ${4 * u}px ${12 * u}px rgba(0,0,0,0.5)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            ...fill,
            borderRadius: r,
            backgroundColor: color,
            backgroundImage: [
              "linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 55%)",
              `repeating-linear-gradient(${vertical ? 0 : 115}deg, rgba(255,255,255,0.18) ${move}px, rgba(255,255,255,0.18) ${move + thick * 0.3}px, transparent ${move + thick * 0.3}px, transparent ${move + thick * 0.6}px)`,
            ].join(", "),
          }}
        />
        {segments > 1
          ? Array.from({ length: segments - 1 }, (_, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  backgroundColor: "rgba(0,0,0,0.35)",
                  ...(vertical
                    ? { left: 0, right: 0, height: Math.max(2, 3 * u), bottom: `${((i + 1) / segments) * 100}%` }
                    : { top: 0, bottom: 0, width: Math.max(2, 3 * u), left: `${((i + 1) / segments) * 100}%` }),
                }}
              />
            ))
          : null}
      </div>
    </div>
  );
};
