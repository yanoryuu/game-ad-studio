import { defineTemplate } from "../types";
import { Intro } from "./Intro";
import { buildTimeline } from "./timeline";

export {
  BODY_MIN_SEC,
  BODY_TAIL_SEC,
  LINE_CLIP_MIN_SEC,
  NO_NARRATION_INFO_SEC,
  TAIL_SPLIT_SEC,
  type IntroInfo,
  type IntroInfoRow,
  type IntroPointShow,
  type IntroTimeline,
} from "./timeline";

/**
 * Template "intro" (紹介動画風): vertical-first, narration-driven game introduction short. ARCHITECTURE §5.8.
 * Body = persistent headline band (top) + 16:9 gameplay strip switching clips per narration line (middle) +
 * large captions (bottom, drawn by <AdVideo> via captionLayout), info card and numbered points over the strip;
 * then the common end card. Emits SE events (headline / transition / info / point / cta) + caption pops.
 */
export const introTemplate = defineTemplate({
  id: "intro",
  buildTimeline,
  Component: Intro,
});
