import { useCallback, useEffect, useRef, useState } from "react";
import type { Fps, RenderFile, RenderJob, RenderTarget } from "@gas/shared";
import { api, ApiError, errorMessage, featureErrorMessage } from "../api";

const POLL_MS = 1000;
const MAX_POLL_FAILURES = 30;

export type TrackedJob = RenderJob & { connectionLost?: boolean };

const isActive = (j: RenderJob) => j.status !== "done" && j.status !== "error";

/**
 * Batch render (POST /render-batch) + per-job polling (GET /render/:jobId) + history (GET /renders).
 * Jobs still running on the server when the panel mounts (e.g. after a reload) are picked up too.
 */
export function useRenderBatch(projectId: string) {
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const [files, setFiles] = useState<RenderFile[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobsRef = useRef<TrackedJob[]>([]);
  const failures = useRef(new Map<string, number>());
  const alive = useRef(true);

  const commit = (fn: (j: TrackedJob[]) => TrackedJob[]) => {
    jobsRef.current = fn(jobsRef.current);
    setJobs(jobsRef.current);
  };

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const r = await api.listRenders(projectId);
      if (!alive.current) return;
      setFiles(r.files);
      setHistoryError(null);
      // adopt active jobs we don't track yet (server-side queue survives a page reload)
      const known = new Set(jobsRef.current.map((j) => j.jobId));
      const extra = r.jobs.filter((j) => isActive(j) && !known.has(j.jobId)).reverse();
      if (extra.length) commit((cur) => [...cur, ...extra]);
    } catch (e) {
      if (!alive.current) return;
      setHistoryError(featureErrorMessage(e, "書き出し履歴"));
    } finally {
      if (alive.current) setHistoryLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    alive.current = true;
    void refreshHistory();
    return () => {
      alive.current = false;
    };
  }, [refreshHistory]);

  // Poll every active job; refresh the history when one finishes.
  const activeCount = jobs.filter(isActive).length;
  useEffect(() => {
    if (activeCount === 0) return;
    let cancelled = false;
    const t = window.setInterval(async () => {
      const active = jobsRef.current.filter(isActive);
      let finished = false;
      await Promise.all(
        active.map(async (j) => {
          try {
            const n = await api.getRenderJob(j.jobId);
            failures.current.delete(j.jobId);
            if (cancelled) return;
            if (!isActive(n)) finished = true;
            commit((cur) => cur.map((x) => (x.jobId === j.jobId ? { ...n, createdAt: n.createdAt ?? x.createdAt } : x)));
          } catch (e) {
            if (cancelled) return;
            const f = (failures.current.get(j.jobId) ?? 0) + 1;
            failures.current.set(j.jobId, f);
            const gone = e instanceof ApiError && e.status === 404;
            if (gone || f >= MAX_POLL_FAILURES) {
              finished = true;
              commit((cur) =>
                cur.map((x) =>
                  x.jobId === j.jobId
                    ? {
                        ...x,
                        status: "error",
                        error: gone ? "ジョブが見つかりません(サーバーが再起動された可能性があります)" : `進捗を取得できません: ${errorMessage(e)}`,
                      }
                    : x,
                ),
              );
            } else commit((cur) => cur.map((x) => (x.jobId === j.jobId ? { ...x, connectionLost: true } : x)));
          }
        }),
      );
      if (finished && !cancelled) void refreshHistory();
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [activeCount, refreshHistory]);

  const start = useCallback(
    async (targets: RenderTarget[], fps: Fps, before?: () => Promise<void>) => {
      setStarting(true);
      setError(null);
      try {
        if (before) await before();
        const { jobIds } = await api.renderBatch(projectId, { targets, fps });
        const now = new Date().toISOString();
        // keep finished rows of earlier batches below the new ones
        commit((cur) => [
          ...jobIds.map((jobId, i) => ({
            jobId,
            projectId,
            format: targets[i]!.format,
            lang: targets[i]!.lang,
            status: "queued" as const,
            progress: 0,
            createdAt: now,
          })),
          ...cur.filter((j) => !jobIds.includes(j.jobId)),
        ]);
      } catch (e) {
        setError(featureErrorMessage(e, "一括書き出し"));
      } finally {
        setStarting(false);
      }
    },
    [projectId],
  );

  const clearFinished = useCallback(() => commit((cur) => cur.filter(isActive)), []);

  const running = starting || activeCount > 0;
  return { jobs, files, historyError, historyLoading, refreshHistory, starting, running, error, start, clearFinished };
}
