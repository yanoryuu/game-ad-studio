import { useCallback, useEffect, useState } from "react";
import { generateId, type Clip, type Format, type Lang } from "@gas/shared";
import { api, ApiError } from "../api";
import { useHealth } from "../hooks/useHealth";
import { useProject, type SaveState } from "../hooks/useProject";
import { navigate } from "../hooks/useHashRoute";
import { cx } from "../util";
import { ClipList } from "./ClipList";
import { ClipMarker, type ClipDraft } from "./ClipMarker";
import { Inspector } from "./Inspector";
import { PreviewPane } from "./PreviewPane";
import { RenderPanel } from "./RenderPanel";
import { ServerDown } from "./ServerDown";
import { SourcesPanel } from "./SourcesPanel";
import { Banner, Empty, Icon, Spinner } from "./ui";

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
  const { project, update, flush, mutateOnServer, saveState, saveError } = store;
  const health = useHealth();
  const [format, setFormat] = usePref<Format>(`gas:${projectId}:format`, "16:9", ["16:9", "9:16"]);
  const [lang, setLang] = usePref<Lang>(`gas:${projectId}:lang`, "ja", ["ja", "en"]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);

  // Reload the project once the server comes back after a failed load.
  const { reload, loadError } = store;
  useEffect(() => {
    if (health.status === "ok" && loadError instanceof ApiError && loadError.status === 0) void reload();
  }, [health.status, loadError, reload]);

  // Default-select the first source.
  useEffect(() => {
    if (!project) return;
    if (!selectedSourceId || !project.sources.some((s) => s.id === selectedSourceId)) {
      setSelectedSourceId(project.sources[0]?.id ?? null);
    }
  }, [project, selectedSourceId]);

  const updateClip = useCallback(
    (clipId: string, patch: Partial<ClipDraft>) =>
      update((p) => ({ ...p, clips: p.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) })),
    [update],
  );

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

  const selectedSource = project.sources.find((s) => s.id === selectedSourceId) ?? null;
  const editingClip = project.clips.find((c) => c.id === editingClipId) ?? null;
  const markerSource = editingClip ? project.sources.find((s) => s.id === editingClip.sourceId) ?? null : selectedSource;

  const addClip = (draft: ClipDraft) => {
    if (!selectedSource) return;
    const clip: Clip = { id: generateId("clip", 8), sourceId: selectedSource.id, ...draft };
    update((p) => {
      // hook clips go after the last hook clip so hooks stay grouped at the top
      if (clip.slot === "hook") {
        const last = p.clips.map((c) => c.slot).lastIndexOf("hook");
        const clips = p.clips.slice();
        clips.splice(last + 1, 0, clip);
        return { ...p, clips };
      }
      return { ...p, clips: [...p.clips, clip] };
    });
  };

  const addSource = async (path: string) => {
    const before = new Set(project.sources.map((s) => s.id));
    const next = await mutateOnServer((p) => api.addSource(p.id, { path }));
    const added = next.sources.find((s) => !before.has(s.id));
    if (added) {
      setSelectedSourceId(added.id);
      setEditingClipId(null);
    }
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
        <aside className="pane pane-left">
          <SourcesPanel
            project={project}
            selectedId={editingClip ? editingClip.sourceId : selectedSourceId}
            onSelect={(id) => {
              setSelectedSourceId(id);
              setEditingClipId(null);
            }}
            onAdd={addSource}
            disabled={health.status === "down"}
          />
          {markerSource ? (
            <ClipMarker
              project={project}
              source={markerSource}
              editingClip={editingClip}
              editingIndex={editingClip ? project.clips.filter((c) => c.slot === editingClip.slot).indexOf(editingClip) : -1}
              onAdd={addClip}
              onUpdate={updateClip}
              onDoneEditing={() => setEditingClipId(null)}
            />
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
        </aside>

        <main className="pane pane-center">
          <PreviewPane project={project} format={format} lang={lang} />
          <RenderPanel project={project} format={format} lang={lang} flush={flush} serverOk={health.status !== "down"} />
        </main>

        <aside className="pane pane-right">
          <Inspector project={project} update={update} format={format} setFormat={setFormat} lang={lang} setLang={setLang} />
        </aside>
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
