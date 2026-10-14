import { useState } from "react";
import {
  createDefaultShortFormData,
  generateId,
  SHORT_TEMPLATE_META,
  templateUsesSe,
  type Lang,
  type LocalizedText,
  type Project,
  type ShortFormData,
  type ShortItem,
  type ShortTemplateId,
  type ShortTemplateMeta,
  type ShortTextField,
} from "@gas/shared";
import type { UpdateProject } from "../hooks/useProject";
import { shortData } from "../shortForm";
import { cx } from "../util";
import { LangAside, LocalizedInput, moveItem } from "./templateBits";
import { Icon, Section, Switch } from "./ui";

const LANG_NAME: Record<Lang, string> = { ja: "日本語", en: "English" };
type TextKey = "title" | "sub" | "note";
const TEXT_KEYS: readonly TextKey[] = ["title", "sub", "note"];
type FieldKey = keyof ShortTemplateMeta["fields"];

/**
 * 構成 tab for the 10 short-form templates (ARCHITECTURE §5.10): a generic editor of templateData.shorts[id]
 * driven entirely by SHORT_TEMPLATE_META[id].fields (absent field = unused = hidden).
 */
export function ShortFormEditor(props: {
  project: Project;
  id: ShortTemplateId;
  update: UpdateProject;
  lang: Lang;
  setLang: (l: Lang) => void;
  onOpenAudio: () => void;
  onOpenClips: () => void;
}) {
  const { project, id, update, lang } = props;
  const meta = SHORT_TEMPLATE_META[id];
  const data = shortData(project, id);
  const defaults = createDefaultShortFormData(id);
  const color = project.style.emphasisColor;
  const [confirmReset, setConfirmReset] = useState(false);

  const setData = (fn: (d: ShortFormData) => ShortFormData) =>
    update((p) => ({
      ...p,
      templateData: { ...p.templateData, shorts: { ...p.templateData.shorts, [id]: fn(p.templateData.shorts?.[id] ?? createDefaultShortFormData(id)) } },
    }));
  const setItems = (fn: (l: ShortItem[]) => ShortItem[]) => setData((d) => ({ ...d, items: fn(d.items) }));

  const order = Object.keys(meta.fields) as FieldKey[];
  const hookN = project.clips.filter((c) => c.slot === "hook").length;
  const mainN = project.clips.filter((c) => c.slot === "main").length;
  const seOn = templateUsesSe(project.template) && project.audio.se.enabled && project.audio.se.volume > 0;

  const textField = (key: TextKey, f: ShortTextField) => {
    const value = data[key];
    const ex = defaults[key];
    const multi = key === "title" || /\n/.test(value.ja + value.en);
    return (
      <div className="field short-field" key={key}>
        <span className="field-label">{f.label}</span>
        <LocalizedInput
          value={value}
          lang={lang}
          big={key === "title"}
          multiline={multi}
          emphasisColor={color}
          ariaLabel={f.label}
          placeholder={{ ja: ex.ja ? `例: ${ex.ja}` : "空欄 = 表示しない", en: ex.en ? `e.g. ${ex.en}` : "empty = hidden" }}
          onChange={(v: LocalizedText) => setData((d) => ({ ...d, [key]: v }))}
        />
        <div className="field-hint">
          {f.hint ? `${f.hint} ` : ""}
          {!value[lang].trim() ? <span className="muted">({LANG_NAME[lang]} が空のため、この言語では表示しません)</span> : null}
        </div>
      </div>
    );
  };

  const itemsField = (f: NonNullable<ShortTemplateMeta["fields"]["items"]>) => {
    const items = data.items;
    const under = items.length < f.min;
    return (
      <div className="field short-field" key="items">
        <span className="field-label short-items-head">
          {f.label}
          <span className="mono muted">
            {items.length} / {f.max}
          </span>
        </span>
        {items.length === 0 ? <div className="field-hint">{f.label}はありません。</div> : null}
        <ol className="feat-items">
          {items.map((it, i) => (
            <li key={it.id} className="feat-item short-item">
              <div className="feat-item-head">
                <span className="feat-badge is-short">
                  {f.label} {i + 1}
                </span>
                {!it.text[lang].trim() ? <span className="feat-stats muted">{LANG_NAME[lang]} が空のため非表示</span> : null}
                <span className="feat-actions">
                  <button className="btn btn-icon btn-ghost" title="上へ" aria-label="上へ" disabled={i === 0} onClick={() => setItems((l) => moveItem(l, i, -1))}>
                    <Icon.Up />
                  </button>
                  <button
                    className="btn btn-icon btn-ghost"
                    title="下へ"
                    aria-label="下へ"
                    disabled={i === items.length - 1}
                    onClick={() => setItems((l) => moveItem(l, i, 1))}
                  >
                    <Icon.Down />
                  </button>
                  <button
                    className="btn btn-icon btn-ghost btn-danger"
                    title={items.length <= f.min ? `${f.label}は ${f.min} 個以上にしてください` : "削除"}
                    aria-label={`${f.label} ${i + 1} を削除`}
                    disabled={items.length <= f.min}
                    onClick={() => setItems((l) => l.filter((x) => x.id !== it.id))}
                  >
                    <Icon.Trash />
                  </button>
                </span>
              </div>
              <LocalizedInput
                value={it.text}
                lang={lang}
                emphasisColor={color}
                multiline={/\n/.test(it.text.ja + it.text.en)}
                ariaLabel={`${f.label} ${i + 1}`}
                placeholder={{
                  ja: defaults.items[i]?.text.ja ? `例: ${defaults.items[i]!.text.ja}` : "",
                  en: defaults.items[i]?.text.en ? `e.g. ${defaults.items[i]!.text.en}` : "",
                }}
                onChange={(text) => setItems((l) => l.map((x) => (x.id === it.id ? { ...x, text } : x)))}
              />
            </li>
          ))}
        </ol>
        <button
          className="btn btn-sm btn-ghost add-line"
          disabled={items.length >= f.max}
          onClick={() => setItems((l) => (l.length >= f.max ? l : [...l, { id: generateId("item", 8), text: { ja: "", en: "" } }]))}
        >
          <Icon.Plus /> {f.label}を追加{items.length >= f.max ? `(最大 ${f.max} 個)` : ""}
        </button>
        <div className={cx("field-hint", under && "warn")}>
          {under ? `${f.label}は ${f.min} 個以上必要です。` : ""}
          {f.hint ?? ""}
        </div>
      </div>
    );
  };

  const numberField = (f: NonNullable<ShortTemplateMeta["fields"]["number"]>) => (
    <div className="field short-field" key="number">
      <label className="short-num">
        <span className="field-label">{f.label}</span>
        <input
          type="number"
          className="input input-sm mono"
          min={f.min}
          max={f.max}
          step={1}
          value={data.number}
          aria-label={f.label}
          onChange={(e) => {
            const raw = e.target.valueAsNumber;
            if (!Number.isFinite(raw)) return;
            const number = Math.min(f.max, Math.max(f.min, Math.round(raw)));
            setData((d) => ({ ...d, number }));
          }}
        />
        <span className="mono muted short-num-range">
          {f.min}〜{f.max}
        </span>
      </label>
      {f.hint ? <div className="field-hint">{f.hint}</div> : null}
    </div>
  );

  const flagField = (f: ShortTextField) => (
    <div className="field short-field" key="flag">
      <Switch checked={data.flag} onChange={(flag) => setData((d) => ({ ...d, flag }))} label={f.label} />
      {f.hint ? <div className="field-hint">{f.hint}</div> : null}
    </div>
  );

  return (
    <>
      <Section title={`${meta.name}の設定`} aside={<LangAside lang={lang} setLang={props.setLang} />}>
        <div className="short-desc">{meta.desc}</div>
        {order.map((key) => {
          const f = meta.fields[key];
          if (!f) return null;
          if ((TEXT_KEYS as readonly string[]).includes(key)) return textField(key as TextKey, f);
          if (key === "items") return itemsField(meta.fields.items!);
          if (key === "number") return numberField(meta.fields.number!);
          return flagField(f);
        })}
        <div className="short-reset">
          {confirmReset ? (
            <>
              <span className="field-hint warn">「{meta.name}」の入力を既定の内容に戻します(両言語)。</span>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setData(() => createDefaultShortFormData(id));
                  setConfirmReset(false);
                }}
              >
                戻す
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirmReset(false)}>
                やめる
              </button>
            </>
          ) : (
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirmReset(true)}>
              <Icon.Refresh size={13} /> 既定に戻す
            </button>
          )}
        </div>
      </Section>

      <Section title="クリップの役割">
        <ul className="short-slots">
          {(["hook", "main"] as const).map((slot) => (
            <li key={slot}>
              <span className={cx("slot-tag", `slot-${slot}`)}>{meta.slots[slot].label}</span>
              <span className="mono muted">{slot === "hook" ? hookN : mainN} 本</span>
              <span className="short-slot-hint">{meta.slots[slot].hint}</span>
            </li>
          ))}
        </ul>
        <div className="field-hint">
          クリップは「{meta.slots.hook.label}」→「{meta.slots.main.label}」の順に流れます。{" "}
          <button className="link-btn" onClick={props.onOpenClips}>
            クリップ一覧を開く
          </button>
        </div>
      </Section>

      <Section title="ナレーションと効果音">
        <div className="intro-se-note">
          <Icon.Speaker size={13} />
          <span>
            効果音: {seOn ? `オン(音量 ${Math.round(project.audio.se.volume * 100)}%)` : "オフ"}
            <span className="muted"> — 見出し・項目・場面転換・吹き出し・CTA・字幕の出現で鳴ります</span>
          </span>
          <button className="btn btn-sm ml-auto" onClick={props.onOpenAudio}>
            音声タブで設定
          </button>
        </div>
        <div className="field-hint">
          台本のフック → 本文の行は区切りなく続けて再生され、CTA の行は
          {id === "loop" ? "最後に重ねる小さな CTA の開始で" : "エンドカードで"}流れます。ナレーションが無くても文字の演出だけで成立します。
          新しく追加した行は早口(×1.25)から始まります。
        </div>
      </Section>
    </>
  );
}
