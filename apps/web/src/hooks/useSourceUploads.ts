import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@gas/shared";
import { api, errorMessage } from "../api";
import { droppedKind } from "./useFileDrop";
import type { MutateOnServer } from "./useProject";

/** One file being uploaded as a source (POST /sources/upload). */
export type SourceUpload = {
  key: string;
  name: string;
  kind: "video" | "image";
  loaded: number;
  total: number;
  /** "registering": bytes sent, waiting for the server to probe / register */
  status: "queued" | "uploading" | "registering" | "error";
  error?: string;
};

/** Parallel uploads (local server: the disk is the limit, not the network). */
const MAX_PARALLEL = 2;
let seq = 0;

/**
 * Upload queue for source files (sources panel + whole-editor drop). Each upload runs through
 * mutateOnServer with pauseSaves: a PUT racing the registration would drop the new source (§6.2).
 * Finished uploads disappear from the list; failed ones stay until dismissed.
 */
export function useSourceUploads(mutateOnServer: MutateOnServer, onAdded: (sourceId: string) => void) {
  const [items, setItems] = useState<SourceUpload[]>([]);
  const queue = useRef<{ key: string; file: File }[]>([]);
  const active = useRef(0);
  const aborts = useRef(new Map<string, AbortController>());
  const onAddedRef = useRef(onAdded);
  onAddedRef.current = onAdded;
  const mutateRef = useRef(mutateOnServer);
  mutateRef.current = mutateOnServer;

  const patch = (key: string, p: Partial<SourceUpload>) =>
    setItems((list) => list.map((u) => (u.key === key ? { ...u, ...p } : u)));

  const pump = useCallback(() => {
    while (active.current < MAX_PARALLEL && queue.current.length) {
      const job = queue.current.shift()!;
      active.current += 1;
      const ac = new AbortController();
      aborts.current.set(job.key, ac);
      void (async () => {
        patch(job.key, { status: "uploading" });
        const before = new Set<string>();
        try {
          const next = await mutateRef.current(
            (p: Project) => {
              for (const s of p.sources) before.add(s.id);
              return api.uploadSource(
                p.id,
                job.file,
                (loaded, total) => patch(job.key, { loaded, total, status: loaded >= total ? "registering" : "uploading" }),
                ac.signal,
              );
            },
            { pauseSaves: true },
          );
          setItems((list) => list.filter((u) => u.key !== job.key));
          const fresh = next.sources.filter((s) => !before.has(s.id));
          const added = fresh.find((s) => s.name === job.file.name) ?? fresh[fresh.length - 1];
          if (added) onAddedRef.current(added.id);
        } catch (e) {
          if ((e as Error).name === "AbortError") setItems((list) => list.filter((u) => u.key !== job.key));
          else patch(job.key, { status: "error", error: errorMessage(e) });
        } finally {
          aborts.current.delete(job.key);
          active.current -= 1;
          pump();
        }
      })();
    }
  }, []);

  /** Queue video / image files (other types are ignored; callers filter and report them). */
  const add = useCallback(
    (files: File[]) => {
      const ok = files.filter((f) => {
        const k = droppedKind(f.name);
        return k === "video" || k === "image";
      });
      if (!ok.length) return;
      const jobs = ok.map((file) => ({ key: `up${++seq}`, file }));
      setItems((list) => [
        ...list,
        ...jobs.map(
          (j): SourceUpload => ({
            key: j.key,
            name: j.file.name,
            kind: droppedKind(j.file.name) === "image" ? "image" : "video",
            loaded: 0,
            total: j.file.size,
            status: "queued",
          }),
        ),
      ]);
      queue.current.push(...jobs);
      pump();
    },
    [pump],
  );

  /** Remove a failed entry, or cancel a queued / running upload. */
  const dismiss = useCallback((key: string) => {
    queue.current = queue.current.filter((j) => j.key !== key);
    aborts.current.get(key)?.abort();
    setItems((list) => list.filter((u) => u.key !== key));
  }, []);

  // Leaving the editor cancels running uploads.
  useEffect(() => {
    const map = aborts.current;
    return () => {
      queue.current = [];
      for (const ac of map.values()) ac.abort();
    };
  }, []);

  return { items, add, dismiss };
}

export type SourceUploads = ReturnType<typeof useSourceUploads>;
