import type { Lang, Project } from "@gas/shared";
import type { PlacedClip, Segment } from "../../../common/clips";
import type { SeEvent } from "../../../common/SeTrack";
import type { TemplateTimeline } from "../../types";
import {
  buildShortBase,
  captionLayoutFor,
  fillInterval,
  fitBlocks,
  itemsOf,
  layClips,
  sec,
  sectionsFromMarks,
  shortData,
  shortTimelineFields,
  textOf,
  SE_GAIN,
  type SectionMark,
  transitionCutsOf,
} from "../common";

/**
 * Template "list" (〇〇選リスト) — ARCHITECTURE §5.10:
 * 0 s: the headline (title) big over the hook clip (full-bleed) with numbered chips previewing the list.
 * Each item: a full-screen number card (「1」「2」… / flag: 「第 N 位」 counting down to 第 1 位) for ~0.6 s, then
 * that item's main clip (main slot clips in item order, repeated if short) with the numbered item text on top.
 * With narration: when the number of main lines equals the number of items, item k starts at main line k.
 * -> common end card.
 */

export const LIST = {
  /** items shown at most (META: 2..5) */
  MAX_ITEMS: 5,
  /** headline phase without hook narration */
  TITLE_SEC: 1.8,
  /** shortest headline phase */
  TITLE_MIN_SEC: 1.1,
  /** number card */
  CARD_SEC: 0.6,
  /** shortest item (card + a bit of its clip) */
  ITEM_MIN_SEC: 1.3,
  /** no narration (free): length of one item */
  ITEM_NN_SEC: 2.6,
  /** free length without items: body */
  NO_ITEMS_SEC: 8,
  /** headline phase clips: tempo */
  TITLE_MAX_CUT_SEC: 2.5,
} as const;

export type ListEntry = {
  /** index into the (non-empty) items of this language, = data order */
  index: number;
  /** position on screen (0 = first shown) */
  order: number;
  /** number on the card / tile (ranking: n..1, else 1..n) */
  num: number;
  /** item rich text */
  text: string;
  /** absolute frames: card [from, from + cardFrames), clip [from + cardFrames, to) */
  from: number;
  cardFrames: number;
  to: number;
};

export type ListTimeline = TemplateTimeline & {
  bodyFrames: number;
  endFrames: number;
  /** headline ("" = none) */
  title: string;
  /** flag: countdown ranking (第 N 位 -> 第 1 位) */
  ranking: boolean;
  /** number of items shown */
  count: number;
  /** headline phase [0, titleFrames) (= bodyFrames when there are no items) */
  titleFrames: number;
  entries: ListEntry[];
  /** clips of the headline phase (absolute frames) */
  titleClips: PlacedClip[];
  /** clips of the items (absolute frames; gaps during the number cards) */
  itemClips: PlacedClip[];
  /** frames where the item footage starts / changes (after each card) */
  cuts: number[];
};

