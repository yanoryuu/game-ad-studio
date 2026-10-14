import type React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import type { Lang, Project } from "@gas/shared";
import { withAlpha } from "../../../common/theme";
import { pop, useShortFrame } from "./anim";
import { BigText, surface, type SurfaceVariant } from "./BigText";
import { fitFont, SAFE916 } from "./layout";

/**
 * Full-screen text card (e.g. fail-win "でも…"): solid surface + speed stripes, one big RichText centered inside
 * the 9:16 safe zone, punches in (scale 1.2 -> 1, legible from its first frame). Put it in a <Sequence>.
 * `under` = small line under the text (plain/rich), `badge` = node above the text.
 */
export const TextCard: React.FC<{
  project: Project;
  lang: Lang;
  text: string;
  variant?: SurfaceVariant;
  under?: string;
  badge?: React.ReactNode;
  /** max font size in reference px. Default 200 en / 170 ja */
  maxFont?: number;
  /** show the footage below at this opacity instead of a solid card: pass the footage as children */
  children?: React.ReactNode;
  /** 0..1 solid opacity over the children. Default 1 (solid) */
  opacity?: number;
}> = ({ project, lang, text, variant = "dark", under, badge, maxFont, children, opacity = 1 }) => {
  const { frame, fps, width, height, u, vertical } = useShortFrame();
  const s = surface(project, variant);
  const p = pop(frame, fps, 0, { stiff: true });
  const top = vertical ? SAFE916.top * u : 80 * u;
  const bottom = vertical ? SAFE916.bottom * u : 120 * u;
  const maxW = width * (vertical ? 0.84 : 0.8);
  const size = fitFont(text, lang, { base: (maxFont ?? (lang === "en" ? 200 : 170)) * u, maxWidth: maxW, maxHeight: (height - top - bottom) * 0.7, minRatio: 0.3 });
  const zoom = interpolate(frame, [0, fps * 3], [1, 1.06]);
  return (
    <AbsoluteFill>
      {children}
      <AbsoluteFill
        style={{
          opacity,
          background: `repeating-linear-gradient(115deg, ${withAlpha(variant === "light" ? "#000000" : "#ffffff", 0.05)} 0px, ${withAlpha(variant === "light" ? "#000000" : "#ffffff", 0.05)} ${22 * u}px, transparent ${22 * u}px, transparent ${56 * u}px), radial-gradient(ellipse at 50% 45%, ${withAlpha("#ffffff", variant === "light" ? 0 : 0.12)} 0%, transparent 65%), linear-gradient(160deg, ${s.a} 0%, ${s.b} 100%)`,
        }}
      />
      <AbsoluteFill style={{ top, bottom, height: "auto", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 36 * u }}>
        {badge}
        <div style={{ maxWidth: maxW, transform: `scale(${interpolate(p, [0, 1], [1.2, 1]) * zoom})` }}>
          <BigText text={text} lang={lang} fontSize={size} emphasisColor={project.style.emphasisColor} color={s.fg} ink={s.ink} marker={s.marker} />
        </div>
        {under ? (
          <div style={{ maxWidth: maxW }}>
            <BigText text={under} lang={lang} fontSize={size * 0.32} emphasisColor={project.style.emphasisColor} color={s.fg} ink={s.ink} marker={s.marker} body />
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
