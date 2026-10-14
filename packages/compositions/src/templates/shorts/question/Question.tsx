import type React from "react";
import { AbsoluteFill, interpolate, Sequence, spring } from "remotion";
import type { Lang, Project } from "@gas/shared";
import { BODY_FONT, displayFont } from "../../../common/fonts";
import { RichText } from "../../../common/RichText";
import { withAlpha } from "../../../common/theme";
import type { TemplateRenderProps } from "../../types";
import {
  Badge,
  bandTextLayout,
  BigText,
  clamp,
  fitFont,
  gameLayout,
  pop,
  shake,
  ShortGameplay,
  ShortShell,
  SpeechBubble,
  stripRect,
  TopBand,
  TopBanner,
  useShortFrame,
  V916,
  type GameLayout,
} from "../common";
import { optionDelay, type QuestionPoll, type QuestionTimeline } from "./timeline";

type Props = TemplateRenderProps<QuestionTimeline>;

const kickerText = (lang: Lang) => (lang === "ja" ? "みんなに質問" : "QUESTION");

/** Giant tilted "?" glyph (accent), used behind the slam and as band decoration. */
const QMark: React.FC<{ size: number; color: string; style?: React.CSSProperties }> = ({ size, color, style }) => (
  <div
    style={{
      position: "absolute",
      fontFamily: displayFont("en").fontFamily,
      fontSize: size,
      lineHeight: 1,
      color,
      ...style,
    }}
  >
    ?
  </div>
);

/* ------------------------------------------------------------------ */
/* 9:16: slam -> shrink into the band                                   */
/* ------------------------------------------------------------------ */

const VerticalTitle: React.FC<Props & { layout: GameLayout }> = ({ project, lang, timeline, layout }) => {
  const { frame, fps, width, height, u } = useShortFrame();
  const { title, slamFrames, morphFrames } = timeline;
  const accent = project.style.accentColor;
  const lay = bandTextLayout(title || " ", lang, { u, width, kicker: true });
  // morph progress 0 (big, centered) -> 1 (in the band)
  const m = title
    ? spring({ frame: frame - slamFrames, fps, durationInFrames: Math.max(1, morphFrames), config: { damping: 16, stiffness: 170, mass: 0.8 } })
    : 1;
  const land = pop(frame, fps, 0, { stiff: true });
  const sh = shake(frame, 2, Math.round(fps * 0.35), 14 * u);
  const bigFont = fitFont(title || " ", lang, { base: (lang === "en" ? 200 : 160) * u, maxWidth: width * 0.8, maxHeight: height * 0.4, minRatio: 0.3 });
  const S = Math.max(1, bigFont / lay.fontSize);
  const centerY = stripRect(width, u).top + stripRect(width, u).height / 2;
  const dy = centerY - lay.centerY;
  const scale = (S + (1 - S) * m) * interpolate(land, [0, 1], [1.1, 1]);
  const bandShift = interpolate(m, [0, 1], [-lay.bandH, 0]);
  const scrim = interpolate(m, [0, 1], [0.5, 0], clamp);
  const qT = interpolate(frame, [0, slamFrames + morphFrames], [0, 1], clamp);

  return (
    <>
      {/* dark scrim during the slam so the big question reads over any footage */}
      {scrim > 0.01 ? <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${scrim})` }} /> : null}
      {/* big "?" behind the slam */}
      {title && m < 0.99 ? (
        <QMark
          size={height * 0.62}
          color={withAlpha(accent, 0.85 * (1 - m))}
          style={{ right: -width * 0.06, top: centerY - height * 0.36, transform: `rotate(${12 + 6 * qT}deg) scale(${interpolate(land, [0, 1], [0.7, 1])})` }}
        />
      ) : null}
      {/* band background slides down with the morph */}
      <div style={{ position: "absolute", left: 0, top: 0, width, transform: `translateY(${bandShift}px)` }}>
        <TopBand
          project={project}
          lang={lang}
          text={title || " "}
          variant={layout === "full" ? "scrim" : "dark"}
          hideText
          deco={
            <>
              <QMark size={lay.bandH * 1.05} color={withAlpha(accent, 0.18)} style={{ left: -width * 0.04, top: -lay.bandH * 0.02, transform: "rotate(-14deg)" }} />
              <QMark size={lay.bandH * 0.8} color={withAlpha(accent, 0.14)} style={{ right: -width * 0.02, top: lay.bandH * 0.18, transform: "rotate(16deg)" }} />
            </>
          }
        />
      </div>
      {/* kicker badge (with the band) */}
      {title ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: (V916.bandH * 0 + 200) * u + bandShift, display: "flex", justifyContent: "center" }}>
          <Badge text={kickerText(lang)} lang={lang} size={(lang === "en" ? 50 : 44) * u} bg={accent} variant="skew" delay={slamFrames} />
        </div>
      ) : null}
      {/* the question itself: one element, scaled/moved from the center into the band */}
      {title ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: lay.centerY,
            display: "flex",
            justifyContent: "center",
            transform: `translateY(-50%) translate(${sh.x * (1 - m)}px, ${dy * (1 - m) + sh.y * (1 - m)}px) scale(${scale}) rotate(${(1 - m) * interpolate(land, [0, 1], [-4, 0])}deg)`,
          }}
        >
          <div style={{ maxWidth: lay.maxW }}>
            <BigText text={title} lang={lang} fontSize={lay.fontSize} emphasisColor={project.style.emphasisColor} />
          </div>
        </div>
      ) : null}
    </>
  );
};

/* ------------------------------------------------------------------ */
/* 16:9: slam centered -> banner                                         */
/* ------------------------------------------------------------------ */

const HorizontalTitle: React.FC<Props> = ({ project, lang, timeline }) => {
  const { frame, fps, width, height, u } = useShortFrame();
  const { title, slamFrames, morphFrames } = timeline;
  if (!title) return null;
  const accent = project.style.accentColor;
  const out = interpolate(frame, [slamFrames, slamFrames + morphFrames], [0, 1], clamp);
  const land = pop(frame, fps, 0, { stiff: true });
  const sh = shake(frame, 2, Math.round(fps * 0.35), 12 * u);
  const bigFont = fitFont(title, lang, { base: (lang === "en" ? 190 : 150) * u, maxWidth: width * 0.8, maxHeight: height * 0.6, minRatio: 0.3 });
  return (
    <>
      {out < 1 ? (
        <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${0.5 * (1 - out)})`, justifyContent: "center", alignItems: "center" }}>
          <QMark size={height * 0.9} color={withAlpha(accent, 0.8 * (1 - out))} style={{ right: width * 0.04, top: -height * 0.02, transform: `rotate(14deg) scale(${interpolate(land, [0, 1], [0.7, 1])})` }} />
          <div
            style={{
              maxWidth: width * 0.8,
              opacity: 1 - out,
              transform: `translate(${sh.x}px, ${sh.y - out * height * 0.3}px) scale(${interpolate(land, [0, 1], [1.25, 1]) * (1 - 0.55 * out)}) rotate(${interpolate(land, [0, 1], [-4, 0])}deg)`,
            }}
          >
            <BigText text={title} lang={lang} fontSize={bigFont} emphasisColor={project.style.emphasisColor} />
          </div>
        </AbsoluteFill>
      ) : null}
      {frame >= slamFrames ? (
        <Sequence from={slamFrames} layout="none" name="banner">
          <TopBanner
            project={project}
            lang={lang}
            text={title}
            variant="dark"
            kicker={<Badge text="?" lang="en" size={64 * u} bg={accent} variant="tag" rotate={-6} />}
          />
        </Sequence>
      ) : null}
    </>
  );
};

