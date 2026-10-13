import { useRef, useState } from "react";
import type { DurationSec, Format, Fps, Game, Lang, Project, TemplateId } from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import { api, errorMessage } from "../api";
import type { UpdateProject } from "../hooks/useProject";
import { cx } from "../util";
import { Field, Icon, Section, Segmented, Spinner } from "./ui";

const TEMPLATES: { id: TemplateId; name: string; desc: string; enabled: boolean }[] = [
  { id: "hook-play-cta", name: "王道", desc: "フック → プレイ → エンドカード", enabled: true },
  { id: "features", name: "魅力紹介", desc: "見出し+クリップの繰り返し", enabled: false },
  { id: "trailer", name: "トレーラー風", desc: "BGM に合わせた短いカット", enabled: false },
];

export function Inspector(props: {
  project: Project;
  update: UpdateProject;
  format: Format;
  setFormat: (f: Format) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
}) {
  const { project, update, lang } = props;
  const setGame = (patch: Partial<Game>) => update((p) => ({ ...p, game: { ...p.game, ...patch } }));
  const clearGameKey = (key: "logo" | "keyArt") =>
    update((p) => {
      const { [key]: _omit, ...rest } = p.game;
      return { ...p, game: rest };
    });
  const setText = (key: "hook" | "cta", value: string) =>
    update((p) => ({ ...p, texts: { ...p.texts, [lang]: { ...p.texts[lang], [key]: value } } }));

  return (
    <div className="inspector">
      <Section title="出力">
        <Field label="フォーマット">
          <Segmented<Format>
            value={props.format}
            onChange={props.setFormat}
            ariaLabel="フォーマット"
            options={[
              { value: "16:9", label: "16:9 横" },
              { value: "9:16", label: "9:16 縦", title: "縦レイアウトの本対応は Phase 3" },
            ]}
          />
        </Field>
        {props.format === "9:16" ? (
          <div className="field-hint warn">縦型(ぼかし背景・クロップ)は Phase 3。現状は簡易レイアウトです。</div>
        ) : null}
        <div className="field-row">
          <Field label="尺">
            <Segmented<DurationSec>
              value={project.durationSec}
              onChange={(durationSec) => update((p) => ({ ...p, durationSec }))}
              ariaLabel="尺"
              options={[
                { value: 15, label: "15秒" },
                { value: 30, label: "30秒" },
                { value: null, label: "自由" },
              ]}
            />
          </Field>
          <Field label="fps">
            <Segmented<Fps>
              value={project.fps}
              onChange={(fps) => update((p) => ({ ...p, fps }))}
              ariaLabel="fps"
              options={[
                { value: 30, label: "30" },
                { value: 60, label: "60" },
              ]}
            />
          </Field>
        </div>
      </Section>

      <Section title="テンプレート">
        <div className="tpl-list" role="radiogroup" aria-label="テンプレート">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={project.template === t.id}
              className={cx("tpl", project.template === t.id && "is-active")}
              disabled={!t.enabled}
              onClick={() => update((p) => ({ ...p, template: t.id }))}
            >
              <TemplateGlyph id={t.id} />
              <span className="tpl-text">
                <span className="tpl-name">
                  {t.name}
                  {!t.enabled ? <span className="badge">Phase 3</span> : null}
                </span>
                <span className="tpl-desc">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="テキスト"
        aside={
          <Segmented<Lang>
            size="sm"
            value={lang}
            onChange={props.setLang}
            ariaLabel="言語"
            options={[
              { value: "ja", label: "日本語" },
              { value: "en", label: "English" },
            ]}
          />
        }
      >
        <Field label="フック" hint="冒頭に大きく出る一言" htmlFor="txt-hook">
          <textarea
            id="txt-hook"
            className="input textarea"
            rows={2}
            lang={lang}
            placeholder={lang === "ja" ? "例: 100 体の敵を一撃で。" : "e.g. One hit. A hundred enemies."}
            value={project.texts[lang].hook}
            onChange={(e) => setText("hook", e.target.value)}
          />
        </Field>
        <Field label="CTA" hint="エンドカードの呼びかけ" htmlFor="txt-cta">
          <input
            id="txt-cta"
            className="input"
            lang={lang}
            value={project.texts[lang].cta}
            onChange={(e) => setText("cta", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="ゲーム情報">
        <Field label="タイトル" htmlFor="g-title">
          <input id="g-title" className="input" value={project.game.title} onChange={(e) => setGame({ title: e.target.value })} />
        </Field>
        <Field label="発売情報" htmlFor="g-release">
          <input
            id="g-release"
            className="input"
            placeholder="2026年冬 発売予定 / Coming Winter 2026"
            value={project.game.releaseText}
            onChange={(e) => setGame({ releaseText: e.target.value })}
          />
        </Field>
        <Field label="Steam URL" htmlFor="g-steam">
          <input
            id="g-steam"
            className="input mono"
            placeholder="https://store.steampowered.com/app/…"
            value={project.game.steamUrl ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v) setGame({ steamUrl: v });
              else
                update((p) => {
                  const { steamUrl: _omit, ...rest } = p.game;
                  return { ...p, game: rest };
                });
            }}
          />
        </Field>
        <Field label="プラットフォーム" hint="カンマ区切り" htmlFor="g-platforms">
          <PlatformsInput value={project.game.platforms} onChange={(platforms) => setGame({ platforms })} />
        </Field>
        <div className="asset-row">
          <AssetSlot
            label="ロゴ"
            project={project}
            value={project.game.logo}
            onChange={(ref) => setGame({ logo: ref })}
            onClear={() => clearGameKey("logo")}
          />
          <AssetSlot
            label="キーアート"
            project={project}
            value={project.game.keyArt}
            onChange={(ref) => setGame({ keyArt: ref })}
            onClear={() => clearGameKey("keyArt")}
            wide
          />
        </div>
      </Section>
    </div>
  );
}

