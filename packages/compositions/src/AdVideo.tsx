import type React from "react";
import { useMemo } from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import type { Format, Lang, Project } from "@gas/shared";
import { getTemplate } from "./templates";
import { Captions, buildCaptionItems } from "./common/Captions";
import { Bgm } from "./common/Bgm";
import { Narration } from "./common/NarrationTrack";
import { makeDuckEnvelope } from "./common/audioMix";
import { DuckContext } from "./common/mixContext";
import { BODY_FONT } from "./common/fonts";

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
 * The single composition. Dispatches to the template module of project.template (templates/index.ts),
 * which renders the visuals from its timeline; this component adds what every template shares:
 * black background + body font, the ducking envelope, captions, narration audio and BGM.
 */
export const AdVideo: React.FC<AdVideoProps> = ({ project, format, lang, assetBaseUrl, useProxy }) => {
  const { fps } = useVideoConfig();
  const template = getTemplate(project.template);
  // ONE timeline (sections + narration plan) shared with calcAdMetadata / buildNarrationPlan
  const tl = useMemo(() => template.buildTimeline(project, fps, lang), [template, project, fps, lang]);
  const duck = useMemo(() => makeDuckEnvelope(tl.narration, fps), [tl, fps]);
  const captionItems = useMemo(
    () => (project.style.captions.enabled ? buildCaptionItems(project, lang, tl.narration, fps) : []),
    [project, lang, tl, fps],
  );
  const cs = project.style.captions;
  const Visuals = template.Component;

  return (
    <DuckContext.Provider value={duck}>
    <AbsoluteFill style={{ backgroundColor: "black", fontFamily: BODY_FONT }}>
      <Visuals project={project} format={format} lang={lang} assetBaseUrl={assetBaseUrl} useProxy={useProxy} timeline={tl} />
      {cs.enabled ? (
        <Captions
          items={captionItems}
          lang={lang}
          format={format}
          verticalMode={project.style.vertical.mode}
          color={project.style.primaryColor}
          position={cs.position}
          size={cs.size}
        />
      ) : null}
      <Narration project={project} plan={tl.narration} assetBaseUrl={assetBaseUrl} />
      {project.audio.bgm ? <Bgm project={project} assetBaseUrl={assetBaseUrl} /> : null}
    </AbsoluteFill>
    </DuckContext.Provider>
  );
};
