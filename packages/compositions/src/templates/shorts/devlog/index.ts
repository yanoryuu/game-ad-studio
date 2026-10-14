import { defineTemplate } from "../../types";
import { Devlog } from "./Devlog";
import { buildTimeline } from "./timeline";

export { DEVLOG, type DevlogTimeline } from "./timeline";

/**
 * Template "devlog" (開発日記), ARCHITECTURE §5.10: giant "DAY n" + today's theme on frame 0 -> raw camcorder-style
 * body with a small DAY badge + series tag top-left -> follow prompt (note) in the last ~2 s -> common end card.
 */
export const devlogTemplate = defineTemplate({
  id: "devlog",
  buildTimeline,
  Component: Devlog,
});
