import { useEffect, useState } from "react";
import { DEFAULT_IMAGE_MOTION, IMAGE_MAX_CLIP_SEC, type Clip, type ClipSlot, type ImageMotion, type Project, type Source } from "@gas/shared";
import { sourceImageUrl } from "@gas/compositions";
import { clamp, cx, formatSec, round2, sourceName } from "../util";
import { CropFrame, type ClipDraft } from "./ClipMarker";
import { Icon, Segmented } from "./ui";

export const IMAGE_MOTION_LABEL: Record<ImageMotion, string> = {
  none: "なし",
  zoomIn: "ズームイン",
  zoomOut: "ズームアウト",
  panLeft: "左へパン",
  panRight: "右へパン",
};
const MOTIONS = Object.keys(IMAGE_MOTION_LABEL) as ImageMotion[];

/** Shortest / default length (seconds) of a clip on an image source. */
const MIN_IMAGE_SEC = 0.5;
const DEFAULT_IMAGE_SEC = 3;
const PRESETS = [2, 3, 5, 8];

/**
 * Clip editor for a native image source (isStillImageSource): instead of IN/OUT scrubbing against a video,
 * the clip's LENGTH (stored as inSec 0 .. outSec = length, at most IMAGE_MAX_CLIP_SEC) and its camera
 * motion ("動き" = clip.imageMotion). The preview loops the motion over the chosen length (approximation of
 * the render: the whole image, contained in the 16:9 box).
 */
