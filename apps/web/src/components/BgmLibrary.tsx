import { useMemo, useRef, useState } from "react";
import { BGM_EXTS, BGM_MOODS, BGM_SOURCES, bgmSourceInfo, type BgmFile, type BgmMood, type Project } from "@gas/shared";
import { api, errorMessage } from "../api";
import { bgmFilesOf, useBgmLibrary } from "../hooks/useBgmLibrary";
import { acceptAttr, useFileDrop } from "../hooks/useFileDrop";
import type { MutateOnServer } from "../hooks/useProject";
import { useAudioPlayer } from "../hooks/useTts";
import { cx } from "../util";
import { Banner, Icon, Spinner } from "./ui";

const MOOD_LABEL: Record<string, string> = Object.fromEntries(BGM_MOODS.map((m) => [m.id, m.label]));

/** Preview URL of a library track (GET /api/bgm/file/<id>, relative = Vite proxy). */
export const bgmLibraryFileUrl = (id: string) => `/api/bgm/file/${id.split("/").map(encodeURIComponent).join("/")}`;

export const formatMinSec = (sec: number) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** True when the track's source requires a credit but none is set. */
export const needsCredit = (f: { source?: string; credit?: string }) => !!bgmSourceInfo(f.source)?.creditRequired && !f.credit?.trim();

