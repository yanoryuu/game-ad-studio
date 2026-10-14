import type { Bgm, Project } from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import { beatState, useWaveform } from "../hooks/useBgmAnalysis";
import { cx, formatSec } from "../util";
import { Icon, Spinner } from "./ui";

const W = 1000;
const H = 44;

/** BGM beat detection: status, "拍を検出" button, waveform strip with beat ticks (ARCHITECTURE §6.11 / §7). */
export function BeatPanel(props: {
  project: Project;
  bgm: Bgm;
  videoSec: number;
  starting: boolean;
  error: string | null;
  disabled: boolean;
  onAnalyze: () => void;
}) {
  const { bgm } = props;
  const st = beatState(bgm);
  const running = st.kind === "running" || props.starting;
  const beats = st.kind === "done" ? st.beats : st.kind === "error" ? st.beats ?? [] : [];
  const bpm = st.kind === "done" || st.kind === "error" ? st.bpm : undefined;
  const wave = useWaveform(assetUrl("", props.project.id, bgm.path));
  const dur = wave?.kind === "ok" ? wave.wave.durationSec : Math.max(beats[beats.length - 1] ?? 0, 1);

  return (
    <div className={cx("beat-box", st.kind === "error" && "is-error")}>
      <div className="beat-head">
        <span className="beat-title">
          <Icon.Pulse size={13} /> ビート
        </span>
        {running ? (
          <span className="beat-stat is-busy">
            <Spinner size={10} /> 検出中…
          </span>
        ) : st.kind === "done" ? (
          <span className="beat-stat is-ok mono">
            {bpm ? <b>{Math.round(bpm)} BPM</b> : null} · {beats.length} 拍
          </span>
        ) : st.kind === "error" ? (
          <span className="beat-stat is-error">失敗</span>
        ) : (
          <span className="beat-stat muted">未検出</span>
        )}
        <button
          className="btn btn-sm ml-auto"
          onClick={props.onAnalyze}
          disabled={running || props.disabled}
          title="BGM のテンポと拍の位置を解析します(トレーラー風のビート同期に使用)"
        >
          {running ? <Spinner size={11} /> : <Icon.Pulse size={13} />}
          {st.kind === "done" || st.kind === "error" ? "再検出" : "拍を検出"}
        </button>
      </div>

      <div className="beat-strip" aria-label="BGM の波形と拍">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          {wave?.kind === "ok"
            ? wave.wave.peaks.map((p, i, a) => {
                const bw = W / a.length;
                const h = Math.max(1.5, p * (H - 6));
                return <rect key={i} className="wf" x={i * bw + 0.6} y={(H - h) / 2} width={Math.max(0.8, bw - 1.2)} height={h} rx={1} />;
              })
            : <line className="wf-flat" x1={0} x2={W} y1={H / 2} y2={H / 2} />}
          {props.videoSec > 0 && props.videoSec < dur ? (
            <>
              <rect className="beat-outside" x={(props.videoSec / dur) * W} y={0} width={W - (props.videoSec / dur) * W} height={H} />
              <line className="beat-video-end" x1={(props.videoSec / dur) * W} x2={(props.videoSec / dur) * W} y1={0} y2={H} />
            </>
          ) : null}
          {beats.map((b, i) => {
            const x = (b / dur) * W;
            if (x > W) return null;
            const strong = i % 4 === 0;
            return <line key={i} className={cx("beat-tick", strong && "is-strong")} x1={x} x2={x} y1={strong ? 0 : 8} y2={strong ? H : H - 8} />;
          })}
        </svg>
        {wave?.kind === "loading" ? <span className="beat-strip-msg">波形を読み込み中…</span> : null}
      </div>
      <div className="beat-foot mono">
        <span>0:00</span>
        {props.videoSec > 0 && props.videoSec < dur ? <span className="muted">動画 {formatSec(props.videoSec)} まで</span> : null}
        <span className="ml-auto">{formatSec(dur)}</span>
      </div>

      {st.kind === "error" ? <div className="field-hint warn">拍を検出できませんでした: {st.message}</div> : null}
      {props.error ? <div className="field-hint warn">{props.error}</div> : null}
      {st.kind === "none" && !running && props.project.template === "trailer" ? (
        <div className="field-hint">トレーラー風はカットを拍に合わせて切り替えます。「拍を検出」を実行してください。</div>
      ) : null}
    </div>
  );
}
