import type React from "react";
import { createContext, useContext } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { hash01, transitionLook, transitionStateAt, type ScheduledTransition, type TransitionLook, type TransitionState } from "./transitions";

/**
 * Cut transitions (ARCHITECTURE §5.11) — the React part. <AdVideo> computes the schedule once (memoized, so the
 * context does not change per frame) and renders the SVG filter defs (<TransitionDefs>, which reads the absolute
 * frame itself). Every <ClipTrack> wraps its footage in <TransitionLayer>, so the effect hits the
 * gameplay footage only — template text, cards, end card, captions and watermark stay crisp.
 */

export type TransitionContextValue = {
  schedule: ScheduledTransition[];
  /** cut frames that have a transition (ClipTrack skips its own cut punch there; trailer skips its entrance) */
  covered: ReadonlySet<number>;
  /** strength multiplier (transitionGain(intensity)) */
  gain: number;
  /** unique prefix of the SVG filter ids of this <AdVideo> instance */
  uid: string;
};

export const TransitionContext = createContext<TransitionContextValue | null>(null);

export const useCutTransition = () => useContext(TransitionContext);

/** true when the cut at absolute frame `f` has a transition (so own per-cut accents should stand back) */
export function useCoveredCut(f: number): boolean {
  const ctx = useContext(TransitionContext);
  return !!ctx && ctx.covered.has(f);
}

const filterIds = (uid: string) => ({ mb: `${uid}-mb`, zb: `${uid}-zb`, gl: `${uid}-gl` });

const unitOf = (w: number, h: number) => Math.min(w, h) / 1080;

/** Glitch slice table for feFuncR (discrete): mostly 0.5 (= no shift) with a few strong bands, per cut + frame. */
function sliceTable(index: number, d: number): string {
  const v: string[] = [];
  for (let k = 0; k < 12; k++) {
    const r = hash01(index * 17 + k, d * 3 + 1);
    v.push(r < 0.45 ? "0.5" : (0.5 + (hash01(k, index + d * 7) - 0.5) * 1.6).toFixed(3));
  }
  return v.join(" ");
}

/**
 * SVG filter defs for the current frame (rendered once by <AdVideo>, only while a transition that needs one runs).
 * Regions are the element's own box with edgeMode="duplicate" so blur does not pull in transparent (dark) edges.
 */
export const TransitionDefs: React.FC = () => {
  const ctx = useContext(TransitionContext);
  const frame = useCurrentFrame(); // <TransitionDefs> sits directly in <AdVideo> -> absolute frame
  const { width, height } = useVideoConfig();
  const s = ctx ? transitionStateAt(ctx.schedule, frame, ctx.gain) : null;
  if (!ctx || !s) return null;
  const look = transitionLook(s);
  const u = unitOf(width, height);
  const ids = filterIds(ctx.uid);
  const box = { x: "0", y: "0", width: "1", height: "1", filterUnits: "objectBoundingBox" as const, colorInterpolationFilters: "sRGB" as const };
  return (
    <svg width={0} height={0} style={{ position: "absolute", width: 0, height: 0 }} aria-hidden>
      <defs>
        {s.kind === "whip" && look.blurX > 0.3 ? (
          <filter id={ids.mb} {...box}>
            <feGaussianBlur stdDeviation={`${(look.blurX * u).toFixed(2)} 0`} edgeMode="duplicate" />
          </filter>
        ) : null}
        {s.kind === "zoom" && look.blur > 0.3 ? (
          <filter id={ids.zb} {...box}>
            <feGaussianBlur stdDeviation={(look.blur * u).toFixed(2)} edgeMode="duplicate" />
          </filter>
        ) : null}
        {s.kind === "glitch" && (look.rgb > 0.3 || look.slice > 0.3) ? (
          <filter id={ids.gl} {...box}>
            <feTurbulence type="fractalNoise" baseFrequency={`0 ${(0.012 / u).toFixed(5)}`} numOctaves={1} seed={(s.index * 31 + s.d * 7 + 1000) % 997} result="n" />
            <feComponentTransfer in="n" result="bands">
              <feFuncR type="discrete" tableValues={sliceTable(s.index, s.d)} />
              <feFuncG type="discrete" tableValues="0.5" />
            </feComponentTransfer>
            <feDisplacementMap in="SourceGraphic" in2="bands" scale={(look.slice * u).toFixed(2)} xChannelSelector="R" yChannelSelector="G" result="d" />
            <feColorMatrix in="d" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            <feOffset in="r" dx={(look.rgb * u).toFixed(2)} dy="0" result="ro" />
            <feColorMatrix in="d" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
            <feColorMatrix in="d" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
            <feOffset in="b" dx={(-look.rgb * u).toFixed(2)} dy="0" result="bo" />
            <feComposite in="ro" in2="g" operator="arithmetic" k1={0} k2={1} k3={1} k4={0} result="rg" />
            <feComposite in="rg" in2="bo" operator="arithmetic" k1={0} k2={1} k3={1} k4={0} />
          </filter>
        ) : null}
      </defs>
    </svg>
  );
};

