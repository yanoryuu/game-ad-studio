import { type Format, type Lang, type Project, type RenderStatus } from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import { useRenderJob } from "../hooks/useRenderJob";
import { useRequiredCredits } from "../hooks/useTts";
import { cx } from "../util";
import { Icon, Spinner } from "./ui";

const STATUS_LABEL: Record<RenderStatus, string> = {
  queued: "待機中",
  bundling: "バンドル中(初回は 15 秒ほど)",
  rendering: "レンダリング中",
  done: "完了",
  error: "失敗",
};

export function RenderPanel(props: {
  project: Project;
  format: Format;
  lang: Lang;
  flush: () => Promise<void>;
  serverOk: boolean;
}) {
  const { project, format, lang } = props;
  const r = useRenderJob(project.id);
  const job = r.job;
  const noClips = project.clips.length === 0;
  const pct = job ? Math.round(job.progress * 100) : 0;
  const outUrl = job?.outputPath ? assetUrl("", project.id, job.outputPath) : null;
  const credits = useRequiredCredits(project, lang);
  const unsynth = project.script.filter((l) => l.lang === lang && l.text.trim() && l.status !== "ok").length;

  const start = () => void r.start({ format, lang, fps: project.fps }, props.flush);

  return (
    <div className={cx("render", job?.status === "done" && "is-done", (job?.status === "error" || r.error) && "is-error")}>
      <div className="render-row">
        <div className="render-spec">
          <span className="render-label">書き出し</span>
          <span className="chip mono">{format}</span>
          <span className="chip">{lang === "ja" ? "日本語" : "English"}</span>
          <span className="chip mono">{project.fps}fps</span>
          <span className="chip mono">H.264</span>
        </div>
        <button
          className="btn btn-primary"
          onClick={start}
          disabled={r.running || noClips || !props.serverOk}
          title={noClips ? "クリップを 1 本以上追加してください" : undefined}
        >
          {r.running ? <Spinner /> : <Icon.Export />} {r.running ? "書き出し中…" : "書き出す"}
        </button>
      </div>

      {noClips && !job ? <div className="field-hint">クリップを追加すると書き出せます。</div> : null}

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

      {job && job.status !== "done" && job.status !== "error" && !r.error ? (
        <div className="render-progress">
          <div className="progress">
            <span
              className={cx(job.status !== "rendering" && "indeterminate")}
              style={job.status === "rendering" ? { width: `${pct}%` } : undefined}
            />
          </div>
          <div className="render-status">
            <span>{STATUS_LABEL[job.status]}</span>
            {r.connectionLost ? <span className="warn">サーバー応答なし — 再試行中</span> : null}
            <span className="mono ml-auto">{job.status === "rendering" ? `${pct}%` : ""}</span>
          </div>
        </div>
      ) : null}

      {job?.status === "done" ? (
        <div className="render-result">
          <Icon.Check />
          <div className="render-result-body">
            <div>書き出しが完了しました</div>
            <div className="mono small path">
              projects/{project.id}/{job.outputPath}
            </div>
          </div>
          {outUrl ? (
            <a className="btn btn-sm" href={outUrl} target="_blank" rel="noreferrer">
              <Icon.External /> 開く
            </a>
          ) : null}
          <button className="btn btn-sm btn-ghost" onClick={r.reset}>
            閉じる
          </button>
        </div>
      ) : null}

      {job?.status === "error" || r.error ? (
        <div className="render-result">
          <Icon.Alert />
          <div className="render-result-body">
            <div>書き出しに失敗しました</div>
            <div className="mono small path">{r.error ?? job?.error ?? "不明なエラー"}</div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={r.reset}>
            閉じる
          </button>
        </div>
      ) : null}
    </div>
  );
}
