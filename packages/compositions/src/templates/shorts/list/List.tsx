import type React from "react";
import { useMemo } from "react";
import { AbsoluteFill, interpolate, Sequence } from "remotion";
import { stripEmphasis, type Lang, type Project } from "@gas/shared";
import { BODY_FONT, displayFont } from "../../../common/fonts";
import { withAlpha } from "../../../common/theme";
import type { TemplateRenderProps } from "../../types";
import {
  Badge,
  BigText,
  bigLineHeight,
  clamp,
  fitFont,
  gameLayout,
  lineCount,
  pop,
  SAFE916,
  shake,
  ShortGameplay,
  ShortShell,
  TopBand,
  useShortFrame,
  V916,
} from "../common";
import type { ListEntry, ListTimeline } from "./timeline";

type Props = TemplateRenderProps<ListTimeline>;

/* ------------------------------------------------------------------ */
/* Palette / labels                                                     */
/* ------------------------------------------------------------------ */

/** Card / tile color of an entry: ranking -> gold / silver / bronze for 1..3, accent otherwise. */
function entryColor(project: Project, ranking: boolean, num: number): string {
  if (ranking) {
    if (num === 1) return "#ffc21a";
    if (num === 2) return "#b9c3d3";
    if (num === 3) return "#d9824a";
  }
  return project.style.accentColor;
}

const kickerText = (lang: Lang, ranking: boolean, n: number) =>
  ranking ? (lang === "ja" ? "ランキング" : "RANKING") : lang === "ja" ? "保存版" : n > 0 ? `TOP ${n}` : "MUST SEE";

/** Number with the ranking affixes: ja 「第」「位」, en "#"/"NO." (small parts scaled by `k`). */
const NumberGlyph: React.FC<{ lang: Lang; ranking: boolean; num: number; size: number; color: string; ink: string; total?: number }> = ({
  lang,
  ranking,
  num,
  size,
  color,
  ink,
  total,
}) => {
  const f = displayFont("en").fontFamily;
  const jf = displayFont("ja");
  const st = Math.max(3, size * 0.045);
  const shadow = `${outlineShadow(st, ink)}, ${st * 1.6}px ${st * 1.8}px 0 ${ink}`;
  const small: React.CSSProperties = { fontFamily: jf.fontFamily, fontWeight: jf.fontWeight, fontSize: size * 0.3, lineHeight: 1, color, textShadow: outlineShadow(Math.max(2, st * 0.6), ink) };
  return (
    <div style={{ display: "flex", alignItems: "flex-end", lineHeight: 1 }}>
      {ranking && lang === "ja" ? <div style={{ ...small, marginBottom: size * 0.1, marginRight: size * 0.02 }}>第</div> : null}
      {ranking && lang !== "ja" ? <div style={{ ...small, fontFamily: f, fontWeight: 400, marginBottom: size * 0.12, marginRight: size * 0.03 }}>NO.</div> : null}
      <div style={{ fontFamily: f, fontSize: size, lineHeight: 0.92, color, textShadow: shadow, letterSpacing: "-0.02em" }}>{num}</div>
      {ranking && lang === "ja" ? <div style={{ ...small, marginBottom: size * 0.1, marginLeft: size * 0.02 }}>位</div> : null}
      {!ranking && total ? <div style={{ ...small, fontFamily: f, fontWeight: 400, opacity: 0.9, marginBottom: size * 0.1, marginLeft: size * 0.1 }}>/{total}</div> : null}
    </div>
  );
};

/** text-shadow outline (8 directions) */
function outlineShadow(px: number, color: string): string {
  const d = px * 0.71;
  return [`${px}px 0 0 ${color}`, `-${px}px 0 0 ${color}`, `0 ${px}px 0 ${color}`, `0 -${px}px 0 ${color}`, `${d}px ${d}px 0 ${color}`, `-${d}px ${d}px 0 ${color}`, `${d}px -${d}px 0 ${color}`, `-${d}px -${d}px 0 ${color}`].join(", ");
}

