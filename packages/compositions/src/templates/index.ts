import { SHORT_TEMPLATE_IDS, type ShortTemplateId, type TemplateId } from "@gas/shared";
import { featuresTemplate } from "./features";
import { hookPlayCtaTemplate } from "./hookPlayCta";
import { introTemplate } from "./intro";
import { beforeAfterTemplate } from "./shorts/beforeAfter";
import { challengeTemplate } from "./shorts/challenge";
import { failWinTemplate } from "./shorts/failWin";
import { payoffTemplate } from "./shorts/payoff";
import { commentTemplate } from "./shorts/comment";
import { devPitchTemplate } from "./shorts/devPitch";
import { devlogTemplate } from "./shorts/devlog";
import { loopTemplate } from "./shorts/loop";
import { listTemplate } from "./shorts/list";
import { questionTemplate } from "./shorts/question";
import { triviaTemplate } from "./shorts/trivia";
import { trailerTemplate } from "./trailer";
import type { TemplateModule } from "./types";

/** Template registry: one TemplateModule per TemplateId (ARCHITECTURE §5.4). */
export const TEMPLATES: Record<TemplateId, TemplateModule> = {
  "hook-play-cta": hookPlayCtaTemplate,
  features: featuresTemplate,
  trailer: trailerTemplate,
  intro: introTemplate,
  // v5 short-form templates: TEMPORARY stubs (replaced by templates/shorts/* modules)
  ...(Object.fromEntries(SHORT_TEMPLATE_IDS.map((id) => [id, hookPlayCtaTemplate])) as Record<ShortTemplateId, TemplateModule>),
  // v5 short-form templates (templates/shorts/*)
  question: questionTemplate,
  "dev-pitch": devPitchTemplate,
  list: listTemplate,
  comment: commentTemplate,
  "before-after": beforeAfterTemplate,
  devlog: devlogTemplate,
  loop: loopTemplate,
  challenge: challengeTemplate,
  "fail-win": failWinTemplate,
  payoff: payoffTemplate,
  trivia: triviaTemplate,
};

/** Module of `id` (unknown ids fall back to hook-play-cta, which never happens for a validated Project). */
export function getTemplate(id: TemplateId): TemplateModule {
  return TEMPLATES[id] ?? hookPlayCtaTemplate;
}

export type { SectionKind, TemplateModule, TemplateRenderProps, TemplateTimeline, TimelineSectionInfo } from "./types";
