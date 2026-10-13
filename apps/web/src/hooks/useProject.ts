import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@gas/shared";
import { api, ApiError, errorMessage } from "../api";

export type SaveState = "saved" | "dirty" | "saving" | "error";

const SAVE_DEBOUNCE_MS = 800;
const RETRY_MS = 4000;

/**
 * Loads a project and keeps it in local state with debounced auto-save (PUT).
 *
 * Edits are tracked with a local revision counter so a PUT response never
 * clobbers edits made while the request was in flight.
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
  /** >0 while a server-side mutation (source add) runs: no PUTs, or a stale PUT would drop the new source. */
  const pausedRef = useRef(0);

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
        if (revRef.current === rev) {
          commit(server);
          setSaveState("saved");
        } else {
          // Newer local edits exist: keep them, adopt server timestamps, save again.
          const cur = projectRef.current!;
          commit({ ...cur, updatedAt: server.updatedAt });
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

  /**
   * Run a server mutation that returns a full Project (e.g. add source).
   * Pending edits are flushed first; if the user edits while the request runs,
   * local edits win and only the newly added sources are merged in.
   */
  const mutateOnServer = useCallback(
    async (fn: (p: Project) => Promise<Project>): Promise<Project> => {
      await flush();
      const cur = projectRef.current;
      if (!cur) throw new Error("project not loaded");
      const startRev = revRef.current;
      pausedRef.current += 1;
      let server: Project;
      try {
        server = await fn(cur);
      } finally {
        pausedRef.current -= 1;
        if (pausedRef.current === 0 && revRef.current !== savedRevRef.current) schedule();
      }
      if (revRef.current === startRev && savedRevRef.current === startRev) {
        commit(server);
        setSaveState("saved");
      } else {
        // Edits were made while the request ran (autosave was paused): re-apply them on
        // top of the server's result by keeping local state + appending the new sources.
        const local = projectRef.current!;
        const known = new Set(local.sources.map((s) => s.id));
        const before = new Set(cur.sources.map((s) => s.id));
        const added = server.sources.filter((s) => !known.has(s.id) && !before.has(s.id));
        revRef.current += 1;
        commit({ ...local, sources: [...local.sources, ...added], updatedAt: server.updatedAt });
        setSaveState("dirty");
        schedule();
      }
      return projectRef.current!;
    },
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

  return { project, loading, loadError, reload: load, update, flush, mutateOnServer, saveState, saveError };
}

export type ProjectStore = ReturnType<typeof useProject>;
export type UpdateProject = ProjectStore["update"];
