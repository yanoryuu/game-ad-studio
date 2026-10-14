/**
 * ======================================================================================================
 *  Short-form template kit (ARCHITECTURE §5.10) — shared by templates/shorts/<id>/ (10 templates)
 * ======================================================================================================
 *
 * A template = templates/shorts/<id>/{timeline.ts, <Name>.tsx, index.ts}; index.ts exports
 * `defineTemplate({ id, buildTimeline, Component })` and is registered in templates/index.ts.
 * Import everything from "../common" (this file). Existing src/common/** stays read-only.
 *
 * ---- 1. buildTimeline (pure) ---------------------------------------------------------------------------
 *   const data = shortData(project, "my-id");                 // templateData.shorts[id]
 *   const title = textOf(data.title, lang);                   // "" = do not show
 *   const base = buildShortBase(project, fps, lang, { minBodySec: 6, noNarrationSec: { min: 8, max: 15 } });
 *     // narration (hook -> main back to back, cta on the end card), free/fixed length, end card (or
 *     // { endCard: false } = loop: no end card, cta lines in the last LOOP_CTA_SEC), clip material:
 *     // base.segs (hook slot then main slot), base.hookSegs, base.mainSegs, base.played (body lines),
 *     // base.bodyFrames / endFrames / totalFrames / hookEnd / ctaFrom.
 *   const lay = layClips(base.segs, { from: 0, to: base.bodyFrames }, fps,
 *                        { lines: base.played, maxCutSec: 2, holdFirstSec: 1.2, keyPrefix: "b" });
 *     // one clip per narration line (intro rules) + tempo splitting; without lines: rotation at maxCutSec, or
 *     // a proportional fit (no maxCutSec). Slot-specific: lay hookSegs into one span and mainSegs into another
 *     // and concatenate (`startIndex` / `nextIndex` continue a rotation). Clip `from` = absolute body frames.
 *   const sections = sectionsFromMarks(standardMarks(base, [{ id: "poll", kind: "card", label: "投票", from: x }]), base.totalFrames);
 *   const seEvents = standardSeEvents(base, lay.cuts, [{ frame: x, slot: "point" }]);   // headline@0, transition@cuts, cta@end
 *   return { ...shortTimelineFields(base, { sections, seEvents, captionLayout: captionLayoutFor(project, { scale: 1.2 }) }),
 *            bodyFrames: base.bodyFrames, endFrames: base.endFrames, clips: lay.clips, cuts: lay.cuts, ...own };
 *   Fixed 15/30: everything must fit base.bodyFrames — shrink effect blocks with fitBlocks([...wanted], body).
 *
 * ---- 2. Component ----------------------------------------------------------------------------------------
 *   <ShortShell {...props} timeline={tl}>                       // body Sequence + common EndCard
 *     <ShortGameplay project layout={gameLayout(project, format)} clips={tl.clips} cuts={tl.cuts} assetBaseUrl useProxy />
 *     {vertical ? <TopBand project lang text={title} variant="dark" kicker={<Badge …/>} />
 *               : <TopBanner project lang text={title} variant="dark" />}
 *     <Sequence from={x} durationInFrames={d} layout="none"> <SpeechBubble …/> </Sequence>
 *   </ShortShell>
 *   Layouts: gameLayout() -> "full16" (16:9) | "strip" (9:16, 16:9 strip at V916.stripTop = 656, captions below)
 *            | "full" (9:16 full-bleed when style.vertical.mode = "crop"; captionLayoutFor() switches captions).
 *   Parts: BigText (outlined display RichText) · TopBand / TopBanner · SlamText · Badge · TextCard ·
 *          CtaBar · SpeechBubble · ProgressGauge · StripBackground. All themable via style.accentColor /
 *          emphasisColor (surface(project, "accent" | "red" | "dark" | "light")).
 *   Rules: frame 0 must already show the main text (entrances animate scale/position only, never opacity from 0);
 *          9:16 safe zone SAFE916 (top 200, bottom 420, right 120 below y 840); captions are drawn by <AdVideo>
 *          (don't put big text where captionLayout puts them: below the strip, or above the bottom 16% in "full").
 *          Templates never draw captions / narration / BGM / SE audio — only timeline.seEvents.
 */

export * from "./data";
export * from "./timeline";
export * from "./layout";
export * from "./anim";
export { BigText, surface, type Surface, type SurfaceVariant } from "./BigText";
export { TopBand, TopBanner, bandTextLayout, type BandVariant } from "./TopBand";
export { ShortGameplay, StripBackground, stripRect } from "./GameStrip";
export { SlamText } from "./SlamText";
export { Badge } from "./Badge";
export { TextCard } from "./TextCard";
export { CtaBar } from "./CtaBar";
export { SpeechBubble } from "./SpeechBubble";
export { ProgressGauge } from "./ProgressGauge";
export { ShortShell } from "./ShortShell";
