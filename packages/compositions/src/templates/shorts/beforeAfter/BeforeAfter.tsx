import type React from "react";
import { AbsoluteFill, interpolate, Sequence } from "remotion";
import type { Lang, Project } from "@gas/shared";
import { displayFont } from "../../../common/fonts";
import { readableOn, withAlpha } from "../../../common/theme";
import type { PlacedClip } from "../../../common/clips";
import type { TemplateRenderProps } from "../../types";
import {
  gameLayout,
  pop,
  shake,
  ShortGameplay,
  ShortShell,
  SlamText,
  StripBackground,
  stripRect,
  TopBand,
  TopBanner,
  useShortFrame,
  type GameLayout,
} from "../common";
import { BEFORE_AFTER, type BeforeAfterTimeline } from "./timeline";

type Props = TemplateRenderProps<BeforeAfterTimeline>;
type Side = "before" | "after";

/** "old footage" grade of the BEFORE part / vivid grade of the AFTER part */
const BEFORE_FILTER = "grayscale(0.72) sepia(0.4) contrast(0.86) brightness(0.86)";
const AFTER_FILTER = "saturate(1.3) contrast(1.06)";

const sideWord = (side: Side) => (side === "before" ? "BEFORE" : "AFTER");
const labelOf = (tl: BeforeAfterTimeline, side: Side) => (side === "before" ? tl.beforeLabel : tl.afterLabel) || sideWord(side);

/* ------------------------------------------------------------------ */
/* Parts                                                                */
/* ------------------------------------------------------------------ */

/** Worn-tape overlay of the BEFORE footage: scanlines, vignette, a rolling tracking band and grain flicker. */
const OldTape: React.FC = () => {
  const { frame, fps, height, u } = useShortFrame();
  const roll = ((frame / fps) * 0.45) % 1.3;
  const flicker = 0.05 + 0.04 * Math.abs(Math.sin(frame * 1.7));
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background: `repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) ${2 * u}px, transparent ${2 * u}px, transparent ${5 * u}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${(roll - 0.15) * 100}%`,
          height: Math.max(8, height * 0.012),
          background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.18), transparent)",
          filter: "blur(1px)",
        }}
      />
      <AbsoluteFill style={{ backgroundColor: `rgba(255,240,210,${flicker})`, mixBlendMode: "overlay" }} />
      <AbsoluteFill style={{ boxShadow: `inset 0 0 ${120 * u}px rgba(0,0,0,0.75)` }} />
    </AbsoluteFill>
  );
};

/**
 * State tag on the footage: small "BEFORE"/"AFTER" over the big label (sub / note). BEFORE = grey worn tag,
 * AFTER = accent tag that is stamped in at `stampAt` (scale 1.9 -> 1 + shake). Legible from its first frame.
 */
const StateTag: React.FC<{ project: Project; lang: Lang; side: Side; text: string; size: number; stampAt?: number; style?: React.CSSProperties }> = ({
  project,
  lang,
  side,
  text,
  size,
  stampAt = 0,
  style,
}) => {
  const { frame, fps, u } = useShortFrame();
  const accent = project.style.accentColor;
  const p = pop(frame, fps, stampAt, { stiff: true });
  const sh = side === "after" ? shake(frame, stampAt + 1, Math.round(fps * 0.3), 10 * u) : { x: 0, y: 0, r: 0 };
  const after = side === "after";
  const bg = after ? accent : "#3a3a3a";
  const fg = after ? readableOn(accent) : "#e9e4d8";
  const word = sideWord(side);
  const showWord = text.toUpperCase() !== word;
  const font = displayFont(lang);
  return (
    <div
      style={{
        position: "absolute",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        transformOrigin: "0% 50%",
        transform: `translate(${sh.x}px, ${sh.y}px) rotate(${(after ? -4 : -2) + sh.r}deg) scale(${interpolate(p, [0, 1], [after ? 1.9 : 1.15, 1])})`,
        ...style,
      }}
    >
      {showWord ? (
        <div
          style={{
            fontFamily: displayFont("en").fontFamily,
            fontSize: size * 0.4,
            letterSpacing: "0.18em",
            color: after ? "#111318" : "#ffffff",
            backgroundColor: after ? "#ffffff" : "#000000",
            padding: `${size * 0.04}px ${size * 0.2}px`,
            marginLeft: size * 0.12,
            lineHeight: 1.15,
          }}
        >
          {word}
        </div>
      ) : null}
      <div
        lang={lang}
        style={{
          fontFamily: font.fontFamily,
          fontWeight: font.fontWeight,
          fontSize: size,
          lineHeight: 1.08,
          textTransform: font.uppercase ? "uppercase" : "none",
          whiteSpace: "nowrap",
          color: fg,
          backgroundColor: bg,
          padding: `${size * 0.1}px ${size * 0.34}px ${size * 0.12}px`,
          border: after ? `${Math.max(3, size * 0.06)}px solid #ffffff` : `${Math.max(2, size * 0.04)}px dashed rgba(255,255,255,0.55)`,
          boxShadow: after ? `0 ${size * 0.1}px 0 rgba(0,0,0,0.55), 0 0 ${size * 0.5}px ${withAlpha(accent, 0.7)}` : `0 ${size * 0.08}px 0 rgba(0,0,0,0.6)`,
          filter: after ? undefined : "sepia(0.4)",
        }}
      >
        {text}
      </div>
    </div>
  );
};

