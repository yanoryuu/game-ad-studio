import type React from "react";
import { AbsoluteFill, interpolate, Sequence } from "remotion";
import type { Lang, Project } from "@gas/shared";
import { displayFont } from "../../../common/fonts";
import { withAlpha } from "../../../common/theme";
import type { TemplateRenderProps } from "../../types";
import {
  Badge,
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
  TopBanner,
  useShortFrame,
  V916,
  type GameLayout,
} from "../common";
import type { ChallengeTimeline } from "./timeline";
import { autoBreak } from "./autoBreak";

type Props = TemplateRenderProps<ChallengeTimeline>;

const RED = "#ff2a2a";
const HAZARD_DARK = "#121212";

/** 9:16: band height (reference px) — shorter with a timer so the timer can straddle the strip's top edge. */
const bandH = (tl: ChallengeTimeline) => (tl.timerSec > 0 ? 580 : V916.bandH);

/** Yellow/black hazard tape. */
const hazard = (u: number, color: string, w = 26) =>
  `repeating-linear-gradient(-45deg, ${color} 0px, ${color} ${w * u}px, ${HAZARD_DARK} ${w * u}px, ${HAZARD_DARK} ${2 * w * u}px)`;

/** Warning triangle icon for the CHALLENGE badge. */
const WarnIcon: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ position: "relative", width: size, height: size * 0.9 }}>
    <div style={{ position: "absolute", inset: 0, background: "#ffffff", clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }} />
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: size * 0.22,
        textAlign: "center",
        fontFamily: displayFont("en").fontFamily,
        fontSize: size * 0.62,
        lineHeight: 1,
        color: RED,
      }}
    >
      !
    </div>
  </div>
);

const ChallengeBadge: React.FC<{ lang: Lang; size: number; delay?: number }> = ({ lang, size, delay = 0 }) => (
  <Badge text="CHALLENGE" lang="en" size={size} bg={RED} fg="#ffffff" variant="skew" icon={<WarnIcon size={size * 0.9} />} delay={delay} rotate={-4} style={{ letterSpacing: lang === "en" ? "0.12em" : "0.1em" }} />
);

/* ------------------------------------------------------------------ */
/* Screen-recording viewfinder                                          */
/* ------------------------------------------------------------------ */