/** CSS for the footage layer at the current frame (identity when nothing runs). */
function layerStyle(look: TransitionLook, state: TransitionState | null, uid: string, u: number): React.CSSProperties {
  if (!state) return {};
  const ids = filterIds(uid);
  const filters: string[] = [];
  if (state.kind === "whip" && look.blurX > 0.3) filters.push(`url(#${ids.mb})`);
  if (state.kind === "zoom" && look.blur > 0.3) filters.push(`url(#${ids.zb})`);
  if (state.kind === "glitch" && (look.rgb > 0.3 || look.slice > 0.3)) filters.push(`url(#${ids.gl})`);
  if (Math.abs(look.brightness - 1) > 0.005) filters.push(`brightness(${look.brightness.toFixed(3)})`);
  const transform = look.tx !== 0 || look.scale !== 1 ? `translateX(${(look.tx * 100).toFixed(3)}%) scale(${look.scale.toFixed(4)})` : undefined;
  void u;
  return { filter: filters.length > 0 ? filters.join(" ") : undefined, transform, transformOrigin: "50% 50%" };
}

/**
 * Wraps one ClipTrack's footage. `active` = one of its clips is on screen at the current absolute frame (layers
 * that show nothing are not filtered — trivia mounts one ClipTrack per clip). The tree shape never changes (no
 * remounts of the videos); only styles + leaf overlays do.
 */
export const TransitionLayer: React.FC<{ active: boolean; absFrame: number; children: React.ReactNode }> = ({ active, absFrame, children }) => {
  const ctx = useContext(TransitionContext);
  const { width, height } = useVideoConfig();
  const u = unitOf(width, height);
  const state = active && ctx ? transitionStateAt(ctx.schedule, absFrame, ctx.gain) : null;
  const look = transitionLook(state);
  const style = layerStyle(look, state, ctx?.uid ?? "", u);
  const edgeBlur = state?.kind === "zoom" ? look.edgeBlur * u : 0;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={style}>{children}</AbsoluteFill>
      {edgeBlur > 0.5 ? (
        // radial-ish zoom blur: blur what is behind, masked to the edges (sharp center)
        <AbsoluteFill
          style={{
            backdropFilter: `blur(${edgeBlur.toFixed(1)}px)`,
            WebkitBackdropFilter: `blur(${edgeBlur.toFixed(1)}px)`,
            maskImage: "radial-gradient(ellipse 70% 70% at 50% 50%, transparent 25%, black 85%)",
            WebkitMaskImage: "radial-gradient(ellipse 70% 70% at 50% 50%, transparent 25%, black 85%)",
          }}
        />
      ) : null}
      {look.flash > 0.01 ? <AbsoluteFill style={{ backgroundColor: "white", opacity: look.flash }} /> : null}
    </AbsoluteFill>
  );
};
