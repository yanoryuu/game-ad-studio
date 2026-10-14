import { defineTemplate } from "../../types";
import { DevPitch } from "./DevPitch";
import { buildTimeline } from "./timeline";

export { DEV_PITCH, type DevPitchTimeline } from "./timeline";

/**
 * Template "dev-pitch" (開発者ピッチ), ARCHITECTURE §5.10: first-person pitch band on top, gameplay with short cuts,
 * permanent CTA bar (cta + developer handle); 16:9 = top banner + bottom-right CTA card; common end card.
 */
export const devPitchTemplate = defineTemplate({
  id: "dev-pitch",
  buildTimeline,
  Component: DevPitch,
});
