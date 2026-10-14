import type { Lang, Project, ScriptLine, ScriptSectionId } from "@gas/shared";

/**
 * Narration placement rules (docs/ARCHITECTURE.md §5.1). Pure functions, no React.
 * Used by buildTimeline() (section lengths + placement) so calcAdMetadata, <AdVideo>
 * and buildNarrationPlan() share one computation.
 */

export type PlacedNarration = {
  lineId: string;
  section: ScriptSectionId;
  /** absolute start frame on the output timeline */
  from: number;
  /** frames actually played (after cutting at the section end); 0 = dropped */
  durationInFrames: number;
  /** natural length of the audio in frames */
  naturalFrames: number;
  /** true if the line was cut or dropped (fixed durationSec and it overflowed its section) */
  cut: boolean;
};

export type NarrationPlan = {
  /** lines of `lang` that have audio (audioPath + durationSec), in playback order (hook, main, cta) */
  lines: PlacedNarration[];
  /** line ids that were cut or dropped because the section is too short (fixed durationSec only) */
  overflowLineIds: string[];
};

/** Lines that can be played: matching lang, non-empty text, audioPath + durationSec (any status). */
export function playableLines(project: Project, lang: Lang): ScriptLine[] {
  return project.script.filter(
    (l) =>
      l.lang === lang &&
      l.text.trim() !== "" &&
      typeof l.audioPath === "string" &&
      l.audioPath !== "" &&
      typeof l.durationSec === "number" &&
      Number.isFinite(l.durationSec) &&
      l.durationSec > 0,
  );
}

const toFrames = (sec: number, fps: number) => Math.round(Math.max(0, sec) * fps);

/** Line placement relative to its section start (frames). */
type RelLine = { line: ScriptLine; rel: number; natural: number };

export type NarrationLayout = {
  hook: RelLine[];
  main: RelLine[];
  cta: RelLine[];
  /** frames each section needs so that all of its narration fits */
  hookNeed: number;
  mainNeed: number;
  ctaNeed: number;
};

export function layoutNarration(project: Project, lang: Lang, fps: number): NarrationLayout {
  const lines = playableLines(project, lang);
  const hook: RelLine[] = [];
  const main: RelLine[] = [];
  const cta: RelLine[] = [];
  let t = 0;
  for (const line of lines) {
    const natural = Math.max(1, toFrames(line.durationSec!, fps));
    const offset = toFrames(line.offsetSec, fps);
    if (line.section === "main") {
      t += offset;
      main.push({ line, rel: t, natural });
      t += natural;
    } else {
      (line.section === "hook" ? hook : cta).push({ line, rel: offset, natural });
    }
  }
  const need = (xs: RelLine[]) => xs.reduce((m, x) => Math.max(m, x.rel + x.natural), 0);
  return { hook, main, cta, hookNeed: need(hook), mainNeed: t, ctaNeed: need(cta) };
}

/** Places a section's lines at `sectionFrom`, cutting at the section end when `fixed`. */
export function placeSection(
  rel: RelLine[],
  section: ScriptSectionId,
  sectionFrom: number,
  sectionFrames: number,
  fixed: boolean,
): PlacedNarration[] {
  return rel.map(({ line, rel: r, natural }) => {
    let duration = natural;
    let cut = false;
    if (fixed && r + natural > sectionFrames) {
      duration = Math.max(0, sectionFrames - r);
      cut = true;
    }
    return { lineId: line.id, section, from: sectionFrom + r, durationInFrames: duration, naturalFrames: natural, cut };
  });
}
