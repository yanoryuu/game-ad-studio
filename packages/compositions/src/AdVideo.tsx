import type React from "react";
import { useId, useMemo } from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import type { Format, Lang, Project } from "@gas/shared";
import { getTemplate } from "./templates";
import { Captions, buildCaptionItems } from "./common/Captions";
import { Bgm } from "./common/Bgm";
import { Narration } from "./common/NarrationTrack";
import { SeTrack, buildSeSchedule } from "./common/SeTrack";
import { makeDuckEnvelope } from "./common/audioMix";
import { DuckContext } from "./common/mixContext";
import { BODY_FONT } from "./common/fonts";
import { TransitionContext, TransitionDefs, type TransitionContextValue } from "./common/CutTransition";
import { buildTransitionSchedule, transitionGain, transitionSetting } from "./common/transitions";

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
 * black background + body font, the ducking envelope, captions, narration audio and BGM, and (v4) the sound
 * effects of tl.seEvents (+ caption pops when tl.captionPopSe), and (§5.11) the cut transitions of tl.transitionCuts
 * (applied by every ClipTrack to its footage only, via TransitionContext).
 */
export const AdVideo: React.FC<AdVideoProps> = ({ project, format, lang, assetBaseUrl, useProxy }) => {
  const { fps } = useVideoConfig();
  const rawId = useId();
  const template = getTemplate(project.template);
  // ONE timeline (sections + narration plan) shared with calcAdMetadata / buildNarrationPlan
  const tl = useMemo(() => template.buildTimeline(project, fps, lang), [template, project, fps, lang]);
  const duck = useMemo(() => makeDuckEnvelope(tl.narration, fps), [tl, fps]);
  const captionItems = useMemo(
    () => (project.style.captions.enabled ? buildCaptionItems(project, lang, tl.narration, fps) : []),
    [project, lang, tl, fps],
  );
  const se = useMemo(
    () => buildSeSchedule(project, tl.seEvents, captionItems, tl.captionPopSe === true, tl.totalFrames, fps),
    [project, tl, captionItems, fps],
  );
  const schedule = useMemo(() => buildTransitionSchedule(project, tl.transitionCuts, tl.totalFrames, fps), [project, tl, fps]);
  const covered = useMemo(() => new Set(schedule.map((s) => s.frame)), [schedule]);
  const gain = transitionGain(transitionSetting(project).intensity);
  const transition = useMemo<TransitionContextValue>(
    () => ({ schedule, covered, gain, uid: "gastr" + rawId.replace(/[^a-zA-Z0-9_-]/g, "") }),
    [schedule, covered, gain, rawId],
  );
  const cs = project.style.captions;
  const Visuals = template.Component;

  return (
    <DuckContext.Provider value={duck}>
    <TransitionContext.Provider value={transition}>
    <AbsoluteFill style={{ backgroundColor: "black", fontFamily: BODY_FONT }}>
      <TransitionDefs />
      <Visuals project={project} format={format} lang={lang} assetBaseUrl={assetBaseUrl} useProxy={useProxy} timeline={tl} />
      {cs.enabled ? (
        <Captions
          items={captionItems}
          lang={lang}
          format={format}
          verticalMode={tl.captionLayout?.verticalMode ?? project.style.vertical.mode}
          color={project.style.primaryColor}
          position={cs.position}
          size={cs.size}
          emphasisColor={project.style.emphasisColor}
          scale={tl.captionLayout?.scale ?? 1}
          variant={tl.captionLayout?.variant}
          fontFamily={tl.captionLayout?.fontFamily}
          box={format === "9:16" ? tl.captionLayout?.box916 : tl.captionLayout?.box169}
        />
      ) : null}
      <Narration project={project} plan={tl.narration} assetBaseUrl={assetBaseUrl} />
      {project.audio.bgm ? <Bgm project={project} assetBaseUrl={assetBaseUrl} /> : null}
      {se.length > 0 ? <SeTrack project={project} events={se} assetBaseUrl={assetBaseUrl} /> : null}
    </AbsoluteFill>
    </TransitionContext.Provider>
    </DuckContext.Provider>
  );
};
