import { useCallback, useEffect, useState } from "react";
import { SE_SLOTS, type Project, type SeFile, type SeListResponse } from "@gas/shared";
import { api, ApiError, featureErrorMessage } from "../api";
import type { UpdateProject } from "./useProject";

/** SE library (GET /api/se, ARCHITECTURE §6.12), cached at module level and shared by every panel. */
export type SeLibraryState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: SeListResponse }
  | { kind: "error"; message: string; status: number };

let state: SeLibraryState = { kind: "idle" };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function set(next: SeLibraryState) {
  state = next;
  notify();
}

function errorState(e: unknown): SeLibraryState {
  const status = e instanceof ApiError ? e.status : 0;
  return {
    kind: "error",
    status,
    message: status === 404 ? "このサーバーは SE ライブラリに対応していません(404)" : featureErrorMessage(e, "SE ライブラリ"),
  };
}

/** Runs one library request; on failure keeps the last good list (if any) and rethrows. */
async function run(fn: () => Promise<SeListResponse>, keepOnError: boolean): Promise<void> {
  if (inflight) await inflight.catch(() => {});
  if (state.kind !== "ok") set({ kind: "loading" });
  const p = fn().then(
    (data) => set({ kind: "ok", data }),
    (e: unknown) => {
      if (!(keepOnError && state.kind === "ok")) set(errorState(e));
      throw e;
    },
  );
  inflight = p
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return p;
}

function ensureLoaded(): void {
  if (state.kind === "ok" || state.kind === "loading" || inflight) return;
  void run(api.listSe, false).catch(() => {});
}

export function useSeLibrary(enabled = true) {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (enabled) ensureLoaded();
    return () => {
      listeners.delete(l);
    };
  }, [enabled]);

  const reload = useCallback(() => run(api.listSe, true), []);
  /** POST /api/se/rescan: re-reads the folder (user added files). */
  const rescan = useCallback(() => run(api.rescanSe, true), []);
  /** PUT /api/se/manifest: id -> credit ("" removes it). */
  const saveCredits = useCallback((credits: Record<string, string>) => run(() => api.updateSeManifest({ credits }), true), []);

  return { state, reload, rescan, saveCredits };
}

/** Files of a loaded library, or undefined (loading / error / idle). */
export function seFilesOf(s: SeLibraryState): SeFile[] | undefined {
  return s.kind === "ok" ? s.data.files : undefined;
}

/** audio.se.credits snapshot the project should hold: credits of the files assigned to slots (§6.12). */
export function seCreditSnapshot(project: Project, files: readonly SeFile[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of SE_SLOTS) {
    const id = project.audio.se.slots[slot];
    if (!id) continue;
    const credit = files.find((f) => f.id === id)?.credit?.trim();
    if (credit) out[id] = credit;
  }
  return out;
}

function sameRecord(a: Record<string, string> | undefined, b: Record<string, string>): boolean {
  const ak = Object.keys(a ?? {});
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return bk.every((k) => a?.[k] === b[k]);
}

/**
 * Keeps project.audio.se.credits in sync with the library (§6.12): whenever the list is (re)loaded, the slots
 * change or the manifest is edited, the snapshot is rewritten with the credits of the assigned files.
 * Loads the library only for templates that play SE; never touches the snapshot while the library is unavailable.
 */
export function useSeCreditsSync(project: Project | null, update: UpdateProject, usesSe: boolean) {
  const lib = useSeLibrary(usesSe);
  const files = seFilesOf(lib.state);
  const slotsKey = project ? JSON.stringify(project.audio.se.slots) : "";
  const creditsKey = project ? JSON.stringify(project.audio.se.credits ?? {}) : "";
  useEffect(() => {
    if (!project || !files) return;
    const want = seCreditSnapshot(project, files);
    if (sameRecord(project.audio.se.credits, want)) return;
    update((p) => {
      const next = seCreditSnapshot(p, files);
      if (sameRecord(p.audio.se.credits, next)) return p;
      const { credits: _omit, ...rest } = p.audio.se;
      const se = Object.keys(next).length ? { ...rest, credits: next } : rest;
      return { ...p, audio: { ...p.audio, se } };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, slotsKey, creditsKey, update]);
}
