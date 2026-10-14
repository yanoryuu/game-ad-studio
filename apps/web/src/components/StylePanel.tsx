import type { CSSProperties } from "react";
import { EMPHASIS_COLORS, isShortTemplate } from "@gas/shared";
import type { CaptionStyle, Format, Project, Style, VerticalMode, Watermark, WatermarkPosition } from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import type { UpdateProject } from "../hooks/useProject";
import { cx } from "../util";
import { EmphasisText } from "./Emphasis";
import { Field, Icon, Section, Segmented, Slider, Switch } from "./ui";

const VERTICAL_MODES: { mode: VerticalMode; name: string; desc: string }[] = [
  { mode: "blur", name: "ぼかし背景", desc: "16:9 の映像全体を中央に、上下をぼかしで埋める" },
  { mode: "crop", name: "クロップ", desc: "縦いっぱいに切り抜く。位置はクリップごとに調整" },
];

const CORNERS: { pos: Exclude<WatermarkPosition, "none">; label: string }[] = [
  { pos: "top-left", label: "左上" },
  { pos: "top-right", label: "右上" },
  { pos: "bottom-left", label: "左下" },
  { pos: "bottom-right", label: "右下" },
];

export function StylePanel(props: {
  project: Project;
  update: UpdateProject;
  format: Format;
  setFormat: (f: Format) => void;
  onOpenClips: () => void;
}) {
  const { project, update } = props;
  const style = project.style;
  const wm = style.watermark;
  const cap = style.captions;
  const setStyle = (patch: Partial<Style>) => update((p) => ({ ...p, style: { ...p.style, ...patch } }));
  const setWm = (patch: Partial<Watermark>) => setStyle({ watermark: { ...wm, ...patch } });
  const setCap = (patch: Partial<CaptionStyle>) => setStyle({ captions: { ...cap, ...patch } });

  const logo = project.game.logo ? assetUrl("", project.id, project.game.logo) : null;

  const vmode = style.vertical?.mode ?? "blur";
  const cropClips = project.clips.filter((c) => c.focusX !== undefined && c.focusX !== 0.5).length;

  return (
    <div className="style-panel">
      <Section title="縦型 (9:16)">
        <div className="vmode-list" role="radiogroup" aria-label="9:16 の作り方">
          {VERTICAL_MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="radio"
              aria-checked={vmode === m.mode}
              className={cx("vmode", vmode === m.mode && "is-active")}
              onClick={() => setStyle({ vertical: { mode: m.mode } })}
            >
              <span className={cx("vmode-glyph", `vg-${m.mode}`)} aria-hidden>
                <span className="vg-band" />
                <span className="vg-video" />
                <span className="vg-band" />
              </span>
              <span className="vmode-name">{m.name}</span>
              <span className="vmode-desc">{m.desc}</span>
            </button>
          ))}
        </div>
        {project.template === "intro" ? (
          <div className="field-hint warn">紹介動画風では使いません(9:16 は常に「上:見出し帯 / 中央:16:9 映像 / 下:字幕」のレイアウト)。</div>
        ) : isShortTemplate(project.template) ? (
          <div className="field-hint">
            ショート向けテンプレートでは「クロップ」= 映像を縦いっぱいに、「ぼかし背景」= 中央に 16:9 の映像帯 + 上下に文字、として使います(テンプレートによっては固定のレイアウトになります)。
          </div>
        ) : null}
        {vmode === "crop" ? (
          <div className="field-hint">
            切り抜く位置(focusX)はクリップを編集すると映像上の枠で調整できます
            {cropClips ? `(調整済み ${cropClips} 本)` : ""}。{" "}
            <button className="link-btn" onClick={props.onOpenClips}>
              クリップ一覧を開く
            </button>
          </div>
        ) : null}
        {props.format !== "9:16" ? (
          <button className="btn btn-sm" onClick={() => props.setFormat("9:16")}>
            <Icon.Crop size={13} /> 9:16 でプレビュー
          </button>
        ) : null}
      </Section>

      <Section title="配置プレビュー">
        {/* Miniature 16:9 frame showing watermark corner + caption placement. */}
        <div className="mini-frame" aria-label="ウォーターマークと字幕の配置">
          {CORNERS.map((c) => (
            <button
              key={c.pos}
              type="button"
              className={cx("mf-corner", `mf-${c.pos}`, wm.position === c.pos && "is-active")}
              onClick={() => setWm({ position: c.pos })}
              title={`ウォーターマークを${c.label}に`}
              aria-pressed={wm.position === c.pos}
              style={{ "--wm-scale": wm.scale } as CSSProperties}
            >
              {wm.position === c.pos ? (
                logo ? <img src={logo} alt="" /> : <span className="mf-title">{project.game.title || "TITLE"}</span>
              ) : null}
            </button>
          ))}
          {cap.enabled ? (
            <span className={cx("mf-cap", `mf-cap-${cap.position}`, `mf-cap-${cap.size}`)}>字幕がここに表示されます</span>
          ) : null}
        </div>
        <div className="field-hint">枠の角をクリックするとウォーターマークの位置を変えられます(本編中に表示)。</div>
      </Section>

      <Section title="ウォーターマーク">
        <Field label="位置">
          <Segmented<WatermarkPosition>
            size="sm"
            value={wm.position}
            onChange={(position) => setWm({ position })}
            ariaLabel="ウォーターマークの位置"
            options={[
              ...CORNERS.map((c) => ({ value: c.pos, label: c.label })),
              { value: "none" as const, label: "なし" },
            ]}
          />
        </Field>
        <Slider
          label="サイズ"
          value={wm.scale}
          min={0.25}
          max={3}
          step={0.05}
          format={(v) => `×${v.toFixed(2)}`}
          onChange={(scale) => setWm({ scale })}
          disabled={wm.position === "none"}
        />
        {project.template === "intro" ? <div className="field-hint warn">紹介動画風ではウォーターマークを出しません(見出し帯が担います)。</div> : null}
        {isShortTemplate(project.template) ? (
          <div className="field-hint warn">ショート向けテンプレートではウォーターマークを出しません(上部の大きな文字・エンドカードが担います)。</div>
        ) : null}
        {!project.game.logo ? <div className="field-hint">ロゴ未設定のときはタイトル文字を表示します(「設定」タブで登録)。</div> : null}
      </Section>

      <Section title="字幕">
        <Switch checked={cap.enabled} onChange={(enabled) => setCap({ enabled })} label="字幕を表示する" />
        <div className="field-row">
          <Field label="位置">
            <Segmented<CaptionStyle["position"]>
              size="sm"
              value={cap.position}
              onChange={(position) => setCap({ position })}
              ariaLabel="字幕の位置"
              options={[
                { value: "bottom", label: "下", disabled: !cap.enabled },
                { value: "center", label: "中央", disabled: !cap.enabled },
              ]}
            />
          </Field>
          <Field label="サイズ">
            <Segmented<CaptionStyle["size"]>
              size="sm"
              value={cap.size}
              onChange={(size) => setCap({ size })}
              ariaLabel="字幕のサイズ"
              options={[
                { value: "m", label: "標準", disabled: !cap.enabled },
                { value: "l", label: "大", disabled: !cap.enabled },
              ]}
            />
          </Field>
        </div>
      </Section>

      <Section title="強調ワード 【】">
        <div className="emph-colors" role="radiogroup" aria-label="強調の色">
          {EMPH_PRESETS.map((c) => {
            const active = style.emphasisColor.toLowerCase() === c.value.toLowerCase();
            return (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={active}
                className={cx("emph-swatch", active && "is-active")}
                onClick={() => setStyle({ emphasisColor: c.value })}
                title={c.value}
              >
                <span className="emph-dot" style={{ background: c.value }} />
                {c.label}
              </button>
            );
          })}
          <span className={cx("emph-swatch is-custom", isCustomEmph(style.emphasisColor) && "is-active")}>
            <ColorField label="カスタム" value={style.emphasisColor} onChange={(emphasisColor) => setStyle({ emphasisColor })} />
          </span>
        </div>
        <div className="emph-sample" lang="ja">
          <EmphasisText text={"このゲーム【神すぎる】んだが！"} color={style.emphasisColor} />
        </div>
        <div className="field-hint">台本・字幕・紹介動画風の見出し/ポイント/情報カードで【】で囲んだ語の色です(少し大きく表示)。</div>
      </Section>

      <Section title="カラー">
        <div className="field-row">
          <ColorField label="メイン" value={style.primaryColor} onChange={(primaryColor) => setStyle({ primaryColor })} />
          <ColorField label="アクセント" value={style.accentColor} onChange={(accentColor) => setStyle({ accentColor })} />
        </div>
      </Section>
    </div>
  );
}

const EMPH_PRESETS = [
  { label: "黄", value: EMPHASIS_COLORS.yellow },
  { label: "赤", value: EMPHASIS_COLORS.red },
];
const isCustomEmph = (v: string) => !EMPH_PRESETS.some((p) => p.value.toLowerCase() === v.toLowerCase());

function ColorField(props: { label: string; value: string; onChange: (v: string) => void }) {
  const hex = /^#[0-9a-f]{6}$/i.test(props.value) ? props.value : "#ffffff";
  return (
    <label className="color-field">
      <span className="field-label">{props.label}</span>
      <span className="color-row">
        <input type="color" value={hex} onChange={(e) => props.onChange(e.target.value)} aria-label={props.label} />
        <input className="input input-sm mono" value={props.value} onChange={(e) => props.onChange(e.target.value)} spellCheck={false} />
      </span>
    </label>
  );
}
