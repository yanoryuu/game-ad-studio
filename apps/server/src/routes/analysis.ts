import type { Express } from "express";
import type { AnalyzeStartResponse } from "@gas/shared";
import { runAnalysisJob } from "../analysis";
import { HttpError, notFound } from "../errors";
import { assertSafeId, projectExists, updateProject } from "../store";

/**
 * Highlight analysis routes (implementation in src/analysis/**).
 * Contract: docs/ARCHITECTURE.md §6.5.
 *
 *   POST /api/projects/:id/sources/:sourceId/analyze -> 202 Project (analysisStatus "running"), runs in background
 */
export function registerAnalysisRoutes(app: Express): void {
  app.post("/api/projects/:id/sources/:sourceId/analyze", async (req, res) => {
    const id = assertSafeId(String(req.params.id));
    const sourceId = assertSafeId(String(req.params.sourceId), "source id");
    if (!(await projectExists(id))) throw notFound(`Project not found: ${id}`);
    const project = await updateProject(id, (p) => {
      const s = p.sources.find((x) => x.id === sourceId);
      if (!s) throw notFound(`Source not found: ${sourceId}`);
      if (s.kind === "image") throw new HttpError(409, `${sourceId} is a still image; highlight analysis needs a video source`);
      if (s.proxyStatus !== "ready") throw new HttpError(409, `Proxy of ${sourceId} is not ready (${s.proxyStatus})`);
      if (s.analysisStatus === "running") throw new HttpError(409, `Analysis of ${sourceId} is already running`);
      s.analysisStatus = "running";
      delete s.analysisError;
    });
    void runAnalysisJob(id, sourceId);
    const body: AnalyzeStartResponse = project;
    res.status(202).json(body);
  });
}
