import { useMemo, useRef, useState } from "react";
import type { Candidate, Clip, ClipSlot, Project, Source } from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import { api, featureErrorMessage } from "../api";
import {
  applyArrangement,
  clipFromCandidate,
  insertClip,
  planArrangement,
  type ArrangeOrder,
} from "../autoArrange";
import type { MutateOnServer, UpdateProject } from "../hooks/useProject";
import { sourceName, cx, formatSec, formatTime } from "../util";
import type { MarkerCue } from "./ClipMarker";
import { Banner, Empty, Icon, Meter, Section, Segmented, Spinner } from "./ui";

type SortKey = "score" | "time";

export function CandidatesPanel(props: {
  project: Project;
  source: Source | null;
  update: UpdateProject;
  mutateOnServer: MutateOnServer;
  onCue: (cue: (Omit<MarkerCue, "n"> & { candId: string }) | null) => void;
  activeCandidateId: string | null;
  onShowClips: () => void;
  serverOk: boolean;
  /** image sources: add a main-slot clip [0, 3 s] (they cannot be analyzed) */
  onAddImageClip?: (sourceId: string) => void;
}) {
  const { project, source, update } = props;
  const [sort, setSort] = useState<SortKey>("score");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useMemo(() => {
    if (!source) return [];
    const l = project.candidates.filter((c) => c.sourceId === source.id);
    return sort === "score" ? l.slice().sort((a, b) => b.score - a.score) : l.slice().sort((a, b) => a.startSec - b.startSec);
  }, [project.candidates, source, sort]);

  const analyze = async () => {
    if (!source) return;
    setStarting(true);
    setError(null);
    try {
      await props.mutateOnServer((p) => api.analyzeSource(p.id, source.id));
    } catch (e) {
      setError(featureErrorMessage(e, "ハイライト解析"));
    } finally {
      setStarting(false);
    }
  };

  const adopt = (c: Candidate, slot: ClipSlot) =>
    update((p) => ({
      ...p,
      clips: insertClip(p.clips, clipFromCandidate(c, slot)),
      candidates: p.candidates.map((x) => (x.id === c.id ? { ...x, adopted: true } : x)),
    }));

  const running = source?.analysisStatus === "running";
  const top = list.length ? Math.max(...list.map((c) => c.score)) : 0;

  return (
    <div className="cands">
      <AutoArrange project={project} update={update} onShowClips={props.onShowClips} />

      <Section
        title="見どころ候補"
        aside={source ? <span className="muted cands-src" title={source.originalPath}>{sourceName(source)}</span> : null}
      >
        {!source ? (
          <Empty compact icon={<Icon.Film size={22} />} title="素材がありません">
            「素材」タブで動画を登録してください。
          </Empty>
        ) : source.kind === "image" ? (
          <div className="analyze-row">
            {props.onAddImageClip ? (
              <button
                className="btn"
                onClick={() => props.onAddImageClip?.(source.id)}
                disabled={source.proxyStatus !== "ready"}
                title="本編の最後に 3 秒のクリップとして追加"
              >
                <Icon.Plus /> クリップに追加
              </button>
            ) : null}
            <div className="analyze-note">
              <span>画像の素材は見どころ検出の対象外です。「クリップに追加」で本編に入れ、長さはクリップ編集で調整します。</span>
            </div>
          </div>
        ) : (
          <>
            <div className="analyze-row">
              <button
                className="btn btn-primary"
                onClick={() => void analyze()}
                disabled={!props.serverOk || source.proxyStatus !== "ready" || running || starting}
                title={source.proxyStatus !== "ready" ? "プロキシの生成が終わると解析できます" : undefined}
              >
                {running || starting ? <Spinner /> : <Icon.Sparkle />}
                {running ? "解析中…" : source.analysisStatus === "done" ? "再検出" : "見どころを検出"}
              </button>
              <div className="analyze-note">
                {source.proxyStatus === "pending" ? (
                  <span className="warn">プロキシ生成中 — 完了後に解析できます</span>
                ) : source.proxyStatus === "error" ? (
                  <span className="st-error">プロキシ生成に失敗した素材は解析できません</span>
                ) : running ? (
                  <span>シーン切替・動き・音量を解析しています。長い動画は数分かかります。</span>
                ) : source.analysisStatus === "done" ? (
                  <span>
                    {list.length} 件 · {list.filter((c) => c.adopted).length} 件採用済み
                  </span>
                ) : (
                  <span>シーン切替・動き・音の盛り上がりから 2〜6 秒の候補を自動で探します。</span>
                )}
              </div>
            </div>
            {running ? (
              <div className="ingest-bar">
                <span />
              </div>
            ) : null}
            {error ? <Banner tone="error">{error}</Banner> : null}
            {source.analysisStatus === "error" ? (
              <Banner tone="error">解析に失敗しました: {source.analysisError ?? "不明なエラー"}</Banner>
            ) : null}

            {list.length > 0 ? (
              <>
                <div className="cands-toolbar">
                  <span className="field-label">並び</span>
                  <Segmented<SortKey>
                    size="sm"
                    value={sort}
                    onChange={setSort}
                    ariaLabel="並び順"
                    options={[
                      { value: "score", label: "スコア順" },
                      { value: "time", label: "時系列" },
                    ]}
                  />
                  <span className="field-hint ml-auto">ホバーで試写・クリックで IN/OUT に読込</span>
                </div>
                <ul className="cand-grid">
                  {list.map((c) => (
                    <CandidateCard
                      key={c.id}
                      project={project}
                      cand={c}
                      best={c.score === top}
                      active={props.activeCandidateId === c.id}
                      onHover={(on) => props.onCue(on ? { inSec: c.startSec, outSec: c.endSec, mode: "hover", candId: c.id } : null)}
                      onSelect={() => props.onCue({ inSec: c.startSec, outSec: c.endSec, mode: "select", candId: c.id })}
                      onAdopt={(slot) => adopt(c, slot)}
                    />
                  ))}
                </ul>
              </>
            ) : source.analysisStatus === "done" ? (
              <Empty compact icon={<Icon.Sparkle size={20} />} title="候補が見つかりませんでした">
                手動で IN / OUT を決めてクリップを追加できます。
              </Empty>
            ) : null}
          </>
        )}
      </Section>
    </div>
  );
}