/** 音声タブ BGM: local BGM library browser (ARCHITECTURE §6.14). */
export function BgmLibrary(props: { project: Project; mutateOnServer: MutateOnServer; serverOk: boolean }) {
  const { project } = props;
  const lib = useBgmLibrary(true);
  const files = bgmFilesOf(lib.state);
  const player = useAudioPlayer();
  const [query, setQuery] = useState("");
  const [moods, setMoods] = useState<BgmMood[]>([]);
  const [busy, setBusy] = useState<"rescan" | "upload" | null>(null);
  const [using, setUsing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const currentId = project.audio.bgm?.library?.id;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (files ?? []).filter(
      (f) =>
        (!q || f.id.toLowerCase().includes(q) || (f.source ?? "").toLowerCase().includes(q) || (f.note ?? "").toLowerCase().includes(q)) &&
        (moods.length === 0 || moods.some((m) => f.tags.includes(m))),
    );
  }, [files, query, moods]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of files ?? []) for (const t of f.tags) c[t] = (c[t] ?? 0) + 1;
    return c;
  }, [files]);

  const uploadFiles = async (list: File[]) => {
    if (!list.length) return;
    setBusy("upload");
    setMsg(null);
    setAdded(null);
    const done: string[] = [];
    try {
      for (const f of list) {
        await lib.upload(f);
        done.push(f.name);
      }
      setAdded(`${done.join(", ")} をライブラリに追加しました。クレジットとタグを設定してください`);
    } catch (e) {
      setMsg(`追加できません: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const drop = useFileDrop({
    accept: BGM_EXTS,
    multiple: true,
    disabled: busy !== null || !props.serverOk,
    onFiles: (f) => void uploadFiles(f),
    onReject: (f) => setMsg(`BGM にできるのは ${BGM_EXTS.join(" / ")} です: ${f.map((x) => x.name).join(", ")}`),
  });

  const rescan = async () => {
    setBusy("rescan");
    setMsg(null);
    try {
      await lib.rescan();
    } catch (e) {
      setMsg(`再読み込みできません: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const use = async (f: BgmFile) => {
    setUsing(f.id);
    setMsg(null);
    player.stop();
    try {
      await props.mutateOnServer((p) => api.bgmFromLibrary(p.id, f.id), { pauseSaves: true });
    } catch (e) {
      setMsg(`使えません: ${errorMessage(e)}`);
    } finally {
      setUsing(null);
    }
  };

  const toggleMood = (m: BgmMood) => setMoods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  return (
    <div className="bgm-lib">
      <div className="bgm-lib-head">
        <span className="field-label">BGM ライブラリ</span>
        <span className="mono muted">{files ? files.length : ""}</span>
        <span className="ml-auto se-lib-actions">
          <button
            className="btn btn-sm"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null || !props.serverOk}
            title="音声ファイルをライブラリのフォルダにコピー(ドロップでも追加できます)"
          >
            {busy === "upload" ? <Spinner size={11} /> : <Icon.Upload size={13} />} 追加
          </button>
          <button className="btn btn-sm" onClick={() => void rescan()} disabled={busy !== null || !props.serverOk} title="フォルダを読み直す">
            {busy === "rescan" ? <Spinner size={11} /> : <Icon.Refresh size={13} />} 再読み込み
          </button>
        </span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={acceptAttr(BGM_EXTS)}
        multiple
        hidden
        onChange={(e) => {
          void uploadFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      <div className={cx("drop-zone bgm-lib-drop", drop.over && "is-drop-over")} data-drop-label="ここにドロップして BGM ライブラリに追加" {...drop.dropProps}>
        {lib.state.kind === "loading" || lib.state.kind === "idle" ? (
          <div className="field-hint">
            <Spinner size={10} /> 読み込み中…
          </div>
        ) : lib.state.kind === "error" ? (
          <Banner
            tone="error"
            action={
              <button className="btn btn-sm" onClick={() => void lib.reload().catch(() => {})}>
                再試行
              </button>
            }
          >
            BGM ライブラリを読み込めません: {lib.state.message}
          </Banner>
        ) : (
          <LibDir dir={lib.state.data.dir} exists={lib.state.data.exists} />
        )}

        {files ? (
          <>
            <div className="bgm-lib-filter">
              <input
                className="input input-sm"
                type="search"
                placeholder="曲名で検索"
                aria-label="BGM を曲名で検索"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="bgm-moods" role="group" aria-label="ムードで絞り込み">
                {BGM_MOODS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={cx("bgm-mood", moods.includes(m.id) && "is-on")}
                    aria-pressed={moods.includes(m.id)}
                    onClick={() => toggleMood(m.id)}
                  >
                    {m.label}
                    {counts[m.id] ? <span className="bgm-mood-n">{counts[m.id]}</span> : null}
                  </button>
                ))}
                {moods.length ? (
                  <button type="button" className="link-btn" onClick={() => setMoods([])}>
                    解除
                  </button>
                ) : null}
              </div>
            </div>

            {files.length === 0 ? (
              <div className="field-hint">まだ曲がありません。上のフォルダに曲を置いて「再読み込み」、またはここにドロップしてください。</div>
            ) : shown.length === 0 ? (
              <div className="field-hint">条件に合う曲がありません。</div>
            ) : (
              <ul className="bgm-lib-list">
                {shown.map((f) => {
                  const key = `bgm:${f.id}`;
                  const on = player.playingId === key;
                  const cur = f.id === currentId;
                  const src = bgmSourceInfo(f.source);
                  return (
                    <li key={f.id} className={cx("bgm-track", cur && "is-current")}>
                      <div className="bgm-track-row">
                        <button
                          className={cx("btn btn-icon btn-ghost", on && "is-on")}
                          title={on ? "停止" : "試聴"}
                          aria-label={`${f.name} を試聴`}
                          disabled={!props.serverOk}
                          onClick={() => (on ? player.stop() : player.play(key, bgmLibraryFileUrl(f.id)))}
                        >
                          {on ? <Icon.Stop size={12} /> : <Icon.Play size={13} />}
                        </button>
                        <div className="bgm-track-main">
                          <div className="bgm-track-name" title={f.id}>
                            {f.name}
                            <span className="mono muted">{f.durationSec > 0 ? formatMinSec(f.durationSec) : "—"}</span>
                          </div>
                          <div className="bgm-track-badges">
                            {f.source ? <span className="bgm-badge">{f.source}</span> : null}
                            {f.credit ? (
                              <span className="bgm-badge is-credit" title={f.credit}>
                                クレジット: {f.credit}
                              </span>
                            ) : src && !src.creditRequired ? (
                              <span className="bgm-badge is-free">クレジット不要</span>
                            ) : null}
                            {needsCredit(f) ? <span className="bgm-badge is-warn">⚠ クレジット未設定</span> : null}
                            {f.tags.map((t) => (
                              <span key={t} className="bgm-tag">
                                {MOOD_LABEL[t]}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          className={cx("btn btn-icon btn-ghost", editing === f.id && "is-on")}
                          title="クレジット・出典・タグを編集"
                          aria-label={`${f.name} の情報を編集`}
                          disabled={!props.serverOk}
                          onClick={() => setEditing(editing === f.id ? null : f.id)}
                        >
                          <Icon.Edit size={13} />
                        </button>
                        {cur ? (
                          <span className="bgm-using">
                            <Icon.Check size={12} /> 使用中
                          </span>
                        ) : (
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={!props.serverOk || using !== null}
                            onClick={() => void use(f)}
                            title="プロジェクトにコピーして BGM にする(拍の解析も始めます)"
                          >
                            {using === f.id ? <Spinner size={11} /> : null}使う
                          </button>
                        )}
                      </div>
                      {f.id !== f.name ? <div className="se-file-id mono">{f.id}</div> : null}
                      {editing === f.id ? <BgmMetaEditor file={f} lib={lib} onClose={() => setEditing(null)} /> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : null}
        {msg ? <div className="field-hint warn">{msg}</div> : null}
        {added ? <div className="field-hint">{added}</div> : null}
      </div>

      <details className="bgm-sources" open>
        <summary>
          <span className="field-label">おすすめの入手先と表記</span>
        </summary>
        <ul>
          <li>
            <b>OpenTracks(旧DOVA-SYNDROME)</b>・<b>PeriTune</b> — 広告利用 OK・クレジット不要
          </li>
          <li>
            <b>OtoLogic</b> — クレジット必須「BGM by OtoLogic(CC BY 4.0)」
          </li>
          <li>
            <b>魔王魂</b> — 「音楽：魔王魂」と表記
          </li>
          <li className="warn">TikTok などで流行中の楽曲は広告の動画ファイルに焼き込めません(各アプリ内の楽曲機能でのみ利用可)。</li>
        </ul>
        <div className="field-hint">曲は各サイトの利用規約に従って使ってください。ライブラリのフォルダはリポジトリ外で、曲は配布物に含めません。</div>
      </details>
    </div>
  );
}

function BgmMetaEditor(props: { file: BgmFile; lib: ReturnType<typeof useBgmLibrary>; onClose: () => void }) {
  const f = props.file;
  const [credit, setCredit] = useState(f.credit ?? "");
  const [source, setSource] = useState(f.source ?? "");
  const [url, setUrl] = useState(f.url ?? "");
  const [note, setNote] = useState(f.note ?? "");
  const [tags, setTags] = useState<BgmMood[]>(f.tags);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const info = bgmSourceInfo(source);
  const warn = !!info?.creditRequired && !credit.trim();

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await props.lib.saveMeta({ [f.id]: { credit: credit.trim(), source: source.trim(), url: url.trim(), note: note.trim(), tags } });
      props.onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bgm-edit">
      <label className="bgm-edit-row">
        <span>入手先</span>
        <input className="input input-sm" list="bgm-source-list" value={source} maxLength={100} placeholder="例: OpenTracks" onChange={(e) => setSource(e.target.value)} />
        <datalist id="bgm-source-list">
          {BGM_SOURCES.map((s) => (
            <option key={s.id} value={s.names[0]}>
              {s.label}
            </option>
          ))}
        </datalist>
      </label>
      <label className="bgm-edit-row">
        <span>クレジット</span>
        <input
          className={cx("input input-sm", warn && "is-error")}
          value={credit}
          maxLength={200}
          placeholder={info?.creditExample || "不要なら空欄"}
          onChange={(e) => setCredit(e.target.value)}
        />
      </label>
      {warn ? (
        <div className="bgm-edit-warn">
          ⚠ {info!.label} の曲はクレジット表記が必要です。
          <button type="button" className="link-btn" onClick={() => setCredit(info!.creditExample)}>
            「{info!.creditExample}」を入れる
          </button>
        </div>
      ) : null}
      <label className="bgm-edit-row">
        <span>URL</span>
        <input className="input input-sm" value={url} maxLength={500} placeholder="曲のページ(任意)" onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="bgm-edit-row">
        <span>メモ</span>
        <input className="input input-sm" value={note} maxLength={500} placeholder="任意" onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="bgm-moods">
        {BGM_MOODS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={cx("bgm-mood", tags.includes(m.id) && "is-on")}
            aria-pressed={tags.includes(m.id)}
            onClick={() => setTags((cur) => (cur.includes(m.id) ? cur.filter((x) => x !== m.id) : [...cur, m.id]))}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="bgm-edit-actions">
        {err ? <span className="field-hint warn">保存できません: {err}</span> : null}
        <button className="btn btn-sm ml-auto" onClick={props.onClose} disabled={saving}>
          キャンセル
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Spinner size={11} /> : null}保存
        </button>
      </div>
    </div>
  );
}

function LibDir({ dir, exists }: { dir: string; exists: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cx("se-dir", !exists && "is-missing")} title="この場所に曲(サブフォルダ可)を置いて「再読み込み」">
      <Icon.Music size={13} />
      <span className="field-hint">フォルダの場所</span>
      <span className="mono se-dir-path" title={dir}>
        {dir}
      </span>
      <button
        className="btn btn-icon btn-ghost"
        title={copied ? "コピーしました" : "パスをコピー"}
        aria-label="パスをコピー"
        onClick={() => {
          void navigator.clipboard?.writeText(dir).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            },
            () => {},
          );
        }}
      >
        {copied ? <Icon.Check size={12} /> : <Icon.Copy size={13} />}
      </button>
      {!exists ? <div className="se-dir-warn">フォルダがありません。「再読み込み」で作成されます。</div> : null}
    </div>
  );
}
