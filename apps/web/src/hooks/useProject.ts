import { useCallback, useEffect, useRef, useState } from "react";
import { sameVoice, type AudioSettings, type Project, type ScriptLine } from "@gas/shared";
import { api, ApiError, errorMessage } from "../api";

export type SaveState = "saved" | "dirty" | "saving" | "error";

const SAVE_DEBOUNCE_MS = 800;
const RETRY_MS = 4000;

/** Fields of a script line written by the server on synthesis. */
const SYNTH_KEYS = ["audioPath", "durationSec", "captions", "status", "error", "credit", "warning"] as const;

/** Server-owned fields of audio.bgm (beat analysis), valid only for the same bgm.path (§6.2). */
const BGM_SERVER_KEYS = ["beats", "bpm", "analysisStatus", "analysisError"] as const;

function mergeBgm(local: AudioSettings, server: AudioSettings): AudioSettings {
  const lb = local.bgm;
  const sb = server.bgm;
  if (!lb || !sb || lb.path !== sb.path) return local;
  const bgm = { ...lb };
  for (const k of BGM_SERVER_KEYS) {
    if (sb[k] === undefined) delete (bgm as Partial<typeof bgm>)[k];
    else (bgm as Record<string, unknown>)[k] = sb[k];
  }
  return { ...local, bgm };
}

/**
 * Merges the server-owned parts of `server` into `local` without touching local edits
 * (mirror of the server's mergeServerOwned, docs/ARCHITECTURE.md §6.2):
 *  - sources: server values (local order kept; locally removed ones stay removed)
 *  - candidates: server list, `adopted` from local when local knows the candidate
 *  - script: local, except synthesis results of `scriptLineIds` whose text/voice/lang still match
 *  - audio.bgm: local, with the beat analysis fields from the server when the path matches
 */
