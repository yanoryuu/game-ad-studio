import { useCallback, useState } from "react";
import {
  hasNarrationInput,
  type Format,
  type Fps,
  type Lang,
  type Project,
  type RenderFile,
  type RenderStatus,
  type RenderTarget,
} from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import type { UpdateProject } from "../hooks/useProject";
import { useRenderBatch, type TrackedJob } from "../hooks/useRenderBatch";
import { useRequiredCredits } from "../hooks/useTts";
import { cx, formatRelative } from "../util";
import { Icon, Segmented, Spinner } from "./ui";

const STATUS_LABEL: Record<RenderStatus, string> = {
  queued: "待機中",
  bundling: "バンドル中",
  rendering: "レンダリング中",
  done: "完了",
  error: "失敗",
};
const FORMATS: Format[] = ["16:9", "9:16"];
const LANGS: Lang[] = ["ja", "en"];
const LANG_LABEL: Record<Lang, string> = { ja: "日本語", en: "English" };
const key = (t: RenderTarget) => `${t.format}|${t.lang}`;

function useTargets(project: Project) {
  const storageKey = `gas:${project.id}:targets`;
  const [sel, setSel] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) return new Set(arr as string[]);
      }
    } catch {
      /* ignore */
    }
    const s = new Set<string>();
    for (const format of project.formats) for (const lang of project.languages) s.add(key({ format, lang }));
    return s;
  });
  const toggle = useCallback(
    (k: string) =>
      setSel((cur) => {
        const next = new Set(cur);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        try {
          localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {
          /* ignore */
        }
        return next;
      }),
    [storageKey],
  );
  const targets: RenderTarget[] = [];
  for (const format of FORMATS) for (const lang of LANGS) if (sel.has(key({ format, lang }))) targets.push({ format, lang });
  return { sel, toggle, targets };
}

