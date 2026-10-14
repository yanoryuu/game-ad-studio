import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Clip, ClipSlot, Project, Source } from "@gas/shared";
import { sourceUrl } from "@gas/compositions";
import { basename, clamp, cx, formatSec, formatTime, round2 } from "../util";
import { Icon, Segmented } from "./ui";

export type ClipDraft = Pick<Clip, "inSec" | "outSec" | "slot" | "gameVolume">;

/**
 * External request to preview a range (e.g. hovering a highlight candidate).
 * A new `n` triggers it. "hover": muted preview; "select": also loads the range into IN/OUT and plays with sound.
 */
export type MarkerCue = { n: number; inSec: number; outSec: number; mode: "hover" | "select" };
/** Extra ranges drawn on the scrub bar (candidates). */
export type MarkerMark = { id: string; inSec: number; outSec: number; active?: boolean };

const MIN_LEN = 0.2;
const DEFAULT_LEN = 3;
const STEP = 1 / 30;

export function ClipMarker(props: {
  project: Project;
  source: Source;
  editingClip: Clip | null;
  editingIndex: number;
  onAdd: (draft: ClipDraft) => void;
  onUpdate: (clipId: string, patch: Partial<ClipDraft>) => void;
  onDoneEditing: () => void;
  cue?: MarkerCue | null;
  marks?: MarkerMark[];
  /** video + scrub + transport only (candidate browsing) */
  compact?: boolean;
}) {
  const { project, source, editingClip } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(source.durationSec);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const stopAtRef = useRef<number | null>(null);
  const [draft, setDraft] = useState<ClipDraft>(() => initialDraft(source, editingClip));

  // Reset when switching source / clip under edit.
  const editingId = editingClip?.id ?? null;
  useEffect(() => {
    const d = initialDraft(source, editingClip);
    setDraft(d);
    const v = videoRef.current;
    if (v && editingClip) {
      v.currentTime = d.inSec;
      setTime(d.inSec);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.id, editingId]);

  // Keep draft synced if the clip under edit is changed elsewhere (clip list inputs).
  useEffect(() => {
    if (!editingClip) return;
    setDraft((d) =>
      d.inSec === editingClip.inSec &&
      d.outSec === editingClip.outSec &&
      d.slot === editingClip.slot &&
      d.gameVolume === editingClip.gameVolume
        ? d
        : { inSec: editingClip.inSec, outSec: editingClip.outSec, slot: editingClip.slot, gameVolume: editingClip.gameVolume },
    );
  }, [editingClip]);

  useEffect(() => {
    setVideoError(false);
    setLoaded(false);
    setPlaying(false);
    setTime(0);
    setDuration(source.durationSec);
  }, [source.id, source.durationSec]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = draft.gameVolume;
  }, [draft.gameVolume]);

  // Smooth playhead while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        setTime(v.currentTime);
        if (stopAtRef.current !== null && v.currentTime >= stopAtRef.current) {
          v.pause();
          stopAtRef.current = null;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const { onUpdate } = props;

  // External preview cue (candidate hover / click).
  const pendingCueRef = useRef<MarkerCue | null>(null);
  const hoverPlayingRef = useRef(false);
  const applyCue = useCallback((c: MarkerCue) => {
    const v = videoRef.current;
    if (!v || v.readyState < 1) {
      pendingCueRef.current = c;
      return;
    }
    pendingCueRef.current = null;
    v.muted = c.mode === "hover";
    hoverPlayingRef.current = c.mode === "hover";
    v.currentTime = c.inSec;
    setTime(c.inSec);
    stopAtRef.current = c.outSec;
    void v.play().catch(() => {});
  }, []);
  const cue = props.cue ?? null;
  const cueN = cue?.n ?? 0;
  useEffect(() => {
    if (!cue) {
      // hover ended: stop the muted preview
      const v = videoRef.current;
      if (v && hoverPlayingRef.current) {
        v.pause();
        v.muted = false;
        hoverPlayingRef.current = false;
        stopAtRef.current = null;
      }
      pendingCueRef.current = null;
      return;
    }
    if (cue.mode === "select" && !editingId) setDraft((d) => ({ ...d, inSec: round2(cue.inSec), outSec: round2(cue.outSec) }));
    applyCue(cue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cueN]);
  const change = useCallback(
    (patch: Partial<ClipDraft>) => {
      setDraft((d) => ({ ...d, ...patch }));
      if (editingId) onUpdate(editingId, patch);
    },
    [editingId, onUpdate],
  );

  const seek = (t: number) => {
    const v = videoRef.current;
    const tt = clamp(t, 0, duration || 0);
    if (v) v.currentTime = tt;
    setTime(tt);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    stopAtRef.current = null;
    v.muted = false;
    hoverPlayingRef.current = false;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  const playRange = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    hoverPlayingRef.current = false;
    v.currentTime = draft.inSec;
    stopAtRef.current = draft.outSec;
    void v.play().catch(() => {});
  };

  const setIn = (t: number) => {
    const inSec = round2(clamp(t, 0, Math.max(0, duration - MIN_LEN)));
    let outSec = draft.outSec;
    if (outSec - inSec < MIN_LEN) outSec = round2(Math.min(duration, inSec + Math.max(DEFAULT_LEN, draft.outSec - draft.inSec)));
    change({ inSec, outSec });
  };
  const setOut = (t: number) => {
    const outSec = round2(clamp(t, MIN_LEN, duration));
    let inSec = draft.inSec;
    if (outSec - inSec < MIN_LEN) inSec = round2(Math.max(0, outSec - Math.max(DEFAULT_LEN, draft.outSec - draft.inSec)));
    change({ inSec, outSec });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const k = e.key.toLowerCase();
    if (k === "i") setIn(time);
    else if (k === "o") setOut(time);
    else if (k === " ") togglePlay();
    else if (k === "arrowleft") seek(time - (e.shiftKey ? 1 : STEP));
    else if (k === "arrowright") seek(time + (e.shiftKey ? 1 : STEP));
    else return;
    e.preventDefault();
  };

  // Scrub bar
  const barRef = useRef<HTMLDivElement | null>(null);
  const timeFromPointer = (e: PointerEvent) => {
    const r = barRef.current!.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * duration;
  };
  const onBarDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(timeFromPointer(e));
  };
  const onBarMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1 || !duration) return;
    seek(timeFromPointer(e));
  };

  const pct = (t: number) => `${duration ? clamp((t / duration) * 100, 0, 100) : 0}%`;
  const others = project.clips.filter((c) => c.sourceId === source.id && c.id !== editingClip?.id);
  const len = draft.outSec - draft.inSec;
  const valid = len >= MIN_LEN && draft.outSec <= duration + 0.01;

  return (
    <div className={cx("marker", editingClip && "is-editing", props.compact && "is-compact")} tabIndex={0} onKeyDown={onKeyDown}>
      <div className="marker-head">
        {editingClip ? (
          <>
            <span className="badge badge-edit">編集中</span>
            <span className="marker-title">クリップ {props.editingIndex + 1}</span>
            <button className="btn btn-sm btn-ghost ml-auto" onClick={props.onDoneEditing}>
              <Icon.Check /> 完了
            </button>
          </>
        ) : (
          <>
            <Icon.Scissors />
            <span className="marker-title" title={source.originalPath}>
              {basename(source.originalPath)}
            </span>
          </>
        )}
      </div>

      <div className="marker-video">
        <video
          key={source.id}
          ref={videoRef}
          src={sourceUrl("", project, source.id, true)}
          poster={undefined}
          preload="auto"
          playsInline
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
            e.currentTarget.volume = draft.gameVolume;
            setLoaded(true);
            if (editingClip) e.currentTarget.currentTime = editingClip.inSec;
            if (pendingCueRef.current) applyCue(pendingCueRef.current);
          }}
          onPlay={() => setPlaying(true)}
          onPause={(e) => {
            setPlaying(false);
            setTime(e.currentTarget.currentTime);
          }}
          onSeeked={(e) => setTime(e.currentTarget.currentTime)}
          onError={() => setVideoError(true)}
          onClick={togglePlay}
        />
        {videoError ? (
          <div className="marker-video-msg">
            <Icon.Alert /> プロキシ動画を読み込めません
          </div>
        ) : !loaded ? (
          <div className="marker-video-msg subtle">読み込み中…</div>
        ) : null}
      </div>

      <div className="scrub" ref={barRef} onPointerDown={onBarDown} onPointerMove={onBarMove} role="slider"
        aria-label="再生位置" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time}>
        <div className="scrub-track" />
        {props.marks?.map((m) => (
          <div
            key={m.id}
            className={cx("scrub-cand", m.active && "is-active")}
            style={{ left: pct(m.inSec), width: `calc(${pct(m.outSec)} - ${pct(m.inSec)})` }}
          />
        ))}
        {others.map((c) => (
          <div
            key={c.id}
            className={cx("scrub-seg", `slot-${c.slot}`)}
            style={{ left: pct(c.inSec), width: `calc(${pct(c.outSec)} - ${pct(c.inSec)})` }}
          />
        ))}
        <div
          className={cx("scrub-range", `slot-${draft.slot}`)}
          style={{ left: pct(draft.inSec), width: `calc(${pct(draft.outSec)} - ${pct(draft.inSec)})` }}
        >
          <span className="scrub-handle in" />
          <span className="scrub-handle out" />
        </div>
        <div className="scrub-head" style={{ left: pct(time) }} />
      </div>

      <div className="transport">
        <button className="btn btn-icon" onClick={togglePlay} title="再生 / 一時停止 (Space)" aria-label="再生 / 一時停止">
          {playing ? <Icon.Pause /> : <Icon.Play />}
        </button>
        <span className="timecode mono">
          {formatTime(time)} <span className="muted">/ {formatTime(duration)}</span>
        </span>
        <button className="btn btn-sm ml-auto" onClick={playRange} disabled={!valid} title="IN〜OUT を再生">
          範囲を再生
        </button>
      </div>

      {props.compact ? (
        <div className="compact-range">
          <span className="mono">
            <span className="c-in">{formatTime(draft.inSec)}</span> – <span className="c-out">{formatTime(draft.outSec)}</span>{" "}
            <span className="muted">{valid ? formatSec(len) : "—"}</span>
          </span>
          <button className="btn btn-sm ml-auto" disabled={!valid} onClick={() => props.onAdd({ ...draft, slot: "hook" })} title="この範囲をフックに追加">
            <Icon.Plus size={12} /> フック
          </button>
          <button className="btn btn-sm" disabled={!valid} onClick={() => props.onAdd({ ...draft, slot: "main" })} title="この範囲を本編に追加">
            <Icon.Plus size={12} /> 本編
          </button>
        </div>
      ) : (
      <>
      <div className="inout">
        <div className="inout-col">
          <button className="btn btn-sm btn-in" onClick={() => setIn(time)} title="現在位置を IN に (I)">
            IN <kbd>I</kbd>
          </button>
          <input
            className="input input-sm mono"
            type="number"
            step={0.1}
            min={0}
            value={draft.inSec}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) change({ inSec: round2(clamp(v, 0, duration)) });
            }}
            aria-label="IN 秒"
          />
        </div>
        <div className="inout-len mono">{valid ? formatSec(len) : "—"}</div>
        <div className="inout-col">
          <button className="btn btn-sm btn-out" onClick={() => setOut(time)} title="現在位置を OUT に (O)">
            OUT <kbd>O</kbd>
          </button>
          <input
            className="input input-sm mono"
            type="number"
            step={0.1}
            min={0}
            value={draft.outSec}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) change({ outSec: round2(clamp(v, 0, duration)) });
            }}
            aria-label="OUT 秒"
          />
        </div>
      </div>

      <div className="marker-opts">
        <Segmented<ClipSlot>
          size="sm"
          ariaLabel="スロット"
          value={draft.slot}
          onChange={(slot) => change({ slot })}
          options={[
            { value: "hook", label: "フック" },
            { value: "main", label: "本編" },
          ]}
        />
        <label className="vol" title="ゲーム音の音量">
          <span className="vol-label">ゲーム音</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft.gameVolume}
            onChange={(e) => change({ gameVolume: Number(e.target.value) })}
          />
          <span className="mono vol-val">{Math.round(draft.gameVolume * 100)}</span>
        </label>
      </div>

      {!editingClip ? (
        <button className="btn btn-primary btn-block" disabled={!valid} onClick={() => props.onAdd(draft)}>
          <Icon.Plus /> クリップを追加
        </button>
      ) : !valid ? (
        <div className="field-hint warn">OUT は IN より後にしてください</div>
      ) : null}
      <div className="field-hint">I / O で IN・OUT、Space で再生、← → でコマ送り(Shift で 1 秒)</div>
      </>
      )}
    </div>
  );
}

function initialDraft(source: Source, clip: Clip | null): ClipDraft {
  if (clip) return { inSec: clip.inSec, outSec: clip.outSec, slot: clip.slot, gameVolume: clip.gameVolume };
  return { inSec: 0, outSec: round2(Math.min(source.durationSec, DEFAULT_LEN)), slot: "main", gameVolume: 0.8 };
}
