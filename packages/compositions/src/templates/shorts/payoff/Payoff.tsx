import type React from "react";
import { AbsoluteFill, interpolate, Sequence, spring } from "remotion";
import type { Lang, Project } from "@gas/shared";
import { displayFont } from "../../../common/fonts";
import { withAlpha } from "../../../common/theme";
import type { TemplateRenderProps } from "../../types";
import {
  clamp,
  gameLayout,
  ProgressGauge,
  pulse,
  shake,
  ShortGameplay,
  ShortShell,
  SlamText,
  stripRect,
  TopBand,
  TopBanner,
  useShortFrame,
  V916,
  type GameLayout,
} from "../common";
import { gaugeValue, type PayoffTimeline } from "./timeline";

type Props = TemplateRenderProps<PayoffTimeline>;

/** 9:16 band height (reference px): leaves a row for the gauge above the strip. */
const BAND_H = 556;

const rand = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/* ------------------------------------------------------------------ */
/* Gauge row                                                            */
/* ------------------------------------------------------------------ */

const GaugeRow: React.FC<{ project: Project; lang: Lang; tl: PayoffTimeline; width: number; barH: number }> = ({ project, lang, tl, width, barH }) => {
  const { frame, fps, u } = useShortFrame();
  const v = gaugeValue(tl, frame);
  const full = frame >= tl.payFrom;
  const hot = v > 0.75 || full;
  const accent = project.style.accentColor;
  const blink = full ? (Math.floor((frame - tl.payFrom) / Math.max(1, Math.round(fps * 0.08))) % 2 === 0 ? 1 : 0) : 0;
  const color = full ? (blink ? "#ffffff" : accent) : v > 0.75 ? "#ff4d2e" : accent;
  const sh = hot && !full ? shake(frame, frame - 1, 3, (v - 0.75) * 14 * u) : { x: 0, y: 0, r: 0 };
  const font = displayFont("en");
  const label = lang === "ja" ? "溜め" : "CHARGE";
  const pct = full ? "MAX!!" : `${Math.round(v * 100)}%`;
  const labelSize = barH * 0.95;
  const p = full ? spring({ frame: frame - tl.payFrom, fps, config: { damping: 8, stiffness: 260, mass: 0.6 } }) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 * u, width, transform: `translate(${sh.x}px, ${sh.y}px) scale(${1 + 0.08 * Math.sin(p * Math.PI)})` }}>
      <div
        lang={lang}
        style={{
          fontFamily: lang === "ja" ? displayFont("ja").fontFamily : font.fontFamily,
          fontWeight: lang === "ja" ? 900 : 400,
          fontSize: labelSize,
          lineHeight: 1,
          color: "#ffffff",
          letterSpacing: "0.04em",
          textShadow: `0 0 ${10 * u}px ${withAlpha(accent, 0.8)}, 0 ${3 * u}px 0 #000`,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <ProgressGauge value={v} width={width * 0.62} height={barH} color={color} segments={10} style={{ width: "100%" }} />
      </div>
      <div
        style={{
          fontFamily: font.fontFamily,
          fontSize: labelSize * (full ? 1.15 : 1),
          lineHeight: 1,
          minWidth: labelSize * 2.6,
          textAlign: "right",
          color: full ? accent : hot ? "#ff6a4d" : "#ffffff",
          textShadow: `0 0 ${(full ? 24 : 8) * u}px ${withAlpha(full ? accent : "#000000", 0.9)}, 0 ${3 * u}px 0 #000`,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pct}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Build-up tension + payoff burst                                      */
/* ------------------------------------------------------------------ */

/** Speed lines + accent vignette that grow with the charge (inside the gameplay box). */
const Tension: React.FC<{ project: Project; tl: PayoffTimeline }> = ({ project, tl }) => {
  const { frame, fps, u } = useShortFrame();
  if (frame >= tl.payFrom) return null;
  const v = gaugeValue(tl, frame);
  const accent = project.style.accentColor;
  const lines = v > 0.45 ? Math.round((v - 0.45) * 40) : 0;
  const step = Math.floor(frame / 2);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 50%, transparent ${70 - 25 * v}%, ${withAlpha(accent, 0.15 + 0.35 * v)} 100%)` }} />
      {Array.from({ length: lines }, (_, i) => {
        const a = rand(step * 13 + i) * 360;
        const len = 18 + rand(step * 7 + i) * 22;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: `${len}%`,
              height: (2 + rand(i + step) * 3) * u,
              background: `linear-gradient(90deg, transparent, ${withAlpha("#ffffff", 0.75)})`,
              transformOrigin: "0% 50%",
              transform: `rotate(${a}deg) translateX(${(48 - len * 0.2) * 2}%)`,
            }}
          />
        );
      })}
      {v > 0.8 ? <AbsoluteFill style={{ border: `${(6 + 10 * Math.abs(Math.sin(frame / fps * 18))) * u}px solid ${withAlpha("#ff4d2e", 0.7)}` }} /> : null}
    </AbsoluteFill>
  );
};

/** Burst rays + debris behind/around the payoff (relative to the payoff Sequence). */
const Burst: React.FC<{ project: Project; centerY: number; clipBottom?: number }> = ({ project, centerY, clipBottom }) => {
  const { frame, fps, width, height, u } = useShortFrame();
  const accent = project.style.accentColor;
  const k = interpolate(frame, [0, fps * 0.6], [1, 0.35], clamp);
  const boxH = clipBottom ?? height;
  const cy = (centerY / boxH) * 100;
  const parts = Array.from({ length: 28 }, (_, i) => {
    const a = rand(i + 1) * Math.PI * 2;
    const sp = 0.6 + rand(i + 50) * 0.9;
    const d = interpolate(frame, [0, fps * 1.2], [0, sp], { ...clamp, easing: (t) => 1 - (1 - t) ** 2 });
    return { x: width / 2 + Math.cos(a) * d * width * 0.7, y: centerY + Math.sin(a) * d * width * 0.7, o: interpolate(frame, [fps * 0.5, fps * 1.4], [1, 0], clamp), s: (12 + rand(i + 7) * 22) * u, r: frame * (5 + i) };
  });
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden", bottom: height - boxH, height: "auto" }}>
      <AbsoluteFill
        style={{
          background: `repeating-conic-gradient(from ${frame * 2}deg at 50% ${cy}%, ${withAlpha(accent, 0.38 * k)} 0deg 7deg, transparent 7deg 18deg)`,
          mixBlendMode: "screen",
        }}
      />
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% ${cy}%, ${withAlpha("#ffffff", 0.35 * k)} 0%, transparent 45%)` }} />
      {parts.map((p, i) =>
        p.o > 0 ? (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p.x,
              top: p.y,
              width: p.s,
              height: p.s * (i % 2 ? 0.45 : 1),
              backgroundColor: i % 3 === 0 ? "#ffffff" : accent,
              opacity: p.o,
              transform: `rotate(${p.r}deg)`,
              boxShadow: `0 0 ${10 * u}px ${withAlpha(accent, 0.8)}`,
            }}
          />
        ) : null,
      )}
    </AbsoluteFill>
  );
};

