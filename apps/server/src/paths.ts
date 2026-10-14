import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_PORT } from "@gas/shared";

const here = path.dirname(fileURLToPath(import.meta.url));

/** <repo>/ (this file lives at <repo>/apps/server/src/paths.ts) */
export const REPO_ROOT = path.resolve(here, "../../..");

/**
 * Port the server listens on (also the asset base URL host used by renders): env GAS_PORT, else PORT,
 * else SERVER_PORT (3101). The web dev proxy always targets 3101; overrides are for test instances.
 */
export const LISTEN_PORT: number = (() => {
  for (const v of [process.env.GAS_PORT, process.env.PORT]) {
    const n = Number(v);
    if (v && Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  return SERVER_PORT;
})();

/** <repo>/projects — override with env GAS_PROJECTS_DIR */
export const PROJECTS_DIR = process.env.GAS_PROJECTS_DIR
  ? path.resolve(process.env.GAS_PROJECTS_DIR)
  : path.join(REPO_ROOT, "projects");

/** Remotion entry bundled by @remotion/bundler */
export const COMPOSITIONS_ENTRY = path.join(REPO_ROOT, "packages/compositions/src/entry.ts");

export function projectDir(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId);
}

/**
 * Headless Chrome already downloaded into <repo>/node_modules/.remotion.
 * Passed explicitly as `browserExecutable` because Remotion otherwise looks for
 * `.remotion` next to the nearest package.json of process.cwd() — which is
 * apps/server when started via `npm run dev -w @gas/server` — and would re-download.
 * Override with env GAS_BROWSER_EXECUTABLE.
 */
export const BROWSER_EXECUTABLE = process.env.GAS_BROWSER_EXECUTABLE
  ? path.resolve(process.env.GAS_BROWSER_EXECUTABLE)
  : path.join(
      REPO_ROOT,
      "node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe",
    );

/** Source dirs whose changes invalidate the cached Remotion bundle. */
export const BUNDLE_WATCH_DIRS = [
  path.join(REPO_ROOT, "packages/compositions/src"),
  path.join(REPO_ROOT, "packages/shared/src"),
];
