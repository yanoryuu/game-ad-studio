import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Project } from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import { errorMessage } from "../api";
import { basename, cx, formatTime } from "../util";
import { Banner, Empty, Icon, Section, Spinner } from "./ui";

export function SourcesPanel(props: {
  project: Project;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (path: string) => Promise<void>;
  disabled?: boolean;
}) {
  const { project } = props;
  const [path, setPath] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!adding) return;
    const t = window.setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 250);
    return () => window.clearInterval(t);
  }, [adding]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // Users often paste paths copied with "Copy as path" (wrapped in quotes).
    const p = path.trim().replace(/^"(.*)"$/, "$1");
    if (!p) return;
    setError(null);
    setAdding(p);
    startedAt.current = Date.now();
    setElapsed(0);
    try {
      await props.onAdd(p);
      setPath("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdding(null);
    }
  };

  const clipCount = (sid: string) => project.clips.filter((c) => c.sourceId === sid).length;

  return (
    <Section title="素材" aside={<span className="mono muted">{project.sources.length}</span>}>
      <form className="add-source" onSubmit={submit}>
        <input
          className="input mono"
          placeholder="D:\Videos\gameplay.mp4"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          disabled={!!adding || props.disabled}
          aria-label="動画ファイルの絶対パス"
          spellCheck={false}
        />
        <button className="btn" type="submit" disabled={!path.trim() || !!adding || props.disabled}>
          {adding ? <Spinner /> : <Icon.Plus />} 登録
        </button>
      </form>
      <div className="field-hint">動画ファイルの絶対パスを入力(エクスプローラーの「パスのコピー」をそのまま貼り付け可)</div>

      {adding ? (
        <div className="ingest" role="status">
          <div className="ingest-row">
            <Spinner />
            <span className="ingest-name" title={adding}>
              {basename(adding)}
            </span>
            <span className="mono muted ml-auto">{formatTime(elapsed).replace(/\.\d+$/, "")}</span>
          </div>
          <div className="ingest-bar">
            <span />
          </div>
          <div className="field-hint">解析とプレビュー用プロキシ(720p)を生成中… 長い動画は数分かかります。</div>
        </div>
      ) : null}

      {error ? <Banner tone="error">登録に失敗しました: {error}</Banner> : null}

      {project.sources.length === 0 && !adding ? (
        <Empty compact icon={<Icon.Film size={22} />} title="素材がありません">
          ゲームプレイ動画を登録すると、ここからクリップを切り出せます。
        </Empty>
      ) : (
        <ul className="source-list">
          {project.sources.map((s) => {
            const n = clipCount(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={cx("source-card", props.selectedId === s.id && "is-active")}
                  onClick={() => props.onSelect(s.id)}
                  title={s.originalPath}
                >
                  <div className="source-thumb">
                    <img src={assetUrl("", project.id, s.thumbPath)} alt="" loading="lazy" />
                    <span className="source-dur mono">{formatTime(s.durationSec).replace(/\.\d+$/, "")}</span>
                  </div>
                  <div className="source-meta">
                    <div className="source-name">{basename(s.originalPath)}</div>
                    <div className="source-sub mono">
                      {s.width}×{s.height} · {Math.round(s.fps * 100) / 100}fps{s.hasAudio ? "" : " · 無音"}
                    </div>
                    <div className="source-sub">{n > 0 ? `クリップ ${n}` : "未使用"}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
