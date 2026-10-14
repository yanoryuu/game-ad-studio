import type React from "react";
import { AbsoluteFill, interpolate, OffthreadVideo, Sequence } from "remotion";
import type { Lang, Project } from "@gas/shared";
import { displayFont } from "../../../common/fonts";
import { withAlpha } from "../../../common/theme";
import { sourceUrl } from "../../../common/urls";
import type { TemplateRenderProps } from "../../types";
import {
  Badge,
  clamp,
  cutFlash,
  gameLayout,
  pop,
  SAFE916,
  shake,
  ShortGameplay,
  ShortShell,
  SlamText,
  stripRect,
  TextCard,
  TopBand,
  TopBanner,
  useShortFrame,
  type GameLayout,
} from "../common";
import { FAIL_WIN, type FailWinTimeline, type SlowClip } from "./timeline";

type Props = TemplateRenderProps<FailWinTimeline>;

const RED = "#ff1f3d";

/** deterministic 0..1 noise */
const rand = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/* ------------------------------------------------------------------ */
/* Slow-motion clip (local: ClipTrack has no playbackRate)              */
/* ------------------------------------------------------------------ */

const SlowVideo: React.FC<{ project: Project; slow: SlowClip; assetBaseUrl: string; useProxy: boolean }> = ({ project, slow, assetBaseUrl, useProxy }) => {
  const source = project.sources.find((s) => s.id === slow.sourceId);
  if (!source) return null;
  if (useProxy && source.proxyStatus !== "ready") return <AbsoluteFill style={{ backgroundColor: "#0b0d12" }} />;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <OffthreadVideo
        src={sourceUrl(assetBaseUrl, project, slow.sourceId, useProxy)}
        trimBefore={slow.trimBefore}
        playbackRate={FAIL_WIN.SLOW_RATE}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${slow.focusX * 100}% 50%` }}
      />
    </AbsoluteFill>
  );
};

/** Slow-motion dressing: cinematic bars, light vignette, "×0.5" badge. Relative to the slow Sequence. */
const SlowDressing: React.FC<{ lang: Lang; dur: number }> = ({ lang, dur }) => {
  const { frame, fps, u } = useShortFrame();
  const bars = interpolate(frame, [0, fps * 0.2, dur - fps * 0.12, dur], [0, 1, 1, 0], clamp);
  const zoom = interpolate(frame, [0, dur], [1, 1.07]);
  return (
    <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(0,0,0,0.55) 100%)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: `${9 * bars}%`, backgroundColor: "#000" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${9 * bars}%`, backgroundColor: "#000" }} />
      <div style={{ position: "absolute", right: 36 * u, bottom: `calc(${9 * bars}% + ${22 * u}px)` }}>
        <Badge text={lang === "ja" ? "スロー ×0.5" : "SLOW-MO ×0.5"} lang={lang} size={34 * u} bg="#ffffff" fg="#111318" variant="pill" />
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Fail dressing: red flashes, glitch slices, scanlines, FAIL stamp     */
/* ------------------------------------------------------------------ */

