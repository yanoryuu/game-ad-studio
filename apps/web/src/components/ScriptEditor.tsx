import { useEffect, useMemo, useRef, useState } from "react";
import {
  createScriptLine,
  DEFAULT_VOICEVOX_SPEAKER,
  type Caption,
  type Lang,
  type Project,
  type ScriptLine,
  type ScriptSectionId,
  type TtsEngine,
  type TtsVoice,
  type Voice,
} from "@gas/shared";
import { assetUrl, buildNarrationPlan } from "@gas/compositions";
import { api, featureErrorMessage } from "../api";
import { mainTargetSec } from "../autoArrange";
import type { MutateOnServer, UpdateProject } from "../hooks/useProject";
import { reloadVoices, useAudioPlayer, useRequiredCredits, useTtsStatus, useTtsVoices, type TtsStatusState } from "../hooks/useTts";
import { clamp, cx, formatSec, round2 } from "../util";
import { Banner, Icon, Section, Segmented, Spinner } from "./ui";

const ENGINE: Record<Lang, TtsEngine> = { ja: "voicevox", en: "piper" };

const SECTIONS: { id: ScriptSectionId; label: string; hint: string; offsetLabel: string }[] = [
  { id: "hook", label: "フック", hint: "冒頭で流れる一言。各行はフック開始から offset 秒後に再生(重なり可)。", offsetLabel: "開始" },
  { id: "main", label: "本編", hint: "上から順に連続で再生。offset は前の行との間(秒)。", offsetLabel: "間" },
  { id: "cta", label: "エンド", hint: "エンドカードで流れる呼びかけ。エンドカード開始から offset 秒後。", offsetLabel: "開始" },
];

const STATUS_LABEL: Record<ScriptLine["status"], string> = {
  none: "未生成",
  ok: "生成済み",
  stale: "要再生成",
  error: "エラー",
};

const needsSynth = (l: ScriptLine) => l.text.trim() !== "" && l.status !== "ok";

