import type React from "react";
import { AbsoluteFill, interpolate, Sequence } from "remotion";
import type { Lang, Project } from "@gas/shared";
import { BODY_FONT, displayFont } from "../../../common/fonts";
import { readableOn, withAlpha } from "../../../common/theme";
import type { TemplateRenderProps } from "../../types";
import {
  BigText,
  clamp,
  fitFont,
  gameLayout,
  pop,
  pulse,
  SAFE916,
  shake,
  ShortGameplay,
  ShortShell,
  stripRect,
  TopBand,
  useShortFrame,
  type GameLayout,
} from "../common";
import type { DevlogTimeline } from "./timeline";

type Props = TemplateRenderProps<DevlogTimeline>;

const MONO = "Consolas, 'Courier New', monospace";
const dayWord = "DAY";
const nextText = (lang: Lang, day: number) => (lang === "ja" ? `次回 DAY ${day + 1}` : `NEXT: DAY ${day + 1}`);

/* ------------------------------------------------------------------ */
/* Parts                                                                */
/* ------------------------------------------------------------------ */

/** Small "DAY n" badge (accent block, mono-ish display type). */
const DayBadge: React.FC<{ project: Project; day: number; size: number; delay?: number }> = ({ project, day, size, delay = 0 }) => {
  const { frame, fps } = useShortFrame();
  const accent = project.style.accentColor;
  const p = pop(frame, fps, delay, { stiff: true });
  const f = displayFont("en").fontFamily;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: size * 0.22,
        padding: `${size * 0.08}px ${size * 0.34}px ${size * 0.1}px`,
        backgroundColor: accent,
        color: readableOn(accent),
        fontFamily: f,
        lineHeight: 1,
        borderRadius: size * 0.12,
        boxShadow: `0 ${size * 0.1}px 0 rgba(0,0,0,0.55)`,
        transform: `rotate(-3deg) scale(${interpolate(p, [0, 1], [0.4, 1])})`,
        transformOrigin: "0% 50%",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: size * 0.62, letterSpacing: "0.12em" }}>{dayWord}</span>
      <span style={{ fontSize: size }}>{day}</span>
    </div>
  );
};

/** Series tag pill ("#indiedev"), dark glass with a hash-colored accent. */
const TagPill: React.FC<{ project: Project; lang: Lang; text: string; size: number; delay?: number }> = ({ project, lang, text, size, delay = 0 }) => {
  const { frame, fps } = useShortFrame();
  const p = pop(frame, fps, delay);
  return (
    <div
      lang={lang}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: `${size * 0.22}px ${size * 0.6}px`,
        borderRadius: size,
        backgroundColor: "rgba(0,0,0,0.6)",
        border: `${Math.max(2, size * 0.06)}px solid ${withAlpha(project.style.accentColor, 0.7)}`,
        color: "#ffffff",
        fontFamily: BODY_FONT,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 1.1,
        whiteSpace: "nowrap",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        transform: `translateX(${interpolate(p, [0, 1], [-30, 0])}px)`,
      }}
    >
      {text}
    </div>
  );
};

