import fsp from "node:fs/promises";
import path from "node:path";
import type { Express } from "express";
import {
  formatSchema,
  langSchema,
  renderBatchRequestSchema,
  type RenderBatchResponse,
  type RenderFile,
  type RenderListResponse,
} from "@gas/shared";
import { parseBody } from "../errors";
import { projectDir } from "../paths";
import { enqueueRender, listProjectJobs } from "../render";
import { assertSafeId, readProject } from "../store";

/**
 * Batch render + render history (ARCHITECTURE §6.9). Implemented in Phase 3 step 1 (owner afterwards: server).
 *
 *   POST /api/projects/:id/render-batch  { targets: [{ format, lang }], fps? } -> RenderBatchResponse { jobIds }
 *   GET  /api/projects/:id/renders                                           -> RenderListResponse { files, jobs }
 */

const NAME_RE = /^\d{8}-\d{6}_(16x9|9x16)_(ja|en)(?:-\d+)?\.mp4$/;

async function listRenderFiles(projectId: string): Promise<RenderFile[]> {
  const dir = path.join(projectDir(projectId), "renders");
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const out: RenderFile[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".mp4")) continue;
    let st;
    try {
      st = await fsp.stat(path.join(dir, name));
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const file: RenderFile = {
      name,
      path: `renders/${name}`,
      absPath: path.join(dir, name),
      url: `/files/${encodeURIComponent(projectId)}/renders/${encodeURIComponent(name)}`,
      sizeBytes: st.size,
      mtime: st.mtime.toISOString(),
    };
    const m = NAME_RE.exec(name);
    if (m) {
      const f = formatSchema.safeParse(m[1]!.replace("x", ":"));
      const l = langSchema.safeParse(m[2]);
      if (f.success) file.format = f.data;
      if (l.success) file.lang = l.data;
    }
    out.push(file);
  }
  out.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : a.name < b.name ? 1 : -1));
  return out;
}

export function registerRenderRoutes(app: Express): void {
  app.post("/api/projects/:id/render-batch", async (req, res) => {
    const id = assertSafeId(req.params.id);
    const body = parseBody(renderBatchRequestSchema, req.body);
    await readProject(id); // 404 early
    const seen = new Set<string>();
    const jobIds: string[] = [];
    for (const t of body.targets) {
      const key = `${t.format}|${t.lang}`;
      if (seen.has(key)) continue;
      seen.add(key);
      jobIds.push(enqueueRender(id, { format: t.format, lang: t.lang, ...(body.fps ? { fps: body.fps } : {}) }));
    }
    const out: RenderBatchResponse = { jobIds };
    res.json(out);
  });

  app.get("/api/projects/:id/renders", async (req, res) => {
    const id = assertSafeId(req.params.id);
    await readProject(id); // 404
    const out: RenderListResponse = { files: await listRenderFiles(id), jobs: listProjectJobs(id) };
    res.json(out);
  });
}