function CandidateCard(props: {
  project: Project;
  cand: Candidate;
  best: boolean;
  active: boolean;
  onHover: (on: boolean) => void;
  onSelect: () => void;
  onAdopt: (slot: ClipSlot) => void;
}) {
  const { cand: c } = props;
  const hoverTimer = useRef<number | null>(null);
  const [imgOk, setImgOk] = useState(true);
  const len = c.endSec - c.startSec;
  const pct = Math.round(c.score * 100);
  return (
    <li
      className={cx("cand", c.adopted && "is-adopted", props.active && "is-active")}
      onMouseEnter={() => {
        // small delay so sweeping the mouse across the grid doesn't thrash the video
        hoverTimer.current = window.setTimeout(() => props.onHover(true), 180);
      }}
      onMouseLeave={() => {
        if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
        props.onHover(false);
      }}
    >
      <button type="button" className="cand-thumb" onClick={props.onSelect} title="この範囲を IN/OUT に読み込んで再生">
        {imgOk ? (
          <img src={assetUrl("", props.project.id, c.thumbPath)} alt="" loading="lazy" onError={() => setImgOk(false)} />
        ) : (
          <span className="cand-noimg">
            <Icon.Image />
          </span>
        )}
        <span className="cand-len mono">{formatSec(len)}</span>
        {c.adopted ? (
          <span className="cand-flag">
            <Icon.Check size={11} /> 採用済み
          </span>
        ) : props.best ? (
          <span className="cand-flag is-best">BEST</span>
        ) : null}
        <span className="cand-play" aria-hidden>
          <Icon.Play size={14} />
        </span>
      </button>
      <div className="cand-body">
        <div className="cand-time mono">
          {formatTime(c.startSec)}
          <span className="muted"> – {formatTime(c.endSec)}</span>
        </div>
        <div className="cand-score" title={`スコア ${pct}`}>
          <Meter value={c.score} />
          <span className="mono">{pct}</span>
        </div>
        <div className="cand-feats">
          <span title={`シーン切替 ${Math.round(c.features.scene * 100)}`}>
            <i>シーン</i>
            <Meter value={c.features.scene} tone="scene" />
          </span>
          <span title={`動き ${Math.round(c.features.motion * 100)}`}>
            <i>動き</i>
            <Meter value={c.features.motion} tone="motion" />
          </span>
          <span title={`音量 ${Math.round(c.features.loudness * 100)}`}>
            <i>音量</i>
            <Meter value={c.features.loudness} tone="loud" />
          </span>
        </div>
        <div className="cand-actions">
          <button type="button" className="btn btn-sm cand-adopt slot-hook" onClick={() => props.onAdopt("hook")}>
            フックに採用
          </button>
          <button type="button" className="btn btn-sm cand-adopt slot-main" onClick={() => props.onAdopt("main")}>
            本編に採用
          </button>
        </div>
      </div>
    </li>
  );
}

