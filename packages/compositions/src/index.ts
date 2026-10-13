// Public API of @gas/compositions (see docs/ARCHITECTURE.md §5).
// NOTE: must NOT import ./entry (registerRoot side effect).
export { AdVideo, type AdVideoProps } from "./AdVideo";
export { calcAdMetadata, type AdMetadata } from "./metadata";
export { assetUrl, sourceUrl } from "./urls";
export { COMPOSITION_ID } from "./constants";
