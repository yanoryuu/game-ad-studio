import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { TtsVoice } from "@gas/shared";
import { config, resolveVoicevoxEnginePath } from "../config";
import { EngineUnavailableError, InvalidVoiceError } from "./proc";

/* ------------------------------------------------------------------ */
/* VOICEVOX ENGINE client + auto-spawn                                  */
/* ------------------------------------------------------------------ */

export type VvMora = {
  text: string;
  consonant?: string | null;
  consonant_length?: number | null;
  vowel: string;
  vowel_length: number;
  pitch: number;
};
export type VvAccentPhrase = {
  moras: VvMora[];
  accent: number;
  pause_mora?: VvMora | null;
  is_interrogative?: boolean;
};
export type VvAudioQuery = {
  accent_phrases: VvAccentPhrase[];
  speedScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  pauseLength?: number | null;
  pauseLengthScale?: number;
  outputSamplingRate: number;
  [k: string]: unknown;
};
type VvSpeaker = { name: string; speaker_uuid: string; styles: { name: string; id: number; type?: string }[] };

const SPAWN_WAIT_MS = 30_000;
const base = () => config.voicevox.url;

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

/** GET /version. Never spawns anything. */
export async function voicevoxVersion(timeoutMs = 1500): Promise<string> {
  const r = await fetchWithTimeout(`${base()}/version`, {}, timeoutMs);
  if (!r.ok) throw new Error(`VOICEVOX /version returned HTTP ${r.status}`);
  const v = (await r.json()) as unknown;
  return typeof v === "string" ? v : JSON.stringify(v);
}

async function reachable(): Promise<boolean> {
  try {
    await voicevoxVersion();
    return true;
  } catch {
    return false;
  }
}

/* --- engine process we spawned (single instance) --- */

let child: ChildProcess | null = null;
let starting: Promise<void> | null = null;
let exitHooked = false;

function killChildSync(): void {
  const c = child;
  child = null;
  if (!c || c.exitCode !== null || c.pid === undefined) return;
  try {
    // /T: the PyInstaller engine may have helper processes; /F: no console to answer a polite close.
    spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } catch {
    try {
      c.kill();
    } catch {
      /* ignore */
    }
  }
}

