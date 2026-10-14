import type { Lang, Project } from "@gas/shared";
import { buildTimeline } from "./timeline";
import type { NarrationPlan } from "./narrationLayout";

/**
 * Narration placement on the output timeline (docs/ARCHITECTURE.md §5.1).
 * Shared by calcAdMetadata, <AdVideo> and the web (overflow warnings): all three go through
 * buildTimeline(), which sizes the sections and places the narration in one pass.
 *
 * Playable lines: lang === `lang`, non-empty text, audioPath + durationSec (stale/error lines with
 * old audio are played too). hook/cta: section start + offsetSec. main: sequential from main start,
 * offsetSec = extra gap before the line. durationSec null -> sections grow to fit; fixed -> lines are
 * cut at the section end (or dropped when they start outside it) and listed in overflowLineIds.
 */
export type { PlacedNarration, NarrationPlan } from "./narrationLayout";

export function buildNarrationPlan(project: Project, lang: Lang, fps: number): NarrationPlan {
  return buildTimeline(project, fps, lang).narration;
}
