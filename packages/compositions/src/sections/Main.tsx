import type React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format, Lang, Project } from "@gas/shared";
import type { TimelineSection } from "../timeline";
import { ClipTrack } from "../ClipTrack";
import { Backdrop } from "../Backdrop";
import { assetUrl } from "../urls";
import { BODY_FONT, displayFont } from "../fonts";
import { outline, unitFor } from "../theme";

/** Small logo / title watermark in the corner while gameplay plays (style.watermark: corner + scale, "none" hides it). */
const CornerBadge: React.FC<{ project: Project; lang: Lang; assetBaseUrl: string }> = ({ project, lang, assetBaseUrl }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const wm = project.style.watermark;
  if (wm.position === "none") return null;
  const u = unitFor(width, height);
  const k = Math.min(3, Math.max(0.25, wm.scale));
  const opacity = interpolate(frame, [4, 14], [0, 0.92], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pad = 44 * u;
  const top = wm.position.startsWith("top");
  const left = wm.position.endsWith("left");
  const place: React.CSSProperties = {
    position: "absolute",
    ...(top ? { top: pad } : { bottom: pad }),
    ...(left ? { left: pad } : { right: pad }),
  };
  const { logo, title } = project.game;
  if (logo) {
    return (
      <Img
        src={assetUrl(assetBaseUrl, project.id, logo)}
        style={{
          ...place,
          maxWidth: Math.min(300 * u * k, width * 0.45),
          maxHeight: Math.min(110 * u * k, height * 0.3),
          objectFit: "contain",
          objectPosition: `${left ? "left" : "right"} ${top ? "top" : "bottom"}`,
          opacity,
          filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.7))",
        }}
      />
    );
  }
  if (!title.trim()) return null;
  const font = displayFont(lang);
  return (
    <div
      style={{
        ...place,
        opacity,
        fontFamily: font.fontFamily,
        fontWeight: font.fontWeight,
        fontSize: 40 * u * k,
        color: "white",
        textShadow: outline(2.5 * u * Math.max(0.6, k)),
        letterSpacing: "0.03em",
        maxWidth: width * 0.45,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        textAlign: left ? "left" : "right",
      }}
    >
      {font.uppercase ? title.toUpperCase() : title}
    </div>
  );
};

/** Shown in the main section when there is no usable footage (keeps the duration meaningful). */
const NoFootage: React.FC<{ project: Project; assetBaseUrl: string }> = ({ project, assetBaseUrl }) => {
  const { width, height } = useVideoConfig();
  const u = unitFor(width, height);
  return (
    <AbsoluteFill>
      <Backdrop project={project} assetBaseUrl={assetBaseUrl} blurPx={0} brightness={0.85} />
      {project.game.keyArt ? null : (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <div style={{ fontFamily: BODY_FONT, fontWeight: 700, fontSize: 36 * u, color: "rgba(255,255,255,0.35)", letterSpacing: "0.2em" }}>
            GAMEPLAY
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

export const MainSection: React.FC<{
  project: Project;
  section: TimelineSection;
  format: Format;
  lang: Lang;
  assetBaseUrl: string;
  useProxy: boolean;
}> = ({ project, section, format, lang, assetBaseUrl, useProxy }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {section.clips.length > 0 ? (
        <ClipTrack project={project} clips={section.clips} format={format} assetBaseUrl={assetBaseUrl} useProxy={useProxy} sectionFrom={section.from} punchFirst />
      ) : (
        <NoFootage project={project} assetBaseUrl={assetBaseUrl} />
      )}
      <CornerBadge project={project} lang={lang} assetBaseUrl={assetBaseUrl} />
    </AbsoluteFill>
  );
};
