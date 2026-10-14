import type React from "react";
import { AbsoluteFill } from "remotion";
import type { Lang } from "@gas/shared";
import { displayFont } from "../../../common/fonts";
import { withAlpha } from "../../../common/theme";
import type { TemplateRenderProps } from "../../types";
import { Badge, CtaBar, gameLayout, SAFE916, ShortGameplay, ShortShell, stripRect, TopBand, TopBanner, useShortFrame } from "../common";
import { DEV_PITCH, type DevPitchTimeline } from "./timeline";

type Props = TemplateRenderProps<DevPitchTimeline>;

const kicker = (lang: Lang) => (lang === "ja" ? "開発者です" : "DEV HERE");

/** Small avatar dot (accent ring + "dev" glyph) used inside the kicker badge. */
const Avatar: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: `radial-gradient(circle at 50% 38%, #ffffff 0 22%, transparent 23%), radial-gradient(ellipse at 50% 100%, #ffffff 0 42%, transparent 43%), ${color}`,
      boxShadow: `0 0 0 ${Math.max(2, size * 0.08)}px #ffffff`,
    }}
  />
);

/** Big typographic quote marks decorating the pitch band. */
const Quotes: React.FC<{ color: string; size: number; bandH: number }> = ({ color, size, bandH }) => {
  const f = displayFont("en").fontFamily;
  return (
    <>
      <div style={{ position: "absolute", left: size * 0.12, top: bandH * 0.2, fontFamily: f, fontSize: size, lineHeight: 1, color }}>“</div>
      <div style={{ position: "absolute", right: size * 0.12, bottom: -size * 0.32, fontFamily: f, fontSize: size, lineHeight: 1, color }}>”</div>
    </>
  );
};

const Vertical: React.FC<Props> = ({ project, format, lang, timeline, assetBaseUrl, useProxy }) => {
  const { width, u } = useShortFrame();
  const layout = gameLayout(project, format);
  const accent = project.style.accentColor;
  const strip = stripRect(width, u, DEV_PITCH.BAND_H);
  return (
    <AbsoluteFill>
      <ShortGameplay
        project={project}
        layout={layout}
        clips={timeline.clips}
        cuts={timeline.cuts}
        assetBaseUrl={assetBaseUrl}
        useProxy={useProxy}
        stripTop={DEV_PITCH.BAND_H}
      />
      {timeline.title ? (
        <TopBand
          project={project}
          lang={lang}
          text={timeline.title}
          variant="light"
          height={DEV_PITCH.BAND_H}
          maxFont={lang === "en" ? 120 : 100}
          kicker={<Badge text={kicker(lang)} lang={lang} size={(lang === "en" ? 40 : 36) * u} bg="#111318" fg="#ffffff" variant="pill" display={lang === "en"} icon={<Avatar size={40 * u} color={accent} />} />}
          deco={<Quotes color={withAlpha(accent, 0.55)} size={260 * u} bandH={DEV_PITCH.BAND_H * u} />}
        />
      ) : null}
      {/* CTA bar: always on, right under the strip, inside the safe zone (right 120px free) */}
      <CtaBar
        project={project}
        lang={lang}
        assetBaseUrl={assetBaseUrl}
        cta={timeline.cta}
        sub={timeline.handle}
        style={{ position: "absolute", left: 36 * u, right: (SAFE916.right + 4) * u, top: strip.bottom + 26 * u }}
      />
    </AbsoluteFill>
  );
};

const Horizontal: React.FC<Props> = ({ project, lang, timeline, assetBaseUrl, useProxy }) => {
  const { width, u } = useShortFrame();
  const accent = project.style.accentColor;
  return (
    <AbsoluteFill>
      <ShortGameplay project={project} layout="full16" clips={timeline.clips} cuts={timeline.cuts} assetBaseUrl={assetBaseUrl} useProxy={useProxy} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.4) 100%)" }} />
      {timeline.title ? (
        <TopBanner
          project={project}
          lang={lang}
          text={timeline.title}
          variant="light"
          maxFont={lang === "en" ? 64 : 52}
          kicker={<Avatar size={70 * u} color={accent} />}
        />
      ) : null}
      <CtaBar
        project={project}
        lang={lang}
        assetBaseUrl={assetBaseUrl}
        cta={timeline.cta}
        sub={timeline.handle}
        compact
        style={{ position: "absolute", right: 56 * u, bottom: 250 * u, width: width * 0.36 }}
      />
    </AbsoluteFill>
  );
};

/** Template "dev-pitch" visuals: body (pitch band + gameplay + permanent CTA) then the common end card. */
export const DevPitch: React.FC<Props> = (props) => (
  <ShortShell project={props.project} format={props.format} lang={props.lang} assetBaseUrl={props.assetBaseUrl} timeline={props.timeline}>
    {props.format === "9:16" ? <Vertical {...props} /> : <Horizontal {...props} />}
  </ShortShell>
);
