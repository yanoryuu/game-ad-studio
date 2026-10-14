// Public API of @gas/compositions (see docs/ARCHITECTURE.md §5).
// NOTE: must NOT import ./entry (registerRoot side effect).
export { AdVideo, type AdVideoProps } from "./AdVideo";
export { calcAdMetadata, getSectionDurations, type AdMetadata, type SectionDurations } from "./metadata";
export { HOOK_SEC, END_CARD_SEC, MAX_HOOK_SEC, MAX_END_CARD_SEC } from "./timeline";
export { buildNarrationPlan, type NarrationPlan, type PlacedNarration } from "./narration";
export { assetUrl, sourceUrl } from "./urls";
export { COMPOSITION_ID } from "./constants";
