import type React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import type { Project } from "@gas/shared";
import { Backdrop } from "./Backdrop";
import { BODY_FONT } from "./fonts";
import { unitFor } from "./theme";

/** Shown in the main section when there is no usable footage (keeps the duration meaningful). */
export const NoFootage: React.FC<{ project: Project; assetBaseUrl: string }> = ({ project, assetBaseUrl }) => {
  const { width, height } = useVideoConfig();
  const u = unitFor(width, height);
  return (
    <AbsoluteFill>
      <Backdrop project={project} assetBaseUrl={assetBaseUrl} blurPx={0} brightness={0.85} />
      {project.game.keyArt ? null : (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <div style={{ fontFamily: BODY_FONT, fontWeight: 700, fontSize: 36 * u, color: "rgba(255,255,255,0.35)", letterSpacing: "0.2em" }}>
            GAMEPLAY
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
