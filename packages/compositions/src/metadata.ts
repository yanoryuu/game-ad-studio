import { FORMAT_SIZE, type Format, type Fps, type Lang, type Project } from "@gas/shared";
import { buildTimeline } from "./timeline";

export type AdMetadata = {
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
};

/**
 * Total length of the hook-play-cta timeline. Uses the same buildTimeline() as <AdVideo>
 * (including the narration of `lang`, which may extend sections when durationSec is null),
 * so the duration always matches what is rendered.
 */
export function calcAdMetadata(project: Project, format: Format, lang: Lang, fps?: Fps): AdMetadata {
  const outFps = fps ?? project.fps;
  const { width, height } = FORMAT_SIZE[format];
  const timeline = buildTimeline(project, outFps, lang);
  return {
    durationInFrames: Math.max(1, timeline.totalFrames),
    fps: outFps,
    width,
    height,
  };
}

export type SectionDurations = { hookSec: number; mainSec: number; endSec: number; totalSec: number };

/** Section lengths in seconds (for the web's structure bar), from the same buildTimeline() as the render. */
export function getSectionDurations(project: Project, lang: Lang, fps: number = project.fps): SectionDurations {
  const tl = buildTimeline(project, fps, lang);
  return {
    hookSec: tl.hook.durationInFrames / fps,
    mainSec: tl.main.durationInFrames / fps,
    endSec: tl.endCard.durationInFrames / fps,
    totalSec: tl.totalFrames / fps,
  };
}
