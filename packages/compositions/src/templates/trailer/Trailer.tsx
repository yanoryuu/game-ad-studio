import type React from "react";
import { useMemo } from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { EndCard } from "../../common/EndCard";
import { NoFootage } from "../../common/NoFootage";
import type { TemplateRenderProps } from "../types";
import { TrailerCard } from "./Card";
import { TrailerCut } from "./Cut";
import { LogoReveal } from "./LogoReveal";
import type { TrailerTimeline } from "./timeline";

/**
 * Template "trailer": beat-snapped cuts and full-screen text cards (cold open) -> logo reveal -> end card.
 * Narration / captions / BGM are added around it by <AdVideo>; no watermark (the logo reveal does that job).
 */
export const Trailer: React.FC<TemplateRenderProps<TrailerTimeline>> = ({ project, format, lang, assetBaseUrl, useProxy, timeline: tl }) => {
  const { fps } = useVideoConfig();
  const premount = Math.round(fps);
  const beatFrames = useMemo(() => tl.beatGrid.map((b) => Math.round(b * fps)), [tl.beatGrid, fps]);

  return (
    <>
      {tl.elements.map((el, i) => {
        const prev = tl.elements[i - 1];
        if (el.type === "cut") {
          const inner = beatFrames.filter((b) => b > el.from && b < el.from + el.durationInFrames).map((b) => b - el.from);
          return (
            <Sequence key={el.clip.key} from={el.from} durationInFrames={el.durationInFrames} premountFor={premount} name={`Cut ${el.cutNo + 1}`}>
              <TrailerCut
                project={project}
                format={format}
                el={el}
                assetBaseUrl={assetBaseUrl}
                useProxy={useProxy}
                afterCard={prev?.type === "card"}
                beatFrames={inner}
              />
            </Sequence>
          );
        }
        if (el.type === "card") {
          return (
            <Sequence key={`card-${i}-${el.card.id}`} from={el.from} durationInFrames={el.durationInFrames} name={`Card ${el.cardNo + 1}`}>
              <TrailerCard project={project} format={format} lang={lang} text={el.text} cardNo={el.cardNo} />
            </Sequence>
          );
        }
        return (
          <Sequence key={`empty-${i}`} from={el.from} durationInFrames={el.durationInFrames} name="No footage">
            <AbsoluteFill style={{ backgroundColor: "black" }}>
              <NoFootage project={project} assetBaseUrl={assetBaseUrl} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
      {tl.logo ? (
        <Sequence from={tl.logo.from} durationInFrames={tl.logo.durationInFrames} premountFor={premount} name="Logo reveal">
          <LogoReveal project={project} format={format} lang={lang} assetBaseUrl={assetBaseUrl} />
        </Sequence>
      ) : null}
      <Sequence from={tl.endCard.from} durationInFrames={tl.endCard.durationInFrames} premountFor={premount} name="End card">
        <EndCard project={project} format={format} lang={lang} assetBaseUrl={assetBaseUrl} />
      </Sequence>
    </>
  );
};