const RecFrame: React.FC<{ rect: { left: number; top: number; width: number; height: number }; timeUp: boolean }> = ({ rect, timeUp }) => {
  const { frame, fps, u } = useShortFrame();
  const corner = Math.min(rect.width, rect.height) * 0.12;
  const t = 7 * u;
  const inset = 22 * u;
  const blink = 0.55 + 0.45 * Math.abs(Math.sin((frame / fps) * Math.PI * (timeUp ? 4 : 1.2)));
  const secs = Math.floor(frame / fps);
  const tc = `00:${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const br = (pos: React.CSSProperties, b: React.CSSProperties) => (
    <div style={{ position: "absolute", width: corner, height: corner, borderColor: "#ffffff", borderStyle: "solid", borderWidth: 0, filter: "drop-shadow(0 0 4px rgba(0,0,0,0.7))", ...pos, ...b }} />
  );
  return (
    <div style={{ position: "absolute", left: rect.left, top: rect.top, width: rect.width, height: rect.height, pointerEvents: "none" }}>
      {/* red recording border */}
      <div style={{ position: "absolute", inset: 0, border: `${5 * u}px solid ${withAlpha(RED, 0.5 + 0.4 * blink)}`, boxShadow: `inset 0 0 ${40 * u}px ${withAlpha(RED, 0.35)}` }} />
      {br({ left: inset, top: inset }, { borderLeftWidth: t, borderTopWidth: t })}
      {br({ right: inset, top: inset }, { borderRightWidth: t, borderTopWidth: t })}
      {br({ left: inset, bottom: inset }, { borderLeftWidth: t, borderBottomWidth: t })}
      {br({ right: inset, bottom: inset }, { borderRightWidth: t, borderBottomWidth: t })}
      <div style={{ position: "absolute", left: inset + 24 * u, top: inset + 22 * u }}>
        <Badge text={`REC ${tc}`} lang="en" size={30 * u} variant="rec" display={false} style={{ letterSpacing: "0.06em" }} />
      </div>
      {/* center crosshair */}
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 44 * u, height: 2 * u, marginLeft: -22 * u, backgroundColor: "rgba(255,255,255,0.45)" }} />
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 2 * u, height: 44 * u, marginTop: -22 * u, backgroundColor: "rgba(255,255,255,0.45)" }} />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Countdown timer                                                      */
/* ------------------------------------------------------------------ */

const fmt = (v: number) => {
  const cs = Math.max(0, Math.floor(v * 100));
  return `${String(Math.floor(cs / 100)).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

const Timer: React.FC<{ tl: ChallengeTimeline; size: number; style?: React.CSSProperties }> = ({ tl, size, style }) => {
  const { frame, fps, u } = useShortFrame();
  const progress = Math.min(1, frame / tl.timerTo);
  const value = tl.timerSec * (1 - progress);
  const timeUp = frame >= tl.timerTo;
  const warn = value <= 3 || timeUp;
  // pulse on every whole second in the warning zone
  const frac = value - Math.floor(value);
  const beat = warn && !timeUp ? interpolate(frac, [0.75, 1], [1, 1.12], clamp) : 1;
  const blink = timeUp ? (Math.floor((frame - tl.timerTo) / Math.max(1, Math.round(fps * 0.12))) % 2 === 0 ? 1 : 0.35) : 1;
  const color = warn ? RED : "#ffffff";
  const p = pop(frame, fps, 0, { stiff: true });
  const sh = timeUp ? shake(frame, tl.timerTo, Math.round(fps * 0.4), 10 * u) : { x: 0, y: 0, r: 0 };
  const font = displayFont("en");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: size * 0.22,
        padding: `${size * 0.1}px ${size * 0.34}px ${size * 0.12}px ${size * 0.22}px`,
        borderRadius: size * 0.22,
        backgroundColor: "rgba(8,8,10,0.92)",
        border: `${4 * u}px solid ${warn ? RED : "#ffffff"}`,
        boxShadow: `0 0 ${(warn ? 36 : 12) * u}px ${withAlpha(warn ? RED : "#000000", warn ? 0.8 : 0.6)}, 0 ${8 * u}px ${20 * u}px rgba(0,0,0,0.6)`,
        transform: `translate(${sh.x}px, ${sh.y}px) scale(${interpolate(p, [0, 1], [0.7, 1]) * beat})`,
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      {/* stopwatch glyph */}
      <div style={{ position: "relative", width: size * 0.62, height: size * 0.62, borderRadius: "50%", border: `${size * 0.07}px solid ${color}`, flexShrink: 0 }}>
        <div style={{ position: "absolute", left: "50%", top: -size * 0.17, width: size * 0.16, height: size * 0.1, marginLeft: -size * 0.08, backgroundColor: color, borderRadius: size * 0.02 }} />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: size * 0.05,
            height: size * 0.22,
            marginLeft: -size * 0.025,
            backgroundColor: color,
            transformOrigin: "50% 0%",
            transform: `rotate(${180 + progress * 360 * Math.max(1, tl.timerSec)}deg)`,
          }}
        />
      </div>
      <div style={{ fontFamily: font.fontFamily, fontSize: size, lineHeight: 1, color, opacity: blink, fontVariantNumeric: "tabular-nums", letterSpacing: "0.03em", textShadow: `0 0 ${18 * u}px ${withAlpha(color, 0.6)}` }}>
        {fmt(value)}
      </div>
      {/* draining bar */}
      <div style={{ position: "absolute", left: 0, bottom: 0, height: 6 * u, width: `${(1 - progress) * 100}%`, backgroundColor: color }} />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Blackout ("結果は…") and the note card                               */
/* ------------------------------------------------------------------ */

const Suspense: React.FC<{ project: Project; lang: Lang; text: string; dur: number; vertical: boolean }> = ({ project, lang, text, dur, vertical }) => {
  const { frame, fps, width, height, u } = useShortFrame();
  const black = interpolate(frame, [0, Math.max(1, Math.round(fps * 0.12))], [0.55, 0.94], clamp);
  const zoom = interpolate(frame, [0, dur], [1, 1.1]);
  const beat = pulse(frame, fps, 0.025, 1.6);
  const p = pop(frame, fps, 0, { stiff: true });
  const shown = autoBreak(text, lang) || "?";
  const size = fitFont(shown, lang, { base: (lang === "en" ? 170 : 150) * u, maxWidth: width * 0.8, maxHeight: vertical ? 420 * u : height * 0.45, minRatio: 0.3 });
  const vig = 0.35 + 0.25 * Math.abs(Math.sin((frame / fps) * Math.PI * 1.6));
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${black})` }} />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 50%, transparent 35%, ${withAlpha(RED, vig)} 100%)` }} />
      <AbsoluteFill
        style={{
          // 9:16: below the timer (which straddles the strip top), above the captions
          top: vertical ? (V916.stripTop + 90) * u : 0,
          bottom: vertical ? (1920 - V916.stripBottom) * u : 0,
          height: "auto",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div style={{ maxWidth: width * 0.82, transform: `scale(${zoom * beat * interpolate(p, [0, 1], [1.25, 1])})` }}>
          <BigText text={shown} lang={lang} fontSize={size} emphasisColor={project.style.emphasisColor} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const NoteCard: React.FC<{ project: Project; lang: Lang; text: string; vertical: boolean }> = ({ project, lang, text, vertical }) => {
  const { frame, fps, width, height, u } = useShortFrame();
  const accent = project.style.accentColor;
  const p = pop(frame, fps, 0, { stiff: true });
  const slide = interpolate(p, [0, 1], [-width * 0.25, 0]);
  const shown = autoBreak(text, lang);
  const size = fitFont(shown, lang, { base: (lang === "en" ? 170 : 140) * u, maxWidth: width * 0.84, maxHeight: height * (vertical ? 0.24 : 0.4), minRatio: 0.3 });
  const tapeH = (vertical ? 70 : 56) * u;
  const centerTop = vertical ? SAFE916.top * u : 0;
  const centerBottom = vertical ? (1920 - V916.stripBottom) * u : 0;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: "rgba(6,6,8,0.82)" }} />
      {/* hazard tapes across the card */}
      <div style={{ position: "absolute", left: -width * 0.1, right: -width * 0.1, top: (vertical ? 360 : 150) * u, height: tapeH, background: hazard(u, accent), transform: `rotate(-4deg) translateX(${slide}px)`, boxShadow: "0 6px 16px rgba(0,0,0,0.6)" }} />
      <div style={{ position: "absolute", left: -width * 0.1, right: -width * 0.1, top: (vertical ? 1180 : 860) * u, height: tapeH, background: hazard(u, accent), transform: `rotate(3deg) translateX(${-slide}px)`, boxShadow: "0 6px 16px rgba(0,0,0,0.6)" }} />
      <AbsoluteFill style={{ top: centerTop, bottom: centerBottom, height: "auto", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 34 * u }}>
        <Badge text={lang === "ja" ? "次はキミの番" : "YOUR TURN"} lang={lang} size={(lang === "en" ? 66 : 58) * u} bg={RED} fg="#ffffff" variant="skew" />
        <div style={{ maxWidth: width * 0.84, transform: `scale(${interpolate(p, [0, 1], [1.2, 1])})` }}>
          <BigText text={shown} lang={lang} fontSize={size} emphasisColor={project.style.emphasisColor} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Title                                                                */
/* ------------------------------------------------------------------ */

const VerticalTitle: React.FC<{ project: Project; lang: Lang; tl: ChallengeTimeline; layout: GameLayout }> = ({ project, lang, tl, layout }) => {
  const { frame, fps, width, u } = useShortFrame();
  const accent = project.style.accentColor;
  const h = bandH(tl);
  const p = pop(frame, fps, 0, { stiff: true });
  const sh = shake(frame, 2, Math.round(fps * 0.4), 12 * u);
  if (!tl.title) {
    return (
      <div style={{ position: "absolute", left: 0, right: 0, top: (SAFE916.top + 40) * u, display: "flex", justifyContent: "center" }}>
        <ChallengeBadge lang={lang} size={84 * u} />
      </div>
    );
  }
  return (
    <TopBand
      project={project}
      lang={lang}
      text={tl.title}
      variant={layout === "full" ? "scrim" : "dark"}
      height={h}
      maxFont={lang === "en" ? 150 : 128}
      kicker={<ChallengeBadge lang={lang} size={(lang === "en" ? 58 : 54) * u} />}
      textStyle={{ transform: `translate(${sh.x}px, ${sh.y}px) scale(${interpolate(p, [0, 1], [1.3, 1])}) rotate(${interpolate(p, [0, 1], [-3, 0])}deg)` }}
      deco={
        <>
          <div style={{ position: "absolute", left: -20 * u, right: -20 * u, top: 120 * u, height: 34 * u, background: hazard(u, accent, 20), opacity: 0.9 }} />
          <div style={{ position: "absolute", right: -60 * u, bottom: -40 * u, width: width * 0.5, height: width * 0.5, borderRadius: "50%", background: `radial-gradient(circle, ${withAlpha(RED, 0.28)} 0%, transparent 65%)` }} />
        </>
      }
    />
  );
};

/* ------------------------------------------------------------------ */
/* Template                                                             */
/* ------------------------------------------------------------------ */

const Vertical: React.FC<Props> = ({ project, format, lang, timeline: tl, assetBaseUrl, useProxy }) => {
  const { frame, width, height, u } = useShortFrame();
  const layout = gameLayout(project, format);
  const strip = stripRect(width, u);
  const rect = layout === "full" ? { left: 0, top: bandH(tl) * u, width, height: height - bandH(tl) * u - SAFE916.bottom * u } : { left: 0, top: strip.top, width, height: strip.height };
  const timeUp = tl.timerSec > 0 && frame >= tl.timerTo;
  const hasSuspense = tl.noteFrom > tl.suspenseFrom;
  return (
    <AbsoluteFill>
      <ShortGameplay project={project} layout={layout} clips={tl.clips} cuts={tl.cuts} assetBaseUrl={assetBaseUrl} useProxy={useProxy} plain />
      <RecFrame rect={rect} timeUp={timeUp} />
      <VerticalTitle project={project} lang={lang} tl={tl} layout={layout} />
      {hasSuspense ? (
        <Sequence from={tl.suspenseFrom} durationInFrames={tl.noteFrom - tl.suspenseFrom} name="suspense">
          <Suspense project={project} lang={lang} text={tl.sub} dur={tl.noteFrom - tl.suspenseFrom} vertical />
        </Sequence>
      ) : null}
      {tl.timerSec > 0 && frame < tl.noteFrom ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: V916.stripTop * u, display: "flex", justifyContent: "center", transform: "translateY(-50%)" }}>
          <Timer tl={tl} size={92 * u} />
        </div>
      ) : null}
      {tl.bodyFrames > tl.noteFrom ? (
        <Sequence from={tl.noteFrom} durationInFrames={tl.bodyFrames - tl.noteFrom} name="note">
          <NoteCard project={project} lang={lang} text={tl.note} vertical />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

const Horizontal: React.FC<Props> = ({ project, lang, timeline: tl, assetBaseUrl, useProxy }) => {
  const { frame, width, height, u } = useShortFrame();
  const timeUp = tl.timerSec > 0 && frame >= tl.timerTo;
  const hasSuspense = tl.noteFrom > tl.suspenseFrom;
  return (
    <AbsoluteFill>
      <ShortGameplay project={project} layout="full16" clips={tl.clips} cuts={tl.cuts} assetBaseUrl={assetBaseUrl} useProxy={useProxy} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 30%)" }} />
      <RecFrame rect={{ left: 18 * u, top: 18 * u, width: width - 36 * u, height: height - 36 * u }} timeUp={timeUp} />
      {tl.title ? (
        <TopBanner project={project} lang={lang} text={tl.title} variant="dark" style={{ top: 120 * u }} kicker={<ChallengeBadge lang={lang} size={40 * u} />} />
      ) : (
        <div style={{ position: "absolute", left: 60 * u, top: 100 * u }}>
          <ChallengeBadge lang={lang} size={64 * u} />
        </div>
      )}
      {hasSuspense ? (
        <Sequence from={tl.suspenseFrom} durationInFrames={tl.noteFrom - tl.suspenseFrom} name="suspense">
          <Suspense project={project} lang={lang} text={tl.sub} dur={tl.noteFrom - tl.suspenseFrom} vertical={false} />
        </Sequence>
      ) : null}
      {tl.timerSec > 0 && frame < tl.noteFrom ? (
        <div style={{ position: "absolute", right: 70 * u, top: 120 * u }}>
          <Timer tl={tl} size={84 * u} />
        </div>
      ) : null}
      {tl.bodyFrames > tl.noteFrom ? (
        <Sequence from={tl.noteFrom} durationInFrames={tl.bodyFrames - tl.noteFrom} name="note">
          <NoteCard project={project} lang={lang} text={tl.note} vertical={false} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

/** Template "challenge" visuals: body (REC viewfinder + challenge band + timer + blackout + note) then the end card. */
export const Challenge: React.FC<Props> = (props) => (
  <ShortShell project={props.project} format={props.format} lang={props.lang} assetBaseUrl={props.assetBaseUrl} timeline={props.timeline}>
    {props.format === "9:16" ? <Vertical {...props} /> : <Horizontal {...props} />}
  </ShortShell>
);
