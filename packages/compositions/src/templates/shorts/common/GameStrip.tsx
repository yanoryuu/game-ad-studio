import type React from "react";
import { AbsoluteFill } from "remotion";
import type { Project } from "@gas/shared";
import { ClipTrack } from "../../../common/ClipTrack";
import type { PlacedClip } from "../../../common/clips";
import { NoFootage } from "../../../common/NoFootage";
import { withAlpha } from "../../../common/theme";
import { cutFlash, useShortFrame } from "./anim";
import { V916, type GameLayout } from "./layout";

/**
 * Gameplay of a short (common/ClipTrack inside):
 *  - "full16": 16:9 full frame (cover);
 *  - "strip":  9:16 dark designed background + a 16:9 strip (1080×608) at `stripTop` (default 656 = centered,
 *              same place as blur mode so the default captions sit right below it) with accent rules that glow on
 *              every cut;
 *  - "full":   9:16 full-bleed; ClipTrack applies style.vertical.mode ("crop" = cover at clip.focusX).
 * `clips` from layClips() (from = frames relative to this component's Sequence; with the body Sequence at 0 that
 * is the absolute frame, pass `sectionFrom` otherwise). No clips -> NoFootage (key art / gradient).
 * `children` are drawn INSIDE the strip box (strip) or over the whole frame (full / full16).
 */
export const ShortGameplay: React.FC<{
  project: Project;
  layout: GameLayout;
  clips: PlacedClip[];
  assetBaseUrl: string;
  useProxy: boolean;
  /** absolute frame of the enclosing Sequence (ducking envelope). Default 0 */
  sectionFrom?: number;
  /** cut frames (same axis as clips) -> strip rules flash. Default: derived from clips */
  cuts?: number[];
  /** strip top in reference px (9:16 strip only). Default V916.stripTop */
  stripTop?: number;
  /** punch (zoom + flash) on the first clip too. Default false */
  punchFirst?: boolean;
  /** extra CSS filter on the footage (e.g. "saturate(0.2)") */
  filter?: string;
  /** hide the accent rules of the strip */
  plain?: boolean;
  children?: React.ReactNode;
}> = ({ project, layout, clips, assetBaseUrl, useProxy, sectionFrom = 0, cuts, stripTop = V916.stripTop, punchFirst = false, filter, plain, children }) => {
  const { frame, fps, width, u } = useShortFrame();
  const accent = project.style.accentColor;
  const footage =
    clips.length > 0 ? (
      <ClipTrack
        project={project}
        clips={clips}
        format={layout === "full" ? "9:16" : "16:9"}
        assetBaseUrl={assetBaseUrl}
        useProxy={useProxy}
        sectionFrom={sectionFrom}
        punchFirst={punchFirst}
      />
    ) : (
      <NoFootage project={project} assetBaseUrl={assetBaseUrl} />
    );
  const filtered = filter ? <AbsoluteFill style={{ filter }}>{footage}</AbsoluteFill> : footage;

  if (layout !== "strip") {
    return (
      <AbsoluteFill style={{ backgroundColor: "#000" }}>
        {filtered}
        {children}
      </AbsoluteFill>
    );
  }

  const top = stripTop * u;
  const stripH = (width * 9) / 16;
  const flash = cutFlash(cuts ?? clips.map((c) => c.from).filter((f) => f > 0), frame, fps);
  const lineH = (6 + 6 * flash) * u;
  const glow = `0 0 ${(16 + 30 * flash) * u}px ${withAlpha(accent, 0.6 + 0.4 * flash)}`;
  return (
    <AbsoluteFill>
      <StripBackground project={project} stripTop={stripTop} />
      <div style={{ position: "absolute", left: 0, top, width, height: stripH, overflow: "hidden", backgroundColor: "#000" }}>
        {filtered}
        <AbsoluteFill style={{ boxShadow: `inset 0 0 ${60 * u}px rgba(0,0,0,0.5)` }} />
        {children}
      </div>
      {plain ? null : (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: top - lineH / 2, height: lineH, backgroundColor: accent, boxShadow: glow }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: top + stripH - lineH / 2, height: lineH, backgroundColor: accent, boxShadow: glow }} />
        </>
      )}
    </AbsoluteFill>
  );
};

/** 9:16 background around the strip: dark gradient, faint scanlines, accent glow out of the strip edges. */
export const StripBackground: React.FC<{ project: Project; stripTop?: number }> = ({ project, stripTop = V916.stripTop }) => {
  const { u, width, height } = useShortFrame();
  const accent = project.style.accentColor;
  const mid = ((stripTop * u + (width * 9) / 32) / height) * 100;
  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(ellipse 90% 30% at 50% ${mid}%, ${withAlpha(accent, 0.2)} 0%, transparent 70%)`,
          `repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) ${2 * u}px, transparent ${2 * u}px, transparent ${10 * u}px)`,
          "linear-gradient(180deg, #11131c 0%, #0a0b12 50%, #030306 100%)",
        ].join(", "),
      }}
    />
  );
};

/** Rect (px) of the 9:16 strip for overlays positioned in frame coordinates. */
export function stripRect(width: number, u: number, stripTop: number = V916.stripTop) {
  const top = stripTop * u;
  const h = (width * 9) / 16;
  return { top, height: h, bottom: top + h, left: 0, width };
}