/** Row of numbered chips: the list at a glance (current one filled, done ones dimmed). */
const Chips: React.FC<{ project: Project; timeline: ListTimeline; current: number; size: number; delay?: number; stagger?: number }> = ({ project, timeline, current, size, delay = 0, stagger = 0 }) => {
  const { frame, fps } = useShortFrame();
  const f = displayFont("en").fontFamily;
  // chips in display order
  return (
    <div style={{ display: "flex", gap: size * 0.28, alignItems: "center" }}>
      {timeline.entries.map((e) => {
        const d = delay + Math.round(stagger * fps * e.order);
        const p = pop(frame, fps, d, { stiff: true });
        if (frame < d) return <div key={e.order} style={{ width: size, height: size }} />;
        const col = entryColor(project, timeline.ranking, e.num);
        const isCur = e.order === current;
        const done = current >= 0 && e.order < current;
        return (
          <div
            key={e.order}
            style={{
              width: size,
              height: size,
              borderRadius: "50%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              fontFamily: f,
              fontSize: size * 0.58,
              lineHeight: 1,
              color: isCur ? "#111318" : "#ffffff",
              backgroundColor: isCur ? col : done ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.55)",
              border: `${Math.max(2, size * 0.07)}px solid ${isCur ? "#ffffff" : withAlpha(col, done ? 0.4 : 0.95)}`,
              boxShadow: isCur ? `0 0 ${size * 0.5}px ${withAlpha(col, 0.8)}` : "none",
              opacity: done ? 0.6 : 1,
              transform: `scale(${interpolate(p, [0, 1], [0.4, 1]) * (isCur ? 1.18 : 1)})`,
            }}
          >
            {e.num}
          </div>
        );
      })}
    </div>
  );
};

/** Full-bleed copy of the project for the headline phase (gameplay cover-cropped in 9:16). */
function useCoverProject(project: Project): Project {
  return useMemo(() => ({ ...project, style: { ...project.style, vertical: { ...project.style.vertical, mode: "crop" as const } } }), [project]);
}

/* ------------------------------------------------------------------ */
/* Headline phase                                                       */
/* ------------------------------------------------------------------ */

