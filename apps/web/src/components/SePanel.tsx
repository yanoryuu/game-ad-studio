import { useEffect, useRef, useState } from "react";
import { SE_PLACEHOLDER_DIR, SE_SLOTS, templateUsesSe, type Project, type SeFile, type SeSettings, type SeSlot } from "@gas/shared";
import { seFileUrl } from "@gas/compositions";
import { errorMessage } from "../api";
import { acceptAttr, AUDIO_EXTS, useFileDrop } from "../hooks/useFileDrop";
import type { UpdateProject } from "../hooks/useProject";
import { seFilesOf, useSeLibrary } from "../hooks/useSeLibrary";
import { useAudioPlayer } from "../hooks/useTts";
import { cx, formatSec } from "../util";
import { Banner, Icon, Section, Slider, Spinner, Switch } from "./ui";

const SLOT_INFO: Record<SeSlot, { label: string; desc: string }> = {
  captionPop: { label: "字幕の出現", desc: "字幕が切り替わるたび" },
  headline: { label: "見出し", desc: "冒頭で見出し帯が出るとき" },
  point: { label: "ポイント", desc: "①②③ のポイントが出るとき" },
  info: { label: "情報カード", desc: "ゲーム情報カードが出るとき" },
  transition: { label: "場面転換", desc: "映像が切り替わるとき" },
  cta: { label: "エンドカード", desc: "エンドカードが始まるとき" },
};