/* ------------------------------------------------------------------ */
/* Poll + comment prompt                                                */
/* ------------------------------------------------------------------ */

/** Vote share shown by the growing bars (decorative; first option leads). */
const SHARES: Record<number, number[]> = { 1: [0.78], 2: [0.64, 0.36], 3: [0.47, 0.33, 0.2] };

const PollOption: React.FC<{ project: Project; lang: Lang; letter: string; text: string; share: number; delay: number; width: number; height: number; lead: boolean }> = ({
  project,
  lang,
  letter,
  text,
  share,
  delay,
  width,
  height,
  lead,
}) => {
  const { frame, fps, u } = useShortFrame();
  if (frame < delay) return null;
  const accent = project.style.accentColor;
  const p = pop(frame, fps, delay, { stiff: true });
  const grow = interpolate(frame - delay - Math.round(fps * 0.25), [0, Math.round(fps * 1.1)], [0, share], { ...clamp, easing: (t) => 1 - (1 - t) ** 3 });
  const tap = lead ? interpolate(frame - delay - Math.round(fps * 0.15), [0, Math.round(fps * 0.12), Math.round(fps * 0.3)], [1, 0.94, 1], clamp) : 1;
  const fontSize = fitFont(text, lang, { base: height * 0.46, maxWidth: width - height * 1.6, minRatio: 0.5 });
  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        borderRadius: height / 2,
        backgroundColor: "rgba(255,255,255,0.94)",
        overflow: "hidden",
        transform: `scale(${interpolate(p, [0, 1], [0.7, 1]) * tap}) translateX(${interpolate(p, [0, 1], [-40 * u, 0])}px)`,
        boxShadow: lead ? `0 0 0 ${5 * u}px ${accent}, 0 ${8 * u}px ${24 * u}px rgba(0,0,0,0.5)` : `0 ${8 * u}px ${24 * u}px rgba(0,0,0,0.45)`,
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${grow * 100}%`, backgroundColor: withAlpha(accent, lead ? 0.85 : 0.45) }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: height * 0.25, padding: `0 ${height * 0.35}px 0 ${height * 0.14}px` }}>
        <div
          style={{
            width: height * 0.72,
            height: height * 0.72,
            borderRadius: "50%",
            backgroundColor: "#111318",
            color: "#fff",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            fontFamily: displayFont("en").fontFamily,
            fontSize: height * 0.42,
            flexShrink: 0,
          }}
        >
          {letter}
        </div>
        <div lang={lang} style={{ flex: 1, minWidth: 0, fontFamily: BODY_FONT, fontWeight: 900, fontSize, color: "#111318", whiteSpace: "nowrap", lineHeight: 1.1 }}>
          <RichText text={text.replace(/\n/g, " ")} lang={lang} emphasisColor={project.style.accentColor} />
        </div>
        {lead && grow > share * 0.98 ? <div style={{ fontFamily: BODY_FONT, fontWeight: 900, fontSize: height * 0.45, color: "#111318" }}>✓</div> : null}
      </div>
    </div>
  );
};

const Poll: React.FC<{ project: Project; lang: Lang; poll: QuestionPoll; vertical: boolean; width: number }> = ({ project, lang, poll, vertical, width }) => {
  const { fps, u } = useShortFrame();
  const n = poll.options.length;
  const rowH = (n > 0 ? (vertical ? 104 : 112) : 0) * u;
  const promptSize = (n > 0 ? (vertical ? 52 : 56) : vertical ? 68 : 72) * u;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 * u, width }}>
      {poll.prompt ? (
        <SpeechBubble project={project} lang={lang} text={poll.prompt} fontSize={promptSize} maxWidth={width} tail={n > 0 ? "down" : "down"} tailAt={0.25} style={{ alignSelf: n > 0 ? "flex-start" : "center", marginBottom: 14 * u }} />
      ) : null}
      {poll.options.map((o, i) => (
        <PollOption
          key={o.id}
          project={project}
          lang={lang}
          letter={String.fromCharCode(65 + i)}
          text={o.text}
          share={SHARES[n]?.[i] ?? 0.3}
          delay={optionDelay(i, fps, !!poll.prompt)}
          width={width}
          height={rowH}
          lead={i === 0}
        />
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Template                                                             */
/* ------------------------------------------------------------------ */

const Body: React.FC<Props> = (props) => {
  const { project, format, lang, timeline, assetBaseUrl, useProxy } = props;
  const { width, height, u } = useShortFrame();
  const layout = gameLayout(project, format);
  const vertical = layout !== "full16";
  const poll = timeline.poll;
  const strip = stripRect(width, u);
  return (
    <AbsoluteFill>
      <ShortGameplay project={project} layout={layout} clips={timeline.clips} cuts={timeline.cuts} assetBaseUrl={assetBaseUrl} useProxy={useProxy}>
        {poll ? (
          <Sequence from={poll.from} durationInFrames={poll.to - poll.from} layout="none" name="poll dim">
            <PollDim />
          </Sequence>
        ) : null}
      </ShortGameplay>
      {vertical ? <VerticalTitle {...props} layout={layout} /> : <HorizontalTitle {...props} />}
      {poll ? (
        <Sequence from={poll.from} durationInFrames={poll.to - poll.from} name="poll">
          {vertical ? (
            <AbsoluteFill style={{ top: strip.top - 40 * u, height: strip.height + 80 * u, justifyContent: "center", alignItems: "flex-start", paddingLeft: 60 * u }}>
              <Poll project={project} lang={lang} poll={poll} vertical width={width - 60 * u - 150 * u} />
            </AbsoluteFill>
          ) : (
            <AbsoluteFill style={{ top: height * 0.24, bottom: height * 0.22, height: "auto", justifyContent: "center", alignItems: "flex-end", paddingRight: 70 * u }}>
              <Poll project={project} lang={lang} poll={poll} vertical={false} width={width * 0.4} />
            </AbsoluteFill>
          )}
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

const PollDim: React.FC = () => {
  const { frame, fps } = useShortFrame();
  return <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${interpolate(frame, [0, fps * 0.2], [0, 0.45], clamp)})` }} />;
};

/** Template "question" visuals: body (gameplay + question band + poll) then the common end card. */
export const Question: React.FC<Props> = (props) => (
  <ShortShell project={props.project} format={props.format} lang={props.lang} assetBaseUrl={props.assetBaseUrl} timeline={props.timeline}>
    <Body {...props} />
  </ShortShell>
);