function PlatformsInput(props: { value: string[]; onChange: (v: string[]) => void }) {
  // Keep raw text locally so typing "Steam, " isn't normalised away mid-edit.
  const [text, setText] = useState(props.value.join(", "));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : props.value.join(", ");
  return (
    <input
      id="g-platforms"
      className="input"
      value={shown}
      onFocus={() => {
        setText(props.value.join(", "));
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        props.onChange(
          e.target.value
            .split(/[,、]/)
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}

function AssetSlot(props: {
  label: string;
  project: Project;
  value: string | undefined;
  onChange: (ref: string) => void;
  onClear: () => void;
  wide?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.uploadAsset(props.project.id, file);
      props.onChange(res.path);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className={cx("asset", props.wide && "asset-wide")}>
      <div className="field-label">{props.label}</div>
      <button
        type="button"
        className={cx("asset-drop", props.value && "has-image")}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void upload(e.dataTransfer.files[0]);
        }}
        disabled={busy}
        title="クリックまたはドロップで画像を選択"
      >
        {busy ? (
          <Spinner />
        ) : props.value ? (
          <img src={assetUrl("", props.project.id, props.value)} alt={props.label} />
        ) : (
          <span className="asset-empty">
            <Icon.Image size={20} />
            <span>画像を選択</span>
          </span>
        )}
      </button>
      {props.value ? (
        <button type="button" className="link-btn" onClick={props.onClear}>
          削除
        </button>
      ) : null}
      {error ? <div className="field-hint warn">{error}</div> : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        hidden
        onChange={(e) => void upload(e.target.files?.[0])}
      />
    </div>
  );
}

function TemplateGlyph({ id }: { id: TemplateId }) {
  // Tiny timeline diagram of each template's structure.
  const blocks: [number, string][] =
    id === "hook-play-cta"
      ? [[2, "a"], [6, "b"], [2, "c"]]
      : id === "features"
        ? [[1, "c"], [2, "b"], [2, "b"], [2, "b"], [2, "c"]]
        : [[1, "b"], [1, "a"], [1, "b"], [1, "a"], [1, "b"], [2, "c"]];
  return (
    <span className="tpl-glyph" aria-hidden>
      {blocks.map(([w, k], i) => (
        <span key={i} className={`g-${k}`} style={{ flexGrow: w }} />
      ))}
    </span>
  );
}
