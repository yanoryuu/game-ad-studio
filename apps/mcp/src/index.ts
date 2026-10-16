// Game Ad Studio MCP server (stdio). Started via bin/game-ad-studio-mcp.mjs (tsx loader).
// stdout = MCP protocol only; all logging goes to stderr.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { API_BASE, log } from "./env";
import { registerTools } from "./tools";

for (const k of ["log", "info", "debug", "warn"] as const) console[k] = (...a: unknown[]) => console.error(...a);

const server = new McpServer(
  { name: "game-ad-studio", version: "0.1.0" },
  {
    instructions:
      "Game Ad Studio: makes short game ad videos (Remotion) from gameplay footage. " +
      "Quick path: make_ad (one shot). Step by step: create_project -> add_sources -> get_candidates -> set_clips -> " +
      "set_template_data -> set_script -> set_audio -> preview_frames (look at the images) -> render. " +
      "list_templates explains the 15 templates. Every tool auto-starts the local API server if needed. " +
      "テキストの【】は強調色、\\n は改行。",
  },
);
registerTools(server);

await server.connect(new StdioServerTransport());
log(`ready (API ${API_BASE}, pid ${process.pid})`);
