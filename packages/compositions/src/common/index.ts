// Shared building blocks for every template (FROZEN after Phase 3.5 step 1: template agents import, never edit;
// needed changes are reported). Templates may import from "../../common" or from the individual files.
export { Backdrop } from "./Backdrop";
export { Bgm } from "./Bgm";
export { Captions, buildCaptionItems, type CaptionItem } from "./Captions";
export { EMPHASIS_SCALE, RichText, estimateEm, estimateRichEm, richLines } from "./RichText";
export {
  SE_MAX_SEC,
  SE_POP_SUPPRESS_SEC,
  SeTrack,
  buildSeSchedule,
  captionPopEvents,
  type ScheduledSe,
  type SeEvent,
} from "./SeTrack";
export { ClipTrack } from "./ClipTrack";
export {
  MIN_CLIP_SEC,
  consumeFrames,
  fitSegments,
  segLen,
  toSegments,
  type PlacedClip,
  type Segment,
  type TimelineSection,
} from "./clips";
export { EndCard } from "./EndCard";
export { BODY_FONT, displayFont } from "./fonts";
export { DUCK_RAMP_SEC, bgmDuckGain, gameDuckGain, makeDuckEnvelope, type DuckEnvelope } from "./audioMix";
export { DuckContext, useDuckEnvelope } from "./mixContext";
export { Narration } from "./NarrationTrack";
export {
  layoutNarration,
  placeSection,
  playableLines,
  toFrames,
  type NarrationLayout,
  type NarrationPlan,
  type PlacedNarration,
  type RelLine,
} from "./narrationLayout";
export { NoFootage } from "./NoFootage";
export { jaPhrases } from "./phrases";
export { isVertical, outline, readableOn, unitFor, withAlpha } from "./theme";
export { assetUrl, seFileUrl, sourceImageUrl, sourceUrl } from "./urls";
export { Watermark } from "./Watermark";
