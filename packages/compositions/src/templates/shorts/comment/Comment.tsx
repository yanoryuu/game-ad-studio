import type React from "react";
import { AbsoluteFill, interpolate, Sequence, spring } from "remotion";
import type { Lang, Project } from "@gas/shared";
import { BODY_FONT } from "../../../common/fonts";
import { readableOn, withAlpha } from "../../../common/theme";
import type { TemplateRenderProps } from "../../types";
import {
  Badge,
  BigText,
  clamp,
  fitFont,
  gameTitle,
  lineCount,
  pop,
  SAFE916,
  shake,
  ShortGameplay,
  ShortShell,
  SpeechBubble,
  useShortFrame,
} from "../common";
import type { CommentTimeline } from "./timeline";

type Props = TemplateRenderProps<CommentTimeline>;

const headerText = (lang: Lang, author: string) =>
  lang === "ja" ? (author ? `${author} さんへの返信` : "コメントへの返信") : author ? `Reply to ${author}'s comment` : "Replying to a comment";

const answerKicker = (lang: Lang) => (lang === "ja" ? "答えはこちら" : "HERE'S THE ANSWER");

/* ------------------------------------------------------------------ */
/* Geometry                                                             */
/* ------------------------------------------------------------------ */

type StickerGeo = {
  /** sticker width / estimated height at scale 1 (px) */
  w: number;
  h: number;
  font: number;
  /** big state: center */
  cx: number;
  cy: number;
  /** small state: top-left + scale */
  sx: number;
  sy: number;
  ss: number;
};

function stickerGeo(comment: string, lang: Lang, width: number, height: number, u: number, vertical: boolean): StickerGeo {
  const w = (vertical ? 930 : 940) * u;
  const pad = w * 0.055;
  const font = fitFont(comment || " ", lang, { base: (lang === "en" ? 80 : 74) * u, maxWidth: w - pad * 2, maxHeight: (vertical ? 320 : 300) * u, minRatio: 0.5 });
  const header = w * 0.07;
  const h = pad * 1.7 + header + font * 0.3 + lineCount(comment || " ") * font * 1.3;
  return vertical
    ? { w, h, font, cx: width / 2, cy: 560 * u, sx: 40 * u, sy: SAFE916.top * u, ss: 0.56 }
    : { w, h, font, cx: width / 2, cy: height * 0.42, sx: 40 * u, sy: 32 * u, ss: 0.5 };
}

/* ------------------------------------------------------------------ */
/* Reply sticker                                                        */
/* ------------------------------------------------------------------ */

/** TikTok-style "reply to comment" sticker: white card, avatar + "Reply to @x's comment", the comment in black. */
const ReplySticker: React.FC<{ project: Project; lang: Lang; comment: string; author: string; geo: StickerGeo }> = ({ project, lang, comment, author, geo }) => {
  const { w, font } = geo;
  const pad = w * 0.055;
  const av = w * 0.07;
  const tail = w * 0.05;
  return (
    <div
      style={{
        position: "relative",
        width: w,
        padding: `${pad * 0.8}px ${pad}px ${pad * 0.9}px`,
        borderRadius: w * 0.05,
        backgroundColor: "#ffffff",
        boxShadow: `0 ${w * 0.015}px ${w * 0.05}px rgba(0,0,0,0.45)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: w * 0.1,
          bottom: -tail + 1,
          width: 0,
          height: 0,
          borderStyle: "solid",
          borderWidth: `${tail}px ${tail * 0.7}px 0 ${tail * 0.2}px`,
          borderColor: "#ffffff transparent transparent transparent",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: w * 0.022, marginBottom: font * 0.3 }}>
        <div
          style={{
            width: av,
            height: av,
            borderRadius: "50%",
            flexShrink: 0,
            background: `radial-gradient(circle at 50% 36%, #ffffff 0 20%, transparent 21%), radial-gradient(ellipse at 50% 100%, #ffffff 0 40%, transparent 41%), linear-gradient(140deg, ${project.style.accentColor}, #ff4f8b)`,
          }}
        />
        <div
          lang={lang}
          style={{ fontFamily: BODY_FONT, fontWeight: 700, fontSize: w * 0.036, color: "#7a7f8c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}
        >
          {headerText(lang, author)}
        </div>
      </div>
      <BigText text={comment} lang={lang} fontSize={font} emphasisColor={project.style.emphasisColor} color="#111318" ink="" marker body align="left" style={{ lineHeight: 1.3 }} />
    </div>
  );
};

/** The sticker: pops in at 0 (scale only), shrinks into the top-left corner at switchAt and stays. */
const StickerLayer: React.FC<Props> = ({ project, lang, timeline }) => {
  const { frame, fps, width, height, u, vertical } = useShortFrame();
  if (!timeline.comment) return null;
  const geo = stickerGeo(timeline.comment, lang, width, height, u, vertical);
  const p = pop(frame, fps, 0, { stiff: true });
  const m = spring({ frame: frame - timeline.switchAt, fps, durationInFrames: Math.max(1, timeline.morphFrames), config: { damping: 16, stiffness: 180, mass: 0.8 } });
  const big = interpolate(p, [0, 1], [0.72, 1]);
  const bigX = geo.cx - (geo.w * big) / 2;
  const bigY = geo.cy - (geo.h * big) / 2;
  const sc = big + (geo.ss - big) * m;
  const x = bigX + (geo.sx - bigX) * m;
  const y = bigY + (geo.sy - bigY) * m;
  const rot = interpolate(p, [0, 1], [-6, -2]) * (1 - m);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: `translate(${x}px, ${y}px) scale(${sc}) rotate(${rot}deg)` }}>
      <ReplySticker project={project} lang={lang} comment={timeline.comment} author={timeline.author} geo={geo} />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Answer                                                               */
/* ------------------------------------------------------------------ */

/** Big answer slam (relative frames from switchAt): kicker badge + huge reply word, then shrinks away. */
const AnswerSlam: React.FC<{ project: Project; lang: Lang; timeline: CommentTimeline }> = ({ project, lang, timeline }) => {
  const { frame, fps, width, height, u, vertical } = useShortFrame();
  const dur = timeline.answerSlamFrames;
  if (frame >= dur) return null;
  const p = pop(frame, fps, 0, { stiff: true });
  const sh = shake(frame, 2, Math.round(fps * 0.35), 16 * u);
  const exitF = Math.min(Math.round(fps * 0.22), Math.floor(dur / 3));
  const exit = interpolate(frame, [dur - exitF, dur], [0, 1], clamp);
  const maxW = width * (vertical ? 0.9 : 0.8);
  const font = fitFont(timeline.answer, lang, { base: (lang === "en" ? 200 : 170) * u, maxWidth: maxW, maxHeight: vertical ? 330 * u : height * 0.42, minRatio: 0.3 });
  const cy = vertical ? 600 * u : height * 0.46;
  const flash = interpolate(frame, [0, 3], [0.7, 0], clamp);
  return (
    <>
      {flash > 0 ? <AbsoluteFill style={{ backgroundColor: `rgba(255,255,255,${flash})` }} /> : null}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: cy,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18 * u,
          opacity: 1 - exit,
          transform: `translateY(-50%) translate(${sh.x}px, ${sh.y + exit * -120 * u}px) scale(${interpolate(p, [0, 1], [1.45, 1]) * (1 - 0.5 * exit)})`,
        }}
      >
        <Badge text={answerKicker(lang)} lang={lang} size={(vertical ? 46 : 40) * u} bg={project.style.accentColor} variant="skew" />
        <div style={{ maxWidth: maxW, transform: `rotate(${interpolate(p, [0, 1], [-5, -2])}deg)` }}>
          <BigText text={timeline.answer} lang={lang} fontSize={font} emphasisColor={project.style.emphasisColor} />
        </div>
      </div>
    </>
  );
};

