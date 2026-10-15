import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Express } from "express";
import { nanoid } from "nanoid";
import {
  bgmFromLibraryRequestSchema,
  DEFAULT_BGM,
  type Bgm,
  type BgmAnalyzeStartResponse,
  type BgmCarveStartResponse,
  type BgmFromLibraryResponse,
  type BgmLibraryRef,
} from "@gas/shared";
import { analyzeBeats } from "../beats";
import { bgmMetaOf, readBgmManifest, resolveBgmFile } from "../bgm/library";
import { makeVoiceCarve, voiceCarvePathFor } from "../bgm/voiceCarve";
import { HttpError, notFound, parseBody } from "../errors";
import { projectDir } from "../paths";
import { assertSafeId, projectExists, updateProject } from "../store";

/**
 * BGM routes (owner: server agent; beat detection in src/beats/**). Contract: ARCHITECTURE §6.11.
 *
 *   POST /api/projects/:id/bgm/analyze -> 202 Project (audio.bgm.analysisStatus "running"), runs in background
 *   POST /api/projects/:id/bgm/from-library { id } -> Project: copies a BGM library track (§6.14) into assets/,
 *        sets audio.bgm (+ library snapshot) and starts the beat analysis like /bgm/analyze and the voice carve
 *   POST /api/projects/:id/bgm/carve -> 202 Project (audio.bgm.voiceCarveStatus "running"): generates the
 *        voice-carved copy (§5.3.1, bgm/voiceCarve.ts) in the background and sets audio.bgm.voiceCarvePath
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

const carving = new Set<string>();

/** Voice-band ducking (§5.3.1): writes assets/<name>-vcarve.flac next to the BGM, then stores voiceCarvePath. */
async function runCarveJob(projectId: string, bgmPath: string): Promise<void> {
  const key = `${projectId}|${bgmPath}`;
  carving.add(key);
  try {
    const outPath = voiceCarvePathFor(bgmPath);
    let error: string | null = null;
    try {
      const t0 = Date.now();
      const dir = projectDir(projectId);
      await makeVoiceCarve(path.join(dir, ...bgmPath.split("/")), path.join(dir, ...outPath.split("/")));
      console.log(`[bgm] ${projectId} ${bgmPath}: voice carve -> ${outPath} in ${Date.now() - t0} ms`);
    } catch (e) {
      error = ((e as Error).message || String(e)).slice(0, 1000);
      console.warn(`[bgm] ${projectId} ${bgmPath}: voice carve failed: ${error}`);
    }
    await updateProject(projectId, (p) => {
      const bgm = p.audio.bgm;
      if (!bgm || bgm.path !== bgmPath) return; // BGM removed / replaced meanwhile -> discard
      delete bgm.voiceCarveError;
      if (error === null) {
        bgm.voiceCarvePath = outPath;
        bgm.voiceCarveStatus = "done";
      } else {
        delete bgm.voiceCarvePath;
        bgm.voiceCarveStatus = "error";
        bgm.voiceCarveError = error;
      }
    }).catch((e) => console.warn(`[bgm] ${projectId}: could not store voice carve: ${(e as Error).message}`));
  } finally {
    carving.delete(key);
  }
}

export function registerBgmRoutes(app: Express): void {
  app.post("/api/projects/:id/bgm/carve", async (req, res) => {
    const id = assertSafeId(String(req.params.id));
    if (!(await projectExists(id))) throw notFound(`Project not found: ${id}`);
    let bgmPath = "";
    const project = await updateProject(id, (p) => {
      const bgm = p.audio.bgm;
      if (!bgm) throw new HttpError(409, "The project has no BGM");
      if (carving.has(`${id}|${bgm.path}`)) throw new HttpError(409, "The BGM is already being carved");
      bgmPath = bgm.path;
      bgm.voiceCarveStatus = "running";
      delete bgm.voiceCarveError;
    });
    void runCarveJob(id, bgmPath);
    const body: BgmCarveStartResponse = project;
    res.status(202).json(body);
  });

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

  app.post("/api/projects/:id/bgm/from-library", async (req, res) => {
    const id = assertSafeId(String(req.params.id));
    const { id: fileId } = parseBody(bgmFromLibraryRequestSchema, req.body);
    if (!(await projectExists(id))) throw notFound(`Project not found: ${id}`);
    const src = resolveBgmFile(fileId);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) throw notFound(`BGM library file not found: ${fileId}`);
    const meta = bgmMetaOf(await readBgmManifest(), fileId);
    const library: BgmLibraryRef = {
      id: fileId,
      ...(meta.credit ? { credit: meta.credit } : {}),
      ...(meta.source ? { source: meta.source } : {}),
      ...(meta.url ? { url: meta.url } : {}),
    };
    // Copy (never reference) so the project / renders stay self-contained.
    const assetsDir = path.join(projectDir(id), "assets");
    await fsp.mkdir(assetsDir, { recursive: true });
    const name = `${nanoid(10)}${path.extname(src).toLowerCase()}`;
    await fsp.copyFile(src, path.join(assetsDir, name));
    const bgmPath = `assets/${name}`;
    const project = await updateProject(id, (p) => {
      const prev = p.audio.bgm;
      const bgm: Bgm = {
        ...DEFAULT_BGM,
        ...(prev ? { volume: prev.volume, duckingDb: prev.duckingDb, fadeOutSec: prev.fadeOutSec, loop: prev.loop } : {}),
        ...(prev?.duckMode ? { duckMode: prev.duckMode } : {}),
        path: bgmPath,
        analysisStatus: "running",
        voiceCarveStatus: "running",
        library,
      };
      p.audio = { ...p.audio, bgm };
    });
    console.log(`[bgm] ${id}: library "${fileId}" -> ${bgmPath}`);
    void runBeatJob(id, bgmPath);
    void runCarveJob(id, bgmPath);
    const body: BgmFromLibraryResponse = project;
    res.json(body);
  });
}