export function mergeServerOwned(
  local: Project,
  server: Project,
  removedSourceIds: ReadonlySet<string>,
  scriptLineIds?: ReadonlySet<string>,
): Project {
  const order = new Map(local.sources.map((s, i) => [s.id, i]));
  const sources = server.sources
    .filter((s) => !removedSourceIds.has(s.id))
    .map((s, i) => ({ s, k: order.get(s.id) ?? local.sources.length + i }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.s);
  const keep = new Set(sources.map((s) => s.id));
  const localAdopted = new Map(local.candidates.map((c) => [c.id, c.adopted]));
  const candidates = server.candidates
    .filter((c) => keep.has(c.sourceId))
    .map((c) => {
      if (!localAdopted.has(c.id)) return c;
      const a = localAdopted.get(c.id);
      const { adopted: _drop, ...rest } = c;
      return a === undefined ? rest : { ...rest, adopted: a };
    });
  let script = local.script;
  if (scriptLineIds && scriptLineIds.size > 0) {
    const byId = new Map(server.script.map((l) => [l.id, l]));
    script = local.script.map((l) => {
      if (!scriptLineIds.has(l.id)) return l;
      const s = byId.get(l.id);
      if (!s || s.text !== l.text || s.lang !== l.lang || !sameVoice(s.voice, l.voice)) return l;
      const next: ScriptLine = { ...l };
      for (const k of SYNTH_KEYS) {
        if (s[k] === undefined) delete (next as Partial<ScriptLine>)[k];
        else (next as Record<string, unknown>)[k] = s[k];
      }
      return next;
    });
  }
  return { ...local, sources, candidates, script, audio: mergeBgm(local.audio, server.audio), updatedAt: server.updatedAt };
}

export type ServerMutationOptions = {
  /** Block auto-save while the request runs (needed when the request ADDS sources: a stale PUT would drop them). */
  pauseSaves?: boolean;
  /** Script lines whose synthesis results should be taken from the response when local edits exist. */
  scriptLineIds?: string[];
};

/**
 * Loads a project and keeps it in local state with debounced auto-save (PUT).
 *
 * Edits are tracked with a local revision counter so a PUT/GET response never
 * clobbers edits made while the request was in flight: in that case only the
 * server-owned fields are merged (mergeServerOwned).
 */
export function useProject(projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);

  const projectRef = useRef<Project | null>(null);
  const revRef = useRef(0);
  const savedRevRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  /** >0 while a server-side mutation that adds sources runs: no PUTs, or a stale PUT would drop the new source. */
  const pausedRef = useRef(0);
  /** Sources deleted locally; never resurrected by a poll before the PUT lands. */
  const removedSourcesRef = useRef(new Set<string>());
  /** Latest server updatedAt seen (ignore older snapshots arriving late). */
  const serverStampRef = useRef("");
  const pollingRef = useRef(false);

  const commit = (next: Project) => {
    projectRef.current = next;
    setProject(next);
  };

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const schedule = useCallback((ms = SAVE_DEBOUNCE_MS) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, ms);
  }, []);

  const noteStamp = (server: Project): boolean => {
    if (serverStampRef.current && server.updatedAt < serverStampRef.current) return false;
    serverStampRef.current = server.updatedAt;
    return true;
  };

  /**
   * Adopt a server snapshot fetched/returned while local revision was `startRev`.
   * No local edits since -> replace wholesale; otherwise merge server-owned fields only.
   */
  const adoptServer = (server: Project, startRev: number, scriptLineIds?: ReadonlySet<string>) => {
    const fresh = noteStamp(server);
    const local = projectRef.current;
    if (!local) return;
    const clean = revRef.current === startRev && savedRevRef.current === startRev && !inflightRef.current;
    if (clean && fresh) {
      const removed = removedSourcesRef.current;
      commit(removed.size ? { ...server, sources: server.sources.filter((s) => !removed.has(s.id)) } : server);
      setSaveState("saved");
      return;
    }
    if (!fresh && !scriptLineIds) return;
    commit(mergeServerOwned(local, server, removedSourcesRef.current, scriptLineIds));
  };

  const flush = useCallback(async (): Promise<void> => {
    clearTimer();
    while (inflightRef.current) await inflightRef.current;
    const p = projectRef.current;
    if (!p || revRef.current === savedRevRef.current || pausedRef.current > 0) return;
    const rev = revRef.current;
    setSaveState("saving");
    const run = (async () => {
      try {
        const server = await api.saveProject(p);
        savedRevRef.current = rev;
        setSaveError(null);
        noteStamp(server);
        // Sources removed in this PUT are gone on the server now.
        for (const id of removedSourcesRef.current) if (!server.sources.some((s) => s.id === id)) removedSourcesRef.current.delete(id);
        if (revRef.current === rev) {
          commit(server);
          setSaveState("saved");
        } else {
          // Newer local edits exist: keep them, merge server-owned fields, save again.
          commit(mergeServerOwned(projectRef.current!, server, removedSourcesRef.current));
          setSaveState("dirty");
          schedule();
        }
      } catch (e) {
        setSaveState("error");
        setSaveError(errorMessage(e));
        schedule(RETRY_MS);
      } finally {
        inflightRef.current = null;
      }
    })();
    inflightRef.current = run;
    await run;
  }, [schedule]);
  flushRef.current = flush;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const p = await api.getProject(projectId);
      revRef.current = 0;
      savedRevRef.current = 0;
      serverStampRef.current = p.updatedAt;
      removedSourcesRef.current.clear();
      commit(p);
      setSaveState("saved");
    } catch (e) {
      setLoadError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Apply a local edit; schedules an auto-save. */
  const update = useCallback(
    (fn: (p: Project) => Project) => {
      const cur = projectRef.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      revRef.current += 1;
      commit(next);
      setSaveState("dirty");
      schedule();
    },
    [schedule],
  );

  /** Delete a source locally (with its clips and candidates); the next PUT removes it on the server. */
  const removeSource = useCallback(
    (sourceId: string) => {
      removedSourcesRef.current.add(sourceId);
      update((p) => ({
        ...p,
        sources: p.sources.filter((s) => s.id !== sourceId),
        clips: p.clips.filter((c) => c.sourceId !== sourceId),
        candidates: p.candidates.filter((c) => c.sourceId !== sourceId),
      }));
    },
    [update],
  );

  /**
   * GET the project and merge server-owned fields (background proxy / analysis progress).
   * Never touches local edits. Overlapping calls are skipped.
   */
  const refreshServerOwned = useCallback(async () => {
    if (pollingRef.current || !projectRef.current) return;
    pollingRef.current = true;
    const startRev = revRef.current;
    try {
      const server = await api.getProject(projectId);
      if (pausedRef.current > 0) return; // a source add is in flight; its own response wins
      if (server.updatedAt === projectRef.current?.updatedAt && revRef.current === savedRevRef.current) return;
      adoptServer(server, startRev);
    } catch {
      /* transient; next poll retries */
    } finally {
      pollingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /**
   * Run a server mutation that returns a full Project (add source, analyze, TTS).
   * Pending edits are flushed first. If the user edits while the request runs,
   * local edits win and only server-owned fields (+ the given script lines' synthesis results) are merged.
   */
  const mutateOnServer = useCallback(
    async (fn: (p: Project) => Promise<Project>, opts: ServerMutationOptions = {}): Promise<Project> => {
      await flush();
      const cur = projectRef.current;
      if (!cur) throw new Error("project not loaded");
      const startRev = revRef.current;
      if (opts.pauseSaves) pausedRef.current += 1;
      let server: Project;
      try {
        server = await fn(cur);
      } finally {
        if (opts.pauseSaves) {
          pausedRef.current -= 1;
          if (pausedRef.current === 0 && revRef.current !== savedRevRef.current) schedule();
        }
      }
      adoptServer(server, startRev, opts.scriptLineIds ? new Set(opts.scriptLineIds) : undefined);
      return projectRef.current!;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flush, schedule],
  );

  // Warn before leaving with unsaved edits; flush on unmount.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (revRef.current !== savedRevRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (revRef.current !== savedRevRef.current) void flushRef.current();
    };
  }, []);

  return {
    project,
    loading,
    loadError,
    reload: load,
    update,
    flush,
    mutateOnServer,
    refreshServerOwned,
    removeSource,
    saveState,
    saveError,
  };
}

export type ProjectStore = ReturnType<typeof useProject>;
export type UpdateProject = ProjectStore["update"];
export type MutateOnServer = ProjectStore["mutateOnServer"];
