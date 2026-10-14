import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  BGM_EXTS,
  BGM_MOODS,
  bgmManifestSchema,
  seFileIdSchema,
  type BgmFile,
  type BgmListResponse,
  type BgmManifest,
  type BgmManifestEntry,
  type BgmManifestUpdateRequest,
  type BgmMood,
} from "@gas/shared";
import { config } from "../config";
import { badRequest } from "../errors";
import { sanitizeSeFileName } from "../se/library";

/**
 * BGM library (ARCHITECTURE §6.14): audio files under config.bgm.dir (default D:\Tools\bgm, outside the repo)
 * plus the manifest "bgm.json" (file id -> { credit, source, url, tags, note }).
 * File id = library-relative path with "/" separators (same rules as SE ids: seFileIdSchema).
 * Modeled on se/library.ts (§6.12).
 */

export const BGM_MANIFEST_FILE = "bgm.json";
const MAX_DEPTH = 6;
const MAX_FILES = 2000;
const MOOD_IDS = BGM_MOODS.map((m) => m.id) as readonly string[];

export function bgmDir(): string {
  return config.bgm.dir;
}

const isBgmExt = (name: string) => (BGM_EXTS as readonly string[]).includes(path.extname(name).toLowerCase());

/** Absolute path of a library file id, strictly inside the library dir (400 on invalid ids / extensions). */
export function resolveBgmFile(id: string): string {
  const parsed = seFileIdSchema.safeParse(id);
  if (!parsed.success) throw badRequest(`Invalid BGM file id: ${JSON.stringify(id)}`);
  const segs = id.split("/");
  if (segs.some((s) => s.includes(":"))) throw badRequest(`Invalid BGM file id: ${JSON.stringify(id)}`);
  if (!isBgmExt(id)) throw badRequest(`Not a BGM audio file: ${JSON.stringify(id)} (allowed: ${BGM_EXTS.join(", ")})`);
  const root = path.resolve(bgmDir());
  const abs = path.resolve(root, ...segs);
  if (!abs.startsWith(root + path.sep)) throw badRequest("Path escapes the BGM library");
  return abs;
}

/* ------------------------------------------------------------------ */
/* Manifest                                                             */
/* ------------------------------------------------------------------ */

const emptyManifest = (): BgmManifest => ({ version: 1, files: {} });

export async function readBgmManifest(): Promise<BgmManifest> {
  let text: string;
  try {
    text = await fsp.readFile(path.join(bgmDir(), BGM_MANIFEST_FILE), "utf8");
  } catch {
    return emptyManifest();
  }
  try {
    const r = bgmManifestSchema.safeParse(JSON.parse(text.replace(/^\uFEFF/, "")));
    if (r.success) return r.data;
    console.warn(`[bgm] ignoring invalid ${BGM_MANIFEST_FILE}: ${r.error.message.slice(0, 200)}`);
  } catch (e) {
    console.warn(`[bgm] ignoring unreadable ${BGM_MANIFEST_FILE}: ${(e as Error).message}`);
  }
  return emptyManifest();
}

let manifestLock: Promise<unknown> = Promise.resolve();

async function writeManifest(m: BgmManifest): Promise<void> {
  await fsp.mkdir(bgmDir(), { recursive: true });
  const file = path.join(bgmDir(), BGM_MANIFEST_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(m, null, 2) + "\n", "utf8");
  await fsp.rename(tmp, file);
}

const TEXT_KEYS = ["credit", "source", "url", "note"] as const;