export function ScriptEditor(props: {
  project: Project;
  update: UpdateProject;
  mutateOnServer: MutateOnServer;
  lang: Lang;
  setLang: (l: Lang) => void;
  serverOk: boolean;
}) {
  const { project, update, lang } = props;
  const engine = ENGINE[lang];
  const tts = useTtsStatus(true);
  const voices = useTtsVoices(engine);
  const player = useAudioPlayer();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [reqError, setReqError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [lineMsg, setLineMsg] = useState<Record<string, string>>({});

  // Re-fetch voices once VOICEVOX comes up.
  const vvOk = tts.state.kind === "ok" && tts.state.status.voicevox.ok;
  const prevVvOk = useRef(vvOk);
  useEffect(() => {
    if (vvOk && !prevVvOk.current) reloadVoices("voicevox");
    prevVvOk.current = vvOk;
  }, [vvOk]);

  const plan = useMemo(() => {
    try {
      return buildNarrationPlan(project, lang, project.fps);
    } catch {
      return { lines: [], overflowLineIds: [] };
    }
  }, [project, lang]);
  const overflow = useMemo(() => new Set(plan.overflowLineIds), [plan]);

  const langLines = project.script.filter((l) => l.lang === lang);
  const pending = langLines.filter(needsSynth);
  const credits = useRequiredCredits(project, lang);
  const allBusy = busy.has("*");

  /* ---------- edits ---------- */
  const patchLine = (id: string, patch: Partial<ScriptLine>, affectsAudio: boolean) =>
    update((p) => ({
      ...p,
      script: p.script.map((l) => {
        if (l.id !== id) return l;
        const next: ScriptLine = { ...l, ...patch };
        if (affectsAudio && (l.status === "ok" || l.status === "error")) {
          next.status = "stale";
          delete next.error;
        }
        return next;
      }),
    }));
  const setVoice = (l: ScriptLine, v: Partial<Voice>) => patchLine(l.id, { voice: { ...l.voice, ...v, engine } }, true);

  const addLine = (section: ScriptSectionId) =>
    update((p) => {
      const same = p.script.filter((l) => l.lang === lang && l.section === section);
      const prevVoice = (same[same.length - 1] ?? p.script.filter((l) => l.lang === lang).at(-1))?.voice;
      const line = createScriptLine(lang, section);
      if (prevVoice && prevVoice.engine === engine) line.voice = { ...prevVoice };
      const lastIdx = same.length ? p.script.indexOf(same[same.length - 1]!) : -1;
      const script = p.script.slice();
      if (lastIdx >= 0) script.splice(lastIdx + 1, 0, line);
      else script.push(line);
      return { ...p, script };
    });

  const removeLine = (id: string) => update((p) => ({ ...p, script: p.script.filter((l) => l.id !== id) }));

  const moveLine = (id: string, dir: -1 | 1) =>
    update((p) => {
      const i = p.script.findIndex((l) => l.id === id);
      if (i < 0) return p;
      const { lang: lg, section } = p.script[i]!;
      let j = i + dir;
      while (j >= 0 && j < p.script.length && (p.script[j]!.lang !== lg || p.script[j]!.section !== section)) j += dir;
      if (j < 0 || j >= p.script.length) return p;
      const script = p.script.slice();
      [script[i], script[j]] = [script[j]!, script[i]!];
      return { ...p, script };
    });

  /* ---------- server ---------- */
  const synthesize = async (lineIds?: string[]) => {
    const key = lineIds ? lineIds : ["*"];
    const targetIds = lineIds ?? pending.map((l) => l.id);
    if (targetIds.length === 0) return;
    setReqError(null);
    setBusy((b) => new Set([...b, ...key]));
    player.stop();
    try {
      await props.mutateOnServer((p) => api.synthesize(p.id, lineIds ? { lang, lineIds } : { lang }), {
        scriptLineIds: targetIds,
      });
    } catch (e) {
      setReqError(`音声を生成できませんでした: ${featureErrorMessage(e, "TTS")}`);
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        key.forEach((k) => n.delete(k));
        return n;
      });
      void tts.recheck();
    }
  };

  const preview = async (l: ScriptLine) => {
    if (player.playingId === `pv:${l.id}`) return player.stop();
    const text = l.text.trim().slice(0, 500);
    if (!text) return;
    setPreviewing(l.id);
    setLineMsg((m) => ({ ...m, [l.id]: "" }));
    try {
      const blob = await api.ttsPreview({ engine, speaker: l.voice.speaker, speed: l.voice.speed, text });
      player.play(`pv:${l.id}`, blob);
    } catch (e) {
      setLineMsg((m) => ({ ...m, [l.id]: `試聴できません: ${featureErrorMessage(e, "TTS")}` }));
    } finally {
      setPreviewing(null);
    }
  };

  const playAudio = (l: ScriptLine) => {
    if (!l.audioPath) return;
    if (player.playingId === `au:${l.id}`) return player.stop();
    player.play(`au:${l.id}`, `${assetUrl("", project.id, l.audioPath)}?v=${encodeURIComponent(String(l.durationSec ?? ""))}`);
  };

  /* ---------- render ---------- */
  const fixed = project.durationSec !== null;
  const mainTarget = mainTargetSec(project, lang);
  const overflowCount = langLines.filter((l) => overflow.has(l.id)).length;

  return (
    <div className="script">
      <div className="script-top">
        <div className="script-top-row">
          <Segmented<Lang>
            value={lang}
            onChange={props.setLang}
            ariaLabel="台本の言語"
            options={[
              { value: "ja", label: "日本語" },
              { value: "en", label: "English" },
            ]}
          />
          <button
            className="btn btn-primary ml-auto"
            disabled={!props.serverOk || pending.length === 0 || allBusy}
            onClick={() => void synthesize()}
            title={pending.length === 0 ? "生成が必要な行はありません" : `未生成・要再生成の ${pending.length} 行を生成`}
          >
            {allBusy ? <Spinner /> : <Icon.Mic />}
            {allBusy ? "生成中…" : `音声を生成${pending.length ? ` (${pending.length})` : ""}`}
          </button>
        </div>
        <TtsStatusBar state={tts.state} lang={lang} onRecheck={() => void tts.recheck()} />
        {allBusy && lang === "ja" && !vvOk ? (
          <div className="field-hint">VOICEVOX を起動しています(初回は 5〜30 秒ほどかかります)…</div>
        ) : null}
        {voices.entry.kind === "error" && tts.state.kind === "ok" ? (
          <div className="field-hint warn">
            声の一覧を取得できません: {voices.entry.message}{" "}
            <button className="link-btn" onClick={voices.reload}>
              再取得
            </button>
          </div>
        ) : null}
        {reqError ? <Banner tone="error">{reqError}</Banner> : null}
        {overflowCount > 0 ? (
          <Banner tone="warn">
            ナレーションが {project.durationSec} 秒尺に収まりません({overflowCount} 行が途中で切れる/入りません)。
            行を短くするか間を詰める、または尺を「自由」にしてください。
          </Banner>
        ) : null}
      </div>

      {SECTIONS.map((sec) => {
        const lines = langLines.filter((l) => l.section === sec.id);
        const speech = lines.reduce((s, l) => s + (l.durationSec ?? 0) + (sec.id === "main" ? l.offsetSec : 0), 0);
        return (
          <Section
            key={sec.id}
            title={<span className={cx("sec-tag", `sec-${sec.id}`)}>{sec.label}</span>}
            aside={
              lines.length ? (
                <span className="mono muted" title="生成済み音声の長さ">
                  {lines.length} 行
                  {speech > 0 ? ` · ${formatSec(speech)}` : ""}
                  {sec.id === "main" && fixed && mainTarget !== null ? ` / 枠 ${formatSec(mainTarget)}` : ""}
                </span>
              ) : null
            }
          >
            {lines.length === 0 ? <div className="field-hint">{sec.hint}</div> : null}
            <ol className="lines">
              {lines.map((l, k) => (
                <LineCard
                  key={l.id}
                  project={project}
                  line={l}
                  index={k}
                  count={lines.length}
                  offsetLabel={sec.offsetLabel}
                  engine={engine}
                  voices={voices}
                  overflow={overflow.has(l.id)}
                  busy={allBusy && needsSynth(l) ? true : busy.has(l.id)}
                  previewing={previewing === l.id}
                  playing={player.playingId}
                  message={lineMsg[l.id]}
                  serverOk={props.serverOk}
                  onText={(text) => patchLine(l.id, { text }, true)}
                  onVoice={(v) => setVoice(l, v)}
                  onOffset={(offsetSec) => patchLine(l.id, { offsetSec }, false)}
                  onCaptions={(captions) => patchLine(l.id, { captions }, false)}
                  onMove={(d) => moveLine(l.id, d)}
                  onRemove={() => removeLine(l.id)}
                  onPreview={() => void preview(l)}
                  onPlay={() => playAudio(l)}
                  onRegenerate={() => void synthesize([l.id])}
                />
              ))}
            </ol>
            <button className="btn btn-sm btn-ghost add-line" onClick={() => addLine(sec.id)}>
              <Icon.Plus /> 行を追加
            </button>
          </Section>
        );
      })}

      <Section title="クレジット">
        {credits.length ? (
          <div className="credits">
            {credits.map((c) => (
              <span key={c} className="chip credit-chip">
                {c}
              </span>
            ))}
            <div className="field-hint">VOICEVOX の音声を使った動画には、動画内または説明欄に上記の表記が必要です。</div>
          </div>
        ) : (
          <div className="field-hint">クレジット表記が必要な音声は使われていません。</div>
        )}
      </Section>
    </div>
  );
}

