import { useCallback, useEffect, useMemo, useState } from "react";
import { generateId, hasNarrationInput, isShortTemplate, templateUsesSe, trailerClipOrder, type Clip, type Format, type Lang, type Project, type Source } from "@gas/shared";
import { calcAdMetadata } from "@gas/compositions";
import { api, ApiError } from "../api";
import { DEFAULT_GAME_VOLUME, insertClip } from "../autoArrange";
import { droppedKind, useWindowFileDrop } from "../hooks/useFileDrop";
import { useBgmVoiceCarveAuto } from "../hooks/useBgmAnalysis";
import { useHealth } from "../hooks/useHealth";
import { useProject, type SaveState } from "../hooks/useProject";
import { useSeCreditsSync } from "../hooks/useSeLibrary";
import { useSourceUploads } from "../hooks/useSourceUploads";
import { introWarnings } from "../introPlan";
import { shortWarnings } from "../shortForm";
import { navigate } from "../hooks/useHashRoute";
import { sourceName, cx } from "../util";
import { AudioPanel } from "./AudioPanel";
import { CandidatesPanel } from "./CandidatesPanel";
import { ClipList } from "./ClipList";
import { ClipMarker, type ClipDraft, type MarkerCue } from "./ClipMarker";
import { Inspector } from "./Inspector";
import { PreviewPane } from "./PreviewPane";
import { RenderPanel } from "./RenderPanel";
import { ScriptEditor } from "./ScriptEditor";
import { ServerDown } from "./ServerDown";
import { SourcesPanel } from "./SourcesPanel";
import { StylePanel } from "./StylePanel";
import { TemplatePanel } from "./TemplatePanel";
import { Banner, Empty, Icon, Spinner, Tabs } from "./ui";

type LeftTab = "media" | "cands" | "script";
type RightTab = "settings" | "structure" | "audio" | "style";

const POLL_MS = 1500;

function usePref<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      if (s && (allowed as readonly string[]).includes(s)) return s as T;
    } catch {
      /* storage unavailable */
    }
    return initial;
  });
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [v, set] as const;
}