const Headline: React.FC<Props> = ({ project, format, lang, timeline, assetBaseUrl, useProxy }) => {
  const { frame, fps, width, height, u, vertical } = useShortFrame();
  const cover = useCoverProject(project);
  const accent = project.style.accentColor;
  const { title, count, ranking } = timeline;
  const land = pop(frame, fps, 0, { stiff: true });
  const sh = shake(frame, 2, Math.round(fps * 0.3), 12 * u);
  const zoom = interpolate(frame, [0, Math.max(1, timeline.titleFrames)], [1.04, 1.12], clamp);
  // 9:16: text block in [top safe, strip bottom]; 16:9: centered
  const boxTop = vertical ? (SAFE916.top + 20) * u : height * 0.1;
  const boxBottom = vertical ? (V916.stripBottom + 10) * u : height * 0.82;
  const maxW = width * (vertical ? 0.84 : 0.74);
  const fontSize = title
    ? fitFont(title, lang, { base: (vertical ? (lang === "en" ? 210 : 172) : lang === "en" ? 170 : 132) * u, maxWidth: maxW, maxHeight: (boxBottom - boxTop) * 0.62, minRatio: 0.3 })
    : 0;
  const chip = (vertical ? 92 : 78) * u;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <ShortGameplay
          project={format === "9:16" ? cover : project}
          layout={format === "9:16" ? "full" : "full16"}
          clips={timeline.titleClips}
          assetBaseUrl={assetBaseUrl}
          useProxy={useProxy}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 80% 55% at 50% ${vertical ? 42 : 50}%, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.5) 100%), linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.1) 40%, rgba(0,0,0,0.5) 100%)`,
        }}
      />
      {/* sunburst behind the headline */}
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: (boxTop + boxBottom) / 2,
            width: Math.max(width, height) * 1.6,
            height: Math.max(width, height) * 1.6,
            transform: `translate(-50%, -50%) rotate(${frame * 0.4}deg)`,
            background: `repeating-conic-gradient(${withAlpha(accent, 0.16)} 0deg 9deg, transparent 9deg 22.5deg)`,
            maskImage: "radial-gradient(circle, black 0%, transparent 60%)",
            WebkitMaskImage: "radial-gradient(circle, black 0%, transparent 60%)",
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ top: boxTop, height: boxBottom - boxTop, flexDirection: "column", justifyContent: "center", alignItems: "center", gap: (vertical ? 44 : 30) * u }}>
        <Badge text={kickerText(lang, ranking, count)} lang={lang} size={(vertical ? 58 : 46) * u} bg={accent} variant="skew" />
        {title ? (
          <div
            style={{
              maxWidth: maxW,
              transform: `translate(${sh.x}px, ${sh.y}px) scale(${interpolate(land, [0, 1], [1.12, 1])}) rotate(${interpolate(land, [0, 1], [-4, 0]) + sh.r}deg)`,
            }}
          >
            <BigText text={title} lang={lang} fontSize={fontSize} emphasisColor={project.style.emphasisColor} />
          </div>
        ) : null}
        {count > 0 ? <Chips project={project} timeline={timeline} current={-1} size={chip} delay={Math.round(fps * 0.25)} stagger={0.09} /> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Number card                                                          */
/* ------------------------------------------------------------------ */

const NumberCard: React.FC<{ project: Project; lang: Lang; timeline: ListTimeline; entry: ListEntry }> = ({ project, lang, timeline, entry }) => {
  const { frame, fps, width, height, u, vertical } = useShortFrame();
  const col = entryColor(project, timeline.ranking, entry.num);
  const p = pop(frame, fps, 0, { stiff: true });
  const tp = pop(frame, fps, 2, { stiff: true });
  const sh = shake(frame, 1, Math.round(fps * 0.25), 16 * u);
  const numSize = (vertical ? 640 : 520) * u;
  const textMaxW = width * (vertical ? 0.84 : 0.7);
  const textSize = fitWrap(entry.text, lang, { base: (vertical ? (lang === "en" ? 140 : 120) : lang === "en" ? 100 : 84) * u, maxWidth: textMaxW, maxHeight: height * (vertical ? 0.22 : 0.24) });
  const top = vertical ? SAFE916.top * u : 40 * u;
  const bottom = vertical ? (SAFE916.bottom + 40) * u : 160 * u;
  const isTop = timeline.ranking && entry.num === 1;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ backgroundColor: col, background: `radial-gradient(circle at 50% 42%, ${withAlpha("#ffffff", 0.35)} 0%, ${withAlpha("#ffffff", 0)} 38%), radial-gradient(circle at 50% 42%, ${col} 38%, ${shadeOf(col)} 100%)` }} />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "42%",
          width: Math.max(width, height) * 1.8,
          height: Math.max(width, height) * 1.8,
          transform: `translate(-50%, -50%) rotate(${frame * 1.2}deg)`,
          background: `repeating-conic-gradient(rgba(255,255,255,0.16) 0deg 8deg, transparent 8deg 20deg)`,
        }}
      />
      {/* diagonal speed band behind the number */}
      <div
        style={{
          position: "absolute",
          left: -width * 0.2,
          right: -width * 0.2,
          top: vertical ? height * 0.3 : height * 0.26,
          height: vertical ? height * 0.2 : height * 0.36,
          backgroundColor: "rgba(0,0,0,0.22)",
          transform: `rotate(-8deg) translateX(${interpolate(p, [0, 1], [-width * 0.3, 0])}px)`,
        }}
      />
      <AbsoluteFill style={{ top, bottom, height: "auto", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: (vertical ? 30 : 10) * u }}>
        {isTop ? <Crown size={(vertical ? 150 : 110) * u} /> : null}
        <div style={{ transform: `translate(${sh.x}px, ${sh.y}px) scale(${interpolate(p, [0, 1], [1.7, 1])}) rotate(${interpolate(p, [0, 1], [-14, -5])}deg)` }}>
          <NumberGlyph lang={lang} ranking={timeline.ranking} num={entry.num} size={numSize} color="#ffffff" ink="#111318" total={timeline.ranking ? undefined : timeline.count} />
        </div>
        <div style={{ maxWidth: textMaxW, transform: `scale(${interpolate(tp, [0, 1], [0.7, 1])}) translateY(${interpolate(tp, [0, 1], [40 * u, 0])}px)` }}>
          <BigText text={entry.text} lang={lang} fontSize={textSize} emphasisColor={project.style.emphasisColor} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Simple crown (CSS) for 第 1 位. */
const Crown: React.FC<{ size: number }> = ({ size }) => (
  <div
    style={{
      width: size * 1.3,
      height: size,
      background: "linear-gradient(180deg, #fff3a8 0%, #ffd23a 45%, #d99a00 100%)",
      clipPath: "polygon(0% 30%, 22% 62%, 50% 0%, 78% 62%, 100% 30%, 90% 100%, 10% 100%)",
      filter: "drop-shadow(0 6px 0 rgba(0,0,0,0.5))",
      marginBottom: -size * 0.3,
    }}
  />
);

/**
 * Font size for an item: the larger of "every explicit line on one line" (fitFont) and, for a single-line item,
 * "wrapped onto two lines" (BigText wraps at phrase / word boundaries, so lines are assumed ~62 % (ja) / 72 % (en) full).
 */
function fitWrap(text: string, lang: Lang, o: { base: number; maxWidth: number; maxHeight: number }): number {
  const one = fitFont(text, lang, { base: o.base, maxWidth: o.maxWidth, maxHeight: o.maxHeight, minRatio: 0.3 });
  if (lineCount(text) > 1) return one;
  const two = Math.min(fitFont(text, lang, { base: o.base, maxWidth: o.maxWidth * 2 * (lang === "ja" ? 0.62 : 0.72), minRatio: 0.3 }), o.maxHeight / (2 * bigLineHeight(lang) * 1.08));
  return Math.max(one, Math.min(o.base, two));
}

/** darker stop of a #rrggbb color */
function shadeOf(color: string): string {
  const m = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return "#111318";
  const v = parseInt(m[1]!, 16);
  const k = 0.42;
  const r = Math.round(((v >> 16) & 255) * k);
  const g = Math.round(((v >> 8) & 255) * k);
  const b = Math.round((v & 255) * k);
  return `rgb(${r},${g},${b})`;
}

/* ------------------------------------------------------------------ */
/* Item overlay (after the card)                                        */
/* ------------------------------------------------------------------ */

/** Number tile (rank color square with the number). */
const Tile: React.FC<{ project: Project; lang: Lang; timeline: ListTimeline; entry: ListEntry; size: number }> = ({ project, lang, timeline, entry, size }) => {
  const { frame, fps } = useShortFrame();
  const col = entryColor(project, timeline.ranking, entry.num);
  const p = pop(frame, fps, 0, { stiff: true });
  const glyph = timeline.ranking ? size * 0.62 : size * 0.78;
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size * 0.14,
        background: `linear-gradient(150deg, ${withAlpha("#ffffff", 0.35)} 0%, ${withAlpha("#ffffff", 0)} 35%), linear-gradient(150deg, ${col} 35%, ${shadeOf(col)} 100%)`,
        boxShadow: `0 0 0 ${size * 0.03}px #ffffff, 0 ${size * 0.05}px 0 rgba(0,0,0,0.55), 0 0 ${size * 0.25}px ${withAlpha(col, 0.6)}`,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        transform: `scale(${interpolate(p, [0, 1], [1.5, 1])}) rotate(${interpolate(p, [0, 1], [-20, -4])}deg)`,
      }}
    >
      <NumberGlyph lang={lang} ranking={timeline.ranking} num={entry.num} size={glyph} color="#ffffff" ink="#111318" />
    </div>
  );
};

