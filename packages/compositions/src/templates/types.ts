import type React from "react";
import type { Format, Lang, Project, TemplateId, VerticalMode } from "@gas/shared";
import type { NarrationPlan } from "../common/narrationLayout";
import type { SeEvent } from "../common/SeTrack";
import type { CaptionBox, CaptionVariant } from "../common/Captions";
import type { TransitionCut } from "../common/transitions";

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
  /**
   * v4: sound effects to play (absolute frames, per slot). <AdVideo> resolves slot -> library file, applies
   * audio.se.enabled / volume and plays them (common/SeTrack). Absent = none. Only templates listed in
   * SE_TEMPLATES (@gas/shared) may emit SE (collectCredits relies on that).
   */
  seEvents?: SeEvent[];
  /**
   * §5.11 cut transitions: absolute frames where the gameplay shot changes and a transition may play, each with the
   * template's recommended effect for style.transition.preset "auto" ("none" = plain cut unless the user picks
   * an effect). Templates leave out cuts that already have their own deliberate effect (section wipes, hard cuts
   * by design, cuts into/out of cards / end card). Absent = no transitions.
   */
  transitionCuts?: TransitionCut[];
  /** v4: true -> <AdVideo> also plays the "captionPop" slot at the start of every caption chunk (§5.9) */
  captionPopSe?: boolean;
  /**
   * v4: caption layout overrides applied by <AdVideo>: `scale` multiplies the caption font size (default 1);
   * `verticalMode` replaces style.vertical.mode for caption placement in 9:16 (e.g. "blur" = the band below a
   * centered 16:9 strip, whatever the project's mode).
   */
  captionLayout?: {
    scale?: number;
    verticalMode?: VerticalMode;
    /** v5: "outline" (default: outlined `style.primaryColor`) | "plain-dark" (black, no outline/shadow/pop; for white backgrounds) */
    variant?: CaptionVariant;
    /** v5: caption font family (default BODY_FONT; the template must load the font itself) */
    fontFamily?: string;
    /** v5: explicit caption box for 9:16, px of the 1080×1920 frame (overrides position / verticalMode; see common/Captions) */
    box916?: CaptionBox;
    /** v5: explicit caption box for 16:9, px of the 1920×1080 frame */
    box169?: CaptionBox;
  };
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
