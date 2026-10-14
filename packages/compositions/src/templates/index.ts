import type { TemplateId } from "@gas/shared";
import { featuresTemplate } from "./features";
import { hookPlayCtaTemplate } from "./hookPlayCta";
import { introTemplate } from "./intro";
import { trailerTemplate } from "./trailer";
import type { TemplateModule } from "./types";

/** Template registry: one TemplateModule per TemplateId (ARCHITECTURE §5.4). */
export const TEMPLATES: Record<TemplateId, TemplateModule> = {
  "hook-play-cta": hookPlayCtaTemplate,
  features: featuresTemplate,
  trailer: trailerTemplate,
  intro: introTemplate,
};

/** Module of `id` (unknown ids fall back to hook-play-cta, which never happens for a validated Project). */
export function getTemplate(id: TemplateId): TemplateModule {
  return TEMPLATES[id] ?? hookPlayCtaTemplate;
}

export type { SectionKind, TemplateModule, TemplateRenderProps, TemplateTimeline, TimelineSectionInfo } from "./types";
