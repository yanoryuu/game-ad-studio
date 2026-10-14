import type React from "react";
import { useMemo } from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type { Format, Lang, Project } from "@gas/shared";
import { buildTimeline } from "./timeline";
import { HookSection } from "./sections/Hook";
import { MainSection } from "./sections/Main";
import { EndCard } from "./sections/EndCard";
import { Captions } from "./Captions";
import { Bgm } from "./Bgm";
import { Narration } from "./NarrationTrack";
import { buildCaptionItems } from "./Captions";
import { makeDuckEnvelope } from "./audioMix";
import { DuckContext } from "./mixContext";
import { BODY_FONT } from "./fonts";

/**
 * Props of the "AdVideo" composition. MUST stay a `type` alias (not an
 * interface) so it satisfies Remotion's `Record<string, unknown>` constraint.
 */
export type AdVideoProps = {
  project: Project;
  format: Format;
  lang: Lang;
  /** "" in web preview (same origin via Vite proxy), "http://localhost:3101" in render */
  assetBaseUrl: string;
  /** true in web preview (720p proxies), false in render (originals) */
  useProxy: boolean;
};

/**
 * Template "hook-play-cta": hook (2.5s) -> main gameplay cuts -> end card (3s), plus narration of `lang`
 * (sections grow to fit it when durationSec is null), captions, ducked game audio and BGM.
 */
export const AdVideo: React.FC<AdVideoProps> = ({ project, format, lang, assetBaseUrl, useProxy }) => {
  const { fps } = useVideoConfig();
  // ONE timeline (sections + narration plan) shared with calcAdMetadata / buildNarrationPlan
  const tl = useMemo(() => buildTimeline(project, fps, lang), [project, fps, lang]);
  const duck = useMemo(() => makeDuckEnvelope(tl.narration, fps), [tl, fps]);
  const captionItems = useMemo(
    () => (project.style.captions.enabled ? buildCaptionItems(project, lang, tl.narration, fps) : []),
    [project, lang, tl, fps],
  );
  const common = { project, format, lang, assetBaseUrl, useProxy };
  const cs = project.style.captions;

  return (
    <DuckContext.Provider value={duck}>
    <AbsoluteFill style={{ backgroundColor: "black", fontFamily: BODY_FONT }}>
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
      {cs.enabled ? (
        <Captions items={captionItems} lang={lang} format={format} color={project.style.primaryColor} position={cs.position} size={cs.size} />
      ) : null}
      <Narration project={project} plan={tl.narration} assetBaseUrl={assetBaseUrl} />
      {project.audio.bgm ? <Bgm project={project} assetBaseUrl={assetBaseUrl} /> : null}
    </AbsoluteFill>
    </DuckContext.Provider>
  );
};