/** Camcorder overlay on the footage: viewfinder corners, REC dot + running timecode, faint grain lines. */
const Viewfinder: React.FC<{ day: number; inset: number; size: number; recTop?: number }> = ({ day, inset, size, recTop }) => {
  const { frame, fps, u } = useShortFrame();
  const t = frame / fps;
  const tc = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}:${String(Math.floor((frame % fps) * (30 / fps))).padStart(2, "0")}`;
  const blink = Math.floor(t * 2) % 2 === 0;
  const arm = size * 2.2;
  const w = Math.max(3, size * 0.12);
  const corner = (pos: React.CSSProperties, b: React.CSSProperties) => (
    <div style={{ position: "absolute", width: arm, height: arm, ...pos, ...b }} />
  );
  const line = `${w}px solid rgba(255,255,255,0.85)`;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: `repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) ${1 * u}px, transparent ${1 * u}px, transparent ${4 * u}px)` }} />
      {corner({ left: inset, top: inset }, { borderLeft: line, borderTop: line })}
      {corner({ right: inset, top: inset }, { borderRight: line, borderTop: line })}
      {corner({ left: inset, bottom: inset }, { borderLeft: line, borderBottom: line })}
      {corner({ right: inset, bottom: inset }, { borderRight: line, borderBottom: line })}
      <div
        style={{
          position: "absolute",
          right: inset + size * 0.6,
          top: recTop ?? inset + size * 0.5,
          display: "flex",
          alignItems: "center",
          gap: size * 0.35,
          fontFamily: MONO,
          fontWeight: 700,
          fontSize: size * 0.8,
          color: "#ffffff",
          textShadow: "0 0 4px rgba(0,0,0,0.9), 0 2px 0 rgba(0,0,0,0.8)",
          whiteSpace: "nowrap",
        }}
      >
        <div style={{ width: size * 0.62, height: size * 0.62, borderRadius: "50%", backgroundColor: "#ff2a2a", opacity: blink ? 1 : 0.25, boxShadow: "0 0 8px #ff2a2a" }} />
        <span>REC</span>
        <span style={{ opacity: 0.85 }}>{day > 0 ? `D${day} ` : ""}{tc}</span>
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Giant intro                                                          */
/* ------------------------------------------------------------------ */

/** Giant "DAY n" + theme on a tape label. Fully legible on frame 0; shrinks away during the settle. */
const Intro: React.FC<Props & { layout: GameLayout }> = ({ project, lang, timeline, layout }) => {
  const { frame, fps, width, height, u } = useShortFrame();
  const { day, title, introFrames, settleFrames } = timeline;
  const accent = project.style.accentColor;
  const vertical = layout !== "full16";
  const land = pop(frame, fps, 0, { stiff: true });
  const out = interpolate(frame, [introFrames, introFrames + settleFrames], [0, 1], clamp);
  const sh = shake(frame, 2, Math.round(fps * 0.3), 12 * u);
  const disp = displayFont("en").fontFamily;
  const digits = String(day);
  // number size: fits the width (Anton digits ~0.5em wide)
  const numSize = Math.min((vertical ? 520 : 400) * u, (width * (vertical ? 0.8 : 0.5)) / Math.max(1, digits.length * 0.5));
  const wordSize = numSize * 0.3;
  const titleSize = title
    ? fitFont(title, lang, { base: (lang === "en" ? 104 : 84) * u, maxWidth: width * (vertical ? 0.78 : 0.6), maxHeight: (vertical ? 300 : 260) * u, minRatio: 0.35 })
    : 0;
  // count-up flicker of the last digit for the first ~0.25 s (number is correct from frame 0 on the thumbnail rule:
  // the final value is shown at frame 0 and again after the flicker)
  const scrim = 0.62 * (1 - out);
  // vertical block center: between the safe top and the caption band (strip bottom)
  const centerY = vertical ? (layout === "strip" ? 740 * u : 820 * u) : height * 0.47;
  const blockScale = interpolate(land, [0, 1], [1.25, 1]) * (1 - 0.6 * out);
  const tapeP = pop(frame, fps, Math.round(fps * 0.12), { stiff: true });
  return (
    <AbsoluteFill style={{ opacity: 1 - out }}>
      <AbsoluteFill style={{ backgroundColor: `rgba(6,7,12,${scrim})` }} />
      {/* notebook grid behind the number */}
      <AbsoluteFill
        style={{
          opacity: 0.5 * (1 - out),
          backgroundImage: `linear-gradient(${withAlpha(accent, 0.16)} ${2 * u}px, transparent ${2 * u}px), linear-gradient(90deg, ${withAlpha(accent, 0.16)} ${2 * u}px, transparent ${2 * u}px)`,
          backgroundSize: `${64 * u}px ${64 * u}px`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: centerY,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          transform: `translate(${sh.x}px, calc(-50% + ${sh.y - out * 200 * u}px)) scale(${blockScale})`,
        }}
      >
        {day > 0 ? (
          <>
            <div style={{ fontFamily: disp, fontSize: wordSize, lineHeight: 1, letterSpacing: "0.3em", color: "#ffffff", textShadow: `0 ${6 * u}px 0 rgba(0,0,0,0.6)`, marginBottom: -numSize * 0.04, paddingLeft: "0.3em" }}>
              {dayWord}
            </div>
            <div
              style={{
                fontFamily: disp,
                fontSize: numSize,
                lineHeight: 0.98,
                color: accent,
                WebkitTextStroke: `${Math.max(3, numSize * 0.018)}px #000`,
                textShadow: `0 ${numSize * 0.03}px 0 #000, 0 0 ${numSize * 0.12}px ${withAlpha(accent, 0.55)}`,
              }}
            >
              {digits}
            </div>
          </>
        ) : null}
        {title ? (
          <div
            style={{
              marginTop: day > 0 ? 14 * u : 0,
              padding: `${18 * u}px ${36 * u}px ${22 * u}px`,
              backgroundColor: "rgba(250,248,240,0.96)",
              boxShadow: `0 ${10 * u}px ${24 * u}px rgba(0,0,0,0.5)`,
              transform: `rotate(${interpolate(tapeP, [0, 1], [-7, -2])}deg) scale(${interpolate(tapeP, [0, 1], [1.2, 1])})`,
              maxWidth: width * (vertical ? 0.86 : 0.66),
              // torn tape edges
              clipPath: `polygon(0 6%, 3% 0, 97% 4%, 100% 0, 99% 94%, 100% 100%, 4% 96%, 0 100%)`,
            }}
          >
            <BigText text={title} lang={lang} fontSize={titleSize} emphasisColor={project.style.emphasisColor} color="#111318" ink="" marker />
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Follow prompt                                                        */
/* ------------------------------------------------------------------ */

const FollowCard: React.FC<{ project: Project; lang: Lang; note: string; day: number; maxWidth: number; vertical: boolean }> = ({ project, lang, note, day, maxWidth, vertical }) => {
  const { frame, fps, u } = useShortFrame();
  const accent = project.style.accentColor;
  const p = pop(frame, fps, 0, { stiff: true });
  const btn = 120 * u;
  const tapAt = Math.round(fps * 0.55);
  const tap = interpolate(frame, [tapAt, tapAt + 4, tapAt + 10], [1, 0.82, 1], clamp);
  const followed = frame >= tapAt + 4;
  const size = fitFont(note, lang, { base: (lang === "en" ? (vertical ? 92 : 80) : vertical ? 76 : 66) * u, maxWidth: maxWidth - btn - 70 * u, maxHeight: 240 * u, minRatio: 0.4 });
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 * u, transform: `scale(${interpolate(p, [0, 1], [1.3, 1])})` }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 30 * u,
          maxWidth,
          padding: `${26 * u}px ${36 * u}px ${26 * u}px ${26 * u}px`,
          borderRadius: 34 * u,
          background: "linear-gradient(180deg, rgba(30,33,46,0.95) 0%, rgba(10,11,18,0.95) 100%)",
          border: `${3 * u}px solid ${withAlpha(accent, 0.8)}`,
          boxShadow: `0 ${16 * u}px ${40 * u}px rgba(0,0,0,0.6), 0 0 ${40 * u}px ${withAlpha(accent, 0.35)}`,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            width: btn,
            height: btn,
            borderRadius: "50%",
            backgroundColor: followed ? "#ffffff" : accent,
            color: followed ? "#111318" : readableOn(accent),
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            fontFamily: BODY_FONT,
            fontWeight: 900,
            fontSize: btn * 0.62,
            lineHeight: 1,
            transform: `scale(${tap * pulse(frame, fps, 0.04, 1.2)})`,
            boxShadow: `0 0 0 ${6 * u}px rgba(255,255,255,0.25), 0 0 ${30 * u}px ${withAlpha(accent, 0.7)}`,
          }}
        >
          {followed ? "✓" : "+"}
        </div>
        <BigText text={note} lang={lang} fontSize={size} emphasisColor={project.style.emphasisColor} align="left" />
      </div>
      {day > 0 ? (
        <div
          style={{
            fontFamily: displayFont("en").fontFamily,
            fontSize: 44 * u,
            letterSpacing: "0.12em",
            color: "#ffffff",
            padding: `${6 * u}px ${24 * u}px`,
            backgroundColor: "rgba(0,0,0,0.6)",
            border: `${2 * u}px dashed rgba(255,255,255,0.6)`,
            borderRadius: 12 * u,
            lineHeight: 1.15,
          }}
        >
          {nextText(lang, day)} ▶
        </div>
      ) : null}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Body                                                                 */
