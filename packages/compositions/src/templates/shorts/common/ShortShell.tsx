import type React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import type { Format, Lang, Project } from "@gas/shared";
import { EndCard } from "../../../common/EndCard";

/**
 * Outer frame of every short-form Component: the body (children) in a <Sequence> [0, bodyFrames) and the common
 * end card in [bodyFrames, bodyFrames + endFrames) (none when endFrames is 0 — loop). Children see frames
 * relative to the body start (= absolute frames).
 */
export const ShortShell: React.FC<{
  project: Project;
  format: Format;
  lang: Lang;
  assetBaseUrl: string;
  timeline: { bodyFrames: number; endFrames: number };
  children: React.ReactNode;
}> = ({ project, format, lang, assetBaseUrl, timeline, children }) => (
  <AbsoluteFill>
    {timeline.bodyFrames > 0 ? (
      <Sequence from={0} durationInFrames={timeline.bodyFrames} name="body">
        {children}
      </Sequence>
    ) : null}
    {timeline.endFrames > 0 ? (
      <Sequence from={timeline.bodyFrames} durationInFrames={timeline.endFrames} name="end card">
        <EndCard project={project} format={format} lang={lang} assetBaseUrl={assetBaseUrl} />
      </Sequence>
    ) : null}
  </AbsoluteFill>
);
