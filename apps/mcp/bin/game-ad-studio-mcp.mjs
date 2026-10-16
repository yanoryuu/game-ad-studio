#!/usr/bin/env node
// Game Ad Studio MCP server launcher (stdio).
// Claude Desktop / Claude Code start this file with an absolute node.exe path, from any working directory:
//   node D:\Tools\game-ad-studio\apps\mcp\bin\game-ad-studio-mcp.mjs
// stdout is reserved for the MCP protocol: every console.* call is redirected to stderr BEFORE anything else loads.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

for (const k of ["log", "info", "debug", "warn"]) console[k] = (...a) => console.error(...a);

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/mcp/bin -> repo root (bare imports like "tsx" resolve from this file's location, not the cwd)
process.chdir(path.resolve(here, "../../.."));

const { register } = await import("tsx/esm/api");
register();
await import(pathToFileURL(path.resolve(here, "../src/index.ts")).href);
