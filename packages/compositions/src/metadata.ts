import { FORMAT_SIZE, type Format, type Fps, type Lang, type Project } from "@gas/shared";
import { getTemplate } from "./templates";
import type { SectionKind } from "./templates/types";

export type AdMetadata = {
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
};

/**
 * Total length of the project's template timeline. Uses the same template buildTimeline() as <AdVideo>
 * (including the narration of `lang`, which may extend sections when durationSec is null),
 * so the duration always matches what is rendered.
 */
export function calcAdMetadata(project: Project, format: Format, lang: Lang, fps?: Fps): AdMetadata {
  const outFps = fps ?? project.fps;
  const { width, height } = FORMAT_SIZE[format];
  const timeline = getTemplate(project.template).buildTimeline(project, outFps, lang);
  return {
    durationInFrames: Math.max(1, timeline.totalFrames),
    fps: outFps,
    width,
    height,
  };
}

export type SectionDuration = { id: string; kind: SectionKind; label: string; sec: number };

/**
 * v3: generic structure of any template + the Phase 2 aggregate fields.
 *  - sections: every timeline section in order (sum = totalSec)
 *  - hookSec = sections of kind "hook" | "intro"
 *  - mainSec = sections of kind "main" | "feature" (time that main-slot footage fills; cards / logo excluded)
 *  - endSec  = sections of kind "end"
 */
export type SectionDurations = {
  sections: SectionDuration[];
  hookSec: number;
  mainSec: number;
  endSec: number;
  totalSec: number;
};

/** Section lengths in seconds (for the web's structure bar), from the same buildTimeline() as the render. */
export function getSectionDurations(project: Project, lang: Lang, fps: number = project.fps): SectionDurations {
  const tl = getTemplate(project.template).buildTimeline(project, fps, lang);
  const sections = tl.sections.map((s) => ({ id: s.id, kind: s.kind, label: s.label, sec: s.durationInFrames / fps }));
  const sum = (kinds: SectionKind[]) => sections.filter((s) => kinds.includes(s.kind)).reduce((a, s) => a + s.sec, 0);
  return {
    sections,
    hookSec: sum(["hook", "intro"]),
    mainSec: sum(["main", "feature"]),
    endSec: sum(["end"]),
    totalSec: tl.totalFrames / fps,
  };
}