function TtsStatusBar(props: { state: TtsStatusState; lang: Lang; onRecheck: () => void }) {
  const { state } = props;
  if (state.kind === "loading") {
    return (
      <div className="tts-status">
        <Spinner size={10} /> <span className="muted">音声エンジンを確認中…</span>
      </div>
    );
  }
  if (state.kind === "unavailable") {
    return (
      <div className="tts-status">
        <span className={cx("eng", "is-off")}>
          <span className="dot" /> {state.message}
        </span>
        <button className="btn btn-sm btn-ghost ml-auto" onClick={props.onRecheck} title="再確認">
          <Icon.Refresh size={13} />
        </button>
      </div>
    );
  }
  const s = state.status;
  return (
    <div className="tts-status">
      <span
        className={cx("eng", s.voicevox.ok ? "is-ok" : "is-idle", props.lang === "ja" && "is-current")}
        title={s.voicevox.ok ? `${s.voicevox.url} v${s.voicevox.version ?? "?"}` : s.voicevox.error ?? s.voicevox.url}
      >
        <span className="dot" /> VOICEVOX{" "}
        <em>{s.voicevox.ok ? (s.voicevox.version ? `v${s.voicevox.version}` : "起動中") : "未起動 · 生成時に自動起動"}</em>
      </span>
      <span
        className={cx("eng", s.piper.ok ? "is-ok" : "is-off", props.lang === "en" && "is-current")}
        title={s.piper.error}
      >
        <span className="dot" /> Piper <em>{s.piper.ok ? "OK" : "使用不可"}</em>
      </span>
      <span
        className={cx("eng", s.whisper.ok ? "is-ok" : "is-idle")}
        title={s.whisper.ok ? "英語字幕の単語タイミングに使用" : `${s.whisper.error ?? "未導入"} — 英語字幕のタイミングは文字数で配分されます`}
      >
        <span className="dot" /> Whisper <em>{s.whisper.ok ? s.whisper.model : "なし"}</em>
      </span>
      <button className="btn btn-sm btn-ghost btn-icon" onClick={props.onRecheck} title="再確認" aria-label="エンジン状態を再確認">
        <Icon.Refresh size={13} />
      </button>
    </div>
  );
}