/** Camera: build-up creep zoom + payoff zoom punch + shake (absolute body frames). */
const useCamera = (tl: PayoffTimeline) => {
  const { frame, fps, u } = useShortFrame();
  if (frame < tl.payFrom) {
    const v = tl.gauge ? gaugeValue(tl, frame) : frame / Math.max(1, tl.payFrom);
    const jitter = v > 0.7 ? (v - 0.7) * 10 * u : 0;
    return { scale: 1 + 0.035 * v, x: (rand(frame) - 0.5) * jitter, y: (rand(frame + 31) - 0.5) * jitter, r: 0, white: 0 };
  }
  const t = frame - tl.payFrom;
  const punch = spring({ frame: t, fps, config: { damping: 9, stiffness: 200, mass: 0.7 } });
  const sh = shake(frame, tl.payFrom, Math.round(fps * 0.7), 26 * u);
  return {
    scale: interpolate(punch, [0, 1], [1.4, 1]),
    x: sh.x,
    y: sh.y,
    r: sh.r,
    white: interpolate(t, [0, Math.round(fps * 0.4)], [1, 0], clamp),
  };
};

/* ------------------------------------------------------------------ */
/* Layouts                                                              */
/* ------------------------------------------------------------------ */

const Vertical: React.FC<Props & { layout: GameLayout }> = ({ project, lang, timeline: tl, assetBaseUrl, useProxy, layout }) => {
  const { frame, fps, width, height, u } = useShortFrame();
  const cam = useCamera(tl);
  const strip = stripRect(width, u);
  const centerY = layout === "full" ? height * 0.45 : strip.top + strip.height / 2;
  const slamH = 540 * u;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `translate(${cam.x}px, ${cam.y}px) rotate(${cam.r}deg) scale(${cam.scale})` }}>
        <ShortGameplay project={project} layout={layout} clips={tl.clips} cuts={tl.cuts} assetBaseUrl={assetBaseUrl} useProxy={useProxy}>
          <Tension project={project} tl={tl} />
        </ShortGameplay>
      </AbsoluteFill>
      {frame >= tl.payFrom ? (
        <Sequence from={tl.payFrom} layout="none" name="burst">
          <Burst project={project} centerY={centerY} clipBottom={layout === "full" ? undefined : strip.bottom} />
        </Sequence>
      ) : null}
      {tl.title ? (
        <TopBand
          project={project}
          lang={lang}
          text={tl.title}
          variant={layout === "full" ? "scrim" : "dark"}
          height={tl.gauge ? BAND_H : V916.bandH}
        />
      ) : null}
      {tl.gauge ? (
        <div style={{ position: "absolute", left: 44 * u, right: 44 * u, top: (BAND_H + 18) * u, display: "flex", justifyContent: "center" }}>
          <GaugeRow project={project} lang={lang} tl={tl} width={width - 88 * u} barH={52 * u} />
        </div>
      ) : null}
      {tl.note && frame >= tl.payFrom ? (
        <Sequence from={tl.payFrom} layout="none" name="note">
          <NoteSlam project={project} lang={lang} text={tl.note} maxWidth={width * 0.9} maxHeight={slamH} style={{ top: centerY - slamH / 2 - 40 * u, height: slamH + 80 * u, bottom: "auto" }} />
        </Sequence>
      ) : null}
      {cam.white > 0 ? <AbsoluteFill style={{ backgroundColor: "#ffffff", opacity: cam.white }} /> : null}
    </AbsoluteFill>
  );
};

