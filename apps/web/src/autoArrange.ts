import { generateId, type Candidate, type Clip, type Lang, type Project } from "@gas/shared";
import { getSectionDurations } from "@gas/compositions";

export const DEFAULT_GAME_VOLUME = 0.8;

/** Target length of the main section for a fixed duration (after hook/end card fit their narration); null = free length. */
export function mainTargetSec(project: Project, lang: Lang): number | null {
  return project.durationSec === null ? null : getSectionDurations(project, lang).mainSec;
}

export type ArrangeOrder = "time" | "score";

const overlaps = (a: Candidate, b: Candidate) =>
  a.sourceId === b.sourceId && a.startSec < b.endSec && b.startSec < a.endSec;

export function clipFromCandidate(c: Candidate, slot: Clip["slot"]): Clip {
  return {
    id: generateId("clip", 8),
    sourceId: c.sourceId,
    inSec: c.startSec,
    outSec: c.endSec,
    slot,
    gameVolume: DEFAULT_GAME_VOLUME,
  };
}

/** Insert a clip keeping hook clips grouped at the top. */
export function insertClip(clips: Clip[], clip: Clip): Clip[] {
  if (clip.slot === "hook") {
    const last = clips.map((c) => c.slot).lastIndexOf("hook");
    const next = clips.slice();
    next.splice(last + 1, 0, clip);
    return next;
  }
  return [...clips, clip];
}

export type ArrangePlan = {
  hook: Candidate | null;
  main: Candidate[];
  mainSec: number;
  /** null = free length (count-based) */
  targetSec: number | null;
};

/**
 * Picks the best candidate for the hook and fills the main section with the next best ones
 * (score order) until the target length is reached (fixed duration) or `freeCount` clips (free length).
 * Candidates of sources that are not in the project are ignored.
 */
export function planArrangement(project: Project, order: ArrangeOrder, freeCount: number): ArrangePlan {
  const srcIndex = new Map(project.sources.map((s, i) => [s.id, i]));
  const pool = project.candidates.filter((c) => srcIndex.has(c.sourceId) && c.endSec > c.startSec);
  const ranked = pool.slice().sort((a, b) => b.score - a.score);
  const hook = ranked[0] ?? null;
  // Main length depends slightly on each language's hook/cta narration; plan against the primary language.
  const targetSec = mainTargetSec(project, project.languages[0] ?? "ja");
  const main: Candidate[] = [];
  let total = 0;
  for (const c of ranked) {
    if (c === hook) continue;
    if (hook && overlaps(c, hook)) continue;
    if (targetSec !== null ? total >= targetSec : main.length >= freeCount) break;
    main.push(c);
    total += c.endSec - c.startSec;
  }
  if (order === "time") {
    main.sort((a, b) => srcIndex.get(a.sourceId)! - srcIndex.get(b.sourceId)! || a.startSec - b.startSec);
  }
  return { hook, main, mainSec: total, targetSec };
}

/** Replaces all clips with the plan and recomputes `adopted` flags. */
export function applyArrangement(project: Project, plan: ArrangePlan): Project {
  const chosen = new Set<string>();
  const clips: Clip[] = [];
  if (plan.hook) {
    clips.push(clipFromCandidate(plan.hook, "hook"));
    chosen.add(plan.hook.id);
  }
  for (const c of plan.main) {
    clips.push(clipFromCandidate(c, "main"));
    chosen.add(c.id);
  }
  const candidates = project.candidates.map((c) => {
    if (chosen.has(c.id)) return { ...c, adopted: true };
    const { adopted: _drop, ...rest } = c;
    return rest;
  });
  return { ...project, clips, candidates };
}
