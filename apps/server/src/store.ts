import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { createDefaultProject, projectSchema, type Project, type ProjectSummary } from "@gas/shared";
import { badRequest, notFound } from "./errors";
import { PROJECTS_DIR, projectDir } from "./paths";

const PROJECT_FILE = "project.json";
export const PROJECT_SUBDIRS = ["proxies", "thumbs", "assets", "renders"] as const;

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
  const parsed = projectSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`project.json of ${id} is invalid: ${parsed.error.message}`);
  }
  return parsed.data;
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

/** Locked read -> mutate -> write. `mutate` may return a new object or modify in place. */
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