/** note slam that keeps breathing after landing. */
const NoteSlam: React.FC<{ project: Project; lang: Lang; text: string; maxWidth: number; maxHeight: number; style: React.CSSProperties }> = ({ project, lang, text, maxWidth, maxHeight, style }) => {
  const { frame, fps } = useShortFrame();
  const breathe = frame > fps * 0.5 ? pulse(frame, fps, 0.03, 1.5) : 1;
  return (
    <AbsoluteFill style={{ transform: `scale(${breathe})` }}>
      <SlamText project={project} lang={lang} text={text} maxWidth={maxWidth} maxHeight={maxHeight} fromScale={2.0} shakeAmp={0} tilt={-6} style={style} />
    </AbsoluteFill>
  );
};

const Horizontal: React.FC<Props> = ({ project, lang, timeline: tl, assetBaseUrl, useProxy }) => {
  const { frame, width, height, u } = useShortFrame();
  const cam = useCamera(tl);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `translate(${cam.x}px, ${cam.y}px) rotate(${cam.r}deg) scale(${cam.scale})` }}>
        <ShortGameplay project={project} layout="full16" clips={tl.clips} cuts={tl.cuts} assetBaseUrl={assetBaseUrl} useProxy={useProxy}>
          <Tension project={project} tl={tl} />
        </ShortGameplay>
      </AbsoluteFill>
      {frame >= tl.payFrom ? (
        <Sequence from={tl.payFrom} layout="none" name="burst">
          <Burst project={project} centerY={height * 0.48} />
        </Sequence>
      ) : null}
      {tl.title ? <TopBanner project={project} lang={lang} text={tl.title} variant="dark" /> : null}
      {tl.gauge ? (
        <div style={{ position: "absolute", right: 60 * u, top: 50 * u }}>
          <GaugeRow project={project} lang={lang} tl={tl} width={width * 0.34} barH={34 * u} />
        </div>
      ) : null}
      {tl.note && frame >= tl.payFrom ? (
        <Sequence from={tl.payFrom} layout="none" name="note">
          <NoteSlam project={project} lang={lang} text={tl.note} maxWidth={width * 0.8} maxHeight={height * 0.5} style={{ bottom: height * 0.1, height: "auto" }} />
        </Sequence>
      ) : null}
      {cam.white > 0 ? <AbsoluteFill style={{ backgroundColor: "#ffffff", opacity: cam.white }} /> : null}
    </AbsoluteFill>
  );
};

/** Template "payoff" visuals: hype band + accelerating build-up (+ charge gauge) -> payoff burst, then the end card. */
export const Payoff: React.FC<Props> = (props) => {
  const layout = gameLayout(props.project, props.format);
  return (
    <ShortShell project={props.project} format={props.format} lang={props.lang} assetBaseUrl={props.assetBaseUrl} timeline={props.timeline}>
      {layout === "full16" ? <Horizontal {...props} /> : <Vertical {...props} layout={layout} />}
    </ShortShell>
  );
};