/** 9:16 band [0, 656): small headline + chips, then [tile][item text]. */
const ItemBand916: React.FC<{ project: Project; lang: Lang; timeline: ListTimeline; entry: ListEntry; full: boolean }> = ({ project, lang, timeline, entry, full }) => {
  const { frame, fps, width, u } = useShortFrame();
  const p = pop(frame, fps, 1);
  const left = 44 * u;
  const tile = 236 * u;
  const rowTop = (SAFE916.top + 96) * u;
  const rowBottom = (V916.bandH - 50) * u;
  const textW = width - left * 2 - tile - 40 * u;
  const fontSize = fitWrap(entry.text, lang, { base: (lang === "en" ? 130 : 112) * u, maxWidth: textW, maxHeight: rowBottom - rowTop });
  const head = stripEmphasis(timeline.title).replace(/\s*\n\s*/g, lang === "ja" ? "" : " ").trim();
  return (
    <>
      <TopBand project={project} lang={lang} text=" " variant={full ? "scrim" : "dark"} hideText />
      <div style={{ position: "absolute", left, right: left, top: SAFE916.top * u, height: 76 * u, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 * u }}>
        <div
          lang={lang}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: BODY_FONT,
            fontWeight: 900,
            fontSize: 38 * u,
            color: "rgba(255,255,255,0.88)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textShadow: "0 2px 6px rgba(0,0,0,0.9)",
          }}
        >
          {head}
        </div>
        <Chips project={project} timeline={timeline} current={entry.order} size={56 * u} />
      </div>
      <div style={{ position: "absolute", left, right: left, top: rowTop, height: rowBottom - rowTop, display: "flex", alignItems: "center", gap: 40 * u }}>
        <Tile project={project} lang={lang} timeline={timeline} entry={entry} size={tile} />
        <div style={{ flex: 1, minWidth: 0, transform: `translateX(${interpolate(p, [0, 1], [60 * u, 0])}px)` }}>
          <BigText text={entry.text} lang={lang} fontSize={fontSize} emphasisColor={project.style.emphasisColor} align="left" />
        </div>
      </div>
    </>
  );
};

