import type React from "react";
import { Sequence, useVideoConfig } from "remotion";
import { EndCard } from "../../common/EndCard";
import type { TemplateRenderProps } from "../types";
import { HookSection } from "./Hook";
import { MainSection } from "./Main";
import type { AdTimeline } from "./timeline";

/**
 * Template "hook-play-cta": hook (2.5s) -> main gameplay cuts -> end card (3s).
 * Narration / captions / BGM are added around it by <AdVideo>.
 */
export const HookPlayCta: React.FC<TemplateRenderProps<AdTimeline>> = ({ project, format, lang, assetBaseUrl, useProxy, timeline: tl }) => {
  const { fps } = useVideoConfig();
  const common = { project, format, lang, assetBaseUrl, useProxy };
  return (
    <>
      <Sequence from={tl.hook.from} durationInFrames={tl.hook.durationInFrames} name="Hook">
        <HookSection {...common} section={tl.hook} />
      </Sequence>
      {tl.main.durationInFrames > 0 ? (
        <Sequence
          from={tl.main.from}
          durationInFrames={tl.main.durationInFrames}
          name="Main"
          premountFor={Math.round(fps)}
        >
          <MainSection {...common} section={tl.main} />
        </Sequence>
      ) : null}
      <Sequence
        from={tl.endCard.from}
        durationInFrames={tl.endCard.durationInFrames}
        name="End card"
        premountFor={Math.round(fps)}
      >
        <EndCard project={project} format={format} lang={lang} assetBaseUrl={assetBaseUrl} />
      </Sequence>
    </>
  );
};
