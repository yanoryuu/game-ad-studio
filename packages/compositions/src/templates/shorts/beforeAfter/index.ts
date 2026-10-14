import { defineTemplate } from "../../types";
import { BeforeAfter } from "./BeforeAfter";
import { buildTimeline } from "./timeline";

export { BEFORE_AFTER, type BeforeAfterTimeline } from "./timeline";

/**
 * Template "before-after" (ビフォーアフター), ARCHITECTURE §5.10: headline on top; BEFORE (hook slot, old-tape grade +
 * sub label) -> hard cut with a 2-frame white flash -> AFTER (main slot, vivid + note label); flag: side-by-side
 * comparison in the last ~2.5 s (9:16 stacked / 16:9 left-right); common end card.
 */
export const beforeAfterTemplate = defineTemplate({
  id: "before-after",
  buildTimeline,
  Component: BeforeAfter,
});