export function buildTimeline(project: Project, fps: number, lang: Lang): ListTimeline {
  const data = shortData(project, "list");
  const title = textOf(data.title, lang);
  const items = itemsOf(data, lang).slice(0, LIST.MAX_ITEMS);
  const n = items.length;
  const ranking = data.flag && n > 0;

  const base = buildShortBase(project, fps, lang, {
    minBodySec: n > 0 ? LIST.TITLE_MIN_SEC + n * LIST.ITEM_MIN_SEC : 4,
    noNarrationSec:
      n > 0
        ? { min: LIST.TITLE_SEC + n * LIST.ITEM_NN_SEC, max: LIST.TITLE_SEC + n * LIST.ITEM_NN_SEC }
        : { min: LIST.NO_ITEMS_SEC, max: 15 },
  });
  const body = base.bodyFrames;
  const minItem = sec(LIST.ITEM_MIN_SEC, fps);
  const titleMin = sec(LIST.TITLE_MIN_SEC, fps);

  // ---- item start frames ------------------------------------------------------------------------
  let starts: number[] = [];
  if (n > 0) {
    const mains = base.played.filter((p) => p.section === "main");
    if (mains.length === n) {
      // aligned: item k switches at the start of main line k (kept apart by >= minItem, inside the body)
      mains.forEach((l, k) => {
        const s = k === 0 ? Math.max(l.from, titleMin) : Math.max(l.from, starts[k - 1]! + minItem);
        starts.push(Math.min(s, body - (n - k) * minItem));
      });
      // too short for the alignment (fixed length cut the lines) -> even split below
      const gap = sec(LIST.CARD_SEC, fps) + 2;
      const bad = starts.some((s, k) => (k === 0 ? s < 1 : s - starts[k - 1]! < gap)) || body - starts[n - 1]! < gap;
      if (bad) starts = [];
    }
    if (starts.length === 0) {
      // even split after the headline (hook narration -> headline lasts until it ends)
      const titleWant = base.hookEnd > 0 ? Math.max(titleMin, base.hookEnd) : sec(LIST.TITLE_SEC, fps);
      const t = Math.max(1, Math.min(titleWant, body - n * minItem));
      const rest = Math.max(n, body - t);
      if (body - t >= n) {
        for (let k = 0; k < n; k++) starts.push(t + Math.floor((rest * k) / n));
      } else {
        // pathologically short body: proportional blocks
        const blocks = fitBlocks([titleWant, ...items.map(() => minItem)], body);
        let acc = blocks[0]!;
        for (let k = 0; k < n; k++) {
          starts.push(Math.min(body - 1, acc));
          acc += blocks[k + 1]!;
        }
      }
    }
  }
  const titleFrames = n > 0 ? Math.max(1, starts[0]!) : body;

  const entries: ListEntry[] = items.map((it, order) => {
    const from = starts[order]!;
    const to = order + 1 < n ? starts[order + 1]! : body;
    const len = Math.max(0, to - from);
    const index = ranking ? n - 1 - order : order;
    return {
      index,
      order,
      num: ranking ? n - order : order + 1,
      text: items[index]!.text,
      from,
      cardFrames: Math.min(sec(LIST.CARD_SEC, fps), Math.max(1, Math.floor(len * 0.6))),
      to,
    };
  });

  // ---- clips -----------------------------------------------------------------------------------
  const hookPool: Segment[] = base.hookSegs.length > 0 ? base.hookSegs : base.segs;
  const itemPool: Segment[] = base.mainSegs.length > 0 ? base.mainSegs : base.segs;
  const titleLay = layClips(hookPool, { from: 0, to: titleFrames }, fps, {
    lines: n > 0 ? base.played.filter((p) => p.section === "hook") : base.played,
    maxCutSec: LIST.TITLE_MAX_CUT_SEC,
    holdFirstSec: Math.min(LIST.TITLE_SEC, titleFrames / fps),
    keyPrefix: "lt",
  });
  const itemClips: PlacedClip[] = [];
  const cuts: number[] = [...titleLay.cuts];
  const itemCutFrames: number[] = [];
  if (itemPool.length > 0) {
    for (const e of entries) {
      const at = e.from + e.cardFrames;
      if (e.to <= at) continue;
      // item i uses the i-th main clip (data order), repeated when there are fewer clips than items
      itemClips.push(...fillInterval(itemPool[e.index % itemPool.length]!, at, e.to - at, `li${e.order}`));
      cuts.push(at);
      itemCutFrames.push(at);
    }
  }

  // ---- sections ---------------------------------------------------------------------------------
  const marks: SectionMark[] = [{ id: "title", kind: "hook", label: "見出し", from: 0 }];
  for (const e of entries) marks.push({ id: `item${e.order + 1}`, kind: "main", label: ranking ? `第${e.num}位` : `項目${e.num}`, from: e.from });
  if (base.endFrames > 0) marks.push({ id: "end", kind: "end", label: "エンド", from: body });
  const sections = sectionsFromMarks(marks, base.totalFrames);

  // ---- SE: headline @0, point @ every number card (louder for #1), transition when the footage comes in
  const se: SeEvent[] = entries.map((e) => ({ frame: e.from, slot: "point", gain: ranking && e.num === 1 ? 1 : SE_GAIN.point }));
  if (ranking) {
    const first = entries.find((e) => e.num === 1);
    if (first) se.push({ frame: first.from, slot: "headline", gain: 0.8 });
  }
  const ev: SeEvent[] = [];
  ev.push({ frame: 0, slot: "headline", gain: SE_GAIN.headline });
  for (const c of cuts) ev.push({ frame: c, slot: "transition", gain: 0.5 });
  ev.push(...se);
  if (base.endFrames > 0) ev.push({ frame: body, slot: "cta", gain: SE_GAIN.cta });
  const seEvents = ev.filter((e) => e.frame >= 0 && e.frame < base.totalFrames).sort((a, b) => a.frame - b.frame);

  return {
    ...shortTimelineFields(base, { sections, seEvents, captionLayout: captionLayoutFor(project, { scale: 1.2 }) }),
    bodyFrames: body,
    endFrames: base.endFrames,
    title,
    ranking,
    count: n,
    titleFrames,
    entries,
    titleClips: titleLay.clips,
    itemClips,
    // §5.11 cut transitions (auto): whip on the title cuts, zoom when an item's footage comes in after its number card
    transitionCuts: [...transitionCutsOf(titleLay.cuts, "whip", titleFrames), ...transitionCutsOf(itemCutFrames, "zoom", body)],
    cuts: [...new Set(cuts)].filter((c) => c > 0 && c < body).sort((a, b) => a - b),
  };
}
