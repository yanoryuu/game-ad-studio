import { useState, type DragEvent } from "react";
import type { Clip, ClipSlot, Project } from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import { basename, cx, formatSec, formatTime } from "../util";
import { Empty, Icon, Section } from "./ui";

const SLOT_LABEL: Record<ClipSlot, string> = { hook: "フック", main: "本編" };
const SLOT_HINT: Record<ClipSlot, string> = {
  hook: "冒頭 2.5 秒(ナレーションに合わせて最大 5 秒)。最も派手な瞬間を。",
  main: "プレイ映像を順にカットでつなぎます。",
};

/** Move clip `id` so it sits before `beforeId` (or at the end of `slot` when null), adopting `slot`. */
export function moveClip(clips: Clip[], id: string, slot: ClipSlot, beforeId: string | null): Clip[] {
  const moving = clips.find((c) => c.id === id);
  if (!moving || id === beforeId) return clips;
  const rest = clips.filter((c) => c.id !== id);
  const moved = moving.slot === slot ? moving : { ...moving, slot };
  let idx: number;
  if (beforeId) idx = rest.findIndex((c) => c.id === beforeId);
  else {
    const lastOfSlot = rest.map((c) => c.slot).lastIndexOf(slot);
    idx = lastOfSlot + 1;
    if (lastOfSlot < 0) idx = slot === "hook" ? 0 : rest.length;
  }
  if (idx < 0) idx = rest.length;
  return [...rest.slice(0, idx), moved, ...rest.slice(idx)];
}

/** Swap with the previous/next clip in the same slot. */
function step(clips: Clip[], id: string, dir: -1 | 1): Clip[] {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return clips;
  const slot = clips[i]!.slot;
  let j = i + dir;
  while (j >= 0 && j < clips.length && clips[j]!.slot !== slot) j += dir;
  if (j < 0 || j >= clips.length) return clips;
  const next = clips.slice();
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function ClipList(props: {
  project: Project;
  editingId: string | null;
  onEdit: (clip: Clip) => void;
  onChangeClips: (clips: Clip[]) => void;
}) {
  const { project } = props;
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const sourceOf = (c: Clip) => project.sources.find((s) => s.id === c.sourceId);
  const total = (slot: ClipSlot) =>
    project.clips.filter((c) => c.slot === slot).reduce((s, c) => s + Math.max(0, c.outSec - c.inSec), 0);

  const onDrop = (e: DragEvent, slot: ClipSlot, beforeId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const id = dragId ?? e.dataTransfer.getData("text/plain");
    setDragId(null);
    setDropTarget(null);
    if (id) props.onChangeClips(moveClip(project.clips, id, slot, beforeId));
  };

  const remove = (id: string) => props.onChangeClips(project.clips.filter((c) => c.id !== id));

  return (
    <Section className="clips-section" title="クリップ" aside={<span className="mono muted">{project.clips.length}</span>}>
      {project.clips.length === 0 ? (
        <Empty compact icon={<Icon.Scissors size={22} />} title="クリップがありません">
          {project.sources.length === 0
            ? "まず素材を登録してください。"
            : "素材を選んで IN / OUT を決め、「クリップを追加」で追加します。"}
        </Empty>
      ) : null}
      {(["hook", "main"] as const).map((slot) => {
        const list = project.clips.filter((c) => c.slot === slot);
        if (project.clips.length === 0) return null;
        return (
          <div
            key={slot}
            className={cx("slot-group", `slot-${slot}`, dropTarget === `slot:${slot}` && "is-drop")}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setDropTarget(`slot:${slot}`);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setDropTarget(null);
            }}
            onDrop={(e) => onDrop(e, slot, null)}
          >
            <div className="slot-head">
              <span className={cx("slot-tag", `slot-${slot}`)}>{SLOT_LABEL[slot]}</span>
              <span className="mono muted">
                {list.length} 本 · {formatSec(total(slot))}
              </span>
            </div>
            {list.length === 0 ? <div className="slot-empty">{SLOT_HINT[slot]}(ここへドラッグ可)</div> : null}
            <ol className="clip-list">
              {list.map((c, k) => {
                const s = sourceOf(c);
                const globalIndex = project.clips.indexOf(c);
                return (
                  <li
                    key={c.id}
                    className={cx(
                      "clip-row",
                      props.editingId === c.id && "is-editing",
                      dragId === c.id && "is-dragging",
                      dropTarget === c.id && "is-drop-before",
                      !s && "is-broken",
                    )}
                    draggable
                    onDragStart={(e) => {
                      setDragId(c.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", c.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropTarget(null);
                    }}
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setDropTarget(c.id);
                    }}
                    onDrop={(e) => onDrop(e, slot, c.id)}
                  >
                    <span className="clip-grip" aria-hidden>
                      <Icon.Grip />
                    </span>
                    <span className="clip-idx mono">{k + 1}</span>
                    <button className="clip-thumb" onClick={() => props.onEdit(c)} title="編集">
                      {s ? <img src={assetUrl("", project.id, s.thumbPath)} alt="" loading="lazy" /> : <Icon.Alert />}
                    </button>
                    <button className="clip-info" onClick={() => props.onEdit(c)} title="編集">
                      <span className="clip-src">{s ? basename(s.originalPath) : "素材が見つかりません"}</span>
                      <span className="clip-range mono">
                        {formatTime(c.inSec)} – {formatTime(c.outSec)}
                        <span className="clip-len">{formatSec(c.outSec - c.inSec)}</span>
                        <span className="clip-vol" title="ゲーム音">
                          ♪{Math.round(c.gameVolume * 100)}
                        </span>
                      </span>
                    </button>
                    <span className="clip-actions">
                      <button
                        className="btn btn-icon btn-ghost"
                        title="上へ"
                        aria-label="上へ"
                        disabled={k === 0}
                        onClick={() => props.onChangeClips(step(project.clips, c.id, -1))}
                      >
                        <Icon.Up />
                      </button>
                      <button
                        className="btn btn-icon btn-ghost"
                        title="下へ"
                        aria-label="下へ"
                        disabled={k === list.length - 1}
                        onClick={() => props.onChangeClips(step(project.clips, c.id, 1))}
                      >
                        <Icon.Down />
                      </button>
                      <button
                        className="btn btn-icon btn-ghost btn-danger"
                        title="削除"
                        aria-label={`クリップ ${globalIndex + 1} を削除`}
                        onClick={() => remove(c.id)}
                      >
                        <Icon.Trash />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </Section>
  );
}