const isPlaceholder = (id: string) => id.startsWith(`${SE_PLACEHOLDER_DIR}/`);
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 音声 tab: sound effects (audio.se) + the SE library (ARCHITECTURE §5.9 / §6.12 / §7 [v4]). */
export function SePanel(props: { project: Project; update: UpdateProject; serverOk: boolean; onOpenStructure?: () => void }) {
  const { project, update } = props;
  const usesSe = templateUsesSe(project.template);
  const lib = useSeLibrary(usesSe);
  const player = useAudioPlayer();
  const se = project.audio.se;
  const files = seFilesOf(lib.state);
  const [busy, setBusy] = useState<"rescan" | "upload" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /** Copies dropped / chosen audio files into the library root (POST /api/se/upload), one by one. */
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
      setAdded(`${done.join(", ")} をライブラリに追加しました`);
    } catch (e) {
      setMsg(`追加できません: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const drop = useFileDrop({
    accept: AUDIO_EXTS,
    multiple: true,
    disabled: busy !== null || !props.serverOk || !usesSe,
    onFiles: (f) => void uploadFiles(f),
    onReject: (f) => setMsg(`効果音にできるのは .wav / .mp3 / .ogg / .m4a / .aac です: ${f.map((x) => x.name).join(", ")}`),
  });

  const setSe = (fn: (s: SeSettings) => SeSettings) => update((p) => ({ ...p, audio: { ...p.audio, se: fn(p.audio.se) } }));
  const setSlot = (slot: SeSlot, id: string) =>
    setSe((s) => {
      const slots = { ...s.slots };
      if (id) slots[slot] = id;
      else delete slots[slot];
      return { ...s, slots };
    });

  const play = (key: string, id: string) => {
    if (player.playingId === key) return player.stop();
    player.play(key, seFileUrl("", id));
  };

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

  if (!usesSe) {
    return (
      <Section title="効果音">
        <div className="se-off-note">
          <Icon.Speaker size={14} />
          <span>
            効果音は <b>紹介動画風</b> と <b>ショート向け</b> のテンプレートでのみ鳴ります(見出し・ポイント・情報カード・場面転換・字幕の出現など)。
            このテンプレートでは鳴りません。
          </span>
        </div>
        {props.onOpenStructure ? (
          <button className="link-btn" onClick={props.onOpenStructure}>
            構成タブでテンプレートを選ぶ
          </button>
        ) : null}
      </Section>
    );
  }

  const user = files?.filter((f) => !isPlaceholder(f.id)) ?? [];
  const placeholders = files?.filter((f) => isPlaceholder(f.id)) ?? [];
  const usedBy = (id: string) => SE_SLOTS.filter((s) => se.slots[s] === id);
  const off = !se.enabled || se.volume <= 0;

  return (
    <>
      <Section
        title="効果音"
        aside={<Switch checked={se.enabled} onChange={(enabled) => setSe((s) => ({ ...s, enabled }))} label="鳴らす" />}
      >
        <div className="field-hint">紹介動画風とショート向けテンプレートでのみ鳴ります。ナレーション中も音量は下げません。</div>
        <Slider
          label="効果音の音量"
          value={se.volume}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          disabled={!se.enabled}
          onChange={(volume) => setSe((s) => ({ ...s, volume }))}
        />
        <ol className={cx("se-slots", off && "is-off")}>
          {SE_SLOTS.map((slot) => {
            const id = se.slots[slot] ?? "";
            const missing = !!id && !!files && !files.some((f) => f.id === id);
            const key = `slot:${slot}`;
            return (
              <li key={slot} className={cx("se-slot", missing && "is-missing")}>
                <div className="se-slot-name">
                  <b>{SLOT_INFO[slot].label}</b>
                  <span>{SLOT_INFO[slot].desc}</span>
                </div>
                <select
                  className={cx("input input-sm", !id && "is-auto")}
                  value={id}
                  onChange={(e) => setSlot(slot, e.target.value)}
                  aria-label={`${SLOT_INFO[slot].label} の効果音`}
                  disabled={!files && lib.state.kind === "loading"}
                >
                  <option value="">なし(無音)</option>
                  {user.length ? (
                    <optgroup label="ユーザー素材">
                      {user.map((f) => (
                        <option key={f.id} value={f.id}>
                          {fileLabel(f)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {placeholders.length ? (
                    <optgroup label="プレースホルダー(仮 SE)">
                      {placeholders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {fileLabel(f)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {id && (!files || missing) ? <option value={id}>{missing ? `⚠ ${id}(見つかりません)` : id}</option> : null}
                </select>
                <button
                  className={cx("btn btn-icon btn-ghost", player.playingId === key && "is-on")}
                  title={player.playingId === key ? "停止" : "試聴"}
                  aria-label={`${SLOT_INFO[slot].label} を試聴`}
                  disabled={!id || missing || !props.serverOk}
                  onClick={() => play(key, id)}
                >
                  {player.playingId === key ? <Icon.Stop size={12} /> : <Icon.Play size={13} />}
                </button>
                {missing ? <div className="se-slot-warn">ライブラリに無いファイルです。書き出しでは無音になります。</div> : null}
              </li>
            );
          })}
        </ol>
      </Section>

      <Section
        title="SE ライブラリ"
        aside={
          <span className="se-lib-actions">
          <button
            className="btn btn-sm"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null || !props.serverOk}
            title="音声ファイルをライブラリのフォルダにコピー(ドロップでも追加できます)"
          >
            {busy === "upload" ? <Spinner size={11} /> : <Icon.Upload size={13} />} 追加
          </button>
          <button className="btn btn-sm" onClick={() => void rescan()} disabled={busy !== null || !props.serverOk} title="POST /api/se/rescan">
            {busy === "rescan" ? <Spinner size={11} /> : <Icon.Refresh size={13} />} フォルダを再読み込み
          </button>
          </span>
        }
      >
        <input
          ref={fileRef}
          type="file"
          accept={acceptAttr(AUDIO_EXTS)}
          multiple
          hidden
          onChange={(e) => {
            void uploadFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <div className={cx("drop-zone se-drop", drop.over && "is-drop-over")} data-drop-label="ここにドロップして効果音を追加" {...drop.dropProps}>
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
            SE ライブラリを読み込めません: {lib.state.message}
          </Banner>
        ) : (
          <>
            <LibDir dir={lib.state.data.dir} exists={lib.state.data.exists} />
            <div className="se-guide">
              効果音ラボ・OtoLogic などのフリー素材(.wav / .mp3 / .ogg / .m4a / .aac)をこのフォルダ(サブフォルダ可)に置き、
              「フォルダを再読み込み」を押すと選べるようになります(ここにドロップ /「追加」でもフォルダにコピーできます)。素材は各サイトの利用規約に従ってください(リポジトリには含めません)。
              クレジット表記が必要な素材は下の欄に入力すると、書き出しのクレジット一覧とエンドカードに出ます。
            </div>
          </>
        )}
        {msg ? <div className="field-hint warn">{msg}</div> : null}
        {added ? <div className="field-hint">{added}</div> : null}

        {files ? (
          <>
            <div className="se-group-head">
              <span className="field-label">ユーザー素材</span>
              <span className="mono muted">{user.length}</span>
            </div>
            {user.length === 0 ? (
              <div className="field-hint">まだありません。フォルダに効果音ファイルを置いて再読み込みしてください。</div>
            ) : (
              <ul className="se-files">
                {user.map((f) => (
                  <SeFileRow key={f.id} file={f} usedBy={usedBy(f.id)} player={player} onPlay={() => play(`file:${f.id}`, f.id)} lib={lib} disabled={!props.serverOk} />
                ))}
              </ul>
            )}
            <details className="se-ph">
              <summary>
                <span className="field-label">プレースホルダー(仮 SE)</span>
                <span className="mono muted">{placeholders.length}</span>
              </summary>
              <div className="field-hint">サーバーが自動で作る仮の効果音です。好きな素材に差し替えてください。</div>
              <ul className="se-files">
                {placeholders.map((f) => (
                  <SeFileRow key={f.id} file={f} usedBy={usedBy(f.id)} player={player} onPlay={() => play(`file:${f.id}`, f.id)} lib={lib} disabled={!props.serverOk} />
                ))}
              </ul>
            </details>
          </>
        ) : null}
        </div>
      </Section>
    </>
  );
}

function fileLabel(f: SeFile): string {
  const dir = f.id.includes("/") ? f.id.slice(0, f.id.lastIndexOf("/")) : "";
  const d = f.durationSec > 0 ? ` · ${formatSec(f.durationSec)}` : "";
  return `${f.name}${dir && !isPlaceholder(f.id) ? `(${dir})` : ""}${d}`;
}

function LibDir({ dir, exists }: { dir: string; exists: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cx("se-dir", !exists && "is-missing")}>
      <Icon.Music size={13} />
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
      {!exists ? <div className="se-dir-warn">フォルダがありません。作成してから「フォルダを再読み込み」を押してください。</div> : null}
    </div>
  );
}

function SeFileRow(props: {
  file: SeFile;
  usedBy: SeSlot[];
  player: ReturnType<typeof useAudioPlayer>;
  onPlay: () => void;
  lib: ReturnType<typeof useSeLibrary>;
  disabled: boolean;
}) {
  const f = props.file;
  const [draft, setDraft] = useState(f.credit ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  // Follow server-side changes while not editing.
  useEffect(() => {
    if (state !== "saving") setDraft(f.credit ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.credit]);

  const commit = async () => {
    const next = draft.trim();
    if (next === (f.credit ?? "")) return;
    setState("saving");
    setErr(null);
    try {
      await props.lib.saveCredits({ [f.id]: next });
      setState("saved");
      window.setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch (e) {
      setState("error");
      setErr(errorMessage(e));
    }
  };

  const key = `file:${f.id}`;
  const on = props.player.playingId === key;
  return (
    <li className="se-file">
      <button
        className={cx("btn btn-icon btn-ghost", on && "is-on")}
        title={on ? "停止" : "試聴"}
        aria-label={`${f.name} を試聴`}
        disabled={props.disabled}
        onClick={props.onPlay}
      >
        {on ? <Icon.Stop size={12} /> : <Icon.Play size={13} />}
      </button>
      <div className="se-file-main">
        <div className="se-file-name" title={f.id}>
          {f.name}
          <span className="mono muted">{f.durationSec > 0 ? formatSec(f.durationSec) : "—"}</span>
          {props.usedBy.map((s) => (
            <span key={s} className="se-used">
              {SLOT_INFO[s].label}
            </span>
          ))}
        </div>
        {f.id !== f.name ? <div className="se-file-id mono">{f.id}</div> : null}
        {isPlaceholder(f.id) ? null : (
        <div className="se-credit">
          <input
            className={cx("input input-sm", state === "error" && "is-error")}
            value={draft}
            placeholder="クレジット(例: 効果音:OtoLogic)— 不要なら空欄"
            aria-label={`${f.name} のクレジット`}
            maxLength={200}
            disabled={props.disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setDraft(f.credit ?? "");
            }}
          />
          <span className="se-credit-state">
            {state === "saving" ? <Spinner size={10} /> : state === "saved" ? <Icon.Check size={12} /> : null}
          </span>
        </div>
        )}
        {err ? <div className="field-hint warn">保存できません: {err}</div> : null}
      </div>
    </li>
  );
}
