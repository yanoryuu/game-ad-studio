import { defineTemplate } from "../../types";
import { Loop } from "./Loop";
import { buildTimeline } from "./timeline";

export { LOOP, type LoopTimeline } from "./timeline";

/**
 * Template "loop" (無限ループ), ARCHITECTURE §5.10: footage only at a quick tempo (small headline + loop ring),
 * no end card, small CTA over the last ~2.5 s, flag = seamless cross-fade back into the opening footage.
 */
export const loopTemplate = defineTemplate({
  id: "loop",
  buildTimeline,
  Component: Loop,
});
