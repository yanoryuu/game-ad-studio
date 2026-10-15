import { assignFeatureClips, type FeatureItem, type Lang, type Project, type ScriptLine } from "@gas/shared";
import { fitSegments, MIN_CLIP_SEC, segLen, toSegments, type TimelineSection } from "../../common/clips";
import { layoutNarration, placeSection, playableLines, toFrames, type PlacedNarration, type RelLine } from "../../common/narrationLayout";
import { END_CARD_SEC, MAX_END_CARD_SEC } from "../hookPlayCta/timeline";
import type { TransitionCut } from "../../common/transitions";
import type { TemplateTimeline, TimelineSectionInfo } from "../types";

/**
 * Timeline of the "features" (魅力紹介) template — ARCHITECTURE §5.5.
 * intro (title over hook clips) -> one section per feature item (heading overlay over its clips) -> end card.
 * Pure + deterministic, integer frames; shared by calcAdMetadata / getSectionDurations / buildNarrationPlan / render.
 */

export const INTRO_SEC = 2.5;
export const MAX_INTRO_SEC = 5;
export const FEATURE_MIN_SEC = 2.0;
/** the heading is shown big for this long at the start of each feature, then shrinks to a label */
export const FEATURE_HEADING_SEC = 1.5;

export type FeatureBlock = TimelineSection & {
  /** feature item id (= section id) */
  id: string;
  /** 0-based position among the feature items */
  index: number;
  item: FeatureItem;
};

export type FeaturesTimeline = TemplateTimeline & {
  intro: TimelineSection;
  /** one per templateData.features.items entry (empty when there are no items) */
  features: FeatureBlock[];
  /** only when there are no feature items: a plain main section (hook-play-cta main rules) */
  main: TimelineSection | null;
  endCard: TimelineSection;
};

/** Sequential layout (t += offset -> place -> t += duration), like the main section of hook-play-cta. */
function sequential(lines: ScriptLine[], fps: number): { rel: RelLine[]; need: number } {
  const rel: RelLine[] = [];
  let t = 0;
  for (const line of lines) {
    const natural = Math.max(1, toFrames(line.durationSec!, fps));
    t += toFrames(line.offsetSec, fps);
    rel.push({ line, rel: t, natural });
    t += natural;
  }
  return { rel, need: t };
}

