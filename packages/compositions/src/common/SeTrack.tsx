import type React from "react";
import { Audio, Sequence, useVideoConfig } from "remotion";
import type { Project, SeFileId, SeSlot } from "@gas/shared";
import type { CaptionItem } from "./Captions";
import { seFileUrl } from "./urls";

/**
 * v4 sound effects (ARCHITECTURE §5.9).
 *
 * Templates put SE events on their timeline (`TemplateTimeline.seEvents`, absolute frames) and may opt into
 * automatic caption pops (`TemplateTimeline.captionPopSe`). <AdVideo> resolves them centrally with
 * buildSeSchedule() and plays them with <SeTrack>; templates never mount SE audio themselves.
 */
export type SeEvent = {
  /** absolute output frame where the sound starts */
  frame: number;
  slot: SeSlot;
  /** extra gain multiplier 0..1 (default 1), multiplied with audio.se.volume */
  gain?: number;
};

/** A resolved, playable SE: the library file of the slot. */
export type ScheduledSe = { frame: number; slot: SeSlot; fileId: SeFileId; gain: number };

/** Each SE plays at most this long (library files are short; bounds accidental long files). */
export const SE_MAX_SEC = 4;
/** An automatic caption pop is skipped when a template SE starts within this distance (avoids stacking). */
export const SE_POP_SUPPRESS_SEC = 0.1;

/** One captionPop event per caption item start (narration chunks + manual captions). */
export function captionPopEvents(items: readonly CaptionItem[]): SeEvent[] {
  const starts = new Set(items.map((i) => i.start));
  return [...starts].map((frame) => ({ frame, slot: "captionPop" as const }));
}

/**
 * Final SE list: [] when audio.se is disabled / silent. Template events + (if `captionPop`) caption pops that are
 * not within SE_POP_SUPPRESS_SEC of a template event; dropped: slots without a file, frames outside
 * [0, totalFrames); one event per (frame, slot). Sorted by frame.
 */
export function buildSeSchedule(
  project: Project,
  templateEvents: readonly SeEvent[] | undefined,
  captionItems: readonly CaptionItem[],
  captionPop: boolean,
  totalFrames: number,
  fps: number,
): ScheduledSe[] {
  const se = project.audio.se;
  if (!se.enabled || se.volume <= 0) return [];
  const base = (templateEvents ?? []).filter((e) => Number.isFinite(e.frame));
  const all: SeEvent[] = [...base];
  if (captionPop) {
    const gap = Math.round(SE_POP_SUPPRESS_SEC * fps);
    for (const p of captionPopEvents(captionItems)) {
      if (!base.some((e) => Math.abs(e.frame - p.frame) <= gap)) all.push(p);
    }
  }
  const seen = new Set<string>();
  const out: ScheduledSe[] = [];
  for (const e of all) {
    const frame = Math.round(e.frame);
    const fileId = se.slots[e.slot];
    if (!fileId || frame < 0 || frame >= totalFrames) continue;
    const key = `${frame}|${e.slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ frame, slot: e.slot, fileId, gain: Math.min(1, Math.max(0, e.gain ?? 1)) });
  }
  return out.sort((a, b) => a.frame - b.frame);
}

/** Plays the scheduled SEs (one <Audio> per event, at audio.se.volume × gain, not ducked). */
export const SeTrack: React.FC<{ project: Project; events: readonly ScheduledSe[]; assetBaseUrl: string }> = ({
  project,
  events,
  assetBaseUrl,
}) => {
  const { fps, durationInFrames } = useVideoConfig();
  const volume = project.audio.se.volume;
  if (!project.audio.se.enabled || volume <= 0 || events.length === 0) return null;
  const maxLen = Math.max(1, Math.round(SE_MAX_SEC * fps));
  return (
    <>
      {events.map((e) => {
        const len = Math.min(maxLen, durationInFrames - e.frame);
        if (len <= 0 || e.gain <= 0) return null;
        return (
          <Sequence key={`${e.frame}-${e.slot}`} from={e.frame} durationInFrames={len} name={`se ${e.slot}`} layout="none">
            <Audio src={seFileUrl(assetBaseUrl, e.fileId)} volume={volume * e.gain} />
          </Sequence>
        );
      })}
    </>
  );
};
