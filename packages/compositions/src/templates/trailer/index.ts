import { defineTemplate } from "../types";
import { Trailer } from "./Trailer";
import { buildTimeline } from "./timeline";

export {
  CARD_MAX_SEC,
  CARD_MIN_SEC,
  CARD_SEC,
  CUT_MAX_SEC,
  CUT_MIN_SEC,
  LOGO_REVEAL_SEC,
  beatGrid,
  type TrailerElement,
  type TrailerTimeline,
} from "./timeline";

/**
 * Template "trailer" (トレーラー風): beat-synced short cuts + big text cards -> logo reveal -> end card.
 * ARCHITECTURE §5.6.
 */
export const trailerTemplate = defineTemplate({
  id: "trailer",
  buildTimeline,
  Component: Trailer,
});
