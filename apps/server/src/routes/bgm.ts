import path from "node:path";
import type { Express } from "express";
import type { BgmAnalyzeStartResponse } from "@gas/shared";
import { analyzeBeats } from "../beats";
import { HttpError, notFound } from "../errors";
import { projectDir } from "../paths";
import { assertSafeId, projectExists, updateProject } from "../store";

/**
 * BGM routes (owner: server agent; beat detection in src/beats/**). Contract: ARCHITECTURE §6.11.
 *
 *   POST /api/projects/:id/bgm/analyze -> 202 Project (audio.bgm.analysisStatus "running"), runs in background
 */

const running = new Set<string>();

async function runBeatJob(projectId: string, bgmPath: string): Promise<void> {
  const key = `${projectId}|${bgmPath}`;
  running.add(key);
  try {
    let result: { beats: number[]; bpm: number } | null = null;
    let error: string | null = null;
    try {
      const t0 = Date.now();
      result = await analyzeBeats(path.join(projectDir(projectId), ...bgmPath.split("/")));
      console.log(`[bgm] ${projectId} ${bgmPath}: ${result.beats.length} beats, ${result.bpm.toFixed(1)} bpm in ${Date.now() - t0} ms`);
    } catch (e) {
      error = ((e as Error).message || String(e)).slice(0, 1000);
      console.warn(`[bgm] ${projectId} ${bgmPath}: beat analysis failed: ${error}`);
    }
    await updateProject(projectId, (p) => {
      const bgm = p.audio.bgm;
      if (!bgm || bgm.path !== bgmPath) return; // BGM removed / replaced meanwhile -> discard
      delete bgm.analysisError;
      if (result) {
        bgm.beats = result.beats;
        bgm.bpm = result.bpm;
        bgm.analysisStatus = "done";
      } else {
        bgm.analysisStatus = "error";
        bgm.analysisError = error ?? "Beat analysis failed";
      }
    }).catch((e) => console.warn(`[bgm] ${projectId}: could not store beat analysis: ${(e as Error).message}`));
  } finally {
    running.delete(key);
  }
}

export function registerBgmRoutes(app: Express): void {
  app.post("/api/projects/:id/bgm/analyze", async (req, res) => {
    const id = assertSafeId(String(req.params.id));
    if (!(await projectExists(id))) throw notFound(`Project not found: ${id}`);
    let bgmPath = "";
    const project = await updateProject(id, (p) => {
      const bgm = p.audio.bgm;
      if (!bgm) throw new HttpError(409, "The project has no BGM");
      if (bgm.analysisStatus === "running" && running.has(`${id}|${bgm.path}`)) {
        throw new HttpError(409, "Beat analysis of the BGM is already running");
      }
      bgmPath = bgm.path;
      bgm.analysisStatus = "running";
      delete bgm.analysisError;
    });
    void runBeatJob(id, bgmPath);
    const body: BgmAnalyzeStartResponse = project;
    res.status(202).json(body);
  });
}
