import type React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Lang } from "@gas/shared";
import { BODY_FONT, displayFont } from "../../common/fonts";
import { jaPhrases } from "../../common/phrases";
import { outline, readableOn, unitFor, withAlpha } from "../../common/theme";
import { featureBadge, fitFontSize, stripBounds, twoDigits, type FeatLayout } from "./layout";
import { FeatureProgress } from "./Progress";

export type HeadingProps = {
  index: number;
  count: number;
  heading: string;
  sub: string;
  lang: Lang;
  layout: FeatLayout;
  accent: string;
  primary: string;
  sectionFrames: number;
  /** frames the heading is shown big (FEATURE_HEADING_SEC) */
  bigFrames: number;
  /** compact label corner (16:9 / crop): away from the watermark */
  labelSide: "left" | "right";
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Text that slides up out of a mask. */
const MaskUp: React.FC<{ progress: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ progress, children, style }) => (
  <div style={{ overflow: "hidden", padding: "0.12em 0.2em", margin: "-0.12em -0.2em", ...style }}>
    <div style={{ transform: `translateY(${(1 - progress) * 115}%)` }}>{children}</div>
  </div>
);

/**
 * Big presentation of one feature: giant index number + badge (魅力① / FEATURE 01) + heading + sub.
 * `align` decides the composition (left-aligned row for 16:9, centered column for 9:16).
 */
