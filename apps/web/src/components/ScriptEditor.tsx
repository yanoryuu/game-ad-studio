import { useEffect, useMemo, useRef, useState } from "react";
import {
  createRecordedVoice,
  createScriptLine,
  DEFAULT_VOICES,
  DEFAULT_VOICEVOX_SPEAKER,
  hasEmphasis,
  hasNarrationInput,
  isShortTemplate,
  SHORT_TEMPLATE_IDS,
  stripEmphasis,
  templateUsesSe,
  type FeatureItem,
  type TemplateId,
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
import { api, errorMessage, featureErrorMessage } from "../api";
import { mainTargetSec } from "../autoArrange";
import { AUDIO_EXTS, useFileDrop } from "../hooks/useFileDrop";
import type { MutateOnServer, UpdateProject } from "../hooks/useProject";
import { reloadVoices, useAudioPlayer, useRequiredCredits, useTtsStatus, useTtsVoices, type TtsStatusState } from "../hooks/useTts";
import { introPlan, type LineAttachment } from "../introPlan";
import { basename, clamp, cx, formatSec, round2 } from "../util";
import { EmphasisField, EmphasisText } from "./Emphasis";
import { Banner, Icon, Section, Segmented, Spinner } from "./ui";

const ENGINE: Record<Lang, TtsEngine> = { ja: "voicevox", en: "piper" };

const SECTIONS: { id: ScriptSectionId; label: string; hint: string; offsetLabel: string }[] = [
  { id: "hook", label: "フック", hint: "冒頭で流れる一言。各行はフック開始から offset 秒後に再生(重なり可)。", offsetLabel: "開始" },
  { id: "main", label: "本編", hint: "上から順に連続で再生。offset は前の行との間(秒)。", offsetLabel: "間" },
  { id: "cta", label: "エンド", hint: "エンドカードで流れる呼びかけ。エンドカード開始から offset 秒後。", offsetLabel: "開始" },
];

/** Per-template wording of the script sections (ARCHITECTURE §5.5 / §5.6). */
const SECTION_TEXT: Partial<Record<TemplateId, Partial<Record<ScriptSectionId, { label: string; hint: string; offsetLabel?: string }>>>> = {
  features: {
    hook: { label: "タイトル", hint: "冒頭のタイトルで流れる一言。タイトル開始から offset 秒後に再生。" },
    main: { label: "魅力", hint: "行ごとに魅力を選ぶとその魅力の頭から順に再生。「全体」の行は最初の魅力から続けて再生。" },
  },
  trailer: {
    hook: { label: "冒頭", hint: "動画の頭(0 秒)から offset 秒後に再生。" },
    main: { label: "本編", hint: "冒頭の行の後から順に連続で再生(ロゴ演出の前まで)。" },
  },
  // v4 intro (§5.8): hook and main lines play back to back as one body
  intro: {
    hook: {
      label: "フック",
      hint: "動画の頭で流れるつかみの行。フック → 本文の順に区切りなく連続で再生します。offset は前の行との間(秒)。",
      offsetLabel: "間",
    },
    main: { label: "本文", hint: "フックの行に続けて順に再生。行ごとに映像が切り替わり、ポイント・情報カードを行に紐付けられます。" },
    cta: { label: "CTA", hint: "エンドカードで流れる呼びかけ。エンドカード開始から offset 秒後。" },
  },
  // v5 short-form templates (§5.10): same narration rules as intro
  ...(Object.fromEntries(
    SHORT_TEMPLATE_IDS.map((id) => [
      id,
      {
        hook: {
          label: "フック",
          hint: "動画の頭で流れるつかみの行。フック → 本文の順に区切りなく連続で再生します。offset は前の行との間(秒)。",
          offsetLabel: "間",
        },
        main: {
          label: "本文",
          hint:
            "フックの行に続けて順に再生。入りきらない行は本文の終わりで切れます。" +
            (id === "list" ? "本文の行数 = 項目数のとき、各行の開始で次の項目に切り替わります。" : ""),
        },
        cta: {
          label: "CTA",
          hint:
            id === "loop"
              ? "最後に重ねる小さな CTA の開始から offset 秒後に流れる呼びかけ(無限ループはエンドカード無し)。"
              : "エンドカードで流れる呼びかけ。エンドカード開始から offset 秒後。",
        },
      },
    ]),
  ) as Partial<Record<TemplateId, Partial<Record<ScriptSectionId, { label: string; hint: string; offsetLabel?: string }>>>>),
};
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥"];
const AUDIO_ACCEPT = ".mp3,.wav,.m4a,.ogg,.aac,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/ogg,audio/aac";
const AUDIO_EXT = /.(mp3|wav|m4a|ogg|aac)$/i;

const STATUS_LABEL: Record<ScriptLine["status"], string> = {
  none: "未生成",
  ok: "生成済み",
  stale: "要再生成",
  error: "エラー",
};

const needsSynth = (l: ScriptLine) => hasNarrationInput(l) && l.status !== "ok";

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
  const isIntro = project.template === "intro";
  const iplan = useMemo(() => (isIntro ? introPlan(project, lang) : null), [isIntro, project, lang]);
  const emphColor = project.style.emphasisColor;
  const anyEmph = langLines.some((l) => hasEmphasis(l.text));
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
  /** 合成音声 <-> 録音. Switching back to TTS reuses the last TTS voice of this language. */
  const setEngineKind = (l: ScriptLine, kind: "tts" | "recorded") => {
    if ((l.voice.engine === "recorded") === (kind === "recorded")) return;
    if (kind === "recorded") return patchLine(l.id, { voice: createRecordedVoice() }, true);
    const prev = [...project.script].reverse().find((x) => x.lang === lang && x.voice.engine === engine)?.voice;
    patchLine(l.id, { voice: prev ? { ...prev } : { ...DEFAULT_VOICES[lang] } }, true);
  };
  const [uploading, setUploading] = useState<string | null>(null);
  const uploadRecording = async (l: ScriptLine, file: File | undefined) => {
    if (!file) return;
    if (!AUDIO_EXT.test(file.name)) {
      setLineMsg((m) => ({ ...m, [l.id]: "mp3 / wav / m4a / ogg / aac のファイルを選んでください" }));
      return;
    }
    setUploading(l.id);
    setLineMsg((m) => ({ ...m, [l.id]: "" }));
    try {
      const res = await api.uploadAsset(project.id, file);
      setRecName((n) => ({ ...n, [res.path]: file.name }));
      patchLine(l.id, { voice: createRecordedVoice(res.path) }, true);
    } catch (e) {
      setLineMsg((m) => ({ ...m, [l.id]: `アップロードできません: ${errorMessage(e)}` }));
    } finally {
      setUploading(null);
    }
  };
  const [recName, setRecName] = useState<Record<string, string>>({});
  const setFeature = (l: ScriptLine, featureId: string) =>
    update((p) => ({
      ...p,
      script: p.script.map((x) => {
        if (x.id !== l.id) return x;
        if (featureId) return { ...x, featureId };
        const { featureId: _omit, ...rest } = x;
        return rest;
      }),
    }));
  const featureItems = project.template === "features" ? project.templateData.features.items : [];

  const addLine = (section: ScriptSectionId) =>
    update((p) => {
      const same = p.script.filter((l) => l.lang === lang && l.section === section);
      const prevVoice = [...same, ...p.script.filter((l) => l.lang === lang)].reverse().find((l) => l.voice.engine === engine)?.voice;
      const line = createScriptLine(lang, section);
      if (prevVoice && prevVoice.engine === engine) line.voice = { ...prevVoice };
      // intro / short-form templates: fast narration (×1.2〜1.3) by default (§5.8 / §5.10)
      else if (p.template === "intro" || isShortTemplate(p.template)) line.voice = { ...line.voice, speed: 1.25 };
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
    if (l.voice.engine === "recorded") {
      // the recording itself (nothing to synthesize)
      if (l.voice.sourcePath) player.play(`pv:${l.id}`, assetUrl("", project.id, l.voice.sourcePath));
      return;
    }
    // 【】 are markup, never read aloud (§6.13)
    const text = stripEmphasis(l.text).trim().slice(0, 500);
    if (!text) return;
    setPreviewing(l.id);
    setLineMsg((m) => ({ ...m, [l.id]: "" }));
    try {
      const blob = await api.ttsPreview({ engine: l.voice.engine === "piper" ? "piper" : "voicevox", speaker: l.voice.speaker, speed: l.voice.speed, text });
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
        <div className={cx("emph-hint", anyEmph && "is-used")}>
          <span className="emph-hint-key mono">【】</span>
          <span>
            で囲んだ語は <EmphasisText text="【強調】" color={emphColor} />
            (色・大きめ)で字幕に出ます。括弧は表示されず、<b>読み上げもしません</b>。選択して <kbd>Ctrl</kbd>+<kbd>B</kbd> または入力欄の【】ボタン。
          </span>
        </div>
        {reqError ? <Banner tone="error">{reqError}</Banner> : null}
        {overflowCount > 0 ? (
          <Banner tone="warn">
            ナレーションが {project.durationSec} 秒尺に収まりません({overflowCount} 行が途中で切れる/入りません)。
            行を短くするか間を詰める、または尺を「自由」にしてください。
          </Banner>
        ) : null}
      </div>

      {SECTIONS.map((base) => {
        const sec = { ...base, ...SECTION_TEXT[project.template]?.[base.id] };
        const lines = langLines.filter((l) => l.section === sec.id);
        const featIds = new Set(featureItems.map((f) => f.id));
        const boundN = sec.id === "main" ? lines.filter((l) => l.featureId && featIds.has(l.featureId)).length : 0;
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
            {boundN > 0 && boundN < lines.length ? (
              <div className="field-hint warn">「全体」の行と魅力に紐付けた行が混在しています。全体の行は最初の魅力から続けて流れるため、重なることがあります。</div>
            ) : null}
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
                  onEngineKind={(k) => setEngineKind(l, k)}
                  onUpload={(f) => void uploadRecording(l, f)}
                  uploading={uploading === l.id}
                  recordingName={l.voice.sourcePath ? recName[l.voice.sourcePath] ?? basename(l.voice.sourcePath) : null}
                  features={sec.id === "main" ? featureItems : []}
                  onFeature={(id) => setFeature(l, id)}
                  emphasisColor={emphColor}
                  attachments={iplan?.byLine.get(l.id)}
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
            <div className="field-hint">
              VOICEVOX の音声{templateUsesSe(project.template) ? "や、クレジットが必要な効果音(OtoLogic など)" : ""}
              を使った動画には、動画内または説明欄に上記の表記が必要です。
            </div>
          </div>
        ) : (
          <div className="field-hint">クレジット表記が必要な音声・効果音は使われていません。</div>
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
      {s.whisper.multilingual ? (
        <span
          className={cx("eng", s.whisper.multilingual.ok ? "is-ok" : "is-idle")}
          title={
            s.whisper.multilingual.ok
              ? "日本語の録音ナレーションの書き起こしに使用"
              : `${s.whisper.multilingual.error ?? "未導入"} — 初回使用時にダウンロードされます`
          }
        >
          <span className="dot" /> 多言語 <em>{s.whisper.multilingual.model}</em>
        </span>
      ) : null}
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
  onEngineKind: (k: "tts" | "recorded") => void;
  onUpload: (f: File | undefined) => void;
  uploading: boolean;
  recordingName: string | null;
  /** features template, main section: the items a line can be bound to ([] = no selector) */
  features: FeatureItem[];
  onFeature: (id: string) => void;
  /** style.emphasisColor (【】 rendering) */
  emphasisColor: string;
  /** intro: info card / points shown while this line plays */
  attachments?: LineAttachment[];
}) {
  const { line: l, engine, voices } = props;
  const [showCaps, setShowCaps] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // recorded lines: drop an audio file onto the recording field (reject -> onUpload shows the message)
  const recDrop = useFileDrop({
    accept: AUDIO_EXTS,
    disabled: props.uploading || !props.serverOk,
    onFiles: (files) => props.onUpload(files[0]),
    onReject: (files) => props.onUpload(files[0]),
  });
  const recorded = l.voice.engine === "recorded";
  const entry = voices.entry;
  const list: TtsVoice[] = entry.kind === "ok" ? entry.voices.filter((v) => v.engine === engine) : [];
  const known = list.some((v) => v.speaker === l.voice.speaker);
  const hasText = stripEmphasis(l.text).trim() !== "";
  const hasInput = hasNarrationInput(l);
  const previewOn = props.playing === `pv:${l.id}`;
  const playOn = props.playing === `au:${l.id}`;
  const transcript =
    recorded && !hasText && l.captions.length > 0 ? l.captions.map((c) => c.text).join(l.lang === "ja" ? "" : " ") : null;
  const boundId = l.featureId && props.features.some((f) => f.id === l.featureId) ? l.featureId : "";

  return (
    <li className={cx("line", `is-${l.status}`, props.overflow && "is-overflow", props.busy && "is-busy", recorded && "is-recorded")}>
      <div className="line-head">
        <span className="line-idx mono">{props.index + 1}</span>
        {props.busy ? (
          <span className="lstatus is-busy">
            <Spinner size={9} /> {recorded ? "変換中" : "生成中"}
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
            title={previewOn ? "停止" : recorded ? "録音ファイルを再生" : "試聴(保存しない)"}
            aria-label="試聴"
            disabled={recorded ? !l.voice.sourcePath : !hasText || props.previewing || !props.serverOk}
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
            title={recorded ? "この行を変換+書き起こし" : "この行を再生成"}
            aria-label="この行を再生成"
            disabled={!hasInput || props.busy || !props.serverOk}
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

      <div className="line-meta">
        <Segmented<"tts" | "recorded">
          size="sm"
          value={recorded ? "recorded" : "tts"}
          onChange={props.onEngineKind}
          ariaLabel="音声の種類"
          options={[
            { value: "tts", label: "合成音声", title: engine === "voicevox" ? "VOICEVOX" : "Piper" },
            { value: "recorded", label: "録音", title: "録音した音声ファイルを使う" },
          ]}
        />
        {props.features.length > 0 ? (
          <select
            className={cx("input input-sm line-feat", !boundId && "is-auto")}
            value={boundId}
            onChange={(e) => props.onFeature(e.target.value)}
            title="この行を流す魅力(全体 = 最初の魅力から続けて再生)"
            aria-label="この行を流す魅力"
          >
            <option value="">全体(順番に)</option>
            {props.features.map((f, i) => (
              <option key={f.id} value={f.id}>
                魅力{CIRCLED[i]} {f.heading[l.lang] || f.heading.ja || f.heading.en}
              </option>
            ))}
          </select>
        ) : null}
        {props.attachments?.map((a) => (
          <span
            key={a.label}
            className={cx("line-attach", `is-${a.kind}`, a.auto && "is-auto")}
            title={a.auto ? "自動で割り当て(構成タブで変更できます)" : "構成タブで紐付け"}
          >
            {a.label}
            {a.auto ? <em>自動</em> : null}
          </span>
        ))}
      </div>

      <EmphasisField
        multiline
        rows={2}
        className="line-text"
        lang={l.lang}
        value={l.text}
        ariaLabel="ナレーションの台詞"
        placeholder={
          recorded
            ? l.lang === "ja"
              ? "(任意)字幕にする文言。空欄なら録音を書き起こして字幕にします"
              : "(Optional) caption text. Empty = transcribe the recording"
            : l.lang === "ja"
              ? "ナレーションの台詞"
              : "Narration line"
        }
        onChange={props.onText}
      />
      {hasEmphasis(l.text) ? (
        <div className="emph-preview" title="字幕での見え方(【】は表示も読み上げもされません)">
          <EmphasisText text={l.text} color={props.emphasisColor} lang={l.lang} />
        </div>
      ) : null}
      {transcript ? (
        <div className="transcript" lang={l.lang}>
          <span className="transcript-tag">書き起こし</span>
          {transcript}
        </div>
      ) : null}

      <div className={cx("line-controls", recorded && "is-recorded")}>
        {recorded ? (
          <div
            className={cx("lc lc-rec drop-zone", recDrop.over && "is-drop-over")}
            data-drop-label="録音をドロップ"
            {...recDrop.dropProps}
          >
            <span className="field-label">録音ファイル</span>
            <div className="rec-row">
              <button
                className={cx("btn btn-sm rec-btn", !l.voice.sourcePath && "btn-primary")}
                onClick={() => fileRef.current?.click()}
                disabled={props.uploading || !props.serverOk}
                title="mp3 / wav / m4a / ogg / aac"
              >
                {props.uploading ? <Spinner size={11} /> : <Icon.Upload size={13} />}
                {l.voice.sourcePath ? "差し替え" : "ファイルを選択"}
              </button>
              <span className={cx("rec-name", !l.voice.sourcePath && "muted")} title={l.voice.sourcePath}>
                {props.uploading ? "アップロード中…" : props.recordingName ?? "未選択"}
              </span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={AUDIO_ACCEPT}
              hidden
              onChange={(e) => {
                props.onUpload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        ) : (
          <>
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
          </>
        )}
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
      {recorded && l.voice.sourcePath && l.status !== "ok" && !props.busy ? (
        <div className="field-hint">「音声を生成」で録音を変換し、書き起こして字幕を作ります。</div>
      ) : null}

      {l.status === "error" && l.error ? <div className="line-error">{l.error}</div> : null}
      {l.warning && l.status === "ok" ? (
        <div className="line-warning">
          <Icon.Alert size={12} /> <span>{l.warning}</span>
        </div>
      ) : null}
      {props.message ? <div className="line-error">{props.message}</div> : null}

      {l.captions.length > 0 ? (
        <div className="caps">
          <button type="button" className="caps-toggle" onClick={() => setShowCaps((v) => !v)} aria-expanded={showCaps}>
            <Icon.Caption size={13} /> 字幕 {l.captions.length}
            {!showCaps ? (
              <span className="caps-inline">
                {l.captions.map((c, i) => (
                  <EmphasisText key={i} text={c.text} color={props.emphasisColor} />
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
                  <EmphasisField
                    size="sm"
                    className="cap-text"
                    value={c.text}
                    lang={l.lang}
                    ariaLabel="字幕テキスト"
                    onChange={(v) => props.onCaptions(l.captions.map((x, j) => (j === i ? { ...x, text: v } : x)))}
                  />
                </li>
              ))}
              <li className="field-hint">字幕の文字・タイミングは行の開始からの秒。【】で強調できます。再生成すると上書きされます。</li>
            </ol>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
