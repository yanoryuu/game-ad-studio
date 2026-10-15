import { trailerClipOrder, type Lang, type Project, type TrailerCard } from "@gas/shared";
import { toSegments, type PlacedClip, type Segment } from "../../common/clips";
import type { TransitionCut } from "../../common/transitions";
import { layoutNarration, placeSection } from "../../common/narrationLayout";
import { END_CARD_SEC, MAX_END_CARD_SEC } from "../hookPlayCta/timeline";
import type { TemplateTimeline, TimelineSectionInfo } from "../types";

/**
 * Timeline of the "trailer" template (docs/ARCHITECTURE.md §5.6). Pure, deterministic, integer frames.
 *
 *   [cut | card]* (cold open, beat-snapped)  ->  logo reveal (optional)  ->  end card
 */

export const CUT_MAX_SEC = 2.0;
export const CUT_MIN_SEC = 0.5;
export const CARD_SEC = 1.5;
export const CARD_MIN_SEC = 1.0;
export const CARD_MAX_SEC = 2.5;
export const LOGO_REVEAL_SEC = 2.0;
/** Free length without any footage: the NoFootage block lasts this long. */
const NO_FOOTAGE_SEC = 2.0;

/** One element of the cut/card sequence, placed on the output timeline. */
export type TrailerElement =
  | {
      type: "cut";
      /** absolute start frame */
      from: number;
      durationInFrames: number;
      /** index in trailerClipOrder(project) */
      orderIndex: number;
      /** running number of the cut in the output (0, 1, 2 ...) — drives the transition style */
      cutNo: number;
      /** the clip, positioned at from = 0 (relative to the cut's own Sequence) */
      clip: PlacedClip;
    }
  | {
      type: "card";
      from: number;
      durationInFrames: number;
      card: TrailerCard;
      text: string;
      /** running number of the card in the output */
      cardNo: number;
    }
  | {
      /** no usable footage at all: NoFootage block */
      type: "empty";
      from: number;
      durationInFrames: number;
    };

export type TrailerTimeline = TemplateTimeline & {
  elements: TrailerElement[];
  logo: { from: number; durationInFrames: number } | null;
  endCard: { from: number; durationInFrames: number };
  /** beat grid actually used for snapping (seconds); empty = beat sync inactive */
  beatGrid: number[];
};

// ---------------------------------------------------------------------------------------------
// beat grid

/**
 * Snap grid (seconds) when beat sync is active: audio.bgm.beats (BGM starts at output frame 0), extended
 * past the last beat with period 60/bpm (or the median beat interval) when the BGM loops. [] = inactive.
 */
export function beatGrid(project: Project, untilSec: number): number[] {
  const bgm = project.audio.bgm;
  if (!project.templateData.trailer.beatSync || !bgm || !bgm.beats) return [];
  const beats = bgm.beats.filter((b) => Number.isFinite(b) && b >= 0).sort((a, b) => a - b);
  if (beats.length < 2) return [];
  if (!bgm.loop) return beats;
  let period = bgm.bpm && Number.isFinite(bgm.bpm) && bgm.bpm > 0 ? 60 / bgm.bpm : 0;
  if (!(period > 0)) {
    const diffs = beats
      .slice(1)
      .map((b, i) => b - beats[i]!)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    period = diffs.length > 0 ? diffs[Math.floor(diffs.length / 2)]! : 0;
  }
  if (!(period > 0.05)) return beats; // degenerate -> no extension (also guards against huge arrays)
  const out = beats.slice();
  let t = beats[beats.length - 1]!;
  while (t + period <= untilSec) {
    t += period;
    out.push(t);
  }
  return out;
}

