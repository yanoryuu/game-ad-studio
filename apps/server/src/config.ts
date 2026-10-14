import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_VOICEVOX_URL } from "@gas/shared";
import { REPO_ROOT } from "./paths";

/**
 * Local tool configuration. Reads optional `<repo>/gas.config.json` (git-ignored; see
 * gas.config.example.json). Every key is optional; missing keys fall back to DEFAULT_CONFIG.
 * The file is read once at startup (restart the server after editing it).
 */
export type GasConfig = {
  voicevox: {
    /** VOICEVOX engine base URL */
    url: string;
    /**
     * run.exe to auto-spawn when the engine is not reachable. Absent -> discovered lazily under
     * VOICEVOX_SEARCH_ROOT via resolveVoicevoxEnginePath().
     */
    enginePath?: string;
  };
  piper: {
    /** piper.exe */
    exePath: string;
    /** directory with <voice>.onnx + <voice>.onnx.json */
    voicesDir: string;
  };
  whisper: {
    /** whisper.cpp install dir used with @remotion/install-whisper-cpp (installWhisperCpp({ to: dir })) */
    dir: string;
    /** whisper model name, e.g. "base.en" (downloadWhisperModel({ model, folder: dir })) */
    model: string;
  };
};

export const CONFIG_FILE = path.join(REPO_ROOT, "gas.config.json");
export const VOICEVOX_SEARCH_ROOT = "D:\\Tools\\voicevox";

export const DEFAULT_CONFIG: GasConfig = {
  voicevox: { url: DEFAULT_VOICEVOX_URL },
  piper: { exePath: "D:\\Tools\\piper\\piper.exe", voicesDir: "D:\\Tools\\piper\\voices" },
  whisper: { dir: "D:\\Tools\\whisper", model: "base.en" },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function loadConfig(): GasConfig {
  let user: DeepPartial<GasConfig> = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      user = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as DeepPartial<GasConfig>;
      console.log(`[config] loaded ${CONFIG_FILE}`);
    } catch (e) {
      console.warn(`[config] ignoring invalid ${CONFIG_FILE}: ${(e as Error).message}`);
    }
  }
  const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);
  const cfg: GasConfig = {
    voicevox: { url: str(user.voicevox?.url, DEFAULT_CONFIG.voicevox.url).replace(/\/+$/, "") },
    piper: {
      exePath: str(user.piper?.exePath, DEFAULT_CONFIG.piper.exePath),
      voicesDir: str(user.piper?.voicesDir, DEFAULT_CONFIG.piper.voicesDir),
    },
    whisper: {
      dir: str(user.whisper?.dir, DEFAULT_CONFIG.whisper.dir),
      model: str(user.whisper?.model, DEFAULT_CONFIG.whisper.model),
    },
  };
  const enginePath = user.voicevox?.enginePath;
  if (typeof enginePath === "string" && enginePath.trim()) cfg.voicevox.enginePath = enginePath.trim();
  return cfg;
}

/** Effective configuration (frozen). */
export const config: Readonly<GasConfig> = Object.freeze(loadConfig());

let discovered: Promise<string | null> | null = null;

async function findRunExe(dir: string, depth: number): Promise<string | null> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const hit = entries.find((e) => e.isFile() && e.name.toLowerCase() === "run.exe");
  if (hit) return path.join(dir, hit.name);
  if (depth <= 0) return null;
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "engine_internal") continue;
    const r = await findRunExe(path.join(dir, e.name), depth - 1);
    if (r) return r;
  }
  return null;
}

/**
 * VOICEVOX engine executable: config.voicevox.enginePath if set (and existing), otherwise the
 * first `run.exe` found under D:\Tools\voicevox (max depth 3, cached). null if none.
 * Expected default: D:\Tools\voicevox\windows-cpu\run.exe (start with `--host 127.0.0.1 --port 50021`).
 */
export function resolveVoicevoxEnginePath(): Promise<string | null> {
  if (config.voicevox.enginePath) {
    return Promise.resolve(fs.existsSync(config.voicevox.enginePath) ? config.voicevox.enginePath : null);
  }
  discovered ??= findRunExe(VOICEVOX_SEARCH_ROOT, 3).then((r) => {
    if (!r) discovered = null; // retry next time (may be installed later)
    return r;
  });
  return discovered;
}
