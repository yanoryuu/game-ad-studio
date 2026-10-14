import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  SE_EXTS,
  seFileIdSchema,
  seManifestSchema,
  type SeFile,
  type SeListResponse,
  type SeManifest,
} from "@gas/shared";
import { config } from "../config";
import { badRequest } from "../errors";

/**
 * SE library (ARCHITECTURE §6.12): audio files under config.se.dir (default D:\Tools\se), including the
 * generated "_placeholder/" sounds, plus the manifest "se.json" (file id -> { credit }).
 * File id = library-relative path with "/" separators (seFileIdSchema).
 */

export const SE_MANIFEST_FILE = "se.json";
const MAX_DEPTH = 6;
const MAX_FILES = 2000;

export function seDir(): string {
  return config.se.dir;
}

const isSeExt = (name: string) => (SE_EXTS as readonly string[]).includes(path.extname(name).toLowerCase());

/** Absolute path of a library file id, strictly inside the library dir (400 on invalid ids / extensions). */
export function resolveSeFile(id: string): string {
  const parsed = seFileIdSchema.safeParse(id);
  if (!parsed.success) throw badRequest(`Invalid SE file id: ${JSON.stringify(id)}`);
  const segs = id.split("/");
  if (segs.some((s) => s.includes(":"))) throw badRequest(`Invalid SE file id: ${JSON.stringify(id)}`);
  if (!isSeExt(id)) throw badRequest(`Not an SE audio file: ${JSON.stringify(id)} (allowed: ${SE_EXTS.join(", ")})`);
  const root = path.resolve(seDir());
  const abs = path.resolve(root, ...segs);
  if (!abs.startsWith(root + path.sep)) throw badRequest("Path escapes the SE library");
  return abs;
}

/** true if the id is valid and the file exists (used by render to drop slots with missing files). */
export function seFileExists(id: string): boolean {
  try {
    return fs.statSync(resolveSeFile(id)).isFile();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Manifest                                                             */
/* ------------------------------------------------------------------ */

const emptyManifest = (): SeManifest => ({ version: 1, files: {} });

export async function readManifest(): Promise<SeManifest> {
  let text: string;
  try {
    text = await fsp.readFile(path.join(seDir(), SE_MANIFEST_FILE), "utf8");
  } catch {
    return emptyManifest();
  }
  try {
    const r = seManifestSchema.safeParse(JSON.parse(text.replace(/^\uFEFF/, "")));
    if (r.success) return r.data;
    console.warn(`[se] ignoring invalid ${SE_MANIFEST_FILE}: ${r.error.message.slice(0, 200)}`);
  } catch (e) {
    console.warn(`[se] ignoring unreadable ${SE_MANIFEST_FILE}: ${(e as Error).message}`);
  }
  return emptyManifest();
}

let manifestLock: Promise<unknown> = Promise.resolve();

async function writeManifest(m: SeManifest): Promise<void> {
  await fsp.mkdir(seDir(), { recursive: true });
  const file = path.join(seDir(), SE_MANIFEST_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(m, null, 2) + "\n", "utf8");
  await fsp.rename(tmp, file);
}

/** Merges credits (id -> text; "" or whitespace removes the credit). Serialized. */
export function updateManifestCredits(credits: Record<string, string>): Promise<SeManifest> {
  const run = manifestLock.then(async () => {
    const m = await readManifest();
    for (const [id, credit] of Object.entries(credits)) {
      const c = credit.trim();
      const entry = { ...(m.files[id] ?? {}) };
      if (c) entry.credit = c;
      else delete entry.credit;
      if (Object.keys(entry).length) m.files[id] = entry;
      else delete m.files[id];
    }
    await writeManifest(m);
    return m;
  });
  manifestLock = run.catch(() => {});
  return run;
}

/** Creates an empty se.json if the library has none (startup). Never throws. */
export async function ensureManifest(): Promise<void> {
  const file = path.join(seDir(), SE_MANIFEST_FILE);
  if (fs.existsSync(file)) return;
  try {
    await writeManifest(emptyManifest());
  } catch (e) {
    console.warn(`[se] could not create ${file}: ${(e as Error).message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Upload (POST /api/se/upload)                                         */
/* ------------------------------------------------------------------ */

/**
 * File name for an uploaded SE: the original base name with characters Windows / seFileIdSchema reject removed
 * (\ / : * ? " < > |, control chars, leading dots, trailing dots/spaces), at most 120 chars before the extension.
 */
export function sanitizeSeFileName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? "";
  const ext = path.extname(base).toLowerCase();
  let stem = base
    .slice(0, base.length - path.extname(base).length)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .slice(0, 120);
  if (!stem || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem)) stem = `se_${stem || "upload"}`;
  return `${stem}${ext}`;
}

/**
 * Writes an uploaded SE into the library ROOT under `fileName` (already sanitized, SE_EXTS);
 * an existing name gets " (2)", " (3)", … Returns the new file id (= the stored name).
 */
export async function saveSeUpload(fileName: string, data: Buffer): Promise<string> {
  if (!isSeExt(fileName)) throw badRequest(`Not an SE audio file: ${JSON.stringify(fileName)} (allowed: ${SE_EXTS.join(", ")})`);
  const dir = seDir();
  await fsp.mkdir(dir, { recursive: true });
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? fileName : `${stem} (${n})${ext}`;
    try {
      // "wx": fails if the name exists -> no race between two uploads of the same name
      await fsp.writeFile(path.join(dir, name), data, { flag: "wx" });
      return name;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw badRequest(`Too many files named ${JSON.stringify(fileName)} in the SE library`);
}

/* ------------------------------------------------------------------ */
/* Listing                                                              */
/* ------------------------------------------------------------------ */

const durationCache = new Map<string, { key: string; sec: number }>();

export function clearSeCache(): void {
  durationCache.clear();
}

function ffprobeDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.on("error", () => resolve(0));
    child.on("close", () => {
      const n = Number(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : 0);
    });
  });
}

async function durationOf(abs: string, stat: fs.Stats): Promise<number> {
  const key = `${stat.size}|${stat.mtimeMs}`;
  const c = durationCache.get(abs);
  if (c && c.key === key) return c.sec;
  const sec = await ffprobeDuration(abs);
  durationCache.set(abs, { key, sec });
  return sec;
}

async function walk(dir: string, rel: string[], depth: number, out: { id: string; abs: string }[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    if (e.name.startsWith(".") || e.name.includes(":")) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 0) await walk(abs, [...rel, e.name], depth - 1, out);
    } else if (e.isFile() && isSeExt(e.name)) {
      const id = [...rel, e.name].join("/");
      if (seFileIdSchema.safeParse(id).success) out.push({ id, abs });
    }
  }
}

/** GET /api/se: every SE file of the library (sorted by id) with duration and credit. */
export async function listSeLibrary(): Promise<SeListResponse> {
  const dir = seDir();
  const exists = fs.existsSync(dir);
  if (!exists) return { dir, exists, files: [] };
  const found: { id: string; abs: string }[] = [];
  await walk(dir, [], MAX_DEPTH, found);
  found.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const manifest = await readManifest();
  const files: SeFile[] = [];
  // probe a few at a time
  const queue = [...found];
  const workers = Array.from({ length: 4 }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      let stat: fs.Stats;
      try {
        stat = await fsp.stat(f.abs);
      } catch {
        continue;
      }
      const credit = manifest.files[f.id]?.credit?.trim();
      files.push({ id: f.id, name: path.basename(f.abs), durationSec: await durationOf(f.abs, stat), ...(credit ? { credit } : {}) });
    }
  });
  await Promise.all(workers);
  files.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { dir, exists, files };
}