function voiceLabel(engine: TtsEngine, speaker: string): string {
  if (engine === "voicevox" && speaker === DEFAULT_VOICEVOX_SPEAKER) return "ずんだもん(ノーマル)";
  return engine === "voicevox" ? `style ${speaker}` : speaker;
}

function LineCard(props: {
  project: Project;
  line: ScriptLine;
  index: number;
  count: number;
  offsetLabel: string;
  engine: TtsEngine;
  voices: ReturnType<typeof useTtsVoices>;
  overflow: boolean;
  busy: boolean;
  previewing: boolean;
  playing: string | null;
  message?: string;
  serverOk: boolean;
  onText: (t: string) => void;
  onVoice: (v: Partial<Voice>) => void;
  onOffset: (s: number) => void;
  onCaptions: (c: Caption[]) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onPreview: () => void;
  onPlay: () => void;
  onRegenerate: () => void;
}) {
  const { line: l, engine, voices } = props;
  const [showCaps, setShowCaps] = useState(false);
  const entry = voices.entry;
  const list: TtsVoice[] = entry.kind === "ok" ? entry.voices.filter((v) => v.engine === engine) : [];
  const known = list.some((v) => v.speaker === l.voice.speaker);
  const hasText = l.text.trim() !== "";
  const previewOn = props.playing === `pv:${l.id}`;
  const playOn = props.playing === `au:${l.id}`;

  return (
    <li className={cx("line", `is-${l.status}`, props.overflow && "is-overflow", props.busy && "is-busy")}>
      <div className="line-head">
        <span className="line-idx mono">{props.index + 1}</span>
        {props.busy ? (
          <span className="lstatus is-busy">
            <Spinner size={9} /> 生成中
          </span>
        ) : (
          <span className={cx("lstatus", `is-${l.status}`)} title={l.error}>
            {STATUS_LABEL[l.status]}
          </span>
        )}
        {l.durationSec ? <span className="mono muted line-dur">{formatSec(l.durationSec)}</span> : null}
        {props.overflow ? (
          <span className="lstatus is-overflow" title="尺に収まらず切られます">
            <Icon.Alert size={11} /> 溢れ
          </span>
        ) : null}
        <span className="line-actions">
          <button
            className={cx("btn btn-icon btn-ghost", previewOn && "is-on")}
            title={previewOn ? "停止" : "試聴(保存しない)"}
            aria-label="試聴"
            disabled={!hasText || props.previewing || !props.serverOk}
            onClick={props.onPreview}
          >
            {props.previewing ? <Spinner size={11} /> : previewOn ? <Icon.Stop size={12} /> : <Icon.Speaker size={14} />}
          </button>
          <button
            className={cx("btn btn-icon btn-ghost", playOn && "is-on")}
            title={l.audioPath ? (playOn ? "停止" : "生成済み音声を再生") : "まだ生成されていません"}
            aria-label="生成済み音声を再生"
            disabled={!l.audioPath}
            onClick={props.onPlay}
          >
            {playOn ? <Icon.Stop size={12} /> : <Icon.Play size={13} />}
          </button>
          <button
            className="btn btn-icon btn-ghost"
            title="この行を再生成"
            aria-label="この行を再生成"
            disabled={!hasText || props.busy || !props.serverOk}
            onClick={props.onRegenerate}
          >
            <Icon.Refresh size={13} />
          </button>
          <button className="btn btn-icon btn-ghost" title="上へ" aria-label="上へ" disabled={props.index === 0} onClick={() => props.onMove(-1)}>
            <Icon.Up />
          </button>
          <button
            className="btn btn-icon btn-ghost"
            title="下へ"
            aria-label="下へ"
            disabled={props.index === props.count - 1}
            onClick={() => props.onMove(1)}
          >
            <Icon.Down />
          </button>
          <button className="btn btn-icon btn-ghost btn-danger" title="削除" aria-label="行を削除" onClick={props.onRemove}>
            <Icon.Trash />
          </button>
        </span>
      </div>

      <textarea
        className="input textarea line-text"
        rows={2}
        lang={l.lang}
        value={l.text}
        placeholder={l.lang === "ja" ? "ナレーションの台詞" : "Narration line"}
        onChange={(e) => props.onText(e.target.value)}
      />

      <div className="line-controls">
        <label className="lc lc-voice">
          <span className="field-label">声</span>
          <select
            className="input input-sm"
            value={l.voice.speaker}
            onChange={(e) => props.onVoice({ speaker: e.target.value })}
            title={entry.kind === "error" ? entry.message : undefined}
          >
            {!known ? <option value={l.voice.speaker}>{voiceLabel(engine, l.voice.speaker)}</option> : null}
            {list.map((v) => (
              <option key={v.speaker} value={v.speaker}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lc lc-speed" title="話速">
          <span className="field-label">
            速度 <span className="mono">×{l.voice.speed.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={l.voice.speed}
            onChange={(e) => props.onVoice({ speed: round2(Number(e.target.value)) })}
            onDoubleClick={() => props.onVoice({ speed: 1 })}
          />
        </label>
        <label className="lc lc-offset" title={props.offsetLabel === "間" ? "前の行との間(秒)" : "セクション開始からの遅延(秒)"}>
          <span className="field-label">{props.offsetLabel} s</span>
          <input
            className="input input-sm mono"
            type="number"
            min={0}
            step={0.1}
            value={l.offsetSec}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) props.onOffset(round2(clamp(v, 0, 60)));
            }}
          />
        </label>
      </div>

      {l.status === "error" && l.error ? <div className="line-error">{l.error}</div> : null}
      {props.message ? <div className="line-error">{props.message}</div> : null}

      {l.captions.length > 0 ? (
        <div className="caps">
          <button type="button" className="caps-toggle" onClick={() => setShowCaps((v) => !v)} aria-expanded={showCaps}>
            <Icon.Caption size={13} /> 字幕 {l.captions.length}
            {!showCaps ? (
              <span className="caps-inline">
                {l.captions.map((c, i) => (
                  <span key={i}>{c.text}</span>
                ))}
              </span>
            ) : null}
            <span className="ml-auto muted">{showCaps ? "閉じる" : "編集"}</span>
          </button>
          {showCaps ? (
            <ol className="caps-list">
              {l.captions.map((c, i) => (
                <li key={i} className="cap-row">
                  <input
                    className="input input-sm mono cap-time"
                    type="number"
                    step={0.05}
                    min={0}
                    value={c.startSec}
                    aria-label="開始秒"
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      props.onCaptions(l.captions.map((x, j) => (j === i ? { ...x, startSec: round2(Math.max(0, v)) } : x)));
                    }}
                  />
                  <input
                    className="input input-sm mono cap-time"
                    type="number"
                    step={0.05}
                    min={0}
                    value={c.endSec}
                    aria-label="終了秒"
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      props.onCaptions(l.captions.map((x, j) => (j === i ? { ...x, endSec: round2(Math.max(0, v)) } : x)));
                    }}
                  />
                  <input
                    className="input input-sm cap-text"
                    value={c.text}
                    lang={l.lang}
                    aria-label="字幕テキスト"
                    onChange={(e) => props.onCaptions(l.captions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                  />
                </li>
              ))}
              <li className="field-hint">字幕の文字・タイミングは行の開始からの秒。再生成すると上書きされます。</li>
            </ol>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
