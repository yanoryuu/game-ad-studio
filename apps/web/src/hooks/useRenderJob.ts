import { useCallback, useEffect, useRef, useState } from "react";
import type { RenderJob, RenderRequest } from "@gas/shared";
import { api, errorMessage } from "../api";

const POLL_MS = 1000;
const MAX_POLL_FAILURES = 30;

/** Starts a render and polls GET /api/render/:jobId every second until done/error. */
export function useRenderJob(projectId: string) {
  const [job, setJob] = useState<RenderJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const timer = useRef<number | null>(null);
  const failures = useRef(0);
  const alive = useRef(true);

  const stopPolling = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const poll = useCallback((jobId: string) => {
    stopPolling();
    timer.current = window.setTimeout(async () => {
      try {
        const j = await api.getRenderJob(jobId);
        if (!alive.current) return;
        failures.current = 0;
        setConnectionLost(false);
        setJob(j);
        if (j.status === "done" || j.status === "error") return;
      } catch (e) {
        if (!alive.current) return;
        failures.current += 1;
        setConnectionLost(true);
        if (failures.current >= MAX_POLL_FAILURES) {
          setError(`進捗を取得できません: ${errorMessage(e)}`);
          return;
        }
      }
      poll(jobId);
    }, POLL_MS);
  }, []);

  const start = useCallback(
    async (req: RenderRequest, before?: () => Promise<void>) => {
      setStarting(true);
      setError(null);
      setConnectionLost(false);
      failures.current = 0;
      try {
        if (before) await before();
        const { jobId } = await api.startRender(projectId, req);
        setJob({ jobId, projectId, format: req.format, lang: req.lang, status: "queued", progress: 0 });
        poll(jobId);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setStarting(false);
      }
    },
    [projectId, poll],
  );

  const reset = useCallback(() => {
    stopPolling();
    setJob(null);
    setError(null);
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopPolling();
    };
  }, []);

  const running = starting || (job !== null && job.status !== "done" && job.status !== "error" && !error);
  return { job, starting, running, error, connectionLost, start, reset };
}
