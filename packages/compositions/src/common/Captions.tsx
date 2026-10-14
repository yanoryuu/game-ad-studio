import type React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format, Lang, Project, VerticalMode } from "@gas/shared";
import type { NarrationPlan } from "./narrationLayout";
import { BODY_FONT } from "./fonts";
import { isVertical, outline, unitFor } from "./theme";
import { RichText, estimateRichEm, estimateWidestUnitEm } from "./RichText";

/* ------------------------------------------------------------------ */
/* Caption items on the output timeline                                 */
/* ------------------------------------------------------------------ */

export type CaptionItem = {
  key: string;
  text: string;
  /** absolute frames [start, end) */
  start: number;
  end: number;
};

/** Gaps between chunks of the same line up to this long are bridged (no flicker between chunks). */
const BRIDGE_SEC = 0.3;

/**
 * Narration captions (line-relative seconds -> absolute frames, clipped to the played part of the line)
 * + manual captions[lang] (output-timeline seconds). ARCHITECTURE §5.2.
 */
export function buildCaptionItems(project: Project, lang: Lang, plan: NarrationPlan, fps: number): CaptionItem[] {
  const items: CaptionItem[] = [];
  const byId = new Map(project.script.map((l) => [l.id, l]));
  const bridge = Math.round(BRIDGE_SEC * fps);
  for (const p of plan.lines) {
    const line = byId.get(p.lineId);
    if (!line || p.durationInFrames <= 0) continue;
    const lineEnd = p.from + p.durationInFrames;
    const chunks = line.captions
      .filter((c) => c.text.trim() && c.endSec > c.startSec)
      .map((c) => ({ text: c.text.trim(), s: p.from + Math.round(c.startSec * fps), e: p.from + Math.round(c.endSec * fps) }))
      .sort((a, b) => a.s - b.s);
    chunks.forEach((c, i) => {
      const next = chunks[i + 1];
      let e = c.e;
      if (next && next.s > e && next.s - e <= bridge) e = next.s;
      // keep the last chunk until the line ends if it ends just before
      if (!next && lineEnd > e && lineEnd - e <= bridge) e = lineEnd;
      e = Math.min(e, lineEnd);
      if (c.s < e) items.push({ key: `${p.lineId}-${i}`, text: c.text, start: c.s, end: e });
    });
  }
  (project.captions[lang] ?? []).forEach((c, i) => {
    const s = Math.round(c.startSec * fps);
    const e = Math.round(c.endSec * fps);
    if (c.text.trim() && e > s) items.push({ key: `manual-${i}`, text: c.text.trim(), start: s, end: e });
  });
  return items;
}

/** v5: caption look (Captions `variant`) */
export type CaptionVariant = "outline" | "plain-dark";
/** v5: explicit caption box (reference px, see Captions `box`) */
export type CaptionBox = { top?: number; bottom?: number; left?: number; right?: number };
const PLAIN_DARK_COLOR = "#0b0b0b";

/** true if a "#rgb"/"#rrggbb" color is light (needs an outline on white) */
function isLightColor(color: string): boolean {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return false;
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const v = parseInt(h, 16);
  return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255 > 0.6;
}