/* ------------------------------------------------------------------ */

const Body: React.FC<Props> = (props) => {
  const { project, format, lang, timeline, assetBaseUrl, useProxy } = props;
  const { frame, width, height, u } = useShortFrame();
  const layout = gameLayout(project, format);
  const vertical = layout !== "full16";
  const { day, tag, title, introFrames, settleFrames, outroFrom, bodyFrames, note } = timeline;
  const settled = introFrames + settleFrames;
  const showChrome = introFrames === 0 || frame >= introFrames;
  const strip = stripRect(width, u);
  const badgeDelay = introFrames;
  const badgeRow = (size: number) => (
    <div style={{ display: "flex", alignItems: "center", gap: 18 * u, maxWidth: width - 2 * 40 * u }}>
      {day > 0 ? <DayBadge project={project} day={day} size={size} delay={badgeDelay} /> : null}
      {tag ? <TagPill project={project} lang={lang} text={tag} size={size * 0.5} delay={badgeDelay + 3} /> : null}
    </div>
  );
  const hasRow = day > 0 || !!tag;

  return (
    <AbsoluteFill>
      <ShortGameplay project={project} layout={layout} clips={timeline.clips} cuts={timeline.cuts} assetBaseUrl={assetBaseUrl} useProxy={useProxy} plain={layout === "strip"} filter="contrast(1.04) saturate(1.05)">
        <Viewfinder
          day={day}
          inset={(layout === "strip" ? 22 : 40) * u}
          size={(layout === "strip" ? 34 : 40) * u}
          recTop={layout === "full" ? (SAFE916.top + (hasRow ? 120 : 20)) * u : undefined}
        />
        {outroFrom < bodyFrames ? (
          <Sequence from={outroFrom} layout="none" name="follow dim">
            <AbsoluteFill style={{ backgroundColor: "rgba(0,0,0,0.45)" }} />
          </Sequence>
        ) : null}
      </ShortGameplay>

      {/* header: band (9:16 strip), scrim header (9:16 full) or top-left stack (16:9) */}
      {layout === "strip" ? (
        <TopBand
          project={project}
          lang={lang}
          text={title || " "}
          variant="dark"
          hideText={!title || !showChrome}
          maxFont={lang === "en" ? 120 : 96}
          kicker={hasRow ? <div style={{ height: 74 * u }} /> : undefined}
          delay={introFrames}
        />
      ) : layout === "full" ? (
        <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 30%)" }} />
      ) : (
        <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 45%)" }} />
      )}
      {showChrome ? (
        <div style={{ position: "absolute", left: (vertical ? 40 : 48) * u, top: vertical ? (SAFE916.top + 6) * u : 40 * u, display: "flex", flexDirection: "column", gap: 18 * u, alignItems: "flex-start" }}>
          {hasRow ? badgeRow((vertical ? 74 : 64) * u) : null}
          {layout !== "strip" && title ? (
            <div style={{ maxWidth: vertical ? width * 0.8 : width * 0.5 }}>
              <BigText
                text={title}
                lang={lang}
                fontSize={fitFont(title, lang, { base: (lang === "en" ? 84 : 66) * u, maxWidth: vertical ? width * 0.8 : width * 0.5, maxHeight: (vertical ? 260 : 220) * u, minRatio: 0.4 })}
                emphasisColor={project.style.emphasisColor}
                align="left"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {introFrames > 0 && frame < settled ? <Intro {...props} layout={layout} /> : null}

      {outroFrom < bodyFrames && note ? (
        <Sequence from={outroFrom} durationInFrames={bodyFrames - outroFrom} name="follow">
          <AbsoluteFill
            style={
              layout === "strip"
                ? { top: strip.top, height: strip.height, justifyContent: "center", alignItems: "center" }
                : layout === "full"
                  ? { top: 600 * u, height: 700 * u, justifyContent: "center", alignItems: "center" }
                  : { top: height * 0.2, height: height * 0.55, justifyContent: "center", alignItems: "center" }
            }
          >
            <FollowCard project={project} lang={lang} note={note} day={day} maxWidth={vertical ? width - 100 * u : width * 0.6} vertical={vertical} />
          </AbsoluteFill>
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

/** Template "devlog" visuals: giant DAY intro -> raw camcorder-style body with DAY badge -> follow prompt -> end card. */
export const Devlog: React.FC<Props> = (props) => (
  <ShortShell project={props.project} format={props.format} lang={props.lang} assetBaseUrl={props.assetBaseUrl} timeline={props.timeline}>
    <Body {...props} />
  </ShortShell>
);