function hookExit(): void {
  if (exitHooked) return;
  exitHooked = true;
  process.on("exit", killChildSync);
  // Only exit on signals we would otherwise exit on anyway (default behaviour), after cleaning up.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
    process.once(sig, () => {
      killChildSync();
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
}

/**
 * Makes sure the engine answers on config.voicevox.url. If not, spawns run.exe
 * (`--host 127.0.0.1 --port <port of url>`) once and waits up to ~30 s for /version.
 * Concurrent callers share the same start attempt. The spawned engine is killed when the server exits.
 * An engine that was already running (started by the user or a previous server run) is used as-is.
 */
export function ensureVoicevox(): Promise<void> {
  starting ??= (async () => {
    if (await reachable()) return;
    if (child && child.exitCode === null) {
      // ours, still booting/hung: just wait below
    } else {
      const exe = await resolveVoicevoxEnginePath();
      if (!exe) {
        throw new EngineUnavailableError(
          `VOICEVOX engine is not running at ${base()} and run.exe was not found (set voicevox.enginePath in gas.config.json)`,
        );
      }
      const url = new URL(base());
      const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
      const port = url.port || "50021";
      console.log(`[tts] starting VOICEVOX engine: ${exe} --host ${host} --port ${port}`);
      const c = spawn(exe, ["--host", host, "--port", port], {
        cwd: path.dirname(exe),
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let errTail = "";
      c.stderr!.on("data", (d: Buffer) => {
        errTail = (errTail + d.toString("utf8")).slice(-4000);
      });
      c.on("error", (e) => console.warn(`[tts] VOICEVOX engine process error: ${e.message}`));
      c.on("exit", (code) => {
        if (child === c) child = null;
        console.log(`[tts] VOICEVOX engine exited (code ${code})${code ? `: ${errTail.trim().split(/\r?\n/).slice(-3).join(" | ")}` : ""}`);
      });
      child = c;
      hookExit();
    }
    const deadline = Date.now() + SPAWN_WAIT_MS;
    while (Date.now() < deadline) {
      if (await reachable()) {
        console.log(`[tts] VOICEVOX engine ready at ${base()}`);
        return;
      }
      if (!child) throw new EngineUnavailableError("VOICEVOX engine exited during startup");
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new EngineUnavailableError(`VOICEVOX engine did not respond at ${base()} within ${SPAWN_WAIT_MS / 1000}s`);
  })().finally(() => {
    starting = null;
  });
  return starting;
}

/* --- API --- */

let speakersCache: { at: number; data: VvSpeaker[] } | null = null;

async function speakers(): Promise<VvSpeaker[]> {
  if (speakersCache && Date.now() - speakersCache.at < 10 * 60_000) return speakersCache.data;
  await ensureVoicevox();
  const r = await fetchWithTimeout(`${base()}/speakers`, {}, 30_000);
  if (!r.ok) throw new Error(`VOICEVOX /speakers returned HTTP ${r.status}`);
  const data = (await r.json()) as VvSpeaker[];
  speakersCache = { at: Date.now(), data };
  return data;
}

const isTalk = (s: { type?: string }) => !s.type || s.type === "talk";

/** One TtsVoice per talk style: speaker = style id, name = "キャラ（スタイル）", credit = "VOICEVOX:キャラ". */
export async function voicevoxVoices(): Promise<TtsVoice[]> {
  const out: TtsVoice[] = [];
  for (const sp of await speakers()) {
    for (const st of sp.styles.filter(isTalk)) {
      out.push({ engine: "voicevox", speaker: String(st.id), name: `${sp.name}（${st.name}）`, lang: "ja", credit: `VOICEVOX:${sp.name}` });
    }
  }
  return out;
}

/** "VOICEVOX:<character>" for a style id; throws if the id is unknown. */
export async function voicevoxCredit(styleId: string): Promise<string> {
  const id = Number(styleId);
  for (const sp of await speakers()) if (sp.styles.some((s) => s.id === id)) return `VOICEVOX:${sp.name}`;
  throw new InvalidVoiceError(`Unknown VOICEVOX speaker/style id "${styleId}"`);
}

function parseStyleId(speaker: string): number {
  if (!/^\d+$/.test(speaker)) throw new InvalidVoiceError(`VOICEVOX speaker must be a numeric style id, got "${speaker}"`);
  return Number(speaker);
}

async function httpError(r: Response, what: string): Promise<Error> {
  let detail = "";
  try {
    detail = (await r.text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  return new Error(`VOICEVOX ${what} returned HTTP ${r.status}${detail ? `: ${detail}` : ""}`);
}

/** audio_query (with speedScale applied) + synthesis. Returns the query used and the WAV bytes. */
export async function voicevoxSynthesize(
  text: string,
  speaker: string,
  speed: number,
): Promise<{ query: VvAudioQuery; wav: Buffer }> {
  const id = parseStyleId(speaker);
  await ensureVoicevox();
  // Japanese text MUST be percent-encoded (encodeURIComponent) in the query string.
  const qr = await fetchWithTimeout(`${base()}/audio_query?text=${encodeURIComponent(text)}&speaker=${id}`, { method: "POST" });
  if (!qr.ok) throw await httpError(qr, "audio_query");
  const query = (await qr.json()) as VvAudioQuery;
  query.speedScale = speed;
  const sr = await fetchWithTimeout(
    `${base()}/synthesis?speaker=${id}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(query) },
    120_000,
  );
  if (!sr.ok) throw await httpError(sr, "synthesis");
  return { query, wav: Buffer.from(await sr.arrayBuffer()) };
}