export function Editor({ projectId }: { projectId: string }) {
  const store = useProject(projectId);
  const { project, update, flush, mutateOnServer, refreshServerOwned, removeSource, saveState, saveError } = store;
  const health = useHealth();
  const [format, setFormat] = usePref<Format>(`gas:${projectId}:format`, "16:9", ["16:9", "9:16"]);
  const [lang, setLang] = usePref<Lang>(`gas:${projectId}:lang`, "ja", ["ja", "en"]);
  const [leftTab, setLeftTab] = usePref<LeftTab>(`gas:${projectId}:left`, "media", ["media", "cands", "script"]);
  const [rightTab, setRightTab] = usePref<RightTab>(`gas:${projectId}:right`, "settings", ["settings", "structure", "audio", "style"]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [cue, setCue] = useState<MarkerCue | null>(null);
  const [activeCandId, setActiveCandId] = useState<string | null>(null);
  const [hoverCandId, setHoverCandId] = useState<string | null>(null);

  // v4: keep audio.se.credits (snapshot used by renders / the end card) in sync with the SE library (§6.12).
  useSeCreditsSync(project, update, !!project && templateUsesSe(project.template));
  // Voice-band ducking (§5.3.1): generate the carved BGM copy when it is missing.
  useBgmVoiceCarveAuto(project, mutateOnServer, health.status === "ok");

  // Reload the project once the server comes back after a failed load.
  const { reload, loadError } = store;
  useEffect(() => {
    if (health.status === "ok" && loadError instanceof ApiError && loadError.status === 0) void reload();
  }, [health.status, loadError, reload]);

  // Background work (proxy encoding / highlight analysis): poll GET and merge server-owned fields.
  const needsPoll =
    !!project?.sources.some((s) => s.proxyStatus === "pending" || s.analysisStatus === "running") ||
    project?.audio.bgm?.analysisStatus === "running" ||
    project?.audio.bgm?.voiceCarveStatus === "running";
  useEffect(() => {
    if (!needsPoll) return;
    const t = window.setInterval(() => void refreshServerOwned(), POLL_MS);
    return () => window.clearInterval(t);
  }, [needsPoll, refreshServerOwned]);

  // Default-select the first source.
  useEffect(() => {
    if (!project) return;
    if (!selectedSourceId || !project.sources.some((s) => s.id === selectedSourceId)) {
      setSelectedSourceId(project.sources[0]?.id ?? null);
    }
  }, [project, selectedSourceId]);

  // Drop the candidate preview cue when the source changes.
  useEffect(() => {
    setCue(null);
    setActiveCandId(null);
    setHoverCandId(null);
  }, [selectedSourceId]);

  // Source uploads (sources panel + whole-editor drop): select the new source when it lands.
  const uploads = useSourceUploads(mutateOnServer, (id) => {
    setSelectedSourceId(id);
    setEditingClipId(null);
  });

  // Whole-editor drop: files dropped outside a drop zone -> videos / images become sources.
  const [dropNote, setDropNote] = useState<string | null>(null);
  const windowDrag = useWindowFileDrop((files) => {
    const media = files.filter((f) => ["video", "image"].includes(droppedKind(f.name)));
    const audio = files.filter((f) => droppedKind(f.name) === "audio");
    const other = files.filter((f) => droppedKind(f.name) === "other");
    if (media.length) {
      uploads.add(media);
      setLeftTab("media");
    }
    const notes: string[] = [];
    if (audio.length) notes.push("音声は「音声」タブの BGM 欄・台本の録音行・効果音ライブラリにドロップしてください。");
    if (other.length) notes.push(`対応していない形式です(${other.map((f) => f.name).join(", ")})。素材は動画・画像のみです。`);
    setDropNote(notes.length ? notes.join(" ") : null);
  }, health.status !== "down");
  useEffect(() => {
    if (!dropNote) return;
    const t = window.setTimeout(() => setDropNote(null), 6000);
    return () => window.clearTimeout(t);
  }, [dropNote]);

  /** Image source -> main-slot clip [0, 3 s] at the end of the main section. */
  const addImageClip = useCallback(
    (sourceId: string) => {
      const clip: Clip = { id: generateId("clip", 8), sourceId, inSec: 0, outSec: 3, slot: "main", gameVolume: DEFAULT_GAME_VOLUME };
      update((p) => ({ ...p, clips: insertClip(p.clips, clip) }));
    },
    [update],
  );

  const updateClip = useCallback(
    (clipId: string, patch: Partial<ClipDraft>) =>
      update((p) => ({ ...p, clips: p.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) })),
    [update],
  );

  const videoSec = useMemo(() => {
    if (!project) return 0;
    try {
      const m = calcAdMetadata(project, format, lang);
      return m.durationInFrames / m.fps;
    } catch {
      return 0;
    }
  }, [project, format, lang]);

  if (store.loading && !project) {
    return (
      <div className="fullscreen-center">
        <Spinner size={22} />
      </div>
    );
  }

  if (!project) {
    const err = loadError;
    const down = err instanceof ApiError && err.status === 0;
    return (
      <div className="fullscreen-center">
        <div className="load-fail">
          {down ? (
            <>
              <ServerDown onRetry={() => void reload()} />
              <div className="row-gap">
                <a className="btn btn-ghost" href="#/">
                  <Icon.Back /> 一覧へ
                </a>
              </div>
            </>
          ) : (
            <Empty icon={<Icon.Alert size={26} />} title={err instanceof ApiError && err.status === 404 ? "プロジェクトが見つかりません" : "読み込みに失敗しました"}>
              <div className="mono small">{err?.message}</div>
              <div className="row-gap">
                <button className="btn" onClick={() => navigate({ page: "list" })}>
                  <Icon.Back /> 一覧へ
                </button>
                <button className="btn" onClick={() => void reload()}>
                  再試行
                </button>
              </div>
            </Empty>
          )}
        </div>
      </div>
    );
  }

  const serverOk = health.status !== "down";
  const selectedSource = project.sources.find((s) => s.id === selectedSourceId) ?? null;
  const editingClip = project.clips.find((c) => c.id === editingClipId) ?? null;
  const markerSource = editingClip ? project.sources.find((s) => s.id === editingClip.sourceId) ?? null : selectedSource;

  // hook clips go after the last hook clip so hooks stay grouped at the top
  const addClip = (draft: ClipDraft) => {
    if (!selectedSource) return;
    const clip: Clip = { id: generateId("clip", 8), sourceId: selectedSource.id, ...draft };
    update((p) => ({ ...p, clips: insertClip(p.clips, clip) }));
  };

  const addSource = async (path: string) => {
    const before = new Set(project.sources.map((s) => s.id));
    // pauseSaves: a PUT racing this request would drop the new source (§6.2)
    const next = await mutateOnServer((p) => api.addSource(p.id, { path }), { pauseSaves: true });
    const added = next.sources.find((s) => !before.has(s.id));
    if (added) {
      setSelectedSourceId(added.id);
      setEditingClipId(null);
    }
  };

  const analyzing = project.sources.some((s) => s.analysisStatus === "running");

  const openClips = () => {
    setLeftTab("media");
    window.setTimeout(() => document.querySelector(".clips-section")?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  };

  return (
    <div className="editor">
      <header className="topbar">
        <a className="topbar-back" href="#/" title="プロジェクト一覧">
          <span className="brand-mark sm" aria-hidden>
            <span />
          </span>
        </a>
        <div className="topbar-title">
          <input
            className="title-input"
            value={project.name}
            onChange={(e) => update((p) => ({ ...p, name: e.target.value }))}
            aria-label="プロジェクト名"
            spellCheck={false}
          />
        </div>
        <SavePill state={saveState} error={saveError} onRetry={() => void flush()} />
        <div className="topbar-right">
          {needsPoll ? (
            <span className="pill pill-busy" title="プロキシ生成 / ハイライト解析 / ビート解析を実行中">
              <Spinner size={10} /> バックグラウンド処理中
            </span>
          ) : null}
          {health.status === "down" ? (
            <span className="pill pill-error">
              <span className="dot" /> サーバー未接続
            </span>
          ) : health.health && (!health.health.ffmpeg || !health.health.ffprobe) ? (
            <span className="pill pill-warn" title="ffmpeg / ffprobe が PATH にありません">
              <Icon.Alert size={12} /> ffmpeg なし
            </span>
          ) : null}
        </div>
      </header>

      {health.status === "down" ? (
        <div className="editor-banner">
          <Banner
            tone="error"
            action={
              <button className="btn btn-sm" onClick={() => void health.recheck()}>
                再接続
              </button>
            }
          >
            サーバーに接続できません。編集内容はこのタブに保持され、接続が戻ると自動で保存されます。
          </Banner>
        </div>
      ) : null}

      <div className="workspace">
        <aside className="pane pane-left pane-tabbed">
          <Tabs<LeftTab>
            ariaLabel="編集パネル"
            value={leftTab}
            onChange={(t) => {
              setLeftTab(t);
              if (t !== "media") setEditingClipId(null);
            }}
            options={[
              { value: "media", label: "素材・クリップ", badge: project.clips.length || null },
              {
                value: "cands",
                label: "候補",
                badge: analyzing ? <Spinner size={8} /> : project.candidates.length || null,
              },
              { value: "script", label: "台本", badge: scriptBadge(project, lang) },
            ]}
          />
          <div className="pane-scroll">
            {leftTab === "media" ? (
              <>
                <SourcesPanel
                  project={project}
                  selectedId={editingClip ? editingClip.sourceId : selectedSourceId}
                  onSelect={(id) => {
                    setSelectedSourceId(id);
                    setEditingClipId(null);
                  }}
                  onAdd={addSource}
                  uploads={uploads}
                  onAddImageClip={addImageClip}
                  onRemove={(id) => {
                    if (editingClip?.sourceId === id) setEditingClipId(null);
                    removeSource(id);
                  }}
                  disabled={!serverOk}
                />
                {markerSource ? (
                  markerSource.proxyStatus === "ready" ? (
                    <ClipMarker
                      project={project}
                      source={markerSource}
                      editingClip={editingClip}
                      editingIndex={editingIndexOf(project, editingClip)}
                      onAdd={addClip}
                      onUpdate={updateClip}
                      onDoneEditing={() => setEditingClipId(null)}
                      cropMode={project.style.vertical?.mode === "crop"}
                      previewVertical={format === "9:16"}
                      onShowVertical={() => setFormat("9:16")}
                    />
                  ) : (
                    <SourceNotReady source={markerSource} />
                  )
                ) : null}
                <ClipList
                  project={project}
                  editingId={editingClipId}
                  onEdit={(c) => {
                    setEditingClipId(c.id);
                    setSelectedSourceId(c.sourceId);
                  }}
                  onChangeClips={(clips) => {
                    if (editingClipId && !clips.some((c) => c.id === editingClipId)) setEditingClipId(null);
                    update((p) => ({ ...p, clips }));
                  }}
                />
              </>
            ) : leftTab === "cands" ? (
              <>
                {project.sources.length > 1 ? (
                  <div className="src-picker">
                    <span className="field-label">素材</span>
                    <select
                      className="input input-sm"
                      value={selectedSourceId ?? ""}
                      onChange={(e) => setSelectedSourceId(e.target.value)}
                      aria-label="候補を表示する素材"
                    >
                      {project.sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {sourceName(s)}
                          {s.analysisStatus === "done"
                            ? `(候補 ${project.candidates.filter((c) => c.sourceId === s.id).length})`
                            : s.analysisStatus === "running"
                              ? "(解析中)"
                              : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {selectedSource ? (
                  selectedSource.proxyStatus === "ready" ? (
                    <div className="marker-sticky">
                      <ClipMarker
                        project={project}
                        source={selectedSource}
                        editingClip={null}
                        editingIndex={-1}
                        onAdd={addClip}
                        onUpdate={updateClip}
                        onDoneEditing={() => {}}
                        compact
                        cue={cue}
                        marks={project.candidates
                          .filter((c) => c.sourceId === selectedSource.id)
                          .map((c) => ({ id: c.id, inSec: c.startSec, outSec: c.endSec, active: c.id === (hoverCandId ?? activeCandId) }))}
                      />
                    </div>
                  ) : (
                    <SourceNotReady source={selectedSource} />
                  )
                ) : null}
                <CandidatesPanel
                  project={project}
                  source={selectedSource}
                  update={update}
                  mutateOnServer={mutateOnServer}
                  activeCandidateId={activeCandId}
                  onCue={(c) => {
                    if (!c) {
                      setHoverCandId(null);
                      setCue((cur) => (cur && cur.mode === "hover" ? null : cur));
                      return;
                    }
                    const { candId, ...rest } = c;
                    if (rest.mode === "select") {
                      setActiveCandId(candId);
                      setHoverCandId(null);
                    } else setHoverCandId(candId);
                    setCue((cur) => ({ ...rest, n: (cur?.n ?? 0) + 1 }));
                  }}
                  onShowClips={() => {
                    setLeftTab("media");
                    window.setTimeout(() => document.querySelector(".clips-section")?.scrollIntoView({ block: "start" }), 50);
                  }}
                  serverOk={serverOk}
                  onAddImageClip={addImageClip}
                />
              </>
            ) : (
              <ScriptEditor
                project={project}
                update={update}
                mutateOnServer={mutateOnServer}
                lang={lang}
                setLang={setLang}
                serverOk={serverOk}
              />
            )}
          </div>
        </aside>

        <main className="pane pane-center">
          <PreviewPane project={project} format={format} lang={lang} />
          <RenderPanel project={project} update={update} flush={flush} serverOk={serverOk} />
        </main>

        <aside className="pane pane-right pane-tabbed">
          <Tabs<RightTab>
            ariaLabel="設定パネル"
            value={rightTab}
            onChange={setRightTab}
            options={[
              { value: "settings", label: "設定" },
              { value: "structure", label: "構成", badge: structureBadge(project, lang) },
              { value: "audio", label: "音声", badge: audioBadge(project) },
              { value: "style", label: "スタイル" },
            ]}
          />
          <div className="pane-scroll">
            {rightTab === "settings" ? (
              <Inspector project={project} update={update} format={format} setFormat={setFormat} lang={lang} setLang={setLang} />
            ) : rightTab === "structure" ? (
              <TemplatePanel
                project={project}
                update={update}
                mutateOnServer={mutateOnServer}
                lang={lang}
                setLang={setLang}
                serverOk={serverOk}
                onOpenAudio={() => setRightTab("audio")}
                onOpenClips={openClips}
                format={format}
                setFormat={setFormat}
              />
            ) : rightTab === "audio" ? (
              <AudioPanel
                project={project}
                update={update}
                mutateOnServer={mutateOnServer}
                serverOk={serverOk}
                videoSec={videoSec}
                onOpenStructure={() => setRightTab("structure")}
              />
            ) : (
              <StylePanel project={project} update={update} format={format} setFormat={setFormat} onOpenClips={openClips} />
            )}
          </div>
        </aside>
      </div>

      {windowDrag.dragging && !windowDrag.inZone ? (
        <div className="editor-drop-overlay" aria-hidden>
          <div className="editor-drop-card">
            <Icon.Upload size={22} />
            <b>ドロップして素材に追加</b>
            <span>動画・画像(複数可)。ロゴ・BGM・録音・効果音はそれぞれの欄にドロップ</span>
          </div>
        </div>
      ) : null}
      {dropNote ? (
        <div className="drop-note" role="status">
          <Icon.Alert size={14} />
          <span>{dropNote}</span>
          <button className="btn btn-icon btn-ghost" onClick={() => setDropNote(null)} aria-label="閉じる">
            <Icon.Close size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function scriptBadge(project: Project, lang: Lang) {
  const n = project.script.filter((l) => l.lang === lang && hasNarrationInput(l) && l.status !== "ok").length;
  return n > 0 ? (
    <span className="tab-badge-warn" title="未生成・要再生成の行">
      {n}
    </span>
  ) : null;
}

/** Index shown in the clip marker ("クリップ N"): position in the slot, or the cut number for the trailer. */
function editingIndexOf(project: Project, clip: Clip | null): number {
  if (!clip) return -1;
  if (project.template === "trailer" || project.template === "intro" || isShortTemplate(project.template)) return trailerClipOrder(project).indexOf(clip);
  return project.clips.filter((c) => c.slot === clip.slot).indexOf(clip);
}

function audioBadge(project: Project) {
  const se = templateUsesSe(project.template) && project.audio.se.enabled && project.audio.se.volume > 0;
  const parts = [project.audio.bgm ? "BGM" : null, se ? "SE" : null].filter(Boolean);
  return parts.length ? parts.join("+") : null;
}

/** Warning badge on the 構成 tab: trailer beat sync without beats / intro lines that cannot be attached. */
function structureBadge(project: Project, lang: Lang) {
  const intro = isShortTemplate(project.template) ? shortWarnings(project, project.template) : introWarnings(project, lang);
  if (intro.length) {
    return (
      <span className="tab-badge-warn" title={intro.join("\n")}>
        !
      </span>
    );
  }
  if (project.template !== "trailer" || !project.templateData.trailer.beatSync) return null;
  if ((project.audio.bgm?.beats?.length ?? 0) >= 2) return null;
  return (
    <span className="tab-badge-warn" title="ビート同期に BGM のビート解析が必要です">
      !
    </span>
  );
}

function SourceNotReady({ source }: { source: Source }) {
  const pending = source.proxyStatus === "pending";
  return (
    <div className={cx("src-wait", !pending && "is-error")}>
      {pending ? <Spinner size={18} /> : <Icon.Alert size={18} />}
      <div>
        <div className="src-wait-title">{pending ? "プレビュー用プロキシを生成中…" : "プロキシの生成に失敗しました"}</div>
        <div className={cx("field-hint", !pending && "mono")}>
          {pending
            ? `${sourceName(source)}(${Math.round(source.durationSec)} 秒)。完了すると自動で表示されます。`
            : source.proxyError ?? "不明なエラー"}
        </div>
      </div>
    </div>
  );
}

function SavePill({ state, error, onRetry }: { state: SaveState; error: string | null; onRetry: () => void }) {
  const label =
    state === "saved" ? "保存済み" : state === "saving" ? "保存中…" : state === "dirty" ? "未保存の変更" : "保存に失敗";
  return (
    <button
      type="button"
      className={cx("save-pill", `save-${state}`)}
      onClick={state === "error" || state === "dirty" ? onRetry : undefined}
      title={state === "error" ? `${error ?? ""}(クリックで再試行)` : state === "dirty" ? "クリックで今すぐ保存" : undefined}
      aria-live="polite"
    >
      {state === "saving" ? <Spinner size={10} /> : state === "saved" ? <Icon.Check size={12} /> : <span className="dot" />}
      {label}
    </button>
  );
}
