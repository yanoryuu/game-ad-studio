import type React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format, Lang, Project } from "@gas/shared";
import type { TimelineSection } from "../../common/clips";
import { Backdrop } from "../../common/Backdrop";
import { ClipTrack } from "../../common/ClipTrack";
import { BODY_FONT, displayFont } from "../../common/fonts";
import { outline, readableOn, unitFor, withAlpha } from "../../common/theme";
import { assetUrl } from "../../common/urls";
import { fitFontSize, stripBounds, type FeatLayout } from "./layout";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** "3つの魅力" / "3 REASONS TO PLAY" kicker under the title. */
function kicker(count: number, lang: Lang): string {
  if (count < 2) return "";
  return lang === "ja" ? `${count}つの魅力` : `${count} REASONS TO PLAY`;
}

/**
 * Title intro: hook clips (or the backdrop) under a dark vignette, the logo (or title) settling in with a
 * light streak, the catch copy revealed by a wipe, and a "3つの魅力" kicker that announces the structure.
 */
export const IntroSection: React.FC<{
  project: Project;
  section: TimelineSection;
  format: Format;
  lang: Lang;
  layout: FeatLayout;
  featureCount: number;
  assetBaseUrl: string;
  useProxy: boolean;
}> = ({ project, section, format, lang, layout, featureCount, assetBaseUrl, useProxy }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const u = unitFor(width, height);
  const accent = project.style.accentColor;
  const primary = project.style.primaryColor;
  const { logo } = project.game;
  const title = project.game.title.trim() || project.name;
  const catchText = project.texts[lang].hook.trim();
  const font = displayFont(lang);
  const kick = kicker(featureCount, lang);

  const logoIn = spring({ frame: frame - 2, fps, config: { damping: 15, stiffness: 120, mass: 1 } });
  const lineIn = spring({ frame: frame - 8, fps, config: { damping: 200, stiffness: 140 } });
  const catchIn = interpolate(frame, [12, 24], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const kickIn = spring({ frame: frame - 18, fps, config: { damping: 14, stiffness: 200, mass: 0.6 } });
  const push = interpolate(frame, [0, durationInFrames], [1, 1.05]);
  const streak = interpolate(frame, [6, 26], [-30, 130], clamp);

  const vertical = layout !== "h";
  const maxW = width * (vertical ? 0.86 : 0.62);
  const titleBlock = logo ? (
    <Img
      src={assetUrl(assetBaseUrl, project.id, logo)}
      style={{
        maxWidth: maxW,
        maxHeight: (layout === "vblur" ? 230 : vertical ? 330 : 380) * u,
        objectFit: "contain",
        filter: `drop-shadow(0 ${10 * u}px ${30 * u}px rgba(0,0,0,0.75)) blur(${(1 - logoIn) * 10 * u}px)`,
      }}
    />
  ) : (
    <div
      style={{
        fontFamily: font.fontFamily,
        fontWeight: font.fontWeight,
        fontSize: fitFontSize(font.uppercase ? title.toUpperCase() : title, (lang === "en" ? 190 : 140) * u, maxW, { display: true, lang, maxLines: 2 }),
        lineHeight: 1.08,
        color: primary,
        textAlign: "center",
        maxWidth: maxW,
        textShadow: `${outline(3 * u, "rgba(0,0,0,0.85)")}, 0 0 ${60 * u}px ${withAlpha(accent, 0.45)}`,
        letterSpacing: lang === "en" ? "0.02em" : "0.04em",
      }}
    >
      {font.uppercase ? title.toUpperCase() : title}
    </div>
  );

  const catchSize = fitFontSize(catchText, (vertical ? 58 : 56) * u, maxW, { display: false, lang, maxLines: 2, minRatio: 0.6 });

  // 9:16 blur: the title lives in the empty band above the footage; otherwise centered (crop: a bit higher)
  const { top } = stripBounds(width, height);
  const box: React.CSSProperties =
    layout === "vblur"
      ? { top: 110 * u, height: top - 130 * u, bottom: "auto", gap: 18 * u }
      : layout === "vcrop"
        ? { paddingBottom: height * 0.14 }
        : {};

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AbsoluteFill style={{ transform: `scale(${push})` }}>
        {section.clips.length > 0 ? (
          <ClipTrack project={project} clips={section.clips} format={format} assetBaseUrl={assetBaseUrl} useProxy={useProxy} sectionFrom={section.from} punchFirst={false} />
        ) : (
          <Backdrop project={project} assetBaseUrl={assetBaseUrl} blurPx={4} brightness={0.75} />
        )}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            layout === "vblur"
              ? "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 35%, rgba(0,0,0,0) 50%)"
              : "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.72) 100%)",
        }}
      />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 26 * u, ...box }}>
        <div
          style={{
            position: "relative",
            flexShrink: 0,
            opacity: interpolate(logoIn, [0, 0.35], [0, 1], clamp),
            transform: `scale(${interpolate(logoIn, [0, 1], [1.3, 1])})`,
            overflow: "hidden",
            padding: 10 * u,
          }}
        >
          {titleBlock}
          {/* light streak across the title */}
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${streak}%`,
              width: "18%",
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)",
              transform: "skewX(-20deg)",
              mixBlendMode: "screen",
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 * u }}>
          <div style={{ width: 220 * u * lineIn, height: 4 * u, background: `linear-gradient(90deg, transparent, ${accent})` }} />
          <div style={{ width: 14 * u, height: 14 * u, backgroundColor: accent, transform: `rotate(45deg) scale(${lineIn})` }} />
          <div style={{ width: 220 * u * lineIn, height: 4 * u, background: `linear-gradient(90deg, ${accent}, transparent)` }} />
        </div>
        {catchText ? (
          <div
            style={{
              clipPath: `inset(-20% ${(1 - catchIn) * 100}% -20% 0)`,
              fontFamily: BODY_FONT,
              fontWeight: 900,
              fontSize: catchSize,
              lineHeight: 1.3,
              color: primary,
              textAlign: "center",
              maxWidth: maxW,
              letterSpacing: lang === "ja" ? "0.08em" : "0.04em",
              whiteSpace: "pre-wrap",
              wordBreak: lang === "ja" ? "keep-all" : "normal",
              overflowWrap: "anywhere",
              textShadow: `${outline(Math.max(2, catchSize * 0.05), "rgba(0,0,0,0.85)")}, 0 ${4 * u}px ${18 * u}px rgba(0,0,0,0.7)`,
            }}
          >
            {catchText}
          </div>
        ) : null}
        {kick ? (
          <div
            style={{
              marginTop: 6 * u,
              opacity: interpolate(kickIn, [0, 0.5], [0, 1], clamp),
              transform: `translateY(${(1 - kickIn) * 24 * u}px) skewX(-10deg)`,
              backgroundColor: accent,
              padding: `${8 * u}px ${26 * u}px`,
              boxShadow: `0 ${6 * u}px ${20 * u}px rgba(0,0,0,0.5)`,
            }}
          >
            <div
              style={{
                transform: "skewX(10deg)",
                fontFamily: lang === "en" ? displayFont("en").fontFamily : BODY_FONT,
                fontWeight: lang === "en" ? 400 : 900,
                fontSize: (lang === "en" ? 40 : 36) * u,
                letterSpacing: lang === "en" ? "0.16em" : "0.12em",
                lineHeight: 1.1,
                color: readableOn(accent),
              }}
            >
              {kick}
            </div>
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
