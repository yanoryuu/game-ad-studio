import { FORMAT_SIZE, type Format, type Fps, type Project } from "@gas/shared";
import { buildTimeline } from "./timeline";

export type AdMetadata = {
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
};

/**
 * Total length of the hook-play-cta timeline. Uses the same buildTimeline() as <AdVideo>,
 * so the duration always matches what is rendered.
 */
export function calcAdMetadata(project: Project, format: Format, fps?: Fps): AdMetadata {
  const outFps = fps ?? project.fps;
  const { width, height } = FORMAT_SIZE[format];
  const timeline = buildTimeline(project, outFps);
  return {
    durationInFrames: Math.max(1, timeline.totalFrames),
    fps: outFps,
    width,
    height,
  };
}
