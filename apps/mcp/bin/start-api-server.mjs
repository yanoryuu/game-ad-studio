// Hidden supervisor of the Game Ad Studio API server (started by apps/mcp/src/autostart.ts).
//
// The MCP server starts THIS script through `powershell Start-Process -WindowStyle Hidden`, so that
//  - it is not a descendant the MCP client can kill: libuv puts its direct (non-detached) children into a
//    kill-on-close job, but processes they create break away silently -> this process (a grandchild via
//    PowerShell) survives the MCP process and process-tree kills of it;
//  - it owns a NEW, HIDDEN console. Node's `detached` would mean DETACHED_PROCESS (no console at all), and then
//    every console program the API server starts without windowsHide (tsx's child node, the Remotion compositor,
//    headless Chrome, ffmpeg) would open a visible window. Here they all inherit the hidden console instead.
//
// It runs exactly the server half of `npm run dev` (`npm run dev -w @gas/server` = `tsx watch --clear-screen=false
// src/index.ts` in apps/server; without npm.cmd / cmd.exe), appends its output to the log file and lives as long
// as the server does (stop this process -> the server stops with it).
//
// usage: node start-api-server.mjs <repoRoot> <logFile> [port]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [repoRoot, logFile, port] = process.argv.slice(2);
if (!repoRoot || !logFile) {
  console.error("usage: start-api-server.mjs <repoRoot> <logFile> [port]");
  process.exit(2);
}
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const out = fs.openSync(logFile, "a");
fs.writeSync(out, `\n===== ${new Date().toISOString()} API server started by the MCP server (supervisor pid ${process.pid}${port ? `, port ${port}` : ""}) =====\n`);
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const env = { ...process.env, FORCE_COLOR: "0" };
if (port) env.GAS_PORT = port;
const child = spawn(process.execPath, [tsxCli, "watch", "--clear-screen=false", "src/index.ts"], {
  cwd: path.join(repoRoot, "apps", "server"),
  env,
  stdio: ["ignore", out, out],
  windowsHide: true,
});
child.on("exit", (code, signal) => {
  try {
    fs.writeSync(out, `===== ${new Date().toISOString()} API server exited (code ${code}, signal ${signal}) =====\n`);
  } catch {
    /* ignore */
  }
  process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(sig, () => child.kill());