/** Small reply bubble under the shrunk sticker (relative frames from switchAt): the "thread" that stays. */
const ReplyBubble: React.FC<{ project: Project; lang: Lang; timeline: CommentTimeline }> = ({ project, lang, timeline }) => {
  const { frame, width, height, u, vertical } = useShortFrame();
  const delay = Math.max(0, timeline.answerSlamFrames - 3);
  if (frame < delay) return null;
  const accent = project.style.accentColor;
  const fg = readableOn(accent);
  const geo = stickerGeo(timeline.comment, lang, width, height, u, vertical);
  const top = timeline.comment ? geo.sy + geo.h * geo.ss + (vertical ? 34 : 26) * u : geo.sy;
  const left = geo.sx + (timeline.comment ? (vertical ? 70 : 60) * u : 0);
  const fontSize = (vertical ? 52 : 40) * u;
  return (
    <div style={{ position: "absolute", left, top }}>
      <SpeechBubble
        project={project}
        lang={lang}
        text={timeline.answer}
        author={`${gameTitle(project)}${lang === "ja" ? "・開発者" : " · dev"}`}
        fontSize={fontSize}
        maxWidth={(vertical ? width - 120 * u - left : width * 0.42)}
        bg={accent}
        fg={fg}
        emphasisColor={fg}
        avatarColor={withAlpha(fg, 0.85)}
        tail={timeline.comment ? "up" : "none"}
        tailAt={0.12}
        delay={delay}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Template                                                             */
/* ------------------------------------------------------------------ */

const Body: React.FC<Props> = (props) => {
  const { project, format, lang, timeline, assetBaseUrl, useProxy } = props;
  const { frame, fps } = useShortFrame();
  const vertical = format === "9:16";
  // comment phase: footage slightly dimmed so the sticker pops
  const dim = timeline.comment ? interpolate(frame, [timeline.switchAt - 1, timeline.switchAt + Math.round(fps * 0.2)], [0.28, 0], clamp) : 0;
  const answerLen = Math.max(1, timeline.bodyFrames - timeline.switchAt);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <ShortGameplay project={project} layout={vertical ? "full" : "full16"} clips={timeline.clips} cuts={timeline.cuts} assetBaseUrl={assetBaseUrl} useProxy={useProxy} />
      {dim > 0 ? <AbsoluteFill style={{ backgroundColor: `rgba(0,0,0,${dim})` }} /> : null}
      {/* top scrim: keeps the sticker / reply readable over bright footage */}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) ${vertical ? 30 : 38}%)` }} />
      {timeline.answer ? (
        <Sequence from={timeline.switchAt} durationInFrames={answerLen} name="answer">
          <ReplyBubble project={project} lang={lang} timeline={timeline} />
        </Sequence>
      ) : null}
      <StickerLayer {...props} />
      {timeline.answer ? (
        <Sequence from={timeline.switchAt} durationInFrames={answerLen} name="answer slam">
          <AnswerSlam project={project} lang={lang} timeline={timeline} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

/** Template "comment" visuals: reply sticker over the hook footage -> answer footage + big reply -> end card. */
export const Comment: React.FC<Props> = (props) => (
  <ShortShell project={props.project} format={props.format} lang={props.lang} assetBaseUrl={props.assetBaseUrl} timeline={props.timeline}>
    <Body {...props} />
  </ShortShell>
);
