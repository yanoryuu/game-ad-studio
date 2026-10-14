import { defineTemplate } from "../../types";
import { Challenge } from "./Challenge";
import { buildTimeline } from "./timeline";

export { CHALLENGE, type ChallengeTimeline } from "./timeline";

/**
 * Template "challenge" (挑戦状), ARCHITECTURE §5.10: "CHALLENGE" badge + the challenge at frame 0 over the hook
 * clip, red REC viewfinder, countdown timer (number -> 0), the result hidden by a blackout (flag + sub), a
 * hazard-tape note card, common end card.
 */
export const challengeTemplate = defineTemplate({
  id: "challenge",
  buildTimeline,
  Component: Challenge,
});
