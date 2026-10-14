import type { CSSProperties } from "react";
import type { CaptionStyle, Project, Style, Watermark, WatermarkPosition } from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import type { UpdateProject } from "../hooks/useProject";
import { cx } from "../util";
import { Field, Section, Segmented, Slider, Switch } from "./ui";

const CORNERS: { pos: Exclude<WatermarkPosition, "none">; label: string }[] = [
  { pos: "top-left", label: "左上" },
  { pos: "top-right", label: "右上" },
  { pos: "bottom-left", label: "左下" },
  { pos: "bottom-right", label: "右下" },
];

export function StylePanel(props: { project: Project; update: UpdateProject }) {
  const { project, update } = props;
  const style = project.style;
  const wm = style.watermark;
  const cap = style.captions;
  const setStyle = (patch: Partial<Style>) => update((p) => ({ ...p, style: { ...p.style, ...patch } }));
  const setWm = (patch: Partial<Watermark>) => setStyle({ watermark: { ...wm, ...patch } });
  const setCap = (patch: Partial<CaptionStyle>) => setStyle({ captions: { ...cap, ...patch } });

  const logo = project.game.logo ? assetUrl("", project.id, project.game.logo) : null;

  return (
    <div className="style-panel">
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

      <Section title="カラー">
        <div className="field-row">
          <ColorField label="メイン" value={style.primaryColor} onChange={(primaryColor) => setStyle({ primaryColor })} />
          <ColorField label="アクセント" value={style.accentColor} onChange={(accentColor) => setStyle({ accentColor })} />
        </div>
      </Section>
    </div>
  );
}

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
