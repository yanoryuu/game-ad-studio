import type React from "react";
import { Composition } from "remotion";
import { createDefaultProject } from "@gas/shared";
import { AdVideo, type AdVideoProps } from "./AdVideo";
import { calcAdMetadata } from "./metadata";

import { COMPOSITION_ID } from "./constants";

/** Placeholder props for Remotion Studio. The server always passes real inputProps. */
const defaultProps: AdVideoProps = {
  project: createDefaultProject("Sample Game", { id: "p_sample", now: new Date(0) }),
  format: "16:9",
  lang: "ja",
  assetBaseUrl: "http://localhost:3101",
  useProxy: true,
};

export const Root: React.FC = () => {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={AdVideo}
      defaultProps={defaultProps}
      // overwritten by calculateMetadata
      durationInFrames={1}
      fps={30}
      width={1920}
      height={1080}
      calculateMetadata={({ props }) => calcAdMetadata(props.project, props.format)}
    />
  );
};
