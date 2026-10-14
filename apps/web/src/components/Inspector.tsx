import { useRef, useState } from "react";
import { isShortTemplate, SHORT_TEMPLATE_META, type DurationSec, type Format, type Fps, type Game, type Lang, type Project } from "@gas/shared";
import { assetUrl } from "@gas/compositions";
import { api, errorMessage } from "../api";
import { hasExt, LOGO_IMAGE_EXTS, useFileDrop } from "../hooks/useFileDrop";
import type { UpdateProject } from "../hooks/useProject";
import { cx } from "../util";
import { Field, Icon, Section, Segmented, Spinner } from "./ui";

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
              { value: "9:16", label: "9:16 縦" },
            ]}
          />
        </Field>
        <div className="field-hint">プレビューの形式です(書き出しはプレビュー下のパネルで複数選べます)。9:16 の作り方はスタイルタブで設定します。</div>
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
        <Field
          label={project.template === "features" ? "キャッチコピー" : "フック"}
          hint={
            project.template === "trailer"
              ? "トレーラー風では使いません(構成タブのテロップを使います)"
              : project.template === "intro"
                ? "紹介動画風では使いません(構成タブの見出し帯を使います)"
              : isShortTemplate(project.template)
                ? `ショート向けテンプレートでは使いません(構成タブの${SHORT_TEMPLATE_META[project.template].fields.title?.label ?? "設定"}を使います)`
              : project.template === "features"
                ? "タイトルと一緒に冒頭に出る一言"
                : "冒頭に大きく出る一言"
          }
          htmlFor="txt-hook"
        >
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
        <Field
          label="CTA"
          hint={
            project.template === "loop"
              ? "最後に小さく重ねる呼びかけ(無限ループはエンドカード無し)"
              : project.template === "dev-pitch"
                ? "エンドカードと、下部に常時出る CTA バーの呼びかけ"
                : "エンドカードの呼びかけ"
          }
          htmlFor="txt-cta"
        >
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
        <Field label="発売情報" hint="言語ごとにエンドカードへ表示(空欄なら非表示)" htmlFor="g-release-ja">
          <div className="lang-inputs">
            {(["ja", "en"] as const).map((lg) => (
              <label key={lg} className={cx("lang-input", lg === lang && "is-current")}>
                <span className="lang-tag mono">{lg.toUpperCase()}</span>
                <input
                  id={`g-release-${lg}`}
                  className="input"
                  placeholder={lg === "ja" ? "2026年冬 発売予定" : "Coming Winter 2026"}
                  lang={lg}
                  value={project.game.releaseText[lg]}
                  onChange={(e) => setGame({ releaseText: { ...project.game.releaseText, [lg]: e.target.value } })}
                />
              </label>
            ))}
          </div>
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
    if (!hasExt(LOGO_IMAGE_EXTS, file.name)) {
      setError("png / jpg / webp / gif / svg の画像を選んでください");
      return;
    }
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

  const drop = useFileDrop({
    accept: LOGO_IMAGE_EXTS,
    disabled: busy,
    onFiles: (files) => void upload(files[0]),
    onReject: () => setError("png / jpg / webp / gif / svg の画像を選んでください"),
  });

  return (
    <div className={cx("asset", props.wide && "asset-wide")} {...drop.dropProps}>
      <div className="field-label">{props.label}</div>
      <button
        type="button"
        className={cx("asset-drop", props.value && "has-image", drop.over && "is-drop-over")}
        data-drop-label="ここにドロップ"
        onClick={() => inputRef.current?.click()}
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

