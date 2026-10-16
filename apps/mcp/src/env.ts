import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_PORT } from "@gas/shared";

const here = path.dirname(fileURLToPath(import.meta.url));

/** <repo>/ (this file lives at <repo>/apps/mcp/src/env.ts) */
export const REPO_ROOT = path.resolve(here, "../../..");

/**
 * Port of the Game Ad Studio API. Env GAS_PORT (same variable the server uses; handy for a test instance),
 * else 3101. The auto-started server gets the same GAS_PORT.
 */
export const API_PORT: number = (() => {
  const n = Number(process.env.GAS_PORT);
  return process.env.GAS_PORT && Number.isInteger(n) && n > 0 && n < 65536 ? n : SERVER_PORT;
})();

export const API_BASE = `http://127.0.0.1:${API_PORT}`;

/** Auto-start log dir (gitignored). */
export const LOG_DIR = path.join(REPO_ROOT, ".logs");

/** GAS_MCP_NO_AUTOSTART=1 disables spawning the API server. */
export const AUTOSTART_ENABLED = !/^(1|true|yes)$/i.test(process.env.GAS_MCP_NO_AUTOSTART ?? "");

export const log = (...a: unknown[]) => console.error("[gas-mcp]", ...a);

/** Where the server keeps projects (same rule as apps/server/src/paths.ts: env GAS_PROJECTS_DIR, else <repo>/projects). */
export const PROJECTS_DIR_GUESS = process.env.GAS_PROJECTS_DIR ? path.resolve(process.env.GAS_PROJECTS_DIR) : path.join(REPO_ROOT, "projects");