/** Band kicker: "1年前 ▶ 今" pills; the active side is lit (switches at the hard cut). */
const TimeChip: React.FC<{ project: Project; lang: Lang; tl: BeforeAfterTimeline; size: number }> = ({ project, lang, tl, size }) => {
  const { frame, fps } = useShortFrame();
  const accent = project.style.accentColor;
  const isAfter = frame >= tl.switchAt;
  const p = pop(frame, fps, tl.switchAt, { stiff: true });
  const font = displayFont(lang);
  const pill = (side: Side, active: boolean, scale: number) => (
    <div
      lang={lang}
      style={{
        fontFamily: font.fontFamily,
        fontWeight: font.fontWeight,
        fontSize: size,
        lineHeight: 1.1,
        textTransform: font.uppercase ? "uppercase" : "none",
        whiteSpace: "nowrap",
        padding: `${size * 0.14}px ${size * 0.5}px`,
        borderRadius: size,
        color: active ? (side === "after" ? readableOn(accent) : "#111318") : "rgba(255,255,255,0.5)",
        backgroundColor: active ? (side === "after" ? accent : "#d9d4c7") : "rgba(255,255,255,0.08)",
        border: `${Math.max(2, size * 0.06)}px solid ${active ? "transparent" : "rgba(255,255,255,0.25)"}`,
        transform: `scale(${scale})`,
        boxShadow: active && side === "after" ? `0 0 ${size * 0.6}px ${withAlpha(accent, 0.7)}` : "none",
      }}
    >
      {labelOf(tl, side)}
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.4 }}>
      {pill("before", !isAfter, 1)}
      <div style={{ fontFamily: displayFont("en").fontFamily, fontSize: size * 0.9, color: isAfter ? accent : "rgba(255,255,255,0.6)", lineHeight: 1 }}>▶</div>
      {pill("after", isAfter, isAfter ? interpolate(p, [0, 1], [1.35, 1]) : 1)}
    </div>
  );
};

/** 2-frame white flash of the hard cut (no fade into it, no fade out of it beyond the 2 frames). */
const HardFlash: React.FC<{ at: number }> = ({ at }) => {
  const { frame } = useShortFrame();
  const t = frame - at;
  if (t < 0 || t >= BEFORE_AFTER.FLASH_FRAMES + 1) return null;
  return <AbsoluteFill style={{ backgroundColor: "#ffffff", opacity: t < BEFORE_AFTER.FLASH_FRAMES ? 1 : 0.35 }} />;
};

/* ------------------------------------------------------------------ */
/* Comparison                                                           */
/* ------------------------------------------------------------------ */