export function RenderPanel(props: {
  project: Project;
  update: UpdateProject;
  flush: () => Promise<void>;
  serverOk: boolean;
}) {
  const { project } = props;
  const r = useRenderBatch(project.id);
  const { sel, toggle, targets } = useTargets(project);
  const [showHistory, setShowHistory] = useState(true);
  const noClips = project.clips.length === 0;
  const langs = LANGS.filter((l) => targets.some((t) => t.lang === l));
  const creditsJa = useRequiredCredits(project, "ja");
  const creditsEn = useRequiredCredits(project, "en");
  const credits = [...new Set([...(langs.includes("ja") ? creditsJa : []), ...(langs.includes("en") ? creditsEn : [])])];
  const unsynth = project.script.filter((l) => langs.includes(l.lang) && hasNarrationInput(l) && l.status !== "ok").length;

  const start = () => void r.start(targets, project.fps, props.flush);
  const finished = r.jobs.some((j) => j.status === "done" || j.status === "error");

  return (
    <div className="render">
      <div className="render-row">
        <span className="render-label">書き出し</span>
        <table className="target-matrix" aria-label="書き出す形式と言語">
          <thead>
            <tr>
              <th />
              {LANGS.map((l) => (
                <th key={l}>{LANG_LABEL[l]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FORMATS.map((f) => (
              <tr key={f}>
                <th className="mono">{f}</th>
                {LANGS.map((l) => {
                  const k = key({ format: f, lang: l });
                  return (
                    <td key={l}>
                      <label className={cx("tm-cell", sel.has(k) && "is-on")} title={`${f} · ${LANG_LABEL[l]}`}>
                        <input type="checkbox" checked={sel.has(k)} onChange={() => toggle(k)} aria-label={`${f} ${LANG_LABEL[l]}`} />
                        <Icon.Check size={11} />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <Segmented<Fps>
          size="sm"
          value={project.fps}
          onChange={(fps) => props.update((p) => ({ ...p, fps }))}
          ariaLabel="fps"
          options={[
            { value: 30, label: "30fps" },
            { value: 60, label: "60fps" },
          ]}
        />
        <button
          className="btn btn-primary ml-auto"
          onClick={start}
          disabled={r.starting || noClips || !props.serverOk || targets.length === 0}
          title={noClips ? "クリップを 1 本以上追加してください" : targets.length === 0 ? "形式と言語を選んでください" : undefined}
        >
          {r.starting ? <Spinner /> : <Icon.Export />} 書き出す{targets.length ? `(${targets.length} 本)` : ""}
        </button>
      </div>

      {noClips ? <div className="field-hint">クリップを追加すると書き出せます。</div> : null}
      {r.error ? (
        <div className="render-note err">
          <Icon.Alert size={13} />
          <span>書き出しを開始できません: {r.error}</span>
        </div>
      ) : null}

      {unsynth > 0 || credits.length > 0 ? (
        <div className="render-notes">
          {unsynth > 0 ? (
            <div className="render-note warn">
              <Icon.Alert size={13} />
              <span>
                未生成・要再生成のナレーションが {unsynth} 行あります(未生成は無音、要再生成は古い音声のまま書き出されます)。
              </span>
            </div>
          ) : null}
          {credits.length > 0 ? (
            <div className="render-note credit">
              <Icon.Mic size={13} />
              <span>
                {credits.map((c, i) => (
                  <span key={c}>
                    {i > 0 ? "、" : ""}
                    <b className="mono">{c}</b>
                  </span>
                ))}{" "}
                をクレジット表記してください(動画内または説明欄)。
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {r.jobs.length > 0 ? (
        <div className="jobs">
          <div className="jobs-head">
            <span className="field-label">ジョブ</span>
            {finished ? (
              <button className="link-btn ml-auto" onClick={r.clearFinished}>
                完了したジョブを消す
              </button>
            ) : null}
          </div>
          <ul className="job-list">
            {r.jobs.map((j) => (
              <JobRow key={j.jobId} job={j} project={project} />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="history">
        <div className="jobs-head">
          <button className="history-toggle" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
            {showHistory ? <Icon.Down size={12} /> : <Icon.Next size={12} />}
            書き出し履歴 <span className="mono muted">{r.files ? r.files.length : ""}</span>
          </button>
          <button
            className="btn btn-icon btn-ghost ml-auto"
            onClick={() => void r.refreshHistory()}
            disabled={r.historyLoading}
            title="履歴を更新"
            aria-label="履歴を更新"
          >
            {r.historyLoading ? <Spinner size={11} /> : <Icon.Refresh size={13} />}
          </button>
        </div>
        {showHistory ? (
          r.historyError ? (
            <div className="field-hint warn">{r.historyError}</div>
          ) : r.files && r.files.length === 0 ? (
            <div className="field-hint">まだ書き出したファイルはありません。</div>
          ) : r.files ? (
            <ul className="history-list">
              {r.files.map((f) => (
                <HistoryRow key={f.path} file={f} project={project} />
              ))}
            </ul>
          ) : null
        ) : null}
      </div>
    </div>
  );
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string, text: string) => {
    const done = () => {
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text) && done());
    else if (fallbackCopy(text)) done();
  };
  return { copied, copy };
}

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Path shown/copied for a render: relative to the repo root (the server does not expose its absolute dir). */
const displayPath = (project: Project, rel: string) => `projects/${project.id}/${rel}`;

function JobRow({ job, project }: { job: TrackedJob; project: Project }) {
  const pct = Math.round(job.progress * 100);
  const active = job.status !== "done" && job.status !== "error";
  const { copied, copy } = useCopy();
  return (
    <li className={cx("job", `is-${job.status}`)}>
      <span className="chip mono">{job.format}</span>
      <span className="chip">{LANG_LABEL[job.lang]}</span>
      <span className="job-status">
        {active ? <Spinner size={10} /> : job.status === "done" ? <Icon.Check size={12} /> : <Icon.Alert size={12} />}
        {STATUS_LABEL[job.status]}
        {job.connectionLost && active ? <span className="warn"> · 応答なし</span> : null}
      </span>
      {active ? (
        <>
          <div className="progress job-progress">
            <span
              className={cx(job.status === "bundling" && "indeterminate")}
              style={job.status === "bundling" ? undefined : { width: `${job.status === "rendering" ? pct : 0}%` }}
            />
          </div>
          <span className="mono job-pct">{job.status === "rendering" ? `${pct}%` : ""}</span>
        </>
      ) : job.status === "done" && job.outputPath ? (
        <span className="job-actions">
          <a className="btn btn-sm" href={assetUrl("", project.id, job.outputPath)} target="_blank" rel="noreferrer">
            <Icon.External size={13} /> 開く
          </a>
          <button className="btn btn-sm btn-ghost" onClick={() => copy(job.jobId, job.absPath ?? displayPath(project, job.outputPath!))} title={job.absPath ?? displayPath(project, job.outputPath)}>
            <Icon.Copy size={13} /> {copied === job.jobId ? "コピーしました" : "パス"}
          </button>
        </span>
      ) : (
        <span className="job-error mono" title={job.error}>
          {job.error ?? "不明なエラー"}
        </span>
      )}
    </li>
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function HistoryRow({ file, project }: { file: RenderFile; project: Project }) {
  const { copied, copy } = useCopy();
  const p = file.absPath ?? displayPath(project, file.path);
  return (
    <li className="hist">
      <span className="hist-name mono" title={file.name}>
        {file.name}
      </span>
      {file.format ? <span className="chip mono">{file.format}</span> : null}
      {file.lang ? <span className="chip">{LANG_LABEL[file.lang]}</span> : null}
      <span className="mono muted hist-size">{formatSize(file.sizeBytes)}</span>
      <span className="muted hist-date" title={new Date(file.mtime).toLocaleString("ja-JP")}>
        {formatRelative(file.mtime)}
      </span>
      <a className="btn btn-icon btn-ghost" href={file.url} target="_blank" rel="noreferrer" title="開く(再生 / ダウンロード)" aria-label="開く">
        <Icon.External size={13} />
      </a>
      <button className={cx("btn btn-icon btn-ghost", copied && "is-on")} onClick={() => copy(file.path, p)} title={copied ? "コピーしました" : `パスをコピー: ${p}`} aria-label="パスをコピー">
        {copied ? <Icon.Check size={13} /> : <Icon.Copy size={13} />}
      </button>
    </li>
  );
}
