import { useRef, useState, type FormEvent } from "react";
import { isStillImageSource, type Project, type Source } from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import { errorMessage } from "../api";
import { acceptAttr, SOURCE_EXTS, useFileDrop } from "../hooks/useFileDrop";
import type { SourceUpload, SourceUploads } from "../hooks/useSourceUploads";
import { cx, formatTime, sourceName } from "../util";
import { Banner, Empty, Icon, Section, Spinner } from "./ui";

export function SourcesPanel(props: {
  project: Project;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (path: string) => Promise<void>;
  onRemove: (id: string) => void;
  /** dropped / chosen files (POST /sources/upload, with progress) */
  uploads: SourceUploads;
  /** image sources: add a main-slot clip [0, 3 s] */
  onAddImageClip: (sourceId: string) => void;
  disabled?: boolean;
}) {
  const { project, uploads } = props;
  const [path, setPath] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const drop = useFileDrop({
    accept: SOURCE_EXTS,
    multiple: true,
    disabled: props.disabled,
    onFiles: (files) => {
      setError(null);
      uploads.add(files);
    },
    onReject: (files) => setError(`動画・画像ではないファイルは登録できません: ${files.map((f) => f.name).join(", ")}`),
  });

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
    const owned = inProjectMedia(project, s);
    const msg =
      n > 0
        ? `「${sourceName(s)}」を削除しますか?\nこの素材を使うクリップ ${n} 本と候補も削除されます。`
        : owned
          ? `「${sourceName(s)}」をプロジェクトから外しますか?(プロジェクト内にコピーした素材ファイルも削除されます)`
          : `「${sourceName(s)}」をプロジェクトから外しますか?(元ファイルは削除されません)`;
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
      <div className={cx("drop-zone", drop.over && "is-drop-over")} data-drop-label="ここにドロップ(動画・画像)" {...drop.dropProps}>
        <form className="add-source" onSubmit={submit}>
          <input
            className="input mono"
            placeholder="D:\Videos\gameplay.mp4"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            disabled={adding || props.disabled}
            aria-label="動画・画像ファイルの絶対パス"
            spellCheck={false}
          />
          <button className="btn" type="submit" disabled={!path.trim() || adding || props.disabled}>
            {adding ? <Spinner /> : <Icon.Plus />} 登録
          </button>
          <button
            className="btn btn-icon"
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={props.disabled}
            title="ファイルを選択してアップロード(複数可)"
            aria-label="ファイルを選択してアップロード"
          >
            <Icon.Upload />
          </button>
        </form>
        <input
          ref={fileRef}
          type="file"
          accept={acceptAttr(SOURCE_EXTS)}
          multiple
          hidden
          onChange={(e) => {
            uploads.add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <div className="field-hint">
          動画・画像をここにドロップ(複数可)するか、絶対パスを入力(「パスのコピー」をそのまま貼り付け可)。
          画像は変換せずそのまま素材になります(クリップごとに長さと動きを設定)。動画のプレビュー用プロキシは裏で生成されます。
        </div>

        {error ? <Banner tone="error">登録に失敗しました: {error}</Banner> : null}
        {uploads.items.length ? (
          <ul className="upload-list">
            {uploads.items.map((u) => (
              <UploadRow key={u.key} u={u} onDismiss={() => uploads.dismiss(u.key)} />
            ))}
          </ul>
        ) : null}

        {project.sources.length === 0 ? (
          <Empty compact icon={<Icon.Film size={22} />} title="素材がありません">
            ゲームプレイ動画や画像を登録すると、ここからクリップを切り出せます。
          </Empty>
        ) : (
          <ul className="source-list">
            {project.sources.map((s) => {
              const n = clipCount(s.id);
              const nc = candCount(s.id);
              const image = s.kind === "image";
              // legacy image sources (converted to an 8 s still video before native images) stay videos
              const still = isStillImageSource(s);
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
                      {still ? null : <span className="source-dur mono">{formatTime(s.durationSec).replace(/\.\d+$/, "")}</span>}
                    </div>
                    <div className="source-meta">
                      <div className="source-name">
                        {image ? <span className="badge-image">画像</span> : null}
                        {sourceName(s)}
                      </div>
                      <div className="source-sub mono">
                        {still
                          ? `${s.width}×${s.height} · 静止画`
                          : image
                            ? `静止画 → ${Math.round(s.durationSec)}秒の動画(旧形式)`
                            : `${s.width}×${s.height} · ${Math.round(s.fps * 100) / 100}fps${s.hasAudio ? "" : " · 無音"}`}
                      </div>
                      <div className="source-sub source-status">
                        {s.proxyStatus === "pending" ? (
                          <span className="st-pending">{image ? "準備中…" : "プロキシ生成中…"}</span>
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
                    aria-label={`${sourceName(s)} を外す`}
                    onClick={() => remove(s)}
                  >
                    <Icon.Trash />
                  </button>
                  {image && s.proxyStatus === "ready" ? (
                    <div className="source-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => props.onAddImageClip(s.id)}
                        title="本編の最後に 3 秒のクリップとして追加(長さは後から調整できます)"
                      >
                        <Icon.Plus size={12} /> クリップに追加
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}

/** Uploaded file / image (or legacy image video) in projects/<id>/media: removing the source deletes that file (server side). */
function inProjectMedia(project: Project, s: Source): boolean {
  const p = s.originalPath.replace(/\\/g, "/");
  return s.kind === "image" || p.includes(`/${project.id}/media/`);
}

function UploadRow({ u, onDismiss }: { u: SourceUpload; onDismiss: () => void }) {
  const pct = u.total > 0 ? Math.min(100, Math.round((u.loaded / u.total) * 100)) : 0;
  const mb = (b: number) => (b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0);
  const failed = u.status === "error";
  return (
    <li className={cx("upload-row", failed && "is-error")}>
      <span className="upload-icon">{u.kind === "image" ? <Icon.Image size={14} /> : <Icon.Film size={14} />}</span>
      <div className="upload-main">
        <div className="upload-name" title={u.name}>
          {u.name}
        </div>
        {failed ? (
          <div className="upload-sub st-error" title={u.error}>
            アップロードに失敗: {u.error}
          </div>
        ) : (
          <>
            <div className="upload-bar">
              <span style={{ width: `${u.status === "registering" ? 100 : pct}%` }} />
            </div>
            <div className="upload-sub mono">
              {u.status === "queued"
                ? "待機中"
                : u.status === "registering"
                  ? "登録中…"
                  : `${pct}% · ${mb(u.loaded)} / ${mb(u.total)} MB`}
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        className="btn btn-icon btn-ghost"
        onClick={onDismiss}
        title={failed ? "閉じる" : "キャンセル"}
        aria-label={failed ? "閉じる" : "アップロードをキャンセル"}
        disabled={u.status === "registering"}
      >
        <Icon.Close size={12} />
      </button>
    </li>
  );
}
