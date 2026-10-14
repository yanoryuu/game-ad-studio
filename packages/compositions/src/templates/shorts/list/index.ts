import { defineTemplate } from "../../types";
import { List } from "./List";
import { buildTimeline } from "./timeline";

export { LIST, type ListEntry, type ListTimeline } from "./timeline";

/**
 * Template "list" (〇〇選リスト), ARCHITECTURE §5.10: big headline over the hook clip, then per item a full-screen
 * number card (flag: 第 N 位 countdown) -> that item's main clip with the numbered item text; common end card.
 */
export const listTemplate = defineTemplate({
  id: "list",
  buildTimeline,
  Component: List,
});
