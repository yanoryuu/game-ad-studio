import type React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type { Format, Lang, Project } from "@gas/shared";
import { Backdrop } from "../../common/Backdrop";
import { ClipTrack } from "../../common/ClipTrack";
import { EndCard } from "../../common/EndCard";
import { NoFootage } from "../../common/NoFootage";
import { Watermark } from "../../common/Watermark";
import type { TemplateRenderProps } from "../types";
import { FeatureHeading } from "./Heading";
import { IntroSection } from "./Intro";
import { layoutOf, type FeatLayout } from "./layout";
import { FEATURE_HEADING_SEC, type FeatureBlock, type FeaturesTimeline } from "./timeline";
import { Wipe, wipeFrames } from "./Transition";

type Common = { project: Project; format: Format; lang: Lang; assetBaseUrl: string; useProxy: boolean };

const FeatureSection: React.FC<Common & { block: FeatureBlock; count: number; layout: FeatLayout }> = ({
  project,
  format,
  lang,
  assetBaseUrl,
  useProxy,
  block,
  count,
  layout,
}) => {
  const { fps } = useVideoConfig();
  const wm = project.style.watermark.position;
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {block.clips.length > 0 ? (
        <ClipTrack project={project} clips={block.clips} format={format} assetBaseUrl={assetBaseUrl} useProxy={useProxy} sectionFrom={block.from} punchFirst={false} />
      ) : (
        <Backdrop project={project} assetBaseUrl={assetBaseUrl} blurPx={6} brightness={0.6} />
      )}
      <Watermark project={project} lang={lang} assetBaseUrl={assetBaseUrl} />
      <FeatureHeading
        index={block.index}
        count={count}
        heading={block.item.heading[lang].trim()}
        sub={block.item.sub?.[lang].trim() ?? ""}
        lang={lang}
        layout={layout}
        accent={project.style.accentColor}
        primary={project.style.primaryColor}
        sectionFrames={block.durationInFrames}
        bigFrames={Math.min(Math.round(FEATURE_HEADING_SEC * fps), Math.max(1, block.durationInFrames - 2))}
        labelSide={wm === "top-left" ? "right" : "left"}
      />
    </AbsoluteFill>
  );
};

/**
 * Template "features" (魅力紹介): title intro -> one section per feature item (numbered heading overlay
 * over its clips, accent swipe between sections, ①②③ progress) -> common end card. ARCHITECTURE §5.5.
 * Captions / narration / BGM are added around it by <AdVideo>.
 */
export const Features: React.FC<TemplateRenderProps<FeaturesTimeline>> = ({ project, format, lang, assetBaseUrl, useProxy, timeline: tl }) => {
  const { fps } = useVideoConfig();
  const common: Common = { project, format, lang, assetBaseUrl, useProxy };
  const layout = layoutOf(project, format);
  const accent = project.style.accentColor;
  const w = wipeFrames(fps);
  const pre = Math.round(fps);

  // swipe across the boundaries intro -> feature 1 -> ... -> feature N (the end card has its own flash)
  const boundaries: number[] = tl.features.map((f) => f.from);
  if (tl.main && tl.main.durationInFrames > 0) boundaries.push(tl.main.from);

  return (
    <>
      {tl.intro.durationInFrames > 0 ? (
        <Sequence from={tl.intro.from} durationInFrames={tl.intro.durationInFrames} name="Intro">
          <IntroSection {...common} section={tl.intro} layout={layout} featureCount={tl.features.length} />
        </Sequence>
      ) : null}
      {tl.features.map((f) =>
        f.durationInFrames > 0 ? (
          <Sequence key={f.id} from={f.from} durationInFrames={f.durationInFrames} name={`Feature ${f.index + 1}`} premountFor={pre}>
            <FeatureSection {...common} block={f} count={tl.features.length} layout={layout} />
          </Sequence>
        ) : null,
      )}
      {tl.main && tl.main.durationInFrames > 0 ? (
        <Sequence from={tl.main.from} durationInFrames={tl.main.durationInFrames} name="Main" premountFor={pre}>
          <AbsoluteFill style={{ backgroundColor: "black" }}>
            {tl.main.clips.length > 0 ? (
              <ClipTrack project={project} clips={tl.main.clips} format={format} assetBaseUrl={assetBaseUrl} useProxy={useProxy} sectionFrom={tl.main.from} punchFirst={false} />
            ) : (
              <NoFootage project={project} assetBaseUrl={assetBaseUrl} />
            )}
            <Watermark project={project} lang={lang} assetBaseUrl={assetBaseUrl} />
          </AbsoluteFill>
        </Sequence>
      ) : null}
      <Sequence from={tl.endCard.from} durationInFrames={tl.endCard.durationInFrames} name="End card" premountFor={pre}>
        <EndCard project={project} format={format} lang={lang} assetBaseUrl={assetBaseUrl} />
      </Sequence>
      {boundaries.map((b) => {
        const inFrom = Math.max(0, b - w);
        return (
          <Sequence key={`wipe-${b}`} from={inFrom} durationInFrames={b - inFrom + w} name="Swipe" layout="none">
            <Sequence durationInFrames={Math.max(1, b - inFrom)} layout="none">
              {b - inFrom > 0 ? <Wipe dir="in" accent={accent} /> : null}
            </Sequence>
            <Sequence from={b - inFrom} durationInFrames={w} layout="none">
              <Wipe dir="out" accent={accent} />
            </Sequence>
          </Sequence>
        );
      })}
    </>
  );
};
