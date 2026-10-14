import { defineTemplate } from "../../types";
import { FailWin } from "./FailWin";
import { buildTimeline } from "./timeline";

export { FAIL_WIN, type FailWinTimeline, type SlowClip } from "./timeline";

/**
 * Template "fail-win" (失敗→逆転), ARCHITECTURE §5.10: red-glitch fail part with the fail text, a full-screen
 * "でも…" card, a slow-motion opening of the comeback (flag), then the comeback text slammed big and kept in the
 * band; common end card.
 */
export const failWinTemplate = defineTemplate({
  id: "fail-win",
  buildTimeline,
  Component: FailWin,
});