function AutoArrange(props: { project: Project; update: UpdateProject; onShowClips: () => void }) {
  const { project } = props;
  const [order, setOrder] = useState<ArrangeOrder>("time");
  const [count, setCount] = useState(6);
  const [undo, setUndo] = useState<{ clips: Clip[]; adopted: Map<string, boolean | undefined>; n: number } | null>(null);
  const plan = useMemo(() => planArrangement(project, order, count), [project, order, count]);
  const nCands = project.candidates.length;
  if (nCands === 0 && !undo) return null;

  const run = () => {
    setUndo({
      clips: project.clips,
      adopted: new Map(project.candidates.map((c) => [c.id, c.adopted])),
      n: plan.main.length + (plan.hook ? 1 : 0),
    });
    props.update((p) => applyArrangement(p, planArrangement(p, order, count)));
  };
  const revert = () => {
    if (!undo) return;
    props.update((p) => ({
      ...p,
      clips: undo.clips,
      candidates: p.candidates.map((c) => {
        const { adopted: _drop, ...rest } = c;
        const a = undo.adopted.get(c.id);
        return a === undefined ? rest : { ...rest, adopted: a };
      }),
    }));
    setUndo(null);
  };

  const target = plan.targetSec;
  const n = plan.main.length + (plan.hook ? 1 : 0);
  return (
    <Section
      title="自動で並べる"
      className="auto-arrange"
      aside={
        <span className="muted">
          {target !== null ? (
            <>
              本編の目標 <span className="mono">{formatSec(target)}</span>
            </>
          ) : (
            "自由尺"
          )}
        </span>
      }
    >
      <div className="aa-row">
        <Segmented<ArrangeOrder>
          size="sm"
          value={order}
          onChange={setOrder}
          ariaLabel="本編の並び順"
          options={[
            { value: "time", label: "時系列", title: "本編を素材の時間順に並べる" },
            { value: "score", label: "スコア順", title: "本編をスコアの高い順に並べる" },
          ]}
        />
        {target === null ? (
          <label className="aa-count" title="本編に並べる本数">
            <input
              className="input input-sm mono"
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(20, Math.round(Number(e.target.value) || 1))))}
            />
            <span className="field-label">本</span>
          </label>
        ) : null}
        <button
          className="btn btn-sm ml-auto"
          onClick={run}
          disabled={n === 0}
          title="全素材の候補から、スコア最上位をフックに、続く上位を本編に並べます(今あるクリップは置き換え)"
        >
          <Icon.Wand size={14} /> 上位 {n} 本を自動で並べる
        </button>
      </div>
      <div className="aa-plan">
        <span className="c-hook">フック {plan.hook ? 1 : 0}</span> ·{" "}
        <span className="c-main">
          本編 {plan.main.length} 本 / <span className="mono">{formatSec(plan.mainSec)}</span>
        </span>
        {target !== null && plan.mainSec < target ? <span className="warn"> · 候補が足りません</span> : null}
        {project.clips.length > 0 && !undo ? <span className="muted"> · 既存 {project.clips.length} 本は置き換え</span> : null}
      </div>
      {undo ? (
        <Banner
          tone="info"
          action={
            <span className="aa-actions">
              <button className="btn btn-sm" onClick={props.onShowClips}>
                クリップを見る
              </button>
              <button className="btn btn-sm btn-ghost" onClick={revert}>
                元に戻す
              </button>
            </span>
          }
        >
          {undo.n} 本のクリップを並べました。
        </Banner>
      ) : null}
    </Section>
  );
}