const BigBlock: React.FC<HeadingProps & { align: "row" | "column"; scale: number; maxWidth: number }> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = unitFor(width, height) * p.scale;
  const font = displayFont(p.lang);
  const en = displayFont("en"); // Anton for the digits in both languages
  const heading = font.uppercase ? p.heading.toUpperCase() : p.heading;
  const sp = (delay: number, cfg = { damping: 16, stiffness: 170, mass: 0.8 }) => spring({ frame: frame - delay, fps, config: cfg });

  const numIn = sp(1, { damping: 14, stiffness: 140, mass: 0.9 });
  const stripe = sp(3, { damping: 200, stiffness: 220, mass: 1 });
  const badgeIn = sp(5);
  const headIn = sp(7, { damping: 18, stiffness: 150, mass: 0.8 });
  const subIn = sp(11);
  const drift = interpolate(frame, [0, p.sectionFrames], [0, -18 * u]);

  const row = p.align === "row";
  const numSize = (row ? 330 : 230) * u;
  const numPad = numSize * 0.2; // italic + skew overhang on the right
  const numW = numSize * 0.9 + numPad; // two Anton digits
  const textMax = row ? p.maxWidth - numW - 40 * u : p.maxWidth;
  const headBase = (p.lang === "en" ? (row ? 150 : 120) : row ? 118 : 96) * u;
  // prefer ONE line (down to 62% of the base size); only very long headings wrap to two lines
  const oneLine = fitFontSize(heading, headBase, textMax, { display: true, lang: p.lang, maxLines: 1, minRatio: 0.3 });
  const headSize = oneLine >= headBase * 0.62 ? oneLine : fitFontSize(heading, headBase * 0.8, textMax, { display: true, lang: p.lang, maxLines: 2, minRatio: 0.45 });
  const subSize = fitFontSize(p.sub, (row ? 46 : 42) * u, textMax, { display: false, lang: p.lang, maxLines: 2, minRatio: 0.6 });
  const fg = readableOn(p.accent);

  const number = (
    <div style={{ position: "relative", flexShrink: 0, paddingRight: numPad, transform: `translateX(${(1 - numIn) * (row ? -260 : 0) * u + drift}px) translateY(${row ? 0 : (1 - numIn) * 120 * u}px)` }}>
      {/* accent stripe behind the number */}
      <div
        style={{
          position: "absolute",
          left: row ? -30 * u : -40 * u,
          right: row ? -10 * u : -40 * u,
          top: "52%",
          height: numSize * 0.26,
          backgroundColor: p.accent,
          transform: `skewX(-18deg) scaleX(${stripe})`,
          transformOrigin: "left center",
          opacity: 0.9,
          boxShadow: `0 0 ${30 * u}px ${withAlpha(p.accent, 0.5)}`,
        }}
      />
      <div
        style={{
          position: "relative",
          fontFamily: en.fontFamily,
          fontWeight: en.fontWeight,
          fontSize: numSize,
          lineHeight: 0.86,
          letterSpacing: "-0.02em",
          color: "transparent",
          WebkitTextStroke: `${Math.max(3, 5 * u)}px ${p.primary}`,
          opacity: interpolate(numIn, [0, 0.4], [0, 1], clamp),
          fontStyle: "italic",
          transform: "skewX(-8deg)",
          textShadow: `0 ${10 * u}px ${40 * u}px rgba(0,0,0,0.5)`,
        }}
      >
        {twoDigits(p.index)}
      </div>
    </div>
  );

  const badge = (
    <div
      style={{
        alignSelf: row ? "flex-start" : "center",
        clipPath: `inset(0 ${(1 - badgeIn) * 100}% 0 0)`,
        backgroundColor: p.accent,
        color: fg,
        fontFamily: p.lang === "en" ? en.fontFamily : BODY_FONT,
        fontWeight: p.lang === "en" ? en.fontWeight : 900,
        fontSize: (p.lang === "en" ? 44 : 42) * u,
        lineHeight: 1,
        letterSpacing: p.lang === "en" ? "0.14em" : "0.08em",
        padding: `${12 * u}px ${24 * u}px ${12 * u}px ${22 * u}px`,
        transform: "skewX(-10deg)",
        boxShadow: `0 ${6 * u}px ${20 * u}px rgba(0,0,0,0.45)`,
      }}
    >
      <div style={{ transform: "skewX(10deg)" }}>{featureBadge(p.index, p.lang)}</div>
    </div>
  );

  const headingEl = heading ? (
    <MaskUp progress={headIn}>
      <div
        style={{
          fontFamily: font.fontFamily,
          fontWeight: font.fontWeight,
          fontSize: headSize,
          lineHeight: p.lang === "en" ? 1.02 : 1.18,
          letterSpacing: p.lang === "en" ? "0.01em" : "0.03em",
          color: p.primary,
          textAlign: row ? "left" : "center",
          maxWidth: textMax,
          wordBreak: p.lang === "en" ? "normal" : "normal",
          overflowWrap: "anywhere",
          textWrap: "balance",
          textShadow: `${outline(Math.max(2, headSize * 0.035), "rgba(0,0,0,0.85)")}, 0 ${8 * u}px ${30 * u}px rgba(0,0,0,0.7)`,
        }}
      >
        {p.lang === "ja"
          ? jaPhrases(heading).map((ph, i) => (
              <span key={i} style={{ display: "inline-block", whiteSpace: "pre" }}>
                {ph}
              </span>
            ))
          : heading}
      </div>
    </MaskUp>
  ) : null;

  const subEl = p.sub ? (
    <div
      style={{
        opacity: interpolate(subIn, [0, 1], [0, 1], clamp),
        transform: `translateX(${row ? (1 - subIn) * 60 * u : 0}px) translateY(${row ? 0 : (1 - subIn) * 30 * u}px)`,
        fontFamily: BODY_FONT,
        fontWeight: 700,
        fontSize: subSize,
        lineHeight: 1.35,
        color: "rgba(255,255,255,0.94)",
        textAlign: row ? "left" : "center",
        maxWidth: textMax,
        letterSpacing: p.lang === "ja" ? "0.04em" : "0.02em",
        textShadow: `${outline(Math.max(1.5, subSize * 0.05), "rgba(0,0,0,0.8)")}, 0 ${4 * u}px ${16 * u}px rgba(0,0,0,0.7)`,
        display: "flex",
        alignItems: "center",
        gap: 16 * u,
        justifyContent: row ? "flex-start" : "center",
      }}
    >
      {row ? <div style={{ width: 48 * u * subIn, height: 4 * u, backgroundColor: p.accent, flexShrink: 0 }} /> : null}
      <span>{p.sub}</span>
    </div>
  ) : null;

  if (row) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 40 * u }}>
        {number}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 * u, alignItems: "flex-start" }}>
          {badge}
          {headingEl}
          {subEl}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 * u }}>
      <div style={{ display: "flex", alignItems: "center", gap: 28 * u }}>
        {number}
        {badge}
      </div>
      {headingEl}
      {subEl}
    </div>
  );
};

