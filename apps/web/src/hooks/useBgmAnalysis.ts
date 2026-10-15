import { useCallback, useEffect, useRef, useState } from "react";
import type { Bgm, Project } from "@gas/shared";
import { api, ApiError, featureErrorMessage } from "../api";
import type { MutateOnServer } from "./useProject";

export type BeatState =
  | { kind: "none" }
  | { kind: "running" }
  | { kind: "done"; beats: number[]; bpm?: number }
  | { kind: "error"; message: string; beats?: number[]; bpm?: number };

/** Beat analysis state of a BGM (server-owned fields, ARCHITECTURE §4 / §6.11). */
export function beatState(bgm: Bgm | undefined): BeatState {
  if (!bgm) return { kind: "none" };
  const st = bgm.analysisStatus ?? "none";
  if (st === "running") return { kind: "running" };
  if (st === "error") return { kind: "error", message: bgm.analysisError ?? "不明なエラー", beats: bgm.beats, bpm: bgm.bpm };
  if (bgm.beats && bgm.beats.length > 0) return { kind: "done", beats: bgm.beats, bpm: bgm.bpm };
  return { kind: "none" };
}

/** True when the trailer's beat sync can use the BGM (§5.6: beats.length >= 2). */
export function hasUsableBeats(project: Project): boolean {
  return (project.audio.bgm?.beats?.length ?? 0) >= 2;
}

/**
 * Voice-band ducking (ARCHITECTURE §5.3.1): starts POST /bgm/carve automatically when the project has a BGM in
 * band mode without a carved copy (new upload, project made before the feature, interrupted run). Once per
 * BGM path per editor session (an error is shown with a retry button instead of looping).
 */
export function useBgmVoiceCarveAuto(project: Project | null, mutateOnServer: MutateOnServer, enabled: boolean) {
  const tried = useRef(new Set<string>());
  const bgm = project?.audio.bgm;
  const want =
    enabled &&
    !!bgm &&
    (bgm.duckMode ?? "band") === "band" &&
    !bgm.voiceCarvePath &&
    bgm.voiceCarveStatus !== "running" &&
    bgm.voiceCarveStatus !== "error";
  const key = project && bgm ? `${project.id}|${bgm.path}` : "";
  useEffect(() => {
    if (!want || !key || tried.current.has(key)) return;
    tried.current.add(key);
    void mutateOnServer((p) => api.carveBgm(p.id)).catch(() => {
      /* 409 = already running; other errors: the next GET shows the state */
    });
  }, [want, key, mutateOnServer]);
}

/** Retry button for a failed voice carve. */
export function useBgmCarve(mutateOnServer: MutateOnServer) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      await mutateOnServer((p) => api.carveBgm(p.id));
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409 ? "BGM が無いか、すでに生成中です" : featureErrorMessage(e, "声の帯域カット"),
      );
    } finally {
      setStarting(false);
    }
  }, [mutateOnServer]);
  return { start, starting, error };
}

/** Starts POST /bgm/analyze (the editor polls GET while analysisStatus is "running"). */
export function useBgmAnalyze(mutateOnServer: MutateOnServer) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      await mutateOnServer((p) => api.analyzeBgm(p.id));
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409
          ? "BGM が無いか、すでに解析中です"
          : `拍を検出できません: ${featureErrorMessage(e, "ビート解析")}`,
      );
    } finally {
      setStarting(false);
    }
  }, [mutateOnServer]);

  return { start, starting, error, clearError: () => setError(null) };
}

/* ------------------------------------------------------------------ */
/* Waveform peaks of an audio file (decoded once per URL)              */
/* ------------------------------------------------------------------ */

export type Waveform = { peaks: number[]; durationSec: number };
type WaveEntry = { kind: "loading" } | { kind: "ok"; wave: Waveform } | { kind: "error" };

const waveCache = new Map<string, WaveEntry>();
const waveInflight = new Map<string, Promise<void>>();
const BUCKETS = 240;

async function decode(url: string): Promise<Waveform> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const Ctx: typeof OfflineAudioContext =
    window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new Ctx(1, 1, 44100);
  const audio = await ctx.decodeAudioData(buf);
  const ch = audio.getChannelData(0);
  const per = Math.max(1, Math.floor(ch.length / BUCKETS));
  const peaks: number[] = [];
  let max = 0;
  for (let b = 0; b < BUCKETS; b++) {
    let sum = 0;
    const start = b * per;
    const end = Math.min(ch.length, start + per);
    // RMS on a stride (fast enough for a few minutes of audio)
    const stride = Math.max(1, Math.floor((end - start) / 400));
    let n = 0;
    for (let i = start; i < end; i += stride) {
      const v = ch[i]!;
      sum += v * v;
      n++;
    }
    const rms = n ? Math.sqrt(sum / n) : 0;
    peaks.push(rms);
    if (rms > max) max = rms;
  }
  return { peaks: peaks.map((p) => (max > 0 ? p / max : 0)), durationSec: audio.duration };
}

/** Decodes the audio at `url` (null = none) into normalized RMS peaks; cached per URL. */
export function useWaveform(url: string | null): WaveEntry | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!url) return;
    if (waveCache.has(url) || waveInflight.has(url)) {
      const p = waveInflight.get(url);
      if (p) void p.then(() => force((n) => n + 1));
      return;
    }
    waveCache.set(url, { kind: "loading" });
    const p = decode(url)
      .then((wave) => void waveCache.set(url, { kind: "ok", wave }))
      .catch(() => void waveCache.set(url, { kind: "error" }))
      .finally(() => waveInflight.delete(url));
    waveInflight.set(url, p);
    let alive = true;
    void p.then(() => alive && force((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [url]);
  return url ? waveCache.get(url) ?? { kind: "loading" } : null;
}
