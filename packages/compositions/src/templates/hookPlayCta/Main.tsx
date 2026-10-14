import type React from "react";
import { AbsoluteFill } from "remotion";
import type { Format, Lang, Project } from "@gas/shared";
import type { TimelineSection } from "../../common/clips";
import { ClipTrack } from "../../common/ClipTrack";
import { NoFootage } from "../../common/NoFootage";
import { Watermark } from "../../common/Watermark";

export const MainSection: React.FC<{
  project: Project;
  section: TimelineSection;
  format: Format;
  lang: Lang;
  assetBaseUrl: string;
  useProxy: boolean;
}> = ({ project, section, format, lang, assetBaseUrl, useProxy }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {section.clips.length > 0 ? (
        <ClipTrack project={project} clips={section.clips} format={format} assetBaseUrl={assetBaseUrl} useProxy={useProxy} sectionFrom={section.from} punchFirst />
      ) : (
        <NoFootage project={project} assetBaseUrl={assetBaseUrl} />
      )}
      <Watermark project={project} lang={lang} assetBaseUrl={assetBaseUrl} />
    </AbsoluteFill>
  );
};