export function buildTimeline(project: Project, fps: number, lang: Lang): FeaturesTimeline {
  const narr = layoutNarration(project, lang, fps); // hook / cta placement + needs (main is re-laid out below)
  const free = project.durationSec === null;
  const grow = (base: number, need: number, max: number) =>
    Math.max(Math.round(base * fps), free ? need : Math.min(need, Math.round(max * fps)));
  const introFrames = grow(INTRO_SEC, narr.hookNeed, MAX_INTRO_SEC);
  const endFrames = grow(END_CARD_SEC, narr.ctaNeed, MAX_END_CARD_SEC);
  const minClipFrames = Math.round(MIN_CLIP_SEC * fps);
  const fixedBody = free ? 0 : Math.max(0, Math.round(project.durationSec! * fps) - introFrames - endFrames);

  const items = project.templateData.features.items;
  const mainLines = playableLines(project, lang).filter((l) => l.section === "main");
  const itemIds = new Set(items.map((it) => it.id));

  // intro: hook-slot clips only (never borrowed from main)
  const hookSegs = toSegments(project, project.clips.filter((c) => c.slot === "hook"), fps);
  const intro: TimelineSection = { from: 0, durationInFrames: introFrames, clips: fitSegments(hookSegs, introFrames, 1, "intro") };

  let cursor = introFrames;
  const features: FeatureBlock[] = [];
  let main: TimelineSection | null = null;
  const mainPlaced: PlacedNarration[] = [];

  if (items.length === 0) {
    // N = 0: one plain main section with every main clip / main line (hook-play-cta main rules)
    const segs = toSegments(project, project.clips.filter((c) => c.slot === "main"), fps);
    const all = sequential(mainLines, fps);
    const frames = free ? Math.max(segs.reduce((a, s) => a + segLen(s), 0), all.need) : fixedBody;
    main = { from: cursor, durationInFrames: frames, clips: fitSegments(segs, frames, minClipFrames, "main") };
    mainPlaced.push(...placeSection(all.rel, "main", main.from, main.durationInFrames, !free));
    cursor += frames;
  } else {
    const assigned = assignFeatureClips(project);
    const minFeature = Math.round(FEATURE_MIN_SEC * fps);
    const per = items.map((item) => {
      const segs = toSegments(project, assigned[item.id] ?? [], fps);
      const bound = sequential(
        mainLines.filter((l) => l.featureId === item.id),
        fps,
      );
      const natural = segs.reduce((a, s) => a + segLen(s), 0);
      return { item, segs, bound, weight: Math.max(minFeature, natural, bound.need) };
    });
    const unbound = sequential(
      mainLines.filter((l) => !l.featureId || !itemIds.has(l.featureId)),
      fps,
    );

    let lens: number[];
    if (free) {
      lens = per.map((p) => p.weight);
      const sum = lens.reduce((a, b) => a + b, 0);
      if (sum < unbound.need) lens[lens.length - 1]! += unbound.need - sum;
    } else {
      const sumW = per.reduce((a, p) => a + p.weight, 0);
      lens = per.map((p) => Math.floor((fixedBody * p.weight) / sumW));
      lens[lens.length - 1]! += fixedBody - lens.reduce((a, b) => a + b, 0);
    }

    const bodyFrom = cursor;
    per.forEach((p, i) => {
      const len = lens[i]!;
      features.push({
        id: p.item.id,
        index: i,
        item: p.item,
        from: cursor,
        durationInFrames: len,
        clips: fitSegments(p.segs, len, minClipFrames, `feat-${p.item.id}`),
      });
      mainPlaced.push(...placeSection(p.bound.rel, "main", cursor, len, !free));
      cursor += len;
    });
    mainPlaced.push(...placeSection(unbound.rel, "main", bodyFrom, cursor - bodyFrom, !free));
  }

  const endCard: TimelineSection = { from: cursor, durationInFrames: endFrames, clips: [] };
  const totalFrames = cursor + endFrames;

  // stable sort by start frame (bound + unbound lines interleave on the timeline)
  const mainSorted = mainPlaced.map((p, i) => ({ p, i })).sort((a, b) => a.p.from - b.p.from || a.i - b.i).map((x) => x.p);
  const lines = [
    ...placeSection(narr.hook, "hook", intro.from, intro.durationInFrames, !free),
    ...mainSorted,
    ...placeSection(narr.cta, "cta", endCard.from, endCard.durationInFrames, !free),
  ];

  const sections: TimelineSectionInfo[] = [{ id: "intro", kind: "intro", label: "タイトル", from: 0, durationInFrames: introFrames }];
  for (const f of features) {
    const heading = f.item.heading[lang].trim();
    sections.push({
      id: f.id,
      kind: "feature",
      label: `魅力${f.index + 1}${heading ? ` ${heading}` : ""}`,
      from: f.from,
      durationInFrames: f.durationInFrames,
    });
  }
  if (main && main.durationInFrames > 0) {
    sections.push({ id: "main", kind: "main", label: "本編", from: main.from, durationInFrames: main.durationInFrames });
  }
  sections.push({ id: "end", kind: "end", label: "エンド", from: endCard.from, durationInFrames: endCard.durationInFrames });

  // §5.11 cut transitions: clip changes INSIDE the intro / each feature / main only — the section boundaries keep
  // their accent swipe (Features.tsx). auto = whip
  const inner = (s: TimelineSection) => s.clips.map((c) => s.from + c.from).filter((f) => f > s.from && f < s.from + s.durationInFrames);
  const transitionCuts: TransitionCut[] = [...new Set([...inner(intro), ...features.flatMap(inner), ...(main ? inner(main) : [])])]
    .sort((a, b) => a - b)
    .map((frame) => ({ frame, auto: "whip" }));

  return {
    fps,
    totalFrames,
    sections,
    transitionCuts,
    intro,
    features,
    main,
    endCard,
    narration: { lines, overflowLineIds: lines.filter((l) => l.cut).map((l) => l.lineId) },
  };
}