const FailGlitch: React.FC<{ tl: FailWinTimeline; lang: Lang }> = ({ tl, lang }) => {
  const { frame, fps, u } = useShortFrame();
  if (frame >= tl.winFrom) return null;
  const hits = [Math.round(fps * 0.25), ...tl.failCuts, Math.round(fps * 0.9), Math.round(fps * 1.9)].filter((f) => f < tl.failTo);
  const flash = cutFlash(hits, frame, fps, 0.35);
  const step = Math.floor(frame / 2);
  const glitchOn = frame >= 3 && (rand(step) > 0.72 || flash > 0.6);
  const slices = glitchOn
    ? Array.from({ length: 3 }, (_, i) => ({
        top: rand(step * 7 + i) * 100,
        h: 1 + rand(step * 3 + i) * 3.5,
        dx: (rand(step * 5 + i) - 0.5) * 80 * u,
        c: i % 2 === 0 ? "rgba(255,0,60,0.22)" : "rgba(0,240,255,0.18)",
      }))
    : [];
  const stampP = pop(frame, fps, Math.round(fps * 0.35), { stiff: true });
  const stampOn = frame >= Math.round(fps * 0.35) && frame < tl.failTo;
  const font = displayFont("en");
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ backgroundColor: RED, mixBlendMode: "multiply", opacity: 0.16 + 0.3 * flash }} />
      <AbsoluteFill style={{ backgroundColor: RED, opacity: 0.45 * flash }} />
      <AbsoluteFill
        style={{
          background: `repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) ${2 * u}px, transparent ${2 * u}px, transparent ${5 * u}px)`,
        }}
      />
      {slices.map((s, i) => (
        <div key={i} style={{ position: "absolute", left: 0, right: 0, top: `${s.top}%`, height: `${s.h}%`, backgroundColor: s.c, transform: `translateX(${s.dx}px)`, mixBlendMode: "screen" }} />
      ))}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 50%, transparent 40%, ${withAlpha("#5a0010", 0.55)} 100%)` }} />
      {stampOn ? (
        <div
          style={{
            position: "absolute",
            right: "6%",
            bottom: "12%",
            transform: `rotate(-12deg) scale(${interpolate(stampP, [0, 1], [2.2, 1])})`,
            border: `${8 * u}px solid ${RED}`,
            borderRadius: 14 * u,
            padding: `${4 * u}px ${26 * u}px`,
            fontFamily: lang === "ja" ? displayFont("ja").fontFamily : font.fontFamily,
            fontWeight: lang === "ja" ? displayFont("ja").fontWeight : 400,
            fontSize: (lang === "ja" ? 92 : 110) * u,
            lineHeight: 1.05,
            color: RED,
            letterSpacing: "0.06em",
            backgroundColor: "rgba(255,255,255,0.12)",
            textShadow: "0 0 12px rgba(0,0,0,0.6)",
          }}
        >
          {lang === "ja" ? "失敗" : "FAIL"}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Comeback dressing: accent light rays + sparkles after the speed-up. Relative to the body. */
const WinGlow: React.FC<{ project: Project; tl: FailWinTimeline }> = ({ project, tl }) => {
  const { frame, fps, u } = useShortFrame();
  if (frame < tl.speedFrom) return null;
  const t = frame - tl.speedFrom;
  const accent = project.style.accentColor;
  const burst = interpolate(t, [0, fps * 0.9], [1, 0], clamp);
  const parts = Array.from({ length: 18 }, (_, i) => {
    const a = rand(i + 3) * Math.PI * 2;
    const d = interpolate(t, [0, fps * 1.0], [0, 0.55 + rand(i + 9) * 0.35], clamp);
    return { x: 50 + Math.cos(a) * d * 60, y: 50 + Math.sin(a) * d * 60, o: interpolate(t, [0, fps * 1.0], [1, 0], clamp), s: (10 + rand(i) * 16) * u };
  });
  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background: `repeating-conic-gradient(from ${t * 1.5}deg at 50% 50%, ${withAlpha(accent, 0.22 * burst)} 0deg 8deg, transparent 8deg 20deg)`,
          mixBlendMode: "screen",
        }}
      />
      {parts.map((p, i) =>
        p.o > 0 ? (
          <div key={i} style={{ position: "absolute", left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s, backgroundColor: i % 3 === 0 ? "#ffffff" : accent, opacity: p.o, transform: `rotate(${i * 40 + t * 12}deg)` }} />
        ) : null,
      )}
    </AbsoluteFill>
  );
};

/** White flash + screen shake helpers (absolute body frames). */
const useImpact = (tl: FailWinTimeline) => {
  const { frame, fps, u } = useShortFrame();
  const failHits = [0, ...tl.failCuts].filter((f) => f < tl.failTo);
  let sh = { x: 0, y: 0, r: 0 };
  for (const h of failHits) {
    const s = shake(frame, h, Math.round(fps * 0.45), 18 * u);
    if (s.x !== 0 || s.y !== 0) sh = s;
  }
  if (frame >= tl.speedFrom && tl.speedFrom < tl.bodyFrames) {
    const s = shake(frame, tl.speedFrom, Math.round(fps * 0.4), 16 * u);
    if (s.x !== 0 || s.y !== 0) sh = s;
  }
  const white = tl.speedFrom < tl.bodyFrames && frame >= tl.speedFrom ? interpolate(frame - tl.speedFrom, [0, Math.round(fps * 0.35)], [0.95, 0], clamp) : 0;
  return { sh, white };
};

const footFilter = (tl: FailWinTimeline, frame: number) =>
  frame < tl.winFrom ? "saturate(0.55) contrast(1.2) brightness(1.05)" : frame < tl.speedFrom ? "saturate(0.85) contrast(1.1)" : "saturate(1.3) contrast(1.06)";

/* ------------------------------------------------------------------ */
/* 9:16                                                                 */
/* ------------------------------------------------------------------ */

const Vertical: React.FC<Props & { layout: GameLayout }> = ({ project, lang, timeline: tl, assetBaseUrl, useProxy, layout }) => {
  const { frame, fps, width, height, u } = useShortFrame();
  const { sh, white } = useImpact(tl);
  const strip = stripRect(width, u);
  const glitchX = frame < tl.failTo && rand(Math.floor(frame / 2) + 101) > 0.8 ? (rand(frame) - 0.5) * 24 * u : 0;
  const inFail = frame < tl.winFrom;
  const accent = project.style.accentColor;
  const slamCenterY = layout === "full" ? height * 0.42 : strip.top + strip.height / 2;
  const slamH = 560 * u;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `translate(${sh.x + glitchX}px, ${sh.y}px) rotate(${sh.r}deg)` }}>
        <ShortGameplay project={project} layout={layout} clips={tl.clips} cuts={[...tl.failCuts, ...tl.winCuts]} assetBaseUrl={assetBaseUrl} useProxy={useProxy} filter={footFilter(tl, frame)}>
          {tl.slow ? (
            <Sequence from={tl.slow.from} durationInFrames={tl.slow.frames} name="slow motion">
              <SlowVideo project={project} slow={tl.slow} assetBaseUrl={assetBaseUrl} useProxy={useProxy} />
              <SlowDressing lang={lang} dur={tl.slow.frames} />
            </Sequence>
          ) : null}
          <FailGlitch tl={tl} lang={lang} />
          <WinGlow project={project} tl={tl} />
        </ShortGameplay>
      </AbsoluteFill>
      {/* band: fail title (red, glitching) -> comeback note (dark + accent) */}
      {inFail && tl.title ? (
        <TopBand
          project={project}
          lang={lang}
          text={tl.title}
          variant={layout === "full" ? "scrim" : "red"}
          textStyle={{
            transform: `translateX(${glitchX * 1.5}px) scale(${interpolate(pop(frame, fps, 0, { stiff: true }), [0, 1], [1.25, 1])})`,
            filter: glitchX !== 0 ? `drop-shadow(${6 * u}px 0 0 rgba(0,255,255,0.7)) drop-shadow(${-6 * u}px 0 0 rgba(255,0,80,0.7))` : undefined,
          }}
          deco={<BandWord text="GAME OVER" color="rgba(0,0,0,0.14)" />}
        />
      ) : null}
      {!inFail && (frame < tl.noteSettle || !tl.note) ? (
        <TopBand project={project} lang={lang} text={tl.sub || " "} variant={layout === "full" ? "scrim" : "dark"} hideText={!tl.sub} />
      ) : null}
      {tl.note && frame >= tl.noteSettle ? (
        <Sequence from={tl.noteSettle} layout="none" name="note band">
          <TopBand
            project={project}
            lang={lang}
            text={tl.note}
            variant={layout === "full" ? "scrim" : "dark"}
            kicker={<Badge text={lang === "ja" ? "逆転" : "COMEBACK"} lang={lang} size={(lang === "en" ? 60 : 56) * u} bg={accent} variant="skew" />}
          />
        </Sequence>
      ) : null}
      {/* "でも…" card */}
      {tl.winFrom > tl.failTo ? (
        <Sequence from={tl.failTo} durationInFrames={tl.winFrom - tl.failTo} name="but card">
          <TextCard project={project} lang={lang} text={tl.sub} variant="dark" />
        </Sequence>
      ) : null}
      {/* the note slams big at the speed-up */}
      {tl.note && tl.noteSettle > tl.speedFrom ? (
        <Sequence from={tl.speedFrom} durationInFrames={tl.noteSettle - tl.speedFrom} name="note slam">
          <SlamText
            project={project}
            lang={lang}
            text={tl.note}
            maxWidth={width * 0.9}
            maxHeight={slamH}
            fromScale={1.6}
            shakeAmp={0}
            exitAt={tl.noteSettle - tl.speedFrom - 5}
            exitFrames={5}
            style={{ top: slamCenterY - slamH / 2 - 40 * u, height: slamH + 80 * u, bottom: "auto" }}
          />
        </Sequence>
      ) : null}
      {white > 0 ? <AbsoluteFill style={{ backgroundColor: "#ffffff", opacity: white }} /> : null}
    </AbsoluteFill>
  );
};

/** Huge faint word filling the band background. */
const BandWord: React.FC<{ text: string; color: string }> = ({ text, color }) => {
  const { u } = useShortFrame();
  return (
    <div
      style={{
        position: "absolute",
        left: -40 * u,
        right: -40 * u,
        top: (SAFE916.top - 40) * u,
        textAlign: "center",
        fontFamily: displayFont("en").fontFamily,
        fontSize: 190 * u,
        lineHeight: 1,
        color,
        whiteSpace: "nowrap",
        transform: "rotate(-6deg)",
      }}
    >
      {text}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 16:9                                                                 */
/* ------------------------------------------------------------------ */

const Horizontal: React.FC<Props> = ({ project, lang, timeline: tl, assetBaseUrl, useProxy }) => {
  const { frame, width, height, u } = useShortFrame();
  const { sh, white } = useImpact(tl);
  const glitchX = frame < tl.failTo && rand(Math.floor(frame / 2) + 101) > 0.8 ? (rand(frame) - 0.5) * 30 * u : 0;
  const accent = project.style.accentColor;
  const inFail = frame < tl.winFrom;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `translate(${sh.x + glitchX}px, ${sh.y}px) rotate(${sh.r}deg) scale(1.03)` }}>
        <ShortGameplay project={project} layout="full16" clips={tl.clips} cuts={[...tl.failCuts, ...tl.winCuts]} assetBaseUrl={assetBaseUrl} useProxy={useProxy} filter={footFilter(tl, frame)}>
          {tl.slow ? (
            <Sequence from={tl.slow.from} durationInFrames={tl.slow.frames} name="slow motion">
              <SlowVideo project={project} slow={tl.slow} assetBaseUrl={assetBaseUrl} useProxy={useProxy} />
              <SlowDressing lang={lang} dur={tl.slow.frames} />
            </Sequence>
          ) : null}
          <FailGlitch tl={tl} lang={lang} />
          <WinGlow project={project} tl={tl} />
        </ShortGameplay>
      </AbsoluteFill>
      {inFail && tl.title ? <TopBanner project={project} lang={lang} text={tl.title} variant="red" style={{ transform: `translateX(${glitchX}px)` }} /> : null}
      {tl.note && frame >= tl.noteSettle ? (
        <Sequence from={tl.noteSettle} layout="none" name="note banner">
          <TopBanner project={project} lang={lang} text={tl.note} variant="dark" kicker={<Badge text={lang === "ja" ? "逆転" : "COMEBACK"} lang={lang} size={40 * u} bg={accent} variant="skew" />} />
        </Sequence>
      ) : null}
      {tl.winFrom > tl.failTo ? (
        <Sequence from={tl.failTo} durationInFrames={tl.winFrom - tl.failTo} name="but card">
          <TextCard project={project} lang={lang} text={tl.sub} variant="dark" />
        </Sequence>
      ) : null}
      {tl.note && tl.noteSettle > tl.speedFrom ? (
        <Sequence from={tl.speedFrom} durationInFrames={tl.noteSettle - tl.speedFrom} name="note slam">
          <SlamText
            project={project}
            lang={lang}
            text={tl.note}
            maxWidth={width * 0.8}
            maxHeight={height * 0.5}
            fromScale={1.6}
            shakeAmp={0}
            exitAt={tl.noteSettle - tl.speedFrom - 5}
            exitFrames={5}
            style={{ bottom: height * 0.12, height: "auto" }}
          />
        </Sequence>
      ) : null}
      {white > 0 ? <AbsoluteFill style={{ backgroundColor: "#ffffff", opacity: white }} /> : null}
    </AbsoluteFill>
  );
};

/** Template "fail-win" visuals: fail (red glitch) -> "でも…" card -> slow-mo comeback + note, then the end card. */
export const FailWin: React.FC<Props> = (props) => {
  const layout = gameLayout(props.project, props.format);
  return (
    <ShortShell project={props.project} format={props.format} lang={props.lang} assetBaseUrl={props.assetBaseUrl} timeline={props.timeline}>
      {layout === "full16" ? <Horizontal {...props} /> : <Vertical {...props} layout={layout} />}
    </ShortShell>
  );
};
