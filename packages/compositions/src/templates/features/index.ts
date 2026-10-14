import { defineTemplate } from "../types";
import { Features } from "./Features";
import { buildTimeline } from "./timeline";

export { INTRO_SEC, MAX_INTRO_SEC, FEATURE_MIN_SEC, FEATURE_HEADING_SEC, type FeaturesTimeline, type FeatureBlock } from "./timeline";

/**
 * Template "features" (魅力紹介): title intro -> [numbered heading overlay + clips] per feature item -> end card.
 * ARCHITECTURE §5.5.
 */
export const featuresTemplate = defineTemplate({
  id: "features",
  buildTimeline,
  Component: Features,
});
