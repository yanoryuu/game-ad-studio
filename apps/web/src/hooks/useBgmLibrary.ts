import { useCallback, useEffect, useState } from "react";
import type { BgmFile, BgmListResponse, BgmManifestUpdateRequest, BgmLibraryRef, Project } from "@gas/shared";
import { api, ApiError, featureErrorMessage } from "../api";
import type { UpdateProject } from "./useProject";

/** BGM library (GET /api/bgm, ARCHITECTURE §6.14), cached at module level (same pattern as useSeLibrary). */
export type BgmLibraryState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: BgmListResponse }
  | { kind: "error"; message: string; status: number };

let state: BgmLibraryState = { kind: "idle" };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function set(next: BgmLibraryState) {
  state = next;
  notify();
}

function errorState(e: unknown): BgmLibraryState {
  const status = e instanceof ApiError ? e.status : 0;
  return {
    kind: "error",
    status,
    message: status === 404 ? "このサーバーは BGM ライブラリに対応していません(404)" : featureErrorMessage(e, "BGM ライブラリ"),
  };
}

async function run(fn: () => Promise<BgmListResponse>, keepOnError: boolean): Promise<void> {
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
  void run(api.listBgm, false).catch(() => {});
}

export function useBgmLibrary(enabled = true) {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (enabled) ensureLoaded();
    return () => {
      listeners.delete(l);
    };
  }, [enabled]);

  const reload = useCallback(() => run(api.listBgm, true), []);
  const rescan = useCallback(() => run(api.rescanBgm, true), []);
  const saveMeta = useCallback((files: BgmManifestUpdateRequest["files"]) => run(() => api.updateBgmManifest({ files }), true), []);
  const upload = useCallback((file: File) => run(() => api.uploadBgm(file), true), []);

  return { state, reload, rescan, saveMeta, upload };
}

export function bgmFilesOf(s: BgmLibraryState): BgmFile[] | undefined {
  return s.kind === "ok" ? s.data.files : undefined;
}

/** audio.bgm.library snapshot for a library file. */
export function bgmLibraryRef(f: BgmFile): BgmLibraryRef {
  return {
    id: f.id,
    ...(f.credit ? { credit: f.credit } : {}),
    ...(f.source ? { source: f.source } : {}),
    ...(f.url ? { url: f.url } : {}),
  };
}

const sameRef = (a: BgmLibraryRef, b: BgmLibraryRef) => a.id === b.id && a.credit === b.credit && a.source === b.source && a.url === b.url;

/**
 * Keeps audio.bgm.library (credit/source/url) in sync with bgm.json while the library list is loaded
 * (e.g. after the credit of the selected track was edited). Files missing from the library keep their snapshot.
 */
export function useBgmLibrarySync(project: Project, update: UpdateProject, files: BgmFile[] | undefined) {
  const lib = project.audio.bgm?.library;
  const key = lib ? JSON.stringify(lib) : "";
  useEffect(() => {
    if (!lib || !files) return;
    const f = files.find((x) => x.id === lib.id);
    if (!f) return;
    const want = bgmLibraryRef(f);
    if (sameRef(lib, want)) return;
    update((p) => {
      const bgm = p.audio.bgm;
      if (!bgm?.library || bgm.library.id !== want.id || sameRef(bgm.library, want)) return p;
      return { ...p, audio: { ...p.audio, bgm: { ...bgm, library: want } } };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, key, update]);
}
