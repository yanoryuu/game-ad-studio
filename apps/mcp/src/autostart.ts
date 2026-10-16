import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { HealthResponse } from "@gas/shared";
import { apiGet } from "./api";
import { API_BASE, API_PORT, AUTOSTART_ENABLED, LOG_DIR, REPO_ROOT, log } from "./env";

/**
 * Auto-start of the Game Ad Studio API server (every tool calls ensureServer() first).
 *
 *  1. GET /api/health ok -> nothing to do.
 *  2. Port already LISTENING (server still booting, or start.ps1 / `npm run dev` just started it) -> never spawn
 *     a second instance; only wait for health.
 *  3. Otherwise start it hidden and independent of this process (powershell Start-Process -WindowStyle Hidden ->
 *     bin/start-api-server.mjs, a supervisor that runs the server half of
 *     `npm run dev`: `tsx watch src/index.ts` in apps/server), log to <repo>/.logs/api-server.log, and poll health
 *     for up to ~60 s. A lock file (.logs/api-autostart-<port>.lock, 90 s) keeps two MCP processes (e.g. Claude
 *     Desktop + Claude Code) from spawning at the same time.
 *
 * Consistent with start.ps1: start.ps1 finds 3101 up but 5173 (web) down, treats it as a leftover, stops it and runs
 * `npm run dev` (server + web) cleanly; the MCP server then simply talks to that instance.
 */

export const SERVER_LOG = path.join(LOG_DIR, "api-server.log");
const LOCK = path.join(LOG_DIR, `api-autostart-${API_PORT}.lock`);
const LOCK_STALE_MS = 90_000;
const START_TIMEOUT_MS = 60_000;

export async function isHealthy(): Promise<HealthResponse | null> {
  try {
    return await apiGet<HealthResponse>("/api/health", { timeoutMs: 3000 });
  } catch {
    return null;
  }
}

export function isPortListening(port = API_PORT, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(1500, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

function takeLock(): boolean {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  try {
    const st = fs.statSync(LOCK);
    if (Date.now() - st.mtimeMs < LOCK_STALE_MS) return false;
  } catch {
    /* no lock */
  }
  fs.writeFileSync(LOCK, `${process.pid} ${new Date().toISOString()}\n`);
  return true;
}

function releaseLock() {
  try {
    fs.rmSync(LOCK, { force: true });
  } catch {
    /* ignore */
  }
}

/** PowerShell single-quoted literal containing a double-quoted argument (Start-Process joins ArgumentList with spaces). */
const psArg = (s: string) => `'"${s.replace(/'/g, "''")}"'`;

/**
 * Starts bin/start-api-server.mjs (supervisor of `tsx watch src/index.ts`) through
 * `powershell Start-Process -WindowStyle Hidden` -> own hidden console, not tied to this process (see that file).
 * Resolves with the supervisor's pid.
 */
function spawnServer(): Promise<number | null> {
  const launcher = path.join(REPO_ROOT, "apps", "mcp", "bin", "start-api-server.mjs");
  const args = [launcher, REPO_ROOT, SERVER_LOG];
  if (process.env.GAS_PORT) args.push(String(API_PORT));
  if (process.platform !== "win32") {
    const child = spawn(process.execPath, args, { cwd: REPO_ROOT, detached: true, stdio: "ignore" });
    child.unref();
    return Promise.resolve(child.pid ?? null);
  }
  const ps =
    `$p = Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}' -ArgumentList @(${args.map(psArg).join(",")}) ` +
    `-WorkingDirectory '${REPO_ROOT.replace(/'/g, "''")}' -WindowStyle Hidden -PassThru; Write-Output $p.Id`;
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      cwd: REPO_ROOT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(Number(out.trim()) || null);
      else reject(new Error(`API launcher exited with ${code}: ${err.trim()}`));
    });
  });
}

function logTail(lines = 25): string {
  try {
    const t = fs.readFileSync(SERVER_LOG, "utf8").split(/\r?\n/);
    return t.slice(-lines).join("\n");
  } catch {
    return "(no log)";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type EnsureResult = { started: boolean; pid?: number | null; waitedMs: number };
let pending: Promise<EnsureResult> | null = null;

/** Makes sure the API answers; starts it when needed (see top). Throws an actionable Error otherwise. */
export function ensureServer(): Promise<EnsureResult> {
  pending ??= ensureInner().finally(() => {
    pending = null;
  });
  return pending;
}

async function ensureInner(): Promise<EnsureResult> {
  const t0 = Date.now();
  if (await isHealthy()) return { started: false, waitedMs: 0 };

  let started = false;
  let pid: number | null | undefined;
  if (await isPortListening()) {
    log(`port ${API_PORT} is in use but /api/health did not answer yet; waiting (no second instance)`);
  } else if (!AUTOSTART_ENABLED) {
    throw new Error(
      `Game Ad Studio API is not running at ${API_BASE} and auto-start is disabled (GAS_MCP_NO_AUTOSTART). ` +
        `Start it with start.ps1 or \`npm run dev\` in ${REPO_ROOT}.`,
    );
  } else if (takeLock()) {
    log(`API down -> starting it (log: ${SERVER_LOG})`);
    try {
      pid = await spawnServer();
      started = true;
      log(`API server process started (pid ${pid ?? "?"}), waiting for health ...`);
    } catch (e) {
      releaseLock();
      throw new Error(`Could not start the Game Ad Studio API server: ${(e as Error).message}`);
    }
  } else {
    log("another process is already starting the API server; waiting");
  }

  try {
    while (Date.now() - t0 < START_TIMEOUT_MS) {
      await sleep(750);
      if (await isHealthy()) {
        log(`API healthy after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        return { started, pid, waitedMs: Date.now() - t0 };
      }
    }
  } finally {
    if (started) releaseLock();
  }
  throw new Error(
    `Game Ad Studio API did not become healthy at ${API_BASE} within ${START_TIMEOUT_MS / 1000} s. ` +
      `Check ${SERVER_LOG} or start it manually (start.ps1 / \`npm run dev\` in ${REPO_ROOT}).\n--- log tail ---\n${logTail()}`,
  );
}