/** Active caption at `frame`: when several overlap, the one that started last wins. */
function activeAt(items: CaptionItem[], frame: number): CaptionItem | null {
  let best: CaptionItem | null = null;
  for (const it of items) {
    if (frame >= it.start && frame < it.end && (!best || it.start >= best.start)) best = it;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

/**
 * Ad-style captions: heavy weight, thick black outline + shadow, pop-in per chunk.
 * Position bottom/center, size m/l. In 9:16 "blur" mode "bottom" sits in the empty band below the
 * (letterboxed) gameplay instead of over it, so HUD elements stay readable; in 9:16 "crop" mode (full-bleed
 * footage) it sits above the bottom ~16% that short-video apps cover with their own UI.
 * v4: 【emphasis】 runs are drawn in `emphasisColor`, EMPHASIS_SCALE x larger, brackets hidden (common/RichText);
 * `scale` multiplies the base font size (templates set it via TemplateTimeline.captionLayout).
 */
export const Captions: React.FC<{
  items: CaptionItem[];
  lang: Lang;
  format: Format;
  /** style.vertical.mode (only matters for 9:16); default "blur" */
  verticalMode?: VerticalMode;
  color: string;
  position: "bottom" | "center";
  size: "m" | "l";
  /** v4: color of 【emphasis】 runs (style.emphasisColor) */
  emphasisColor?: string;
  /** v4: base font size multiplier (default 1) */
  scale?: number;
  /**
   * v5: "outline" (default) = `color` with a thick black outline + shadow and a pop-in; "plain-dark" = near-black
   * text, no dark outline / drop shadow / pop (for white backgrounds, e.g. template trivia; only a WHITE halo, invisible
   * on white, keeps it readable over footage or the end card). 【emphasis】 keeps `emphasisColor` (a light emphasis
   * color gets a thin dark outline so it stays readable on white).
   */
  variant?: CaptionVariant;
  /** v5: font family override (default BODY_FONT) */
  fontFamily?: string;
  /**
   * v5: explicit caption box in reference px (1 = 1px of a 1080p short side, i.e. px of the 1080×1920 / 1920×1080
   * frame), already resolved for this format. Overrides position / verticalMode. top + bottom: centered in the band;
   * only top: hangs from `top`; only bottom: sits on `bottom`. left / right narrow the box (and the max width).
   */
  box?: CaptionBox;
}> = ({ items, lang, format, verticalMode = "blur", color, position, size, emphasisColor = "#FFE14D", scale = 1, variant = "outline", fontFamily, box: area }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const active = activeAt(items, frame);
  if (!active) return null;

  const u = unitFor(width, height);
  const vertical = isVertical(format);
  const local = frame - active.start;
  const pop = spring({ frame: local, fps, config: { damping: 14, stiffness: 320, mass: 0.55 } });
  const opacity = interpolate(local, [0, 2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const base = (vertical ? (size === "l" ? 84 : 68) : size === "l" ? 74 : 58) * u * scale;
  const plain = variant === "plain-dark";
  const areaWidth = area && (area.left !== undefined || area.right !== undefined) ? width - ((area.left ?? 0) + (area.right ?? 0)) * u : null;
  const maxWidth = areaWidth !== null ? Math.min(width * (vertical ? 0.9 : 0.8), areaWidth * 0.96) : width * (vertical ? 0.9 : 0.8);
  // shrink long captions so they stay within ~2 lines
  const em = estimateRichEm(active.text);
  // ...and so the widest unbreakable phrase/word still fits on one line (it would overflow the frame otherwise)
  const unitFit = (maxWidth * 0.94) / estimateWidestUnitEm(active.text, lang);
  const fontSize = Math.min(unitFit, Math.max(base * 0.62, Math.min(base, (maxWidth * 2 * 0.9) / em)));
  const stroke = Math.max(3, fontSize * 0.11);

  let box: React.CSSProperties;
  if (area) {
    const justifyContent = area.top !== undefined && area.bottom !== undefined ? "center" : area.top !== undefined ? "flex-start" : "flex-end";
    box = {
      top: area.top !== undefined ? area.top * u : 0,
      bottom: area.bottom !== undefined ? area.bottom * u : 0,
      left: (area.left ?? 0) * u,
      right: (area.right ?? 0) * u,
      width: "auto",
      height: "auto",
      justifyContent,
      alignItems: "center",
    };
  } else if (position === "center") {
    box = { justifyContent: "center", alignItems: "center" };
  } else if (vertical && verticalMode === "crop") {
    box = { justifyContent: "flex-end", alignItems: "center", paddingBottom: height * 0.16 };
  } else if (vertical) {
    // band below the 16:9 video, which is centered at full width
    const videoBottom = (height + (width * 9) / 16) / 2;
    box = { top: videoBottom + 30 * u, bottom: 150 * u, height: "auto", justifyContent: "center", alignItems: "center" };
  } else {
    box = { justifyContent: "flex-end", alignItems: "center", paddingBottom: 72 * u };
  }

  return (
    <AbsoluteFill style={{ ...box, pointerEvents: "none" }}>
      <div
        key={active.key}
        lang={lang}
        style={{
          maxWidth,
          textAlign: "center",
          fontFamily: fontFamily ?? BODY_FONT,
          fontWeight: 900,
          fontSize,
          lineHeight: 1.28,
          letterSpacing: lang === "ja" ? "0.02em" : "0.01em",
          color: plain ? PLAIN_DARK_COLOR : color,
          textShadow: plain ? outline(stroke * 0.8, "#ffffff") : `${outline(stroke, "#000")}, 0 ${stroke * 1.2}px ${stroke * 3}px rgba(0,0,0,0.75)`,
          transform: plain ? undefined : `translateY(${interpolate(pop, [0, 1], [14 * u, 0])}px) scale(${interpolate(pop, [0, 1], [0.82, 1])})`,
          opacity: plain ? 1 : opacity,
          wordBreak: lang === "ja" ? "keep-all" : "normal",
          overflowWrap: "anywhere",
          lineBreak: "strict",
          textWrap: "balance",
        }}
      >
        <RichText
          text={active.text}
          lang={lang}
          emphasisColor={emphasisColor}
          emphasisStyle={plain && isLightColor(emphasisColor) ? { textShadow: outline(Math.max(2, fontSize * 0.04), PLAIN_DARK_COLOR) } : undefined}
        />
      </div>
    </AbsoluteFill>
  );
};