/** One comparison pane: footage (cover) in a box, graded, with its tag. Slides in from `from` (px offset). */
const Pane: React.FC<{
  props: Props;
  side: Side;
  clips: PlacedClip[];
  box: { left: number; top: number; width: number; height: number };
  slideFrom: { x: number; y: number };
  tagSize: number;
  tagPos: React.CSSProperties;
}> = ({ props, side, clips, box, slideFrom, tagSize, tagPos }) => {
  const { project, lang, timeline, assetBaseUrl, useProxy } = props;
  const { frame, fps } = useShortFrame();
  const p = pop(frame, fps, side === "before" ? 0 : 2, { stiff: true });
  const dx = interpolate(p, [0, 1], [slideFrom.x, 0]);
  const dy = interpolate(p, [0, 1], [slideFrom.y, 0]);
  return (
    <div style={{ position: "absolute", ...box, overflow: "hidden", backgroundColor: "#000", transform: `translate(${dx}px, ${dy}px)` }}>
      <ShortGameplay
        project={project}
        layout="full16"
        clips={clips}
        assetBaseUrl={assetBaseUrl}
        useProxy={useProxy}
        sectionFrom={timeline.compareFrom}
        filter={side === "before" ? BEFORE_FILTER : AFTER_FILTER}
      >
        {side === "before" ? <OldTape /> : null}
      </ShortGameplay>
      <StateTag project={project} lang={lang} side={side} text={labelOf(timeline, side)} size={tagSize} style={tagPos} />
    </div>
  );
};