export function ImageClipEditor(props: {
  project: Project;
  source: Source;
  editingClip: Clip | null;
  editingIndex: number;
  onAdd: (draft: ClipDraft) => void;
  onUpdate: (clipId: string, patch: Partial<ClipDraft>) => void;
  onDoneEditing: () => void;
  compact?: boolean;
  cropMode?: boolean;
  previewVertical?: boolean;
  onShowVertical?: () => void;
}) {
  const { project, source, editingClip } = props;
  const editingId = editingClip?.id ?? null;
  const [draft, setDraft] = useState<ClipDraft>(() => imageDraft(editingClip));
  const [lenText, setLenText] = useState(() => String(lengthOf(imageDraft(editingClip))));
  const [showFrame, setShowFrame] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const d = imageDraft(editingClip);
    setDraft(d);
    setLenText(String(lengthOf(d)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.id, editingId]);

  // keep in sync when the clip is changed elsewhere (clip list, undo)
  useEffect(() => {
    if (!editingClip) return;
    const d = imageDraft(editingClip);
    setDraft((cur) => {
      if (
        cur.inSec === d.inSec &&
        cur.outSec === d.outSec &&
        cur.slot === d.slot &&
        cur.focusX === d.focusX &&
        cur.imageMotion === d.imageMotion
      )
        return cur;
      if (lengthOf(cur) !== lengthOf(d)) setLenText(String(lengthOf(d)));
      return d;
    });
  }, [editingClip]);

  useEffect(() => setLoadError(false), [source.id]);

  const change = (patch: Partial<ClipDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (editingId) props.onUpdate(editingId, patch);
  };
  const setLength = (sec: number) => {
    const len = round2(clamp(sec, MIN_IMAGE_SEC, IMAGE_MAX_CLIP_SEC));
    setLenText(String(len));
    change({ inSec: 0, outSec: len });
  };

  const len = lengthOf(draft);
  const motion = draft.imageMotion ?? DEFAULT_IMAGE_MOTION;
  const src = sourceImageUrl("", project, source.id, true);
  const frameOn = !!props.cropMode && !props.compact && showFrame;

  const preview = (
    <div className="marker-video image-stage">
      <img
        key={`${source.id}:${motion}:${len}`}
        src={src}
        alt=""
        className={cx("image-stage-img", !frameOn && motion !== "none" && `img-motion-${motion}`)}
        style={{ animationDuration: `${Math.max(0.5, len)}s` }}
        onError={() => setLoadError(true)}
        draggable={false}
      />
      {frameOn && !loadError ? (
        <CropFrame aspect={source.width / source.height} focusX={draft.focusX ?? 0.5} onChange={(focusX) => change({ focusX })} />
      ) : null}
      {loadError ? (
        <div className="marker-video-msg">
          <Icon.Alert /> プレビュー画像を読み込めません
        </div>
      ) : null}
      <span className="image-stage-tag mono">
        画像 {source.width}×{source.height}
      </span>
    </div>
  );

  if (props.compact) {
    return (
      <div className="marker is-compact is-image">
        {preview}
        <div className="compact-range">
          <span className="muted">画像は {formatSec(DEFAULT_IMAGE_SEC)} のクリップとして追加(長さ・動きは後で調整)</span>
          <button className="btn btn-sm ml-auto" onClick={() => props.onAdd({ ...imageDraft(null), slot: "hook" })} title="フックに追加">
            <Icon.Plus size={12} /> フック
          </button>
          <button className="btn btn-sm" onClick={() => props.onAdd({ ...imageDraft(null), slot: "main" })} title="本編に追加">
            <Icon.Plus size={12} /> 本編
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cx("marker is-image", editingClip && "is-editing")}>
      <div className="marker-head">
        {editingClip ? (
          <>
            <span className="badge badge-edit">編集中</span>
            <span className="marker-title">クリップ {props.editingIndex + 1}</span>
            <span className="badge-image">画像</span>
            <button className="btn btn-sm btn-ghost ml-auto" onClick={props.onDoneEditing}>
              <Icon.Check /> 完了
            </button>
          </>
        ) : (
          <>
            <Icon.Image />
            <span className="marker-title" title={source.originalPath}>
              {sourceName(source)}
            </span>
          </>
        )}
      </div>

      {preview}

      <div className="image-len">
        <label className="field-label" htmlFor="image-clip-len">
          長さ
        </label>
        <input
          id="image-clip-len"
          className="input input-sm mono"
          type="number"
          step={0.5}
          min={MIN_IMAGE_SEC}
          max={IMAGE_MAX_CLIP_SEC}
          value={lenText}
          onChange={(e) => {
            setLenText(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(v) && v >= MIN_IMAGE_SEC && v <= IMAGE_MAX_CLIP_SEC) {
              change({ inSec: 0, outSec: round2(v) });
            }
          }}
          onBlur={() => {
            const v = Number(lenText);
            setLength(Number.isFinite(v) && lenText !== "" ? v : len);
          }}
          aria-label="画像クリップの長さ(秒)"
        />
        <span className="muted">秒</span>
        <span className="image-len-presets">
          {PRESETS.map((p) => (
            <button key={p} type="button" className={cx("btn btn-sm btn-ghost", len === p && "is-on")} onClick={() => setLength(p)}>
              {p}s
            </button>
          ))}
        </span>
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
        <label className="image-motion">
          <span className="vol-label">動き</span>
          <select
            className="input input-sm"
            value={motion}
            onChange={(e) => change({ imageMotion: e.target.value as ImageMotion })}
            aria-label="画像の動き"
          >
            {MOTIONS.map((m) => (
              <option key={m} value={m}>
                {IMAGE_MOTION_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {props.cropMode ? (
        <div className="focus-row">
          <button
            type="button"
            className={cx("btn btn-sm btn-ghost focus-toggle", showFrame && "is-on")}
            onClick={() => setShowFrame((v) => !v)}
            title="画像上に 9:16 の切り抜き枠を表示(枠の表示中は動きのプレビューを止めます)"
            aria-pressed={showFrame}
          >
            <Icon.Crop size={13} /> 9:16 枠
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={draft.focusX ?? 0.5}
            onChange={(e) => change({ focusX: Number(e.target.value) })}
            onDoubleClick={() => change({ focusX: 0.5 })}
            aria-label="9:16 クロップの横位置"
          />
          <span className="mono focus-val">{Math.round((draft.focusX ?? 0.5) * 100)}%</span>
          {editingClip && !props.previewVertical && props.onShowVertical ? (
            <button className="link-btn" onClick={props.onShowVertical} title="プレビューを 9:16 に切り替えて確認">
              9:16 で確認
            </button>
          ) : null}
        </div>
      ) : null}

      {!editingClip ? (
        <button className="btn btn-primary btn-block" onClick={() => props.onAdd(draft)}>
          <Icon.Plus /> クリップを追加({formatSec(len)})
        </button>
      ) : null}
      <div className="field-hint">
        画像はそのまま(高画質のまま)使われます。長さは {MIN_IMAGE_SEC}〜{IMAGE_MAX_CLIP_SEC} 秒、テンプレートの尺に合わせて伸縮することがあります。
      </div>
    </div>
  );
}

function lengthOf(d: Pick<ClipDraft, "inSec" | "outSec">): number {
  return round2(Math.max(0, d.outSec - d.inSec));
}

/** Draft of an image clip (new: [0, 3 s], main, zoomIn default = imageMotion absent). */
function imageDraft(clip: Clip | null): ClipDraft {
  if (!clip) return { inSec: 0, outSec: DEFAULT_IMAGE_SEC, slot: "main", gameVolume: 0.8 };
  const d: ClipDraft = { inSec: clip.inSec, outSec: clip.outSec, slot: clip.slot, gameVolume: clip.gameVolume };
  if (clip.focusX !== undefined) d.focusX = clip.focusX;
  if (clip.imageMotion !== undefined) d.imageMotion = clip.imageMotion;
  return d;
}