/** Merges per id and per field ("" / [] removes a field; absent = unchanged). Serialized. */
export function updateBgmManifest(files: BgmManifestUpdateRequest["files"]): Promise<BgmManifest> {
  const run = manifestLock.then(async () => {
    const m = await readBgmManifest();
    for (const [id, patch] of Object.entries(files)) {
      const entry: BgmManifestEntry = { ...(m.files[id] ?? {}) };
      for (const k of TEXT_KEYS) {
        const v = patch[k];
        if (v === undefined) continue;
        const t = v.trim();
        if (t) entry[k] = t;
        else delete entry[k];
      }
      if (patch.tags !== undefined) {
        const tags = MOOD_IDS.filter((t) => patch.tags!.includes(t as BgmMood));
        if (tags.length) entry.tags = tags;
        else delete entry.tags;
      }
      if (Object.keys(entry).length) m.files[id] = entry;
      else delete m.files[id];
    }
    await writeManifest(m);
    return m;
  });
  manifestLock = run.catch(() => {});
  return run;
}

/** Startup / rescan: creates the library dir and an empty bgm.json when missing. Never throws. */
export async function initBgmLibrary(): Promise<void> {
  try {
    await fsp.mkdir(bgmDir(), { recursive: true });
    const file = path.join(bgmDir(), BGM_MANIFEST_FILE);
    if (!fs.existsSync(file)) await writeManifest(emptyManifest());
  } catch (e) {
    console.warn(`[bgm] could not prepare ${bgmDir()}: ${(e as Error).message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Upload (POST /api/bgm/upload)                                        */
/* ------------------------------------------------------------------ */

/** Same sanitizing as SE uploads (§6.12). */
export const sanitizeBgmFileName = sanitizeSeFileName;

/** Writes an upload into the library ROOT; an existing name gets " (2)", " (3)", … Returns the new id. */
export async function saveBgmUpload(fileName: string, data: Buffer): Promise<string> {
  if (!isBgmExt(fileName)) throw badRequest(`Not a BGM audio file: ${JSON.stringify(fileName)} (allowed: ${BGM_EXTS.join(", ")})`);
  const dir = bgmDir();
  await fsp.mkdir(dir, { recursive: true });
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? fileName : `${stem} (${n})${ext}`;
    try {
      await fsp.writeFile(path.join(dir, name), data, { flag: "wx" });
      return name;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw badRequest(`Too many files named ${JSON.stringify(fileName)} in the BGM library`);
}

/* ------------------------------------------------------------------ */
/* Listing                                                              */
/* ------------------------------------------------------------------ */

const durationCache = new Map<string, { key: string; sec: number }>();

export function clearBgmCache(): void {
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
    } else if (e.isFile() && isBgmExt(e.name)) {
      const id = [...rel, e.name].join("/");
      if (seFileIdSchema.safeParse(id).success) out.push({ id, abs });
    }
  }
}

/** Manifest metadata of one id as exposed by the list (trimmed, known tags only). */
export function bgmMetaOf(m: BgmManifest, id: string): Omit<BgmFile, "id" | "name" | "durationSec"> {
  const e = m.files[id] ?? {};
  const out: Omit<BgmFile, "id" | "name" | "durationSec"> = {
    tags: MOOD_IDS.filter((t) => e.tags?.includes(t)) as BgmMood[],
  };
  for (const k of TEXT_KEYS) {
    const v = e[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

/** GET /api/bgm: every BGM_EXTS file of the library (sorted by id) with duration and manifest metadata. */
export async function listBgmLibrary(): Promise<BgmListResponse> {
  const dir = bgmDir();
  const exists = fs.existsSync(dir);
  if (!exists) return { dir, exists, files: [] };
  const found: { id: string; abs: string }[] = [];
  await walk(dir, [], MAX_DEPTH, found);
  const manifest = await readBgmManifest();
  const files: BgmFile[] = [];
  const queue = [...found];
  const workers = Array.from({ length: 4 }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      let stat: fs.Stats;
      try {
        stat = await fsp.stat(f.abs);
      } catch {
        continue;
      }
      files.push({ id: f.id, name: path.basename(f.abs), durationSec: await durationOf(f.abs, stat), ...bgmMetaOf(manifest, f.id) });
    }
  });
  await Promise.all(workers);
  files.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { dir, exists, files };
}
