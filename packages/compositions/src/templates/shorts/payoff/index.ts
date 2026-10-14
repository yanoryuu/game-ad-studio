import { defineTemplate } from "../../types";
import { Payoff } from "./Payoff";
import { buildTimeline } from "./timeline";

export { PAYOFF, acceleratingCuts, gaugeValue, type PayoffTimeline } from "./timeline";

/**
 * Template "payoff" (溜め→爆発), ARCHITECTURE §5.10: hype line in the top band all along, accelerating build-up
 * cuts with a charge gauge (flag), the last clip = payoff (white flash, zoom punch, shake, burst + note); end card.
 */
export const payoffTemplate = defineTemplate({
  id: "payoff",
  buildTimeline,
  Component: Payoff,
});