/** Compact label kept for the rest of the section: [01 | heading] + progress dots. */
const CompactLabel: React.FC<HeadingProps & { appearAt: number }> = (p) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = unitFor(width, height);
  const font = displayFont(p.lang);
  const en = displayFont("en");
  const heading = font.uppercase ? p.heading.toUpperCase() : p.heading;
  const s = spring({ frame: frame - p.appearAt, fps, config: { damping: 18, stiffness: 200, mass: 0.7 } });
  if (frame < p.appearAt) return null;
  const right = p.labelSide === "right";
  const maxW = width * (p.layout === "h" ? 0.42 : 0.62);
  const size = fitFontSize(heading || " ", (p.lang === "en" ? 46 : 40) * u, maxW, { display: true, lang: p.lang, maxLines: 1, minRatio: 0.55 });
  const fg = readableOn(p.accent);
  // 16:9: one compact bar [01 | heading | 1-2-3]; 9:16 crop: progress pill under the bar (narrow frame)
  const inline = p.layout === "h";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: right ? "flex-end" : "flex-start", gap: 16 * u }}>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          flexDirection: right ? "row-reverse" : "row",
          clipPath: right ? `inset(0 0 0 ${(1 - s) * 100}%)` : `inset(0 ${(1 - s) * 100}% 0 0)`,
          boxShadow: `0 ${6 * u}px ${24 * u}px rgba(0,0,0,0.45)`,
        }}
      >
        <div
          style={{
            backgroundColor: p.accent,
            color: fg,
            fontFamily: en.fontFamily,
            fontWeight: en.fontWeight,
            fontSize: 50 * u,
            lineHeight: 1,
            padding: `${10 * u}px ${18 * u}px`,
            display: "flex",
            alignItems: "center",
          }}
        >
          {twoDigits(p.index)}
        </div>
        {heading ? (
          <div
            style={{
              backgroundColor: "rgba(8,10,16,0.78)",
              color: p.primary,
              fontFamily: font.fontFamily,
              fontWeight: font.fontWeight,
              fontSize: size,
              lineHeight: 1.1,
              letterSpacing: p.lang === "en" ? "0.03em" : "0.04em",
              padding: `${10 * u}px ${24 * u}px`,
              display: "flex",
              alignItems: "center",
              maxWidth: maxW,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              borderLeft: right ? "none" : `${3 * u}px solid ${withAlpha(p.accent, 0.9)}`,
              borderRight: right ? `${3 * u}px solid ${withAlpha(p.accent, 0.9)}` : "none",
            }}
          >
            {heading}
          </div>
        ) : null}
        {inline && p.count >= 2 ? (
        <div style={{ backgroundColor: "rgba(8,10,16,0.78)", padding: `${10 * u}px ${18 * u}px`, display: "flex", alignItems: "center" }}>
          <FeatureProgress index={p.index} count={p.count} accent={p.accent} sectionFrames={p.sectionFrames} delay={p.appearAt + 2} size={0.8} />
        </div>
        ) : null}
      </div>
      {!inline && p.count >= 2 ? (
        <div style={{ backgroundColor: "rgba(8,10,16,0.78)", padding: `${10 * u}px ${18 * u}px`, display: "flex", alignItems: "center", borderRadius: 999, boxShadow: `0 ${6 * u}px ${24 * u}px rgba(0,0,0,0.45)` }}>
          <FeatureProgress index={p.index} count={p.count} accent={p.accent} sectionFrames={p.sectionFrames} delay={p.appearAt + 2} size={0.8} />
        </div>
      ) : null}
    </div>
  );
};

/** The heading overlay of one feature section (frames relative to the section). */
export const FeatureHeading: React.FC<HeadingProps> = (p) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const u = unitFor(width, height);
  const big = p.bigFrames;
  // big block exit (16:9 / crop): slide out + fade during the last frames of the big phase
  const exitLen = Math.max(4, Math.round(big * 0.18));
  const exit = interpolate(frame, [big - exitLen, big], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const scrim = interpolate(frame, [0, 5], [0, 1], clamp) * (1 - exit);

  if (p.layout === "vblur") {
    // text stays in the empty band above the footage strip; it only settles to a smaller size
    const { top } = stripBounds(width, height);
    const settle = interpolate(frame, [big - exitLen, big + 2], [1, 0.84], { ...clamp, easing: Easing.inOut(Easing.cubic) });
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 150 * u,
            height: top - 150 * u - 92 * u,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ transform: `scale(${settle})` }}>
            <BigBlock {...p} align="column" scale={1} maxWidth={width * 0.9} />
          </div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: top - 70 * u, display: "flex", justifyContent: "center" }}>
          <FeatureProgress index={p.index} count={p.count} accent={p.accent} sectionFrames={p.sectionFrames} delay={8} />
        </div>
      </AbsoluteFill>
    );
  }

  const isH = p.layout === "h";
  const right = p.labelSide === "right";
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {frame < big ? (
        <>
          <AbsoluteFill
            style={{
              opacity: scrim,
              background: isH
                ? "linear-gradient(90deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0) 78%)"
                : "linear-gradient(180deg, rgba(0,0,0,0) 12%, rgba(0,0,0,0.62) 32%, rgba(0,0,0,0.62) 58%, rgba(0,0,0,0) 78%)",
            }}
          />
          <AbsoluteFill
            style={{
              justifyContent: "center",
              alignItems: isH ? "flex-start" : "center",
              paddingLeft: isH ? 130 * u : 0,
              paddingBottom: isH ? 40 * u : height * 0.12,
              opacity: 1 - exit,
              transform: `translateX(${-exit * 160 * u}px)`,
            }}
          >
            <BigBlock {...p} align={isH ? "row" : "column"} scale={1} maxWidth={isH ? width - 260 * u : width * 0.88} />
          </AbsoluteFill>
        </>
      ) : null}
      <div
        style={{
          position: "absolute",
          top: isH ? 44 * u : height * 0.075,
          ...(right ? { right: 48 * u } : { left: 48 * u }),
        }}
      >
        <CompactLabel {...p} appearAt={big - Math.round(exitLen / 2)} />
      </div>
    </AbsoluteFill>
  );
};
