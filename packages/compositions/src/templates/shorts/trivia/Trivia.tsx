import type React from "react";
import { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { stripEmphasis, type Lang, type Project } from "@gas/shared";
import { ClipTrack } from "../../../common/ClipTrack";
import type { PlacedClip } from "../../../common/clips";
import { NoFootage } from "../../../common/NoFootage";
import { RichText, estimateRichEm } from "../../../common/RichText";
import type { TemplateRenderProps } from "../../types";
import { isReddish, ShortShell, useShortFrame } from "../common";
import { useTriviaFont } from "./font";
import { TRIVIA, TRIVIA_FONT_FAMILY, type TriviaTimeline } from "./timeline";

type Props = TemplateRenderProps<TriviaTimeline>;

/** the reference's title red (pure, saturated); a reddish style.accentColor replaces it */
const DEFAULT_RED = "#F20F0F";
const INK = "#0b0b0b";
const redOf = (project: Project) => (isReddish(project.style.accentColor) ? project.style.accentColor : DEFAULT_RED);

/** letter spacing of the title (the reference sets its kana very wide) */
const titleSpacing = (lang: Lang) => (lang === "ja" ? 0.1 : 0.03);

/** Largest font (<= maxFont) at which every title line fits `maxWidth` incl. letter spacing and box padding. */
function titleFont(lines: string[], lang: Lang, maxFont: number, maxWidth: number): number {
  const ls = titleSpacing(lang);
  let size = maxFont;
  for (const line of lines) {
    if (!line) continue;
    const chars = [...stripEmphasis(line)].length;
    // + box padding (2 × 0.16em + ls) and ~6% estimate slack (Rounded M+ latin is a little narrower than the em estimate)
    const em = (estimateRichEm(line) * (lang === "en" ? 0.92 : 1) + chars * ls + 0.32 + ls) * 1.06;
    size = Math.min(size, maxWidth / Math.max(1, em));
  }
  return Math.max(maxFont * 0.38, size);
}

/** The persistent 2-line title: line 1 = white in a red box, line 2 = black on white. Static from frame 0. */
const Title: React.FC<{
  project: Project;
  lang: Lang;
  line1: string;
  line2: string;
  fontSize: number;
  style: React.CSSProperties;
}> = ({ project, lang, line1, line2, fontSize, style }) => {
  const ls = titleSpacing(lang);
  const red = redOf(project);
  const text: React.CSSProperties = {
    fontFamily: TRIVIA_FONT_FAMILY,
    fontWeight: 900,
    fontSize,
    letterSpacing: `${ls}em`,
    whiteSpace: "nowrap",
    wordBreak: "keep-all",
    textAlign: "center",
  };
  return (
    <div lang={lang} style={{ position: "absolute", display: "flex", flexDirection: "column", alignItems: "center", ...style }}>
      {line1 ? (
        <div
          style={{
            ...text,
            color: "#ffffff",
            backgroundColor: red,
            lineHeight: 1.22,
            // trailing letter-spacing sits on the right: pad the left by the same amount to stay centered
            padding: `0.03em 0.16em 0.03em ${0.16 + ls}em`,
          }}
        >
          <RichText text={line1} lang={lang} emphasisColor={project.style.emphasisColor} emphasisScale={1} />
        </div>
      ) : null}
      {line2 ? (
        <div style={{ ...text, color: INK, lineHeight: 1.2, marginTop: fontSize * 0.06, paddingLeft: `${ls}em` }}>
          <RichText text={line2} lang={lang} emphasisColor={red} emphasisScale={1} />
        </div>
      ) : null}
    </div>
  );
};

/**
 * The media window: clips cover-cropped at clip.focusX (ClipTrack in 9:16 "crop" mode, whatever the project's
 * vertical mode), HARD cuts (one ClipTrack per clip = no punch / flash, like the reference), NoFootage without clips.
 */
const MediaWindow: React.FC<{
  project: Project;
  clips: PlacedClip[];
  assetBaseUrl: string;
  useProxy: boolean;
  sub: string;
  lang: Lang;
  rect: { left: number; top: number; width: number; height: number };
  subSize: number;
}> = ({ project, clips, assetBaseUrl, useProxy, sub, lang, rect, subSize }) => {
  const cropProject = useMemo<Project>(
    () => ({ ...project, style: { ...project.style, vertical: { ...project.style.vertical, mode: "crop" } } }),
    [project],
  );
  return (
    <div style={{ position: "absolute", ...rect, overflow: "hidden", backgroundColor: "#000" }}>
      {clips.length > 0 ? (
        clips.map((clip) => (
          <ClipTrack
            key={clip.key}
            project={cropProject}
            clips={[clip]}
            format="9:16"
            assetBaseUrl={assetBaseUrl}
            useProxy={useProxy}
            sectionFrom={0}
            punchFirst={false}
          />
        ))
      ) : (
        <NoFootage project={project} assetBaseUrl={assetBaseUrl} />
      )}
      {sub ? (
        <div
          lang={lang}
          style={{
            position: "absolute",
            left: subSize * 0.7,
            bottom: subSize * 0.6,
            maxWidth: rect.width - subSize * 1.4,
            padding: `${subSize * 0.18}px ${subSize * 0.45}px`,
            borderRadius: subSize * 0.3,
            backgroundColor: "rgba(0,0,0,0.55)",
            color: "#ffffff",
            fontFamily: TRIVIA_FONT_FAMILY,
            fontWeight: 900,
            fontSize: subSize,
            lineHeight: 1.2,
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <RichText text={sub.replace(/\n/g, " ")} lang={lang} emphasisColor={project.style.emphasisColor} emphasisScale={1} />
        </div>
      ) : null}
    </div>
  );
};

const Body: React.FC<Props> = ({ project, lang, timeline, assetBaseUrl, useProxy }) => {
  const { width, u, vertical } = useShortFrame();
  const lines = [timeline.line1, timeline.line2];

  if (vertical) {
    const V = TRIVIA.V;
    const maxW = width - 2 * V.titleSideMargin * u;
    const fontSize = titleFont(lines, lang, V.titleMaxFont * u, maxW);
    return (
      <AbsoluteFill style={{ backgroundColor: "#ffffff" }}>
        <MediaWindow
          project={project}
          clips={timeline.clips}
          assetBaseUrl={assetBaseUrl}
          useProxy={useProxy}
          sub={timeline.sub}
          lang={lang}
          rect={{ left: 0, top: V.mediaTop * u, width, height: V.mediaH * u }}
          subSize={34 * u}
        />
        {timeline.line1 || timeline.line2 ? (
          <Title
            project={project}
            lang={lang}
            line1={timeline.line1}
            line2={timeline.line2}
            fontSize={fontSize}
            style={{ left: 0, right: 0, bottom: (1920 - V.titleBottom) * u }}
          />
        ) : null}
      </AbsoluteFill>
    );
  }

  const H = TRIVIA.H;
  const colW = width - (H.colLeft + H.colRight) * u;
  const fontSize = titleFont(lines, lang, H.titleMaxFont * u, colW);
  const mediaH = H.mediaH * u;
  return (
    <AbsoluteFill style={{ backgroundColor: "#ffffff" }}>
      <MediaWindow
        project={project}
        clips={timeline.clips}
        assetBaseUrl={assetBaseUrl}
        useProxy={useProxy}
        sub={timeline.sub}
        lang={lang}
        rect={{ left: H.mediaLeft * u, top: (1080 * u - mediaH) / 2, width: H.mediaW * u, height: mediaH }}
        subSize={30 * u}
      />
      {timeline.line1 || timeline.line2 ? (
        <Title
          project={project}
          lang={lang}
          line1={timeline.line1}
          line2={timeline.line2}
          fontSize={fontSize}
          style={{ left: H.colLeft * u, width: colW, top: H.titleTop * u }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/** Template "trivia" (雑学ストーリー), ARCHITECTURE §5.10. Captions are drawn by <AdVideo> (captionLayout "plain-dark"). */
export const Trivia: React.FC<Props> = (props) => {
  useTriviaFont(props.lang);
  return (
    <ShortShell {...props} timeline={props.timeline}>
      <Body {...props} />
    </ShortShell>
  );
};
