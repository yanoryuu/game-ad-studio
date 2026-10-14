import { useMemo, useState, type DragEvent } from "react";
import { assignFeatureClips, trailerClipOrder, type Clip, type ClipSlot, type FeatureItem, type Project, type TemplateId } from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import { basename, cx, formatSec, formatTime } from "../util";
import { Empty, Icon, Section } from "./ui";

const SLOT_LABEL: Record<TemplateId, Record<ClipSlot, string>> = {
  "hook-play-cta": { hook: "フック", main: "本編" },
  features: { hook: "タイトル", main: "魅力" },
  trailer: { hook: "フック", main: "本編" },
  intro: { hook: "前半", main: "後半" },
};
const SLOT_HINT: Record<TemplateId, Record<ClipSlot, string>> = {
  "hook-play-cta": {
    hook: "冒頭 2.5 秒(ナレーションに合わせて最大 5 秒)。最も派手な瞬間を。",
    main: "プレイ映像を順にカットでつなぎます。",
  },
  features: {
    hook: "冒頭のタイトル(ロゴ+キャッチ)の背景映像。",
    main: "各魅力の映像。所属を選ぶか「自動」で順番に振り分けます。",
  },
  trailer: {
    hook: "カット列の先頭。フック → 本編の順に短いカットでつながります。",
    main: "フックの後に続くカット(各最大 2 秒)。",
  },
  intro: {
    hook: "台本の行ごとに、フック → 本編の順で映像が切り替わります。",
    main: "フックの後に続く映像(足りなければ先頭に戻って繰り返し)。",
  },
};
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥"];

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

