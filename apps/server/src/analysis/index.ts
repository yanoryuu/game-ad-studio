import fsp from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Candidate } from "@gas/shared";
import { probe } from "../media";
import { projectDir } from "../paths";
import { readProject, updateProject } from "../store";
import { binFeatures, DEFAULT_BIN_SEC, normalizeBins, type NormBin } from "./features";
import { extractRawFeatures, extractThumb, type VideoFrameStat } from "./ffmpegFeatures";
import { defaultSegmentOptions, segmentCandidates, type CandidateRange, type SegmentOptions } from "./segment";

export { binFeatures, normalizeBins } from "./features";
export { defaultSegmentOptions, scoreBins, segmentCandidates } from "./segment";
export type { CandidateRange, SegmentOptions } from "./segment";

/** scdet score (0..100) at/above which a frame counts as a hard cut */
export const CUT_THRESHOLD = 14;

/**
 * true if frame i starts a brightness flash (explosion / hit flash): luma jumps up and comes back
 * to the previous level within ~1.5 s. Those are highlights, not edit points.
 */
function isFlash(video: VideoFrameStat[], i: number): boolean {
  const f = video[i]!;
  const before = video.slice(Math.max(0, i - 15), i).map((x) => x.yavg);
  if (!before.length) return false;
  const pre = before.reduce((a, b) => a + b, 0) / before.length;
  let peak = f.yavg;
  for (let j = i; j < video.length && video[j]!.t - f.t <= 0.5; j++) peak = Math.max(peak, video[j]!.yavg);
  if (peak - pre < 10) return false;
  for (let j = i + 1; j < video.length && video[j]!.t - f.t <= 1.5; j++) {
    if (Math.abs(video[j]!.yavg - pre) < 6) return true;
  }
  return false;
}

/** Cut timestamps from per-frame scene scores (flashes excluded; debounced: one cut per 0.4 s). */
export function detectCuts(video: VideoFrameStat[], threshold = CUT_THRESHOLD): number[] {
  const cuts: number[] = [];
  for (let i = 1; i < video.length; i++) {
    const f = video[i]!;
    if (f.scene < threshold) continue;
    if (isFlash(video, i)) continue;
    const last = cuts[cuts.length - 1];
    if (last !== undefined && f.t - last < 0.4) continue;
    cuts.push(f.t);
  }
  return cuts;
}

export type AnalyzeResult = {
  durationSec: number;
  candidates: CandidateRange[];
  bins: NormBin[];
  cuts: number[];
  timingMs: { extract: number; segment: number };
};

/** Analyzes a video file (normally the 720p30 proxy). Pure apart from the ffmpeg/ffprobe calls. */
export async function analyzeFile(input: string, opts: Partial<SegmentOptions> = {}): Promise<AnalyzeResult> {
  const t0 = Date.now();
  const info = await probe(input);
  const raw = await extractRawFeatures(input, info.audioStreamIndex !== undefined);
  const t1 = Date.now();
  const lastT = raw.video[raw.video.length - 1]?.t ?? 0;
  const durationSec = Math.max(info.durationSec, lastT);
  const binSec = opts.binSec ?? DEFAULT_BIN_SEC;
  const bins = normalizeBins(binFeatures(raw, durationSec, binSec), binSec);
  const cuts = detectCuts(raw.video);
  const candidates = segmentCandidates(bins, cuts, { ...defaultSegmentOptions(durationSec), ...opts, binSec });
  return { durationSec, candidates, bins, cuts, timingMs: { extract: t1 - t0, segment: Date.now() - t1 } };
}

/* ------------------------------------------------------------------ */
/* Background job (POST /analyze)                                       */
/* ------------------------------------------------------------------ */

const running = new Set<string>();
const key = (projectId: string, sourceId: string) => `${projectId}/${sourceId}`;

export function isAnalysisRunning(projectId: string, sourceId: string): boolean {
  return running.has(key(projectId, sourceId));
}