const Compare: React.FC<Props & { layout: GameLayout }> = (props) => {
  const { project, timeline, layout } = props;
  const { frame, fps, width, height, u } = useShortFrame();
  const accent = project.style.accentColor;
  const p = pop(frame, fps, 4, { stiff: true });
  const arrow = (glyph: string, style: React.CSSProperties) => (
    <div
      style={{
        position: "absolute",
        width: 120 * u,
        height: 120 * u,
        borderRadius: "50%",
        backgroundColor: accent,
        color: readableOn(accent),
        border: `${6 * u}px solid #ffffff`,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: displayFont("en").fontFamily,
        fontSize: 56 * u,
        boxShadow: `0 0 ${40 * u}px ${withAlpha(accent, 0.8)}, 0 ${8 * u}px 0 rgba(0,0,0,0.5)`,
        transform: `scale(${interpolate(p, [0, 1], [0.2, 1])})`,
        ...style,
      }}
    >
      {glyph}
    </div>
  );
  if (layout === "full16") {
    const half = width / 2;
    const gap = 8 * u;
    return (
      <AbsoluteFill style={{ backgroundColor: "#ffffff" }}>
        <Pane props={props} side="before" clips={timeline.compareBefore} box={{ left: 0, top: 0, width: half - gap / 2, height }} slideFrom={{ x: -half * 0.4, y: 0 }} tagSize={64 * u} tagPos={{ left: 40 * u, top: 40 * u }} />
        <Pane props={props} side="after" clips={timeline.compareAfter} box={{ left: half + gap / 2, top: 0, width: half - gap / 2, height }} slideFrom={{ x: half * 0.4, y: 0 }} tagSize={64 * u} tagPos={{ left: 40 * u, top: 40 * u }} />
        {arrow("▶", { left: half - 60 * u, top: height * 0.42 - 60 * u })}
      </AbsoluteFill>
    );
  }
  // 9:16: stacked. strip layout: both panes inside [212, 1264) (captions stay below); full: two halves.
  const top = layout === "strip" ? 212 * u : 0;
  const bottom = layout === "strip" ? stripRect(width, u).bottom : height;
  const gap = 12 * u;
  const h = (bottom - top - gap) / 2;
  const tagTop = layout === "full" ? 220 * u : 24 * u;
  return (
    <AbsoluteFill>
      <StripBackground project={project} />
      <AbsoluteFill style={{ top, height: bottom - top, backgroundColor: "#ffffff" }} />
      <Pane props={props} side="before" clips={timeline.compareBefore} box={{ left: 0, top, width, height: h }} slideFrom={{ x: -width * 0.5, y: 0 }} tagSize={60 * u} tagPos={{ left: 36 * u, top: tagTop }} />
      <Pane props={props} side="after" clips={timeline.compareAfter} box={{ left: 0, top: top + h + gap, width, height: h }} slideFrom={{ x: width * 0.5, y: 0 }} tagSize={60 * u} tagPos={{ left: 36 * u, top: 24 * u }} />
      {arrow("▼", { right: (120 + 40) * u, top: top + h + gap / 2 - 60 * u })}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Body                                                                 */
/* ------------------------------------------------------------------ */

const Body: React.FC<Props> = (props) => {
  const { project, format, lang, timeline, assetBaseUrl, useProxy } = props;
  const { frame, fps, u } = useShortFrame();
  const layout = gameLayout(project, format);
  const vertical = layout !== "full16";
  const isAfter = frame >= timeline.switchAt;
  const side: Side = isAfter ? "after" : "before";
  const tagSize = (vertical ? 76 : 70) * u;
  const tagPos: React.CSSProperties =
    layout === "strip" ? { left: 36 * u, top: 28 * u } : layout === "full" ? { left: 36 * u, top: 700 * u } : { left: 48 * u, top: 300 * u };
  const tag = <StateTag key={side} project={project} lang={lang} side={side} text={labelOf(timeline, side)} size={tagSize} stampAt={isAfter ? timeline.switchAt : 0} style={tagPos} />;
  const showMain = timeline.compareFrom > 0;
  const stampFrames = Math.max(8, Math.min(Math.round(fps * 0.75), timeline.compareFrom - timeline.switchAt));

  return (
    <AbsoluteFill>
      {showMain ? (
        <Sequence from={0} durationInFrames={timeline.compareFrom} layout="none" name="before / after">
          <ShortGameplay
            project={project}
            layout={layout}
            clips={timeline.clips}
            cuts={timeline.cuts}
            assetBaseUrl={assetBaseUrl}
            useProxy={useProxy}
            filter={isAfter ? AFTER_FILTER : BEFORE_FILTER}
          >
            {isAfter ? null : <OldTape />}
            {layout === "strip" ? tag : null}
            {timeline.switchAt > 0 ? (
              <Sequence from={timeline.switchAt} durationInFrames={stampFrames} layout="none" name="after stamp">
                <SlamText project={project} lang={lang} text={labelOf(timeline, "after")} maxHeight={layout === "strip" ? 380 * u : 520 * u} maxWidth={720 * u} color={project.style.accentColor} fromScale={2.2} exitAt={stampFrames - 6} />
              </Sequence>
            ) : null}
          </ShortGameplay>
          {vertical ? (
            timeline.title ? (
              <TopBand
                project={project}
                lang={lang}
                text={timeline.title}
                variant={layout === "full" ? "scrim" : "dark"}
                kicker={<TimeChip project={project} lang={lang} tl={timeline} size={(lang === "en" ? 40 : 38) * u} />}
              />
            ) : (
              <div style={{ position: "absolute", left: 0, right: 0, top: 230 * u, display: "flex", justifyContent: "center" }}>
                <TimeChip project={project} lang={lang} tl={timeline} size={52 * u} />
              </div>
            )
          ) : (
            <>
              {timeline.title ? <TopBanner project={project} lang={lang} text={timeline.title} variant="dark" /> : null}
              <div style={{ position: "absolute", right: 56 * u, top: 44 * u, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <TimeChip project={project} lang={lang} tl={timeline} size={34 * u} />
              </div>
            </>
          )}
          {layout === "strip" ? null : tag}
          {timeline.switchAt > 0 ? <HardFlash at={timeline.switchAt} /> : null}
        </Sequence>
      ) : null}
      {timeline.compareFrom < timeline.bodyFrames ? (
        <Sequence from={timeline.compareFrom} durationInFrames={timeline.bodyFrames - timeline.compareFrom} name="compare">
          <Compare {...props} layout={layout} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

/** Template "before-after" visuals: BEFORE (old grade) -> hard cut -> AFTER (vivid) -> comparison, then the end card. */
export const BeforeAfter: React.FC<Props> = (props) => (
  <ShortShell project={props.project} format={props.format} lang={props.lang} assetBaseUrl={props.assetBaseUrl} timeline={props.timeline}>
    <Body {...props} />
  </ShortShell>
);
