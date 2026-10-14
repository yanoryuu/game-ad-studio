// Public API of @gas/compositions (see docs/ARCHITECTURE.md §5).
// NOTE: must NOT import ./entry (registerRoot side effect).
export { AdVideo, type AdVideoProps } from "./AdVideo";
export {
  calcAdMetadata,
  getSectionDurations,
  type AdMetadata,
  type SectionDuration,
  type SectionDurations,
} from "./metadata";
export { HOOK_SEC, END_CARD_SEC, MAX_HOOK_SEC, MAX_END_CARD_SEC } from "./templates/hookPlayCta";
export { buildNarrationPlan, type NarrationPlan, type PlacedNarration } from "./narration";
export { getTemplate, TEMPLATES } from "./templates";
export type { SectionKind, TemplateModule, TemplateRenderProps, TemplateTimeline, TimelineSectionInfo } from "./templates/types";
export { assetUrl, sourceUrl } from "./common/urls";
export { COMPOSITION_ID } from "./constants";