/** Grid point within [lo, hi] closest to `target` (earliest on ties), or null. */
function snap(grid: number[], target: number, lo: number, hi: number): number | null {
  // binary search for the first point >= lo
  let a = 0;
  let b = grid.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (grid[m]! < lo - 1e-9) a = m + 1;
    else b = m;
  }
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = a; i < grid.length && grid[i]! <= hi + 1e-9; i++) {
    const d = Math.abs(grid[i]! - target);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = grid[i]!;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// sequence building

type CutItem = {
  kind: "cut";
  orderIndex: number;
  seg: Segment;
  naturalSec: number;
  /** source material available from inSec to the end of the source (Infinity if unknown) */
  availSec: number;
  baseSec: number;
};
type CardItem = { kind: "card"; card: TrailerCard; text: string; anchor: number /* -1 = front, j = after usable cut j */ };
type Item = CutItem | CardItem | { kind: "empty"; baseSec: number };

/** Interleaves usable cuts (in order) with cards by anchor (cards keep array order at the same anchor). */
function interleave(cuts: CutItem[], cards: CardItem[]): Item[] {
  const out: Item[] = [];
  const clampAnchor = (a: number) => Math.min(a, cuts.length - 1);
  for (const c of cards) if (clampAnchor(c.anchor) < 0) out.push(c);
  cuts.forEach((cut, j) => {
    out.push(cut);
    for (const c of cards) if (clampAnchor(c.anchor) === j) out.push(c);
  });
  return out;
}

/** Lays items out from t = 0 with optional beat snapping. Returns frame boundaries (cumulative rounding). */
function layout(items: Item[], grid: number[], fps: number): number[] {
  const ends: number[] = [];
  let t = 0;
  for (const it of items) {
    let base: number;
    let lo: number;
    let hi: number;
    if (it.kind === "cut") {
      base = it.baseSec;
      lo = Math.min(CUT_MIN_SEC, it.naturalSec);
      // extended cuts (base past the clip's natural length) may snap a little later too
      hi = base > it.naturalSec ? base + CUT_MIN_SEC : it.naturalSec;
    } else if (it.kind === "card") {
      base = CARD_SEC;
      lo = CARD_MIN_SEC;
      hi = CARD_MAX_SEC;
    } else {
      base = it.baseSec;
      lo = base;
      hi = base;
    }
    const e = t + base;
    const snapped = grid.length > 0 && it.kind !== "empty" ? snap(grid, e, t + lo, t + hi) : null;
    let end = snapped ?? e;
    // never produce an empty element
    if (Math.round(end * fps) <= Math.round(t * fps)) end = (Math.round(t * fps) + 1) / fps;
    ends.push(Math.round(end * fps));
    t = end;
  }
  return ends;
}

/**
 * Frame boundaries -> elements. A cut plays from clip.inSec; when its slot is longer than the remaining
 * source material it holds the last frame.
 */
function toElements(items: Item[], ends: number[]): TrailerElement[] {
  const out: TrailerElement[] = [];
  let from = 0;
  let cutNo = 0;
  let cardNo = 0;
  items.forEach((it, i) => {
    const dur = Math.max(1, ends[i]! - from);
    if (it.kind === "cut") {
      const avail = Number.isFinite(it.seg.maxOutF) ? Math.max(1, it.seg.maxOutF - it.seg.inF) : Infinity;
      const play = Math.max(1, Math.min(dur, avail));
      out.push({
        type: "cut",
        from,
        durationInFrames: dur,
        orderIndex: it.orderIndex,
        cutNo: cutNo++,
        clip: {
          key: `cut-${i}-${it.seg.clipId}`,
          clipId: it.seg.clipId,
          sourceId: it.seg.sourceId,
          from: 0,
          playFrames: play,
          holdFrames: dur - play,
          trimBefore: it.seg.inF,
          volume: it.seg.volume,
          focusX: it.seg.focusX,
          hasAudio: it.seg.hasAudio,
        },
      });
    } else if (it.kind === "card") {
      out.push({ type: "card", from, durationInFrames: dur, card: it.card, text: it.text, cardNo: cardNo++ });
    } else {
      out.push({ type: "empty", from, durationInFrames: dur });
    }
    from += dur;
  });
  return out;
}

const sumFrames = (ends: number[]) => (ends.length > 0 ? ends[ends.length - 1]! : 0);

/**
 * Makes the body exactly `B` frames: the last element absorbs the difference, but a card stays within
 * [CARD_MIN_SEC, CARD_MAX_SEC] (never a long black card); the rest goes to the last cut / NoFootage block
 * (a cut continues into the source, then holds its last frame).
 */
function fitTo(items: Item[], ends: number[], B: number, fps: number): void {
  if (ends.length === 0) return;
  const d = ends.map((e, i) => e - (i > 0 ? ends[i - 1]! : 0));
  let diff = B - sumFrames(ends);
  if (diff === 0) return;
  const last = d.length - 1;
  if (items[last]!.kind === "card") {
    const lo = Math.min(d[last]!, Math.round(CARD_MIN_SEC * fps));
    const hi = Math.max(d[last]!, Math.round(CARD_MAX_SEC * fps));
    const next = Math.min(hi, Math.max(lo, d[last]! + diff));
    diff -= next - d[last]!;
    d[last] = next;
  }
  if (diff > 0) {
    let idx = last;
    for (let i = last; i >= 0; i--) {
      if (items[i]!.kind !== "card") {
        idx = i;
        break;
      }
    }
    d[idx] = d[idx]! + diff;
  } else if (diff < 0) {
    // shrink from the back: cuts / blocks down to CUT_MIN_SEC, then cards down to CARD_MIN_SEC, then anything to 1 frame
    const floors: Array<(it: Item) => number> = [
      (it) => (it.kind === "card" ? Infinity : Math.round(CUT_MIN_SEC * fps)),
      (it) => (it.kind === "card" ? Math.round(CARD_MIN_SEC * fps) : Math.round(CUT_MIN_SEC * fps)),
      () => 1,
    ];
    for (const floor of floors) {
      for (let i = last; i >= 0 && diff < 0; i--) {
        const take = Math.min(-diff, Math.max(0, d[i]! - floor(items[i]!)));
        d[i] = d[i]! - take;
        diff += take;
      }
    }
  }
  let acc = 0;
  d.forEach((x, i) => {
    acc += x;
    ends[i] = acc;
  });
}

export function buildTimeline(project: Project, fps: number, lang: Lang): TrailerTimeline {
  const td = project.templateData.trailer;
  const narr = layoutNarration(project, lang, fps);
  const fixed = project.durationSec !== null;

  // --- cuts (one per clip of trailerClipOrder; unusable clips keep their index but make no cut)
  const order = trailerClipOrder(project);
  const usable: CutItem[] = [];
  const usableIdxByOrder: number[] = []; // order index -> index in usable (-1 if unusable)
  order.forEach((clip, orderIndex) => {
    const seg = toSegments(project, [clip], fps)[0];
    if (!seg) {
      usableIdxByOrder.push(-1);
      return;
    }
    const naturalSec = (seg.outF - seg.inF) / fps;
    usableIdxByOrder.push(usable.length);
    const availSec = Number.isFinite(seg.maxOutF) ? Math.max(naturalSec, (seg.maxOutF - seg.inF) / fps) : Infinity;
    usable.push({ kind: "cut", orderIndex, seg, naturalSec, availSec, baseSec: Math.min(naturalSec, CUT_MAX_SEC) });
  });

  // --- cards with text in this language, anchored after the last usable cut with order index <= k
  const cards: CardItem[] = [];
  for (const card of td.cards) {
    const text = (card.text[lang] ?? "").trim();
    if (!text) continue;
    let anchor = -1;
    if (card.afterClipIndex >= 0) {
      const k = Math.min(card.afterClipIndex, order.length - 1);
      for (let i = k; i >= 0; i--) {
        const u = usableIdxByOrder[i]!;
        if (u >= 0) {
          anchor = u;
          break;
        }
      }
    }
    cards.push({ kind: "card", card, text, anchor });
  }

  // --- fixed blocks
  const logoFrames = td.logoReveal ? Math.max(1, Math.round(LOGO_REVEAL_SEC * fps)) : 0;
  const endBase = Math.round(END_CARD_SEC * fps);
  const endFrames = Math.max(endBase, fixed ? Math.min(narr.ctaNeed, Math.round(MAX_END_CARD_SEC * fps)) : narr.ctaNeed);

  // generous upper bound for the beat grid extension
  const untilSec =
    (fixed ? project.durationSec! : usable.reduce((a, c) => a + c.naturalSec, 0) + cards.length * CARD_MAX_SEC + 10) +
    (narr.hookNeed + narr.mainNeed) / fps +
    10;
  const grid = beatGrid(project, untilSec);

  let items: Item[];
  let ends: number[];

  if (usable.length === 0) {
    // no footage: one NoFootage block (front cards before it, the rest after it)
    const B = fixed ? Math.max(1, Math.round(project.durationSec! * fps) - logoFrames - endFrames) : 0;
    let cardList = cards.slice();
    const build = (emptySec: number) => {
      const front = cardList.filter((c) => c.anchor < 0);
      const back = cardList.filter((c) => c.anchor >= 0);
      return [...front, { kind: "empty" as const, baseSec: emptySec }, ...back];
    };
    items = build(NO_FOOTAGE_SEC);
    ends = layout(items, grid, fps);
    if (fixed) {
      // cards take what they need (dropped from the end if they alone exceed B); the block fills the rest
      for (;;) {
        const cardFrames = sumFrames(layout(cardList, grid, fps));
        if (cardFrames < B || cardList.length === 0) {
          items = build(Math.max(1, B - cardFrames) / fps);
          ends = layout(items, grid, fps);
          break;
        }
        cardList = cardList.slice(0, -1);
      }
      fitTo(items, ends, B, fps);
    }
  } else if (!fixed) {
    items = interleave(usable, cards);
    ends = layout(items, grid, fps);
  } else {
    const B = Math.max(1, Math.round(project.durationSec! * fps) - logoFrames - endFrames);
    let cuts = usable.slice();
    let cardList = cards.slice();
    items = interleave(cuts, cardList);
    ends = layout(items, grid, fps);
    let S = sumFrames(ends);
    if (S > B) {
      // drop cuts from the end (their cards move behind the last remaining cut), then cards from the end
      while (S > B && cuts.length > 1) {
        cuts = cuts.slice(0, -1);
        items = interleave(cuts, cardList);
        ends = layout(items, grid, fps);
        S = sumFrames(ends);
      }
      while (S > B && cardList.length > 0) {
        const lastCard = [...items].reverse().find((it): it is CardItem => it.kind === "card");
        cardList = cardList.filter((c) => c !== lastCard);
        items = interleave(cuts, cardList);
        ends = layout(items, grid, fps);
        S = sumFrames(ends);
      }
    }
    if (S < B) {
      // stretch cut base lengths by B/S (each up to its clip's natural length) and lay out again;
      // repeated a few times because cards / capped cuts do not stretch
      for (let iter = 0; iter < 4 && S < B; iter++) {
        const k = B / S;
        const next = cuts.map((c) => ({ ...c, baseSec: Math.min(c.naturalSec, c.baseSec * k) }));
        if (next.every((c, i) => c.baseSec === cuts[i]!.baseSec)) break;
        const nextItems = interleave(next, cardList);
        const nextEnds = layout(nextItems, grid, fps);
        if (sumFrames(nextEnds) > B) break; // overshoot (snapping) -> keep the previous layout
        cuts = next;
        items = nextItems;
        ends = nextEnds;
        S = sumFrames(ends);
      }
    }
    if (S < B) {
      // still short (cuts are at their natural length): spread the gap over ALL cuts in proportion to their
      // length, extending them past outSec into the source (up to the source end; only beyond that do they
      // hold their last frame), then lay out / re-snap again
      const extend = (gapSec: number): CutItem[] => {
        const next = cuts.map((c) => ({ ...c }));
        let remaining = gapSec;
        for (let pass = 0; pass < 4 && remaining > 1e-6; pass++) {
          const open = next.filter((c) => c.availSec - c.baseSec > 1e-6);
          const tot = open.reduce((a, c) => a + c.baseSec, 0);
          if (tot <= 0) break;
          let used = 0;
          for (const c of open) {
            const add = Math.min(c.availSec - c.baseSec, (remaining * c.baseSec) / tot);
            c.baseSec += add;
            used += add;
          }
          remaining -= used;
        }
        if (remaining > 1e-6) {
          const tot = next.reduce((a, c) => a + c.baseSec, 0);
          for (const c of next) c.baseSec += (remaining * c.baseSec) / tot;
        }
        return next;
      };
      // beat snapping may overshoot B -> shrink the requested gap and retry; keep the longest layout <= B
      let gap = (B - S) / fps;
      for (let iter = 0; iter < 6 && gap > 1e-6; iter++) {
        const next = extend(gap);
        const nextItems = interleave(next, cardList);
        const nextEnds = layout(nextItems, grid, fps);
        const nextS = sumFrames(nextEnds);
        if (nextS <= B) {
          if (nextS > S) {
            cuts = next;
            items = nextItems;
            ends = nextEnds;
            S = nextS;
          }
          break;
        }
        gap -= (nextS - B) / fps + 0.25 / Math.max(1, next.length);
      }
    }
    fitTo(items, ends, B, fps);
  }

  // free length: the last element grows so hook + main narration fit before the logo
  if (!fixed && ends.length > 0) {
    const need = narr.hookNeed + narr.mainNeed;
    if (need > sumFrames(ends)) fitTo(items, ends, need, fps);
  }

  const elements = toElements(items, ends);
  const bodyFrames = elements.reduce((a, e) => a + e.durationInFrames, 0);
  const logo = logoFrames > 0 ? { from: bodyFrames, durationInFrames: logoFrames } : null;
  const endCard = { from: bodyFrames + logoFrames, durationInFrames: endFrames };
  const totalFrames = endCard.from + endCard.durationInFrames;

  // --- sections: consecutive cuts (or the NoFootage block) merge into one "cuts-<n>" section
  const sections: TimelineSectionInfo[] = [];
  let runNo = 0;
  for (const el of elements) {
    if (el.type === "card") {
      sections.push({ id: el.card.id, kind: "card", label: "テロップ", from: el.from, durationInFrames: el.durationInFrames });
      continue;
    }
    const last = sections[sections.length - 1];
    if (last && last.kind === "main") last.durationInFrames += el.durationInFrames;
    else sections.push({ id: `cuts-${runNo++}`, kind: "main", label: "カット", from: el.from, durationInFrames: el.durationInFrames });
  }
  // duplicate card ids (should not happen) would break the "unique id" rule -> suffix them
  const seen = new Set<string>();
  for (const s of sections) {
    let id = s.id;
    for (let n = 2; seen.has(id); n++) id = `${s.id}-${n}`;
    s.id = id;
    seen.add(id);
  }
  if (logo) sections.push({ id: "logo", kind: "logo", label: "ロゴ", from: logo.from, durationInFrames: logo.durationInFrames });
  sections.push({ id: "end", kind: "end", label: "エンド", from: endCard.from, durationInFrames: endCard.durationInFrames });

  // --- narration: hook at 0 + offset, main continuous from hookNeed, both within [0, logo start); cta on the end card
  const bodyEnd = bodyFrames;
  const lines = [
    ...placeSection(narr.hook, "hook", 0, bodyEnd, fixed),
    ...placeSection(narr.main, "main", narr.hookNeed, bodyEnd - narr.hookNeed, fixed),
    ...placeSection(narr.cta, "cta", endCard.from, endCard.durationInFrames, fixed),
  ];

  // §5.11 cut transitions: only cut -> cut (cards / logo / end card have their own entrances); auto rotates
  // flash / glitch / whip / zoom (replaces the built-in entrance of those cuts, see Cut.tsx)
  const TRAILER_AUTO = ["flash", "glitch", "whip", "zoom"] as const;
  const transitionCuts: TransitionCut[] = [];
  elements.forEach((el, i) => {
    if (i > 0 && el.type === "cut" && elements[i - 1]!.type === "cut") {
      transitionCuts.push({ frame: el.from, auto: TRAILER_AUTO[transitionCuts.length % TRAILER_AUTO.length]! });
    }
  });

  return {
    fps,
    totalFrames,
    sections,
    narration: { lines, overflowLineIds: lines.filter((l) => l.cut).map((l) => l.lineId) },
    transitionCuts,
    elements,
    logo,
    endCard,
    beatGrid: grid,
  };
}