/** 16:9 top-left panel [tile][item text] + chips top-right. */
const ItemPanel169: React.FC<{ project: Project; lang: Lang; timeline: ListTimeline; entry: ListEntry }> = ({ project, lang, timeline, entry }) => {
  const { frame, fps, width, height, u } = useShortFrame();
  const p = pop(frame, fps, 0);
  const tile = 150 * u;
  const textW = width * 0.5;
  const fontSize = fitWrap(entry.text, lang, { base: (lang === "en" ? 80 : 66) * u, maxWidth: textW, maxHeight: height * 0.2 });
  const accent = entryColor(project, timeline.ranking, entry.num);
  return (
    <>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 30%)" }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 34 * u,
          display: "flex",
          alignItems: "center",
          gap: 34 * u,
          padding: `${16 * u}px ${80 * u}px ${16 * u}px ${44 * u}px`,
          background: "linear-gradient(100deg, rgba(10,11,18,0.92) 0%, rgba(23,26,38,0.86) 100%)",
          clipPath: `polygon(0 0, 100% 0, calc(100% - ${44 * u}px) 100%, 0 100%)`,
          borderBottom: `${6 * u}px solid ${accent}`,
          transform: `translateX(${interpolate(p, [0, 1], [-8, 0])}%)`,
        }}
      >
        <Tile project={project} lang={lang} timeline={timeline} entry={entry} size={tile} />
        <div style={{ maxWidth: textW }}>
          <BigText text={entry.text} lang={lang} fontSize={fontSize} emphasisColor={project.style.emphasisColor} align="left" />
        </div>
      </div>
      <div style={{ position: "absolute", right: 44 * u, top: 50 * u }}>
        <Chips project={project} timeline={timeline} current={entry.order} size={58 * u} />
      </div>
    </>
  );
};

/* ------------------------------------------------------------------ */
/* Template                                                             */
/* ------------------------------------------------------------------ */

const Body: React.FC<Props> = (props) => {
  const { project, format, lang, timeline, assetBaseUrl, useProxy } = props;
  const layout = gameLayout(project, format);
  const vertical = layout !== "full16";
  const { entries, titleFrames } = timeline;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {entries.length > 0 ? (
        <Sequence from={titleFrames} name="items">
          <ShortGameplay
            project={project}
            layout={layout}
            clips={timeline.itemClips.map((c) => ({ ...c, from: c.from - titleFrames }))}
            cuts={timeline.cuts.map((c) => c - titleFrames)}
            sectionFrom={titleFrames}
            assetBaseUrl={assetBaseUrl}
            useProxy={useProxy}
          />
        </Sequence>
      ) : null}
      {entries.map((e) => (
        <Sequence key={e.order} from={e.from} durationInFrames={Math.max(1, e.to - e.from)} name={`item ${e.num}`}>
          {vertical ? <ItemBand916 project={project} lang={lang} timeline={timeline} entry={e} full={layout === "full"} /> : <ItemPanel169 project={project} lang={lang} timeline={timeline} entry={e} />}
          <Sequence durationInFrames={Math.max(1, e.cardFrames)} name="card">
            <NumberCard project={project} lang={lang} timeline={timeline} entry={e} />
          </Sequence>
        </Sequence>
      ))}
      <Sequence from={0} durationInFrames={Math.max(1, titleFrames)} name="headline">
        <Headline {...props} />
      </Sequence>
    </AbsoluteFill>
  );
};

/** Template "list" visuals: headline -> (number card -> item clip + numbered band) × n -> common end card. */
export const List: React.FC<Props> = (props) => (
  <ShortShell project={props.project} format={props.format} lang={props.lang} assetBaseUrl={props.assetBaseUrl} timeline={props.timeline}>
    <Body {...props} />
  </ShortShell>
);
