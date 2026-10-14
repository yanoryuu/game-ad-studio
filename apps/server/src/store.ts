import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { createDefaultProject, migrateProject, projectSchema, type Project, type ProjectSummary } from "@gas/shared";
import { badRequest, notFound } from "./errors";
import { PROJECTS_DIR, projectDir } from "./paths";

const PROJECT_FILE = "project.json";
export const PROJECT_SUBDIRS = ["proxies", "thumbs", "assets", "renders", "tts"] as const;

const ID_RE = /^[A-Za-z0-9_-]+$/;

/** Validates an id coming from a URL before it is used as a path segment. */
export function assertSafeId(id: string, what = "project id"): string {
  if (!ID_RE.test(id) || id.length > 64) throw badRequest(`Invalid ${what}: ${JSON.stringify(id)}`);
  return id;
}

function projectFile(id: string): string {
  return path.join(projectDir(id), PROJECT_FILE);
}

/* ------------------------------------------------------------------ */
/* Per-project mutex: serializes read-modify-write cycles in-process.  */
/* ------------------------------------------------------------------ */

const locks = new Map<string, Promise<unknown>>();

export function withProjectLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(id, tail);
  void tail.then(() => {
    if (locks.get(id) === tail) locks.delete(id);
  });
  return run;
}

/* ------------------------------------------------------------------ */
/* Read / write                                                         */
/* ------------------------------------------------------------------ */

export async function projectExists(id: string): Promise<boolean> {
  assertSafeId(id);
  try {
    return (await fs.stat(projectFile(id))).isFile();
  } catch {
    return false;
  }
}

export async function readProject(id: string): Promise<Project> {
  assertSafeId(id);
  let raw: string;
  try {
    raw = await fs.readFile(projectFile(id), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw notFound(`Project not found: ${id}`);
    throw e;
  }
  try {
    // v1 -> v2 upgrade happens here (in memory; persisted by the next write).
    return migrateProject(JSON.parse(raw));
  } catch (e) {
    throw new Error(`project.json of ${id} is invalid: ${(e as Error).message}`);
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  // Windows: rename over a file that is momentarily open (AV scanner, another reader) can fail with EPERM/EBUSY.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt < 8 && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

/** Validates, stamps updatedAt and writes atomically (temp file + rename). Returns the saved project. */
export async function writeProject(project: Project): Promise<Project> {
  const toSave = projectSchema.parse({ ...project, updatedAt: new Date().toISOString() });
  const dir = projectDir(assertSafeId(toSave.id));
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${PROJECT_FILE}.${nanoid(6)}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(toSave, null, 2) + "\n", "utf8");
  try {
    await renameWithRetry(tmp, projectFile(toSave.id));
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
  return toSave;
}

/**
 * THE helper for route modules: locked read (migrated) -> mutate -> validate + write. Returns the saved project.
 * `mutate` may modify in place or return a new object. Throwing inside `mutate` aborts without writing.
 * Never hold the lock during long work (ffmpeg, TTS): do the work outside, then call updateProject to store results.
 */
export function updateProject(id: string, mutate: (p: Project) => Project | void | Promise<Project | void>): Promise<Project> {
  return withProjectLock(id, async () => {
    const current = await readProject(id);
    const next = (await mutate(current)) ?? current;
    return writeProject(next);
  });
}

export async function createProject(name: string): Promise<Project> {
  let id = `p_${nanoid(10)}`;
  while (await projectExists(id)) id = `p_${nanoid(10)}`;
  const project = createDefaultProject(name, { id });
  const dir = projectDir(id);
  for (const sub of PROJECT_SUBDIRS) await fs.mkdir(path.join(dir, sub), { recursive: true });
  return withProjectLock(id, () => writeProject(project));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(PROJECTS_DIR);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out: ProjectSummary[] = [];
  for (const name of entries) {
    if (!ID_RE.test(name)) continue;
    try {
      const p = await readProject(name);
      const summary: ProjectSummary = {
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        template: p.template,
      };
      if (p.sources[0]) summary.thumbPath = p.sources[0].thumbPath;
      out.push(summary);
    } catch (e) {
      if ((e as { status?: number }).status !== 404) {
        console.warn(`[server] skipping project dir "${name}": ${(e as Error).message}`);
      }
    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}

/* ------------------------------------------------------------------ */
/* PUT merge: server-owned fields always come from the stored copy      */
/* ------------------------------------------------------------------ */

const sameVoice = (a: Project["script"][number]["voice"], b: Project["script"][number]["voice"]) =>
  a.engine === b.engine && a.speaker === b.speaker && a.speed === b.speed;

/**
 * Applied by PUT /api/projects/:id so a debounced web save built from an older snapshot cannot
 * clobber results written by background jobs:
 *  - sources: the web may only delete / reorder. Sources unknown to the server are dropped; every other
 *    field (paths, metadata, proxyStatus/proxyError, analysisStatus/analysisError) comes from `stored`.
 *  - candidates: list comes from `stored` (only those whose source still exists); `adopted` comes from the body.
 *  - script: the body wins, except a line whose text+voice equal the stored line while the stored one has
 *    status "ok" and the body's doesn't -> the stored synthesis result (audioPath, durationSec, captions,
 *    status, error, credit) is kept.
 */
export function mergeServerOwned(stored: Project, body: Project): Project {
  const storedSources = new Map(stored.sources.map((s) => [s.id, s]));
  const sources = body.sources.flatMap((s) => {
    const st = storedSources.get(s.id);
    return st ? [st] : [];
  });
  const keep = new Set(sources.map((s) => s.id));
  const adopted = new Map(body.candidates.map((c) => [c.id, c.adopted]));
  const candidates = stored.candidates
    .filter((c) => keep.has(c.sourceId))
    .map((c) => {
      const a = adopted.has(c.id) ? adopted.get(c.id) : c.adopted;
      const { adopted: _drop, ...rest } = c;
      return a === undefined ? rest : { ...rest, adopted: a };
    });
  const storedLines = new Map(stored.script.map((l) => [l.id, l]));
  const script = body.script.map((l) => {
    const st = storedLines.get(l.id);
    if (!st || st.status !== "ok" || l.status === "ok") return l;
    if (st.text !== l.text || st.lang !== l.lang || !sameVoice(st.voice, l.voice)) return l;
    const { audioPath: _a, durationSec: _d, error: _e, credit: _c, ...base } = l;
    return {
      ...base,
      captions: st.captions,
      status: st.status,
      ...(st.audioPath ? { audioPath: st.audioPath } : {}),
      ...(st.durationSec ? { durationSec: st.durationSec } : {}),
      ...(st.credit ? { credit: st.credit } : {}),
    };
  });
  return { ...body, sources, candidates, script };
}
