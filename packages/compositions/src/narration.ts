import type { Lang, Project } from "@gas/shared";
import { getTemplate } from "./templates";
import type { NarrationPlan } from "./common/narrationLayout";

/**
 * Narration placement on the output timeline (docs/ARCHITECTURE.md §5.1 / §5.5 / §5.6).
 * Shared by calcAdMetadata, <AdVideo> and the web (overflow warnings): all go through the template's
 * buildTimeline(), which sizes the sections and places the narration in one pass.
 */
export type { PlacedNarration, NarrationPlan } from "./common/narrationLayout";

export function buildNarrationPlan(project: Project, lang: Lang, fps: number): NarrationPlan {
  return getTemplate(project.template).buildTimeline(project, fps, lang).narration;
}
