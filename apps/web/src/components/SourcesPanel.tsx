import { useState, type FormEvent } from "react";
import type { Project, Source } from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import { errorMessage } from "../api";
import { basename, cx, formatTime } from "../util";
import { Banner, Empty, Icon, Section, Spinner } from "./ui";

export function SourcesPanel(props: {
  project: Project;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (path: string) => Promise<void>;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const { project } = props;
  const [path, setPath] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // Users often paste paths copied with "Copy as path" (wrapped in quotes).
    const p = path.trim().replace(/^"(.*)"$/, "$1");
    if (!p) return;
    setError(null);
    setAdding(true);
    try {
      await props.onAdd(p);
      setPath("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  const clipCount = (sid: string) => project.clips.filter((c) => c.sourceId === sid).length;
  const candCount = (sid: string) => project.candidates.filter((c) => c.sourceId === sid).length;

  const remove = (s: Source) => {
    const n = clipCount(s.id);
    const msg =
      n > 0
        ? `「${basename(s.originalPath)}」を削除しますか?\nこの素材を使うクリップ ${n} 本と候補も削除されます。`
        : `「${basename(s.originalPath)}」をプロジェクトから外しますか?(元ファイルは削除されません)`;
    if (window.confirm(msg)) props.onRemove(s.id);
  };

  const pending = project.sources.filter((s) => s.proxyStatus === "pending").length;

  return (
    <Section
      title="素材"
      aside={
        <span className="mono muted">
          {pending > 0 ? (
            <span className="warn">
              <Spinner size={9} /> 準備中 {pending} ·{" "}
            </span>
          ) : null}
          {project.sources.length}
        </span>
      }
    >
      <form className="add-source" onSubmit={submit}>
        <input
          className="input mono"
          placeholder="D:\Videos\gameplay.mp4"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          disabled={adding || props.disabled}
          aria-label="動画ファイルの絶対パス"
          spellCheck={false}
        />
        <button className="btn" type="submit" disabled={!path.trim() || adding || props.disabled}>
          {adding ? <Spinner /> : <Icon.Plus />} 登録
        </button>
      </form>
      <div className="field-hint">
        動画ファイルの絶対パスを入力(「パスのコピー」をそのまま貼り付け可)。プレビュー用プロキシは裏で生成されます。
      </div>

      {error ? <Banner tone="error">登録に失敗しました: {error}</Banner> : null}

      {project.sources.length === 0 ? (
        <Empty compact icon={<Icon.Film size={22} />} title="素材がありません">
          ゲームプレイ動画を登録すると、ここからクリップを切り出せます。
        </Empty>
      ) : (
        <ul className="source-list">
          {project.sources.map((s) => {
            const n = clipCount(s.id);
            const nc = candCount(s.id);
            return (
              <li key={s.id} className="source-item">
                <button
                  type="button"
                  className={cx(
                    "source-card",
                    props.selectedId === s.id && "is-active",
                    s.proxyStatus === "error" && "is-error",
                  )}
                  onClick={() => props.onSelect(s.id)}
                  title={s.originalPath}
                >
                  <div className="source-thumb">
                    {s.proxyStatus === "ready" ? (
                      <img src={assetUrl("", project.id, s.thumbPath)} alt="" loading="lazy" />
                    ) : s.proxyStatus === "pending" ? (
                      <span className="source-thumb-state">
                        <Spinner size={16} />
                      </span>
                    ) : (
                      <span className="source-thumb-state is-error">
                        <Icon.Alert size={18} />
                      </span>
                    )}
                    <span className="source-dur mono">{formatTime(s.durationSec).replace(/\.\d+$/, "")}</span>
                  </div>
                  <div className="source-meta">
                    <div className="source-name">{basename(s.originalPath)}</div>
                    <div className="source-sub mono">
                      {s.width}×{s.height} · {Math.round(s.fps * 100) / 100}fps{s.hasAudio ? "" : " · 無音"}
                    </div>
                    <div className="source-sub source-status">
                      {s.proxyStatus === "pending" ? (
                        <span className="st-pending">プロキシ生成中…</span>
                      ) : s.proxyStatus === "error" ? (
                        <span className="st-error" title={s.proxyError}>
                          変換に失敗{s.proxyError ? `: ${s.proxyError}` : ""}
                        </span>
                      ) : (
                        <>
                          <span>{n > 0 ? `クリップ ${n}` : "未使用"}</span>
                          {s.analysisStatus === "running" ? (
                            <span className="st-pending">
                              <Spinner size={8} /> 解析中
                            </span>
                          ) : s.analysisStatus === "done" ? (
                            <span className="st-ok">候補 {nc}</span>
                          ) : s.analysisStatus === "error" ? (
                            <span className="st-error" title={s.analysisError}>
                              解析エラー
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  className="btn btn-icon btn-ghost btn-danger source-remove"
                  title="素材を外す"
                  aria-label={`${basename(s.originalPath)} を外す`}
                  onClick={() => remove(s)}
                >
                  <Icon.Trash />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
