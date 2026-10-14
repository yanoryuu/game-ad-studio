import type React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format, Lang, Project } from "@gas/shared";
import { displayFont } from "../../common/fonts";
import { isVertical, unitFor, withAlpha } from "../../common/theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Rough glyph width in em (CJK full width, Latin per display font). */
function charEm(ch: string, lang: Lang): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp > 0x2e80) return 1;
  if (ch === " ") return 0.28;
  return lang === "en" ? 0.47 : 0.6;
}
const textEm = (s: string, lang: Lang, tracking: number) => {
  let em = 0;
  for (const ch of s) em += charEm(ch, lang) + tracking;
  return em;
};

/** Breaks `words` into `n` lines with the narrowest widest line (greedy on a target width). */
function balance(words: string[], n: number, lang: Lang, tracking: number): string[] {
  if (n <= 1 || words.length <= 1) return [words.join(" ")];
  const total = textEm(words.join(" "), lang, tracking);
  const target = total / n;
  const lines: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    const next = [...cur, w].join(" ");
    if (cur.length > 0 && textEm(next, lang, tracking) > target * 1.08 && lines.length < n - 1) {
      lines.push(cur.join(" "));
      cur = [w];
    } else cur.push(w);
  }
  if (cur.length) lines.push(cur.join(" "));
  return lines;
}

/** Chooses line breaks + font size for a big card text. Explicit newlines are kept; long lines may wrap by words / spaces. */
export function fitCardText(
  text: string,
  lang: Lang,
  maxW: number,
  maxH: number,
  base: number,
  tracking: number,
  lineHeight: number,
): { lines: string[]; fontSize: number } {
  const paras = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let best = { lines: paras, fontSize: 0 };
  for (let extra = 0; extra <= 2; extra++) {
    const lines: string[] = [];
    for (const p of paras) {
      const words = p.split(/[ 　]+/).filter(Boolean);
      const n = Math.min(words.length, 1 + extra);
      lines.push(...balance(words, n, lang, tracking));
    }
    const widest = Math.max(...lines.map((l) => textEm(l, lang, tracking)));
    const size = Math.min(base, maxW / Math.max(1, widest), maxH / (lines.length * lineHeight));
    // prefer fewer lines unless wrapping makes the type clearly bigger
    if (size > best.fontSize * 1.15) best = { lines, fontSize: size };
  }
  return best;
}

/**
 * Full-screen trailer text card: black, faint accent haze, big tracked-out type that sharpens in from a blur
 * and slowly widens / pushes, accent hairlines growing from the center, light streak on entry.
 */
export const TrailerCard: React.FC<{ project: Project; format: Format; lang: Lang; text: string; cardNo: number }> = ({
  project,
  format,
  lang,
  text,
  cardNo,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const u = unitFor(width, height);
  const vertical = isVertical(format);
  const font = displayFont(lang);
  const accent = project.style.accentColor;
  const color = project.style.primaryColor;
  const f = (sec: number) => Math.max(2, Math.round(sec * fps));

  const display = font.uppercase ? text.toUpperCase() : text;
  const trackFrom = lang === "en" ? 0.06 : 0.1;
  const trackTo = lang === "en" ? 0.2 : 0.24;
  const lineHeight = lang === "en" ? 1.08 : 1.25;
  const maxW = width * (vertical ? 0.84 : 0.78);
  const maxH = height * (vertical ? 0.4 : 0.5);
  const base = (lang === "en" ? (vertical ? 200 : 175) : vertical ? 150 : 140) * u;
  const { lines, fontSize } = fitCardText(display, lang, maxW, maxH, base, trackTo, lineHeight);

  const p = interpolate(frame, [0, durationInFrames], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
  const tracking = trackFrom + (trackTo - trackFrom) * p;
  const scale = 1.0 + 0.06 * p;
  const inP = interpolate(frame, [0, f(0.28)], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const blur = (1 - inP) * 18 * u;
  const outP = interpolate(frame, [durationInFrames - f(0.12), durationInFrames], [1, 0], clamp);
  const opacity = inP * outP;
  // entry streak: a bright horizontal line sweeping out from the center
  const streak = interpolate(frame, [0, f(0.35)], [0, 1], { ...clamp, easing: Easing.out(Easing.exp) });
  const streakAlpha = interpolate(frame, [0, f(0.08), f(0.45)], [0, 1, 0], clamp);
  const hair = interpolate(frame, [f(0.1), f(0.6)], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  // alternate: odd cards slightly drift up, even ones down
  const drift = (cardNo % 2 === 0 ? -1 : 1) * 10 * u * p;

  const blockH = lines.length * fontSize * lineHeight;
  const hairW = Math.min(maxW, width * 0.42) * hair;

  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse ${vertical ? "90% 40%" : "60% 50%"} at 50% 50%, ${withAlpha(accent, 0.13)} 0%, rgba(0,0,0,0) 70%)`,
          opacity: outP,
        }}
      />
      {/* light streak */}
      <div
        style={{
          position: "absolute",
          left: width * (0.5 - 0.5 * streak),
          width: width * streak,
          top: height / 2 - 1.5 * u,
          height: 3 * u,
          background: `linear-gradient(90deg, rgba(255,255,255,0) 0%, ${withAlpha(accent, 0.9)} 30%, #ffffff 50%, ${withAlpha(accent, 0.9)} 70%, rgba(255,255,255,0) 100%)`,
          boxShadow: `0 0 ${30 * u}px ${12 * u}px ${withAlpha(accent, 0.35)}`,
          opacity: streakAlpha,
        }}
      />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            transform: `translateY(${drift.toFixed(2)}px) scale(${scale.toFixed(4)})`,
            opacity,
            filter: blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : undefined,
          }}
        >
          <div style={{ width: hairW, height: Math.max(1, 2 * u), backgroundColor: accent, marginBottom: fontSize * 0.32, boxShadow: `0 0 ${10 * u}px ${withAlpha(accent, 0.8)}` }} />
          <div style={{ height: blockH, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            {lines.map((line, i) => (
              <div
                key={i}
                style={{
                  fontFamily: font.fontFamily,
                  fontWeight: font.fontWeight,
                  fontSize,
                  lineHeight,
                  letterSpacing: `${tracking.toFixed(4)}em`,
                  // tracking adds space after the last glyph too -> re-center
                  marginRight: `-${tracking.toFixed(4)}em`,
                  color,
                  textAlign: "center",
                  whiteSpace: "nowrap",
                  textShadow: `0 0 ${24 * u}px ${withAlpha(accent, 0.45)}, 0 0 ${2 * u}px rgba(255,255,255,0.4)`,
                }}
              >
                {line}
              </div>
            ))}
          </div>
          <div style={{ width: hairW, height: Math.max(1, 2 * u), backgroundColor: accent, marginTop: fontSize * 0.32, boxShadow: `0 0 ${10 * u}px ${withAlpha(accent, 0.8)}` }} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
