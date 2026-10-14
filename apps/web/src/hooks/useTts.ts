import { useCallback, useEffect, useRef, useState } from "react";
import { collectCredits, templateUsesSe, type Lang, type Project, type TtsEngine, type TtsStatusResponse, type TtsVoice } from "@gas/shared";
import { api, ApiError, featureErrorMessage } from "../api";
import { seFilesOf, useSeLibrary } from "./useSeLibrary";

export type TtsStatusState =
  | { kind: "loading" }
  | { kind: "ok"; status: TtsStatusResponse }
  /** 501: server TTS not implemented yet; other: unreachable */
  | { kind: "unavailable"; message: string; notImplemented: boolean };

/** Polls GET /api/tts/status (side-effect free) while mounted: every 4 s if VOICEVOX is down, else 20 s. */
export function useTtsStatus(enabled: boolean) {
  const [state, setState] = useState<TtsStatusState>({ kind: "loading" });
  const timer = useRef<number | null>(null);

  const check = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    let next = 20000;
    try {
      const s = await api.ttsStatus();
      setState({ kind: "ok", status: s });
      if (!s.voicevox.ok) next = 4000;
    } catch (e) {
      const ni = e instanceof ApiError && e.status === 501;
      setState({ kind: "unavailable", message: featureErrorMessage(e, "TTS"), notImplemented: ni });
      next = ni ? 30000 : 5000;
    }
    timer.current = window.setTimeout(() => void check(), next);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void check();
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [enabled, check]);

  return { state, recheck: check };
}

type VoicesEntry =
  | { kind: "loading" }
  | { kind: "ok"; voices: TtsVoice[] }
  | { kind: "error"; message: string; status: number };

const voicesCache = new Map<TtsEngine, VoicesEntry>();
const voicesInflight = new Map<TtsEngine, Promise<void>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function loadVoices(engine: TtsEngine, force = false): Promise<void> {
  const cur = voicesCache.get(engine);
  if (!force && cur && cur.kind === "ok") return Promise.resolve();
  const inflight = voicesInflight.get(engine);
  if (inflight) return inflight;
  if (!cur || cur.kind !== "ok") voicesCache.set(engine, { kind: "loading" });
  notify();
  const p = api
    .ttsVoices(engine)
    .then((voices) => {
      voicesCache.set(engine, { kind: "ok", voices });
    })
    .catch((e: unknown) => {
      voicesCache.set(engine, {
        kind: "error",
        message:
          e instanceof ApiError && e.status === 503
            ? engine === "voicevox"
              ? "VOICEVOX が起動していません(音声生成時に自動で起動します)"
              : "Piper が使えません"
            : featureErrorMessage(e, "TTS"),
        status: e instanceof ApiError ? e.status : 0,
      });
    })
    .finally(() => {
      voicesInflight.delete(engine);
      notify();
    });
  voicesInflight.set(engine, p);
  return p;
}

/** GET /api/tts/voices?engine=… with a module-level cache shared by all lines. */
export function useTtsVoices(engine: TtsEngine, enabled = true) {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (enabled) void loadVoices(engine);
    return () => {
      listeners.delete(l);
    };
  }, [engine, enabled]);
  const entry = voicesCache.get(engine) ?? { kind: "loading" as const };
  const reload = useCallback(() => void loadVoices(engine, true), [engine]);
  return { entry, reload };
}

/** Re-fetch voices of an engine (e.g. after VOICEVOX came up). */
export function reloadVoices(engine: TtsEngine) {
  void loadVoices(engine, true);
}

/** One shared <audio> for previews: playing a new clip stops the previous one. */
export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setPlayingId(null);
  }, []);

  const play = useCallback(
    (id: string, src: string | Blob) => {
      stop();
      const url = typeof src === "string" ? src : URL.createObjectURL(src);
      if (typeof src !== "string") urlRef.current = url;
      const a = new Audio(url);
      audioRef.current = a;
      setPlayingId(id);
      a.onended = () => {
        if (audioRef.current === a) stop();
      };
      a.onerror = () => {
        if (audioRef.current === a) stop();
      };
      void a.play().catch(() => {
        if (audioRef.current === a) stop();
      });
    },
    [stop],
  );

  useEffect(() => stop, [stop]);
  return { playingId, play, stop };
}

/**
 * Credits required by the narration of `lang`: shared collectCredits() with the VOICEVOX voice list, so lines
 * not synthesized yet resolve their speaker credit (ARCHITECTURE §7).
 * v4: + SE credits from the live library list (GET /api/se) when the template plays SE; falls back to the
 * project snapshot (audio.se.credits) while the list is unavailable.
 */
export function useRequiredCredits(project: Project, lang: Lang): string[] {
  const needsLookup = project.script.some(
    (l) => l.lang === lang && l.text.trim() && l.voice.engine === "voicevox" && !l.credit,
  );
  const { entry } = useTtsVoices("voicevox", needsLookup);
  const se = useSeLibrary(templateUsesSe(project.template));
  return collectCredits(project, lang, entry.kind === "ok" ? entry.voices : undefined, seFilesOf(se.state));
}