/** Swap clip `id` with its previous/next neighbour in `group` (ids in display order). */
function stepIn(clips: Clip[], group: string[], id: string, dir: -1 | 1): Clip[] {
  const k = group.indexOf(id);
  const other = group[k + dir];
  if (k < 0 || !other) return clips;
  const i = clips.findIndex((c) => c.id === id);
  const j = clips.findIndex((c) => c.id === other);
  const next = clips.slice();
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

function setFeature(clips: Clip[], id: string, featureId: string | null): Clip[] {
  return clips.map((c) => {
    if (c.id !== id) return c;
    if (featureId) return { ...c, featureId };
    const { featureId: _omit, ...rest } = c;
    return rest;
  });
}

type Group = { key: string; slot: ClipSlot; item?: FeatureItem; itemIndex?: number; clips: Clip[] };

export function ClipList(props: {
  project: Project;
  editingId: string | null;
  onEdit: (clip: Clip) => void;
  onChangeClips: (clips: Clip[]) => void;
}) {
  const { project } = props;
  const tpl = project.template;
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const items = project.templateData.features.items;
  const featureMode = tpl === "features" && items.length > 0;
  const itemIds = new Set(items.map((i) => i.id));
  const assigned = useMemo(() => (featureMode ? assignFeatureClips(project) : {}), [featureMode, project]);
  const trailerIndex = useMemo(
    () => (tpl === "trailer" || tpl === "intro" ? new Map(trailerClipOrder(project).map((c, i) => [c.id, i])) : null),
    [tpl, project],
  );

  const sourceOf = (c: Clip) => project.sources.find((s) => s.id === c.sourceId);
  const total = (list: Clip[]) => list.reduce((s, c) => s + Math.max(0, c.outSec - c.inSec), 0);

  /** Drop `dragId` before `beforeId` (null = end of slot); in a feature group also assign that feature. */
  const onDrop = (e: DragEvent, slot: ClipSlot, beforeId: string | null, featureId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const id = dragId ?? e.dataTransfer.getData("text/plain");
    setDragId(null);
    setDropTarget(null);
    if (!id) return;
    let next = moveClip(project.clips, id, slot, beforeId);
    if (featureId) next = setFeature(next, id, featureId);
    props.onChangeClips(next);
  };

  const remove = (id: string) => props.onChangeClips(project.clips.filter((c) => c.id !== id));

  const groups: { slot: ClipSlot; subs: Group[] }[] = (["hook", "main"] as const).map((slot) => {
    const list = project.clips.filter((c) => c.slot === slot);
    if (slot === "main" && featureMode) {
      return {
        slot,
        subs: items.map((item, i) => ({ key: `feat:${item.id}`, slot, item, itemIndex: i, clips: assigned[item.id] ?? [] })),
      };
    }
    return { slot, subs: [{ key: `slot:${slot}`, slot, clips: list }] };
  });

  return (
    <Section className="clips-section" title="クリップ" aside={<span className="mono muted">{project.clips.length}</span>}>
      {project.clips.length === 0 ? (
        <Empty compact icon={<Icon.Scissors size={22} />} title="クリップがありません">
          {project.sources.length === 0
            ? "まず素材を登録してください。"
            : "素材を選んで IN / OUT を決め、「クリップを追加」で追加します。"}
        </Empty>
      ) : null}
      {project.clips.length === 0
        ? null
        : groups.map(({ slot, subs }) => {
            const all = project.clips.filter((c) => c.slot === slot);
            const grouped = subs.length > 1 || !!subs[0]?.item;
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
                  <span className={cx("slot-tag", `slot-${slot}`)}>{SLOT_LABEL[tpl][slot]}</span>
                  <span className="mono muted">
                    {all.length} 本 · {formatSec(total(all))}
                  </span>
                </div>
                {all.length === 0 ? <div className="slot-empty">{SLOT_HINT[tpl][slot]}(ここへドラッグ可)</div> : null}
                {grouped && all.length > 0 ? <div className="slot-hint">{SLOT_HINT[tpl][slot]}</div> : null}
                {subs.map((g) => {
                  const ids = g.clips.map((c) => c.id);
                  const list = (
                    <ol className="clip-list">
                      {g.clips.map((c, k) => {
                        const s = sourceOf(c);
                        const globalIndex = project.clips.indexOf(c);
                        const idx = trailerIndex ? (trailerIndex.get(c.id) ?? 0) + 1 : k + 1;
                        const explicit = !!c.featureId && itemIds.has(c.featureId);
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
                            onDrop={(e) => onDrop(e, slot, c.id, g.item?.id)}
                          >
                            <span className="clip-grip" aria-hidden>
                              <Icon.Grip />
                            </span>
                            <span className="clip-idx mono" title={trailerIndex ? `カット ${idx}` : undefined}>
                              {idx}
                            </span>
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
                            {g.item ? (
                              <select
                                className={cx("input input-sm clip-feat", !explicit && "is-auto")}
                                value={explicit ? c.featureId : ""}
                                onChange={(e) => props.onChangeClips(setFeature(project.clips, c.id, e.target.value || null))}
                                title="所属する魅力(自動 = 順番に振り分け)"
                                aria-label="所属する魅力"
                              >
                                <option value="">自動→{CIRCLED[g.itemIndex!]}</option>
                                {items.map((it, i) => (
                                  <option key={it.id} value={it.id}>
                                    魅力{CIRCLED[i]} {it.heading.ja || it.heading.en}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                            <span className="clip-actions">
                              <button
                                className="btn btn-icon btn-ghost"
                                title="上へ"
                                aria-label="上へ"
                                disabled={k === 0}
                                onClick={() => props.onChangeClips(stepIn(project.clips, ids, c.id, -1))}
                              >
                                <Icon.Up />
                              </button>
                              <button
                                className="btn btn-icon btn-ghost"
                                title="下へ"
                                aria-label="下へ"
                                disabled={k === g.clips.length - 1}
                                onClick={() => props.onChangeClips(stepIn(project.clips, ids, c.id, 1))}
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
                  );
                  if (!g.item) return <div key={g.key}>{list}</div>;
                  return (
                    <div
                      key={g.key}
                      className={cx("feat-group", dropTarget === g.key && "is-drop")}
                      onDragOver={(e) => {
                        if (!dragId) return;
                        e.preventDefault();
                        e.stopPropagation();
                        setDropTarget(g.key);
                      }}
                      onDrop={(e) => onDrop(e, slot, null, g.item!.id)}
                    >
                      <div className="feat-group-head">
                        <span className="feat-badge">魅力{CIRCLED[g.itemIndex!]}</span>
                        <span className="feat-group-name">{g.item.heading.ja || g.item.heading.en || "(見出しなし)"}</span>
                        <span className="mono muted ml-auto">
                          {g.clips.length} 本 · {formatSec(total(g.clips))}
                        </span>
                      </div>
                      {g.clips.length === 0 ? <div className="slot-empty">クリップなし(ここへドラッグで割り当て)</div> : list}
                    </div>
                  );
                })}
              </div>
            );
          })}
    </Section>
  );
}
