import type { Express } from "express";
import {
  ttsPreviewRequestSchema,
  ttsSynthesizeRequestSchema,
  ttsVoicesQuerySchema,
  type Project,
  type ScriptLine,
  type TtsVoice,
} from "@gas/shared";
import { HttpError, badRequest, parseBody } from "../errors";
import { assertSafeId, readProject, updateProject } from "../store";
import { EngineUnavailableError, InvalidVoiceError } from "../tts/proc";
import { listVoices, previewWav, removeLineAudio, synthesizeLine, ttsStatus, type LineSynthesis } from "../tts/service";

/**
 * TTS routes (implementation in src/tts/**). Contract: docs/ARCHITECTURE.md §6.6.
 *
 *   GET  /api/tts/status                      -> TtsStatusResponse (no side effects)
 *   GET  /api/tts/voices?engine=voicevox|piper -> TtsVoice[]  (503 if the engine is unavailable; may auto-start VOICEVOX)
 *   POST /api/projects/:id/tts                -> Project      (body TtsSynthesizeRequest; synchronous)
 *   POST /api/tts/preview                     -> audio/wav    (body TtsPreviewRequest)
 *
 * Non-fatal per-line warnings (e.g. whisper failed -> proportional caption timing) are logged and also sent
 * in the response header `X-Tts-Warnings` = encodeURIComponent(JSON.stringify([{ lineId, warning }])).
 */

type Snapshot = Pick<ScriptLine, "id" | "text" | "lang" | "voice">;
type Outcome =
  | { kind: "ok"; snap: Snapshot; result: LineSynthesis }
  | { kind: "error"; snap: Snapshot; error: string }
  | { kind: "clear"; snap: Snapshot };

const sameVoice = (a: ScriptLine["voice"], b: ScriptLine["voice"]) =>
  a.engine === b.engine && a.speaker === b.speaker && a.speed === b.speed;

function unchanged(line: ScriptLine, snap: Snapshot): boolean {
  return line.text === snap.text && line.lang === snap.lang && sameVoice(line.voice, snap.voice);
}

function engineError(e: unknown): never {
  if (e instanceof EngineUnavailableError) throw new HttpError(503, e.message);
  if (e instanceof InvalidVoiceError) throw badRequest(e.message);
  throw e;
}

export function registerTtsRoutes(app: Express): void {
  app.get("/api/tts/status", async (_req, res) => {
    res.json(await ttsStatus());
  });

  app.get("/api/tts/voices", async (req, res) => {
    const { engine } = parseBody(ttsVoicesQuerySchema, req.query, "query");
    let voices: TtsVoice[];
    try {
      voices = await listVoices(engine);
    } catch (e) {
      if (e instanceof EngineUnavailableError) throw new HttpError(503, e.message);
      throw new HttpError(503, `${engine} voices unavailable: ${(e as Error).message}`);
    }
    res.json(voices);
  });

  app.post("/api/tts/preview", async (req, res) => {
    const body = parseBody(ttsPreviewRequestSchema, req.body);
    if (!body.text.trim()) throw badRequest("text is empty");
    let wav: Buffer;
    try {
      wav = await previewWav({ engine: body.engine, speaker: body.speaker, speed: body.speed }, body.text);
    } catch (e) {
      engineError(e);
    }
    res.setHeader("Cache-Control", "no-store");
    res.type("audio/wav").send(wav);
  });

  app.post("/api/projects/:id/tts", async (req, res) => {
    const id = assertSafeId(req.params.id);
    const { lang, lineIds } = parseBody(ttsSynthesizeRequestSchema, req.body);
    const project = await readProject(id);

    let targets: ScriptLine[];
    if (lineIds) {
      const byId = new Map(project.script.map((l) => [l.id, l]));
      targets = [];
      for (const lid of new Set(lineIds)) {
        const l = byId.get(lid);
        if (!l) throw badRequest(`Unknown script line: ${lid}`);
        if (l.lang !== lang) throw badRequest(`Line ${lid} is "${l.lang}", not "${lang}"`);
        targets.push(l);
      }
    } else {
      targets = project.script.filter(
        (l) => l.lang === lang && (l.text.trim() ? l.status !== "ok" : l.status !== "none" || !!l.audioPath),
      );
    }

    // Synthesis outside the lock, one line at a time (engines are CPU bound).
    const outcomes: Outcome[] = [];
    let voicevoxDown: string | null = null; // don't wait for the engine again after it failed once in this request
    for (const line of targets) {
      const snap: Snapshot = { id: line.id, text: line.text, lang: line.lang, voice: { ...line.voice } };
      if (!line.text.trim()) {
        outcomes.push({ kind: "clear", snap });
        continue;
      }
      if (line.voice.engine === "voicevox" && voicevoxDown) {
        outcomes.push({ kind: "error", snap, error: voicevoxDown });
        continue;
      }
      try {
        const t0 = Date.now();
        const result = await synthesizeLine(id, line);
        console.log(`[tts] ${id}/${line.id} (${line.voice.engine}) ${result.durationSec.toFixed(2)}s audio in ${Date.now() - t0} ms`);
        outcomes.push({ kind: "ok", snap, result });
      } catch (e) {
        const msg = (e as Error).message || String(e);
        if (e instanceof EngineUnavailableError && line.voice.engine === "voicevox") voicevoxDown = msg;
        console.warn(`[tts] ${id}/${line.id} failed: ${msg}`);
        outcomes.push({ kind: "error", snap, error: msg });
      }
    }

    const warnings: { lineId: string; warning: string }[] = [];
    const cleared: string[] = [];
    const saved: Project = await updateProject(id, (p) => {
      p.script = p.script.map((line) => {
        const o = outcomes.find((x) => x.snap.id === line.id);
        if (!o || !unchanged(line, o.snap)) return line; // deleted or edited meanwhile -> leave it (web marked it stale)
        const { audioPath: _a, durationSec: _d, error: _e, credit: _c, ...base } = line;
        if (o.kind === "clear") {
          cleared.push(line.id);
          return { ...base, captions: [], status: "none" };
        }
        if (o.kind === "error") return { ...line, status: "error", error: o.error.slice(0, 1000) };
        if (o.result.warning) warnings.push({ lineId: line.id, warning: o.result.warning });
        return {
          ...base,
          audioPath: o.result.audioPath,
          durationSec: o.result.durationSec,
          captions: o.result.captions,
          status: "ok",
          ...(o.result.credit ? { credit: o.result.credit } : {}),
        };
      });
    });
    for (const lid of cleared) await removeLineAudio(id, lid);

    if (warnings.length) res.setHeader("X-Tts-Warnings", encodeURIComponent(JSON.stringify(warnings)));
    res.json(saved);
  });
}
