import { defineTemplate } from "../../types";
import { Trivia } from "./Trivia";
import { buildTimeline } from "./timeline";

export { TRIVIA, splitTitle, type TriviaTimeline } from "./timeline";

/**
 * Template "trivia" (雑学ストーリー), ARCHITECTURE §5.10: white background, persistent 2-line title (white on a red
 * box / black on white), full-width ~8:7 media window with hard cuts per narration line, black un-outlined captions
 * under it; flag = no end card (cta lines continue the story), flag off = common end card.
 */
export const triviaTemplate = defineTemplate({
  id: "trivia",
  buildTimeline,
  Component: Trivia,
});
