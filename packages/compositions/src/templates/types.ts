import type React from "react";
import type { Format, Lang, Project, TemplateId } from "@gas/shared";
import type { NarrationPlan } from "../common/narrationLayout";

/**
 * Template module contract (docs/ARCHITECTURE.md §5.4). Every template lives in templates/<name>/ and
 * exports ONE TemplateModule from its index.ts; templates/index.ts dispatches on project.template.
 */

/** What a section of the output timeline is (drives the web's structure-bar colors). */
export type SectionKind =
  /** opening title (features) */
  | "intro"
  /** hook (hook-play-cta) */
  | "hook"
  /** gameplay block (hook-play-cta main, trailer cut runs) */
  | "main"
  /** one feature item block (features) */
  | "feature"
  /** full-screen text card (trailer) */
  | "card"
  /** logo reveal (trailer) */
  | "logo"
  /** end card (all templates) */
  | "end";

/** One section of the output timeline, consecutive and gap-free; durations sum to totalFrames. */
export type TimelineSectionInfo = {
  /** unique within the timeline, e.g. "hook", "main", "end", "intro", "<featureItemId>", "<cardId>", "cuts-0", "logo" */
  id: string;
  kind: SectionKind;
  /** short Japanese UI label for the structure bar, e.g. "フック", "魅力1 爽快なアクション", "テロップ" */
  label: string;
  /** absolute start frame */
  from: number;
  durationInFrames: number;
};

/** Base of every template's timeline. Templates extend it with whatever their Component needs. */
export type TemplateTimeline = {
  fps: number;
  totalFrames: number;
  /** in playback order, gap-free, covering [0, totalFrames) */
  sections: TimelineSectionInfo[];
  /** narration of the requested language placed on this timeline (common/narrationLayout.ts) */
  narration: NarrationPlan;
};

export type TemplateRenderProps<T extends TemplateTimeline = TemplateTimeline> = {
  project: Project;
  format: Format;
  lang: Lang;
  assetBaseUrl: string;
  useProxy: boolean;
  /** = module.buildTimeline(project, fps, lang), computed once by <AdVideo> */
  timeline: T;
};

/**
 * A template:
 *  - buildTimeline: PURE (no React), deterministic; integer frames at `fps`. Used by calcAdMetadata,
 *    getSectionDurations, buildNarrationPlan and <AdVideo> — so duration, structure bar, overflow warnings
 *    and the render always agree. Must never throw for a valid Project (empty project -> still >= 1 frame).
 *  - Component: renders the VISUALS only (sections as <Sequence>s). <AdVideo> already provides the black
 *    background + BODY_FONT, the ducking context, captions, narration audio and BGM around it.
 */
export type TemplateModule<T extends TemplateTimeline = TemplateTimeline> = {
  id: TemplateId;
  buildTimeline: (project: Project, fps: number, lang: Lang) => T;
  Component: React.FC<TemplateRenderProps<T>>;
};

/** Type-erases a template's specific timeline type for the registry. */
export function defineTemplate<T extends TemplateTimeline>(m: TemplateModule<T>): TemplateModule {
  return m as unknown as TemplateModule;
}
