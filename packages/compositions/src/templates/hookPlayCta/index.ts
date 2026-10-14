import { defineTemplate } from "../types";
import { HookPlayCta } from "./HookPlayCta";
import { buildTimeline } from "./timeline";

export { HOOK_SEC, END_CARD_SEC, MAX_HOOK_SEC, MAX_END_CARD_SEC, type AdTimeline } from "./timeline";

/** "hook-play-cta" (王道): hook -> main gameplay -> end card. ARCHITECTURE §5.1. */
export const hookPlayCtaTemplate = defineTemplate({
  id: "hook-play-cta",
  buildTimeline,
  Component: HookPlayCta,
});
