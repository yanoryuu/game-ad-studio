import { useCallback, useEffect, useRef, useState } from "react";
import type { HealthResponse } from "@gas/shared";
import { api } from "../api";

export type HealthStatus = "checking" | "ok" | "down";

/** Polls GET /api/health — quickly while the server is down, slowly once up. */
export function useHealth() {
  const [status, setStatus] = useState<HealthStatus>("checking");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const timer = useRef<number | null>(null);

  const check = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    let next: HealthStatus;
    try {
      const h = await api.health();
      setHealth(h);
      next = "ok";
    } catch {
      setHealth(null);
      next = "down";
    }
    setStatus(next);
    timer.current = window.setTimeout(() => void check(), next === "ok" ? 30000 : 3000);
  }, []);

  useEffect(() => {
    void check();
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [check]);

  return { status, health, recheck: check };
}