/** Ranges equal within 50 ms count as "the same candidate" across re-analyses (keeps id + adopted). */
const sameRange = (a: { startSec: number; endSec: number }, b: { startSec: number; endSec: number }) =>
  Math.abs(a.startSec - b.startSec) < 0.05 && Math.abs(a.endSec - b.endSec) < 0.05;

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

/**
 * Runs the analysis of one source and stores the result. Never throws (errors go to analysisError).
 * The caller has already set analysisStatus "running".
 */
export async function runAnalysisJob(projectId: string, sourceId: string): Promise<void> {
  const k = key(projectId, sourceId);
  running.add(k);
  const started = Date.now();
  const dir = projectDir(projectId);
  const newThumbs: string[] = [];
  try {
    let candidates: Candidate[];
    try {
      const project = await readProject(projectId);
      const source = project.sources.find((s) => s.id === sourceId);
      if (!source) return; // deleted meanwhile
      const input = path.join(dir, source.proxyPath);
      const result = await analyzeFile(input);
      const previous = project.candidates.filter((c) => c.sourceId === sourceId);
      candidates = result.candidates.map((r) => {
        const old = previous.find((c) => sameRange(c, r));
        const id = old?.id ?? `cand_${nanoid(8)}`;
        return {
          id,
          sourceId,
          startSec: r.startSec,
          endSec: r.endSec,
          score: r.score,
          features: r.features,
          thumbPath: `thumbs/${id}.jpg`,
          ...(old?.adopted !== undefined ? { adopted: old.adopted } : {}),
        };
      });
      await fsp.mkdir(path.join(dir, "thumbs"), { recursive: true });
      await mapLimit(candidates, 4, async (c) => {
        const out = path.join(dir, c.thumbPath);
        await extractThumb(input, (c.startSec + c.endSec) / 2, out);
        newThumbs.push(out);
      });
      console.log(
        `[analysis] ${projectId}/${sourceId}: ${candidates.length} candidates in ${((Date.now() - started) / 1000).toFixed(1)}s` +
          ` (features ${(result.timingMs.extract / 1000).toFixed(1)}s, ${result.cuts.length} cuts)`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[analysis] ${projectId}/${sourceId} failed: ${msg}`);
      await updateProject(projectId, (p) => {
        const s = p.sources.find((x) => x.id === sourceId);
        if (!s) return;
        s.analysisStatus = "error";
        s.analysisError = msg;
      }).catch(() => {});
      return;
    }

    let removedThumbs: string[] = [];
    let stored = false;
    await updateProject(projectId, (p) => {
      const s = p.sources.find((x) => x.id === sourceId);
      if (!s) return; // source removed while analyzing -> leave project untouched
      const keepIds = new Set(candidates.map((c) => c.id));
      // adopted may have changed (PUT) while we were working: re-read it from the stored copy
      const storedAdopted = new Map(p.candidates.filter((c) => c.sourceId === sourceId).map((c) => [c.id, c.adopted]));
      removedThumbs = p.candidates
        .filter((c) => c.sourceId === sourceId && !keepIds.has(c.id))
        .map((c) => path.join(dir, c.thumbPath));
      const fresh = candidates.map((c) => {
        if (!storedAdopted.has(c.id)) return c;
        const a = storedAdopted.get(c.id);
        const { adopted: _a, ...rest } = c;
        return a === undefined ? rest : { ...rest, adopted: a };
      });
      p.candidates = [...p.candidates.filter((c) => c.sourceId !== sourceId), ...fresh];
      s.analysisStatus = "done";
      delete s.analysisError;
      stored = true;
    }).catch((e) => {
      console.warn(`[analysis] ${projectId}/${sourceId}: could not store result: ${(e as Error).message}`);
    });
    if (stored) {
      for (const f of removedThumbs) await fsp.rm(f, { force: true }).catch(() => {});
    } else {
      // result discarded -> our thumbnails are orphans (unless they overwrite kept ids' files, harmless)
      for (const f of newThumbs) await fsp.rm(f, { force: true }).catch(() => {});
    }
  } finally {
    running.delete(k);
  }
}
