import { useMemo, type CSSProperties } from "react";
import {
  generateId,
  hasNarrationInput,
  introClipOrder,
  stripEmphasis,
  templateUsesSe,
  type Format,
  type IntroData,
  type IntroInfoItem,
  type IntroPoint,
  type Lang,
  type LocalizedText,
  type Project,
} from "@gas/shared";
import type { UpdateProject } from "../hooks/useProject";
import { bodyLineLabel, CIRCLED, introPlan, INTRO_SECTION_LABEL, setLangRef } from "../introPlan";
import { cx } from "../util";
import { EmphasisField, EmphasisText } from "./Emphasis";
import { LangAside, LocalizedInput, moveItem, otherLang } from "./templateBits";
import { Icon, Section, Slider, Switch } from "./ui";

const MAX_INFO = 6;
const MAX_POINTS = 5;
const LANG_NAME: Record<Lang, string> = { ja: "日本語", en: "English" };

/**
 * Shown under the template list when 紹介動画風 is selected: one click to the recommended preview/output setup
 * (9:16 preview + 9:16 in the export formats, length 自由 = follows the narration).
 */
export function IntroFormatHint(props: { project: Project; update: UpdateProject; format: Format; setFormat: (f: Format) => void; name?: string }) {
  const { project } = props;
  const ok = props.format === "9:16" && project.durationSec === null && project.formats.includes("9:16");
  if (ok) {
    return (
      <div className="intro-fmt-ok">
        <Icon.Check size={12} /> 9:16 プレビュー・尺「自由」(ナレーションに合わせて伸縮)
      </div>
    );
  }
  const apply = () => {
    props.setFormat("9:16");
    props.update((p) => ({
      ...p,
      durationSec: null,
      formats: p.formats.includes("9:16") ? p.formats : ["9:16", ...p.formats],
    }));
  };
  return (
    <div className="intro-fmt" role="status">
      <span>
        {props.name ?? "紹介動画風"}は Shorts / TikTok 向けの縦型です。<b>9:16</b> でプレビューし、尺は<b>「自由」</b>(ナレーションの長さに合わせる)がおすすめです。
        {project.durationSec !== null ? `(現在 ${project.durationSec} 秒固定)` : ""}
      </span>
      <button className="btn btn-sm btn-primary" onClick={apply}>
        <Icon.Crop size={13} /> 9:16・自由尺にする
      </button>
    </div>
  );
}

/** 構成 tab for template "intro" (ARCHITECTURE §5.8 / §7 [v4]). */
export function IntroEditor(props: {
  project: Project;
  update: UpdateProject;
  lang: Lang;
  setLang: (l: Lang) => void;
  onOpenAudio: () => void;
  onOpenClips: () => void;
}) {
  const { project, update, lang } = props;
  const data = project.templateData.intro;
  const color = project.style.emphasisColor;
  const plan = useMemo(() => introPlan(project, lang), [project, lang]);
  const hasNarration = plan.body.some(hasNarrationInput);

  const setData = (fn: (d: IntroData) => IntroData) =>
    update((p) => ({ ...p, templateData: { ...p.templateData, intro: fn(p.templateData.intro) } }));
  const setInfo = (fn: (i: IntroData["info"]) => IntroData["info"]) => setData((d) => ({ ...d, info: fn(d.info) }));
  const setInfoItems = (fn: (l: IntroInfoItem[]) => IntroInfoItem[]) => setInfo((i) => ({ ...i, items: fn(i.items) }));
  const setPoints = (fn: (l: IntroPoint[]) => IntroPoint[]) => setData((d) => ({ ...d, points: { ...d.points, items: fn(d.points.items) } }));

  const kicker = data.kicker ?? { ja: "", en: "" };
  const clips = introClipOrder(project);

  return (
    <>
      <Section title="見出し帯" aside={<LangAside lang={lang} setLang={props.setLang} />}>
        <HeadlinePreview project={project} lang={lang} />
        <div className="field">
          <span className="field-label">小ラベル(kicker)</span>
          <LocalizedInput
            value={kicker}
            lang={lang}
            ariaLabel="小ラベル"
            placeholder={{ ja: "例: 今話題", en: "e.g. TRENDING" }}
            onChange={(v) =>
              setData((d) => {
                if (v.ja || v.en) return { ...d, kicker: v };
                const { kicker: _omit, ...rest } = d;
                return rest;
              })
            }
          />
        </div>
        <div className="field">
          <span className="field-label">見出し</span>
          <LocalizedInput
            value={data.headline}
            lang={lang}
            big
            multiline
            emphasisColor={color}
            ariaLabel="見出し"
            placeholder={{ ja: "例: このゲーム\n【神すぎる】んだが！", en: "e.g. This game is\n【INSANELY GOOD】" }}
            onChange={(headline) => setData((d) => ({ ...d, headline }))}
          />
          <div className="field-hint">
            本文のあいだ画面上部にずっと表示されます。改行で 2 行に、【】で囲んだ語は強調色で大きく表示。空欄ならゲームタイトルを出します。
          </div>
        </div>
      </Section>

      <Section
        title="情報カード"
        aside={<Switch checked={data.info.enabled} onChange={(enabled) => setInfo((i) => ({ ...i, enabled }))} label="表示" />}
      >
        <div className={cx("intro-block", !data.info.enabled && "is-off")}>
          <ol className="info-rows">
            {data.info.items.map((it, i) => (
              <li key={it.id} className="info-row">
                <input
                  className="input input-sm info-label"
                  lang={lang}
                  value={it.label[lang]}
                  placeholder={lang === "ja" ? "項目" : "Label"}
                  aria-label={`${i + 1} 行目の項目名(${LANG_NAME[lang]})`}
                  onChange={(e) => setInfoItems((l) => l.map((x) => (x.id === it.id ? { ...x, label: { ...x.label, [lang]: e.target.value } } : x)))}
                />
                <EmphasisField
                  size="sm"
                  lang={lang}
                  value={it.value[lang]}
                  placeholder={lang === "ja" ? "内容(空欄 = この言語では非表示)" : "Value (empty = hidden)"}
                  ariaLabel={`${i + 1} 行目の内容(${LANG_NAME[lang]})`}
                  onChange={(v) => setInfoItems((l) => l.map((x) => (x.id === it.id ? { ...x, value: { ...x.value, [lang]: v } } : x)))}
                />
                <span className="feat-actions">
                  <button className="btn btn-icon btn-ghost" title="上へ" aria-label="上へ" disabled={i === 0} onClick={() => setInfoItems((l) => moveItem(l, i, -1))}>
                    <Icon.Up />
                  </button>
                  <button
                    className="btn btn-icon btn-ghost"
                    title="下へ"
                    aria-label="下へ"
                    disabled={i === data.info.items.length - 1}
                    onClick={() => setInfoItems((l) => moveItem(l, i, 1))}
                  >
                    <Icon.Down />
                  </button>
                  <button
                    className="btn btn-icon btn-ghost btn-danger"
                    title="削除"
                    aria-label={`${i + 1} 行目を削除`}
                    onClick={() => setInfoItems((l) => l.filter((x) => x.id !== it.id))}
                  >
                    <Icon.Trash />
                  </button>
                </span>
                <span className={cx("info-other", !(it.label[otherLang(lang)] || it.value[otherLang(lang)]) && "is-empty")} lang={otherLang(lang)}>
                  <span className="lang-tag mono">{otherLang(lang).toUpperCase()}</span>
                  {it.label[otherLang(lang)] || it.value[otherLang(lang)] ? (
                    <>
                      {it.label[otherLang(lang)] || "—"}
                      <span className="muted"> : </span>
                      <EmphasisText text={it.value[otherLang(lang)]} color={color} />
                    </>
                  ) : (
                    "未入力"
                  )}
                </span>
              </li>
            ))}
          </ol>
          <button
            className="btn btn-sm btn-ghost add-line"
            disabled={data.info.items.length >= MAX_INFO}
            onClick={() =>
              setInfoItems((l) =>
                l.length >= MAX_INFO ? l : [...l, { id: generateId("info", 8), label: { ja: "", en: "" }, value: { ja: "", en: "" } }],
              )
            }
          >
            <Icon.Plus /> 行を追加{data.info.items.length >= MAX_INFO ? `(最大 ${MAX_INFO} 行)` : ""}
          </button>

          <LinePicker
            label={`表示する台本行(${LANG_NAME[lang]})`}
            project={project}
            lang={lang}
            value={data.info.atLineId?.[lang] ?? ""}
            autoLabel="自動(本文の 2 行目)"
            onChange={(id) =>
              setInfo((i) => {
                const atLineId = setLangRef(i.atLineId, lang, id);
                if (atLineId) return { ...i, atLineId };
                const { atLineId: _omit, ...rest } = i;
                return rest;
              })
            }
          />
          <div className={cx("field-hint", plan.info.badRef && "warn")}>
            {!plan.info.visible
              ? data.info.enabled
                ? `${LANG_NAME[lang]} の項目がすべて空のため、この言語では表示されません。`
                : "情報カードは表示されません。"
              : plan.info.badRef
                ? "指定した開始行が見つからない(または未入力の)ため、自動(本文の 2 行目)で表示します。"
                : plan.info.lineId
                  ? `${bodyLineLabel(plan.body, plan.info.lineId)} の開始で表示${plan.info.mode === "auto" ? "(自動)" : ""}。`
                  : "ナレーションが無いため、動画の 1 秒後に表示します。"}
          </div>
          <Slider
            label="表示時間"
            value={data.info.durationSec}
            min={0.5}
            max={20}
            step={0.5}
            format={(v) => `${v.toFixed(1)} 秒`}
            onChange={(durationSec) => setInfo((i) => ({ ...i, durationSec }))}
          />
        </div>
      </Section>

      <Section title="おすすめポイント" aside={<span className="mono muted">{data.points.items.length} / {MAX_POINTS}</span>}>
        {data.points.items.length === 0 ? <div className="field-hint">①②③… の番号付きで、台本の行に合わせて順に表示する短い一言です。</div> : null}
        <ol className="feat-items">
          {data.points.items.map((pt, i) => {
            const pp = plan.points.find((x) => x.item.id === pt.id);
            const hidden = plan.hiddenPointIds.has(pt.id);
            return (
              <li key={pt.id} className="feat-item point-item">
                <div className="feat-item-head">
                  <span className={cx("feat-badge is-point", hidden && "is-dim")}>
                    {pp ? `ポイント${CIRCLED[pp.num] ?? pp.num + 1}` : "ポイント —"}
                  </span>
                  <span className="feat-stats">
                    {hidden ? (
                      <span className="muted">{LANG_NAME[lang]} が空のため非表示</span>
                    ) : pp?.lineId ? (
                      <>
                        {pp.mode === "auto" ? <span className="muted">自動 → </span> : null}
                        {bodyLineLabel(plan.body, pp.lineId, 10)}
                      </>
                    ) : hasNarration ? (
                      <span className="warn-text">割り当てる行がありません</span>
                    ) : (
                      <span className="muted">ナレーション無し: 等間隔で表示</span>
                    )}
                  </span>
                  <span className="feat-actions">
                    <button className="btn btn-icon btn-ghost" title="上へ" aria-label="上へ" disabled={i === 0} onClick={() => setPoints((l) => moveItem(l, i, -1))}>
                      <Icon.Up />
                    </button>
                    <button
                      className="btn btn-icon btn-ghost"
                      title="下へ"
                      aria-label="下へ"
                      disabled={i === data.points.items.length - 1}
                      onClick={() => setPoints((l) => moveItem(l, i, 1))}
                    >
                      <Icon.Down />
                    </button>
                    <button
                      className="btn btn-icon btn-ghost btn-danger"
                      title="削除"
                      aria-label={`ポイント ${i + 1} を削除`}
                      onClick={() => setPoints((l) => l.filter((x) => x.id !== pt.id))}
                    >
                      <Icon.Trash />
                    </button>
                  </span>
                </div>
                <LocalizedInput
                  value={pt.text}
                  lang={lang}
                  big
                  emphasisColor={color}
                  ariaLabel={`ポイント ${i + 1}`}
                  placeholder={{ ja: "例: 【爽快】なアクション", en: "e.g. 【Thrilling】 action" }}
                  onChange={(text: LocalizedText) => setPoints((l) => l.map((x) => (x.id === pt.id ? { ...x, text } : x)))}
                />
                <LinePicker
                  label="紐付ける行"
                  project={project}
                  lang={lang}
                  compact
                  value={pt.lineId?.[lang] ?? ""}
                  autoLabel="自動(本文の行に順番に)"
                  onChange={(id) =>
                    setPoints((l) =>
                      l.map((x) => {
                        if (x.id !== pt.id) return x;
                        const lineId = setLangRef(x.lineId, lang, id);
                        if (lineId) return { ...x, lineId };
                        const { lineId: _omit, ...rest } = x;
                        return rest;
                      }),
                    )
                  }
                />
                {pp?.badRef ? <div className="field-hint warn">紐付け先の行が見つからない(または未入力の)ため、自動で割り当てます。</div> : null}
              </li>
            );
          })}
        </ol>
        <button
          className="btn btn-sm btn-ghost add-line"
          disabled={data.points.items.length >= MAX_POINTS}
          onClick={() =>
            setPoints((l) => (l.length >= MAX_POINTS ? l : [...l, { id: generateId("point", 8), text: { ja: "", en: "" } }]))
          }
        >
          <Icon.Plus /> ポイントを追加{data.points.items.length >= MAX_POINTS ? `(最大 ${MAX_POINTS} 件)` : ""}
        </button>
        <div className="field-hint">
          紐付けた行の再生中にバッジを表示します。「自動」は本文の行(情報カード・紐付け済みの行を除く)に上から順に割り当てます。
        </div>
      </Section>

      <Section title="映像と効果音">
        <Switch
          checked={data.clipPerLine}
          onChange={(clipPerLine) => setData((d) => ({ ...d, clipPerLine }))}
          label="台本の行ごとに映像を切り替える"
        />
        <div className="field-hint">
          {data.clipPerLine
            ? "本文の行が変わるたびに次のクリップへ(フック → 本編の順、足りなければ先頭に戻る)。0.6 秒未満の行では切り替えません。"
            : "クリップを順番に並べて本文の長さに合わせます。"}{" "}
          クリップ {clips.length} 本。{" "}
          <button className="link-btn" onClick={props.onOpenClips}>
            クリップ一覧を開く
          </button>
        </div>
        <div className="intro-se-note">
          <Icon.Speaker size={13} />
          <span>
            効果音:{" "}
            {templateUsesSe(project.template) && project.audio.se.enabled && project.audio.se.volume > 0
              ? `オン(音量 ${Math.round(project.audio.se.volume * 100)}%)`
              : "オフ"}
            <span className="muted"> — 見出し・ポイント・情報カード・場面転換・字幕の出現で鳴ります</span>
          </span>
          <button className="btn btn-sm ml-auto" onClick={props.onOpenAudio}>
            音声タブで設定
          </button>
        </div>
        <div className="field-hint">ナレーションは早口(×1.2〜1.3)がおすすめです。紹介動画風で新しく追加した行は ×1.25 から始まります。</div>
      </Section>
    </>
  );
}

/** Mini 9:16-style rendering of the headline band (kicker badge + headline with emphasis). */
function HeadlinePreview({ project, lang }: { project: Project; lang: Lang }) {
  const data = project.templateData.intro;
  const kicker = stripEmphasis(data.kicker?.[lang] ?? "").trim();
  const text = data.headline[lang];
  const color = project.style.emphasisColor;
  return (
    <div className="hl-preview" style={{ "--hl-accent": project.style.accentColor } as CSSProperties} aria-label="見出しのプレビュー">
      {kicker ? <span className="hl-kicker">{kicker}</span> : null}
      <div className="hl-text" lang={lang}>
        {text.trim() ? <EmphasisText text={text} color={color} /> : <span className="hl-title">{project.game.title || "ゲームタイトル"}</span>}
      </div>
      <span className="hl-caption">見出しのプレビュー({LANG_NAME[lang]})</span>
    </div>
  );
}

/** Select a body line (hook → main, this language) or "auto". */
function LinePicker(props: {
  label: string;
  project: Project;
  lang: Lang;
  value: string;
  autoLabel: string;
  onChange: (id: string) => void;
  compact?: boolean;
}) {
  const body = useMemo(() => {
    const ls = props.project.script.filter((l) => l.lang === props.lang);
    return [...ls.filter((l) => l.section === "hook"), ...ls.filter((l) => l.section === "main")];
  }, [props.project.script, props.lang]);
  const known = !props.value || body.some((l) => l.id === props.value);
  return (
    <label className={cx("line-pick", props.compact && "is-compact")}>
      <span className="field-label">{props.label}</span>
      <select
        className={cx("input input-sm", !props.value && "is-auto")}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        <option value="">{props.autoLabel}</option>
        {(["hook", "main"] as const).map((sec) => {
          const ls = body.filter((l) => l.section === sec);
          if (!ls.length) return null;
          return (
            <optgroup key={sec} label={INTRO_SECTION_LABEL[sec]}>
              {ls.map((l) => (
                <option key={l.id} value={l.id}>
                  {bodyLineLabel(body, l.id, 22)}
                  {!hasNarrationInput(l) ? "(未入力)" : ""}
                </option>
              ))}
            </optgroup>
          );
        })}
        {!known ? <option value={props.value}>(削除された行)</option> : null}
      </select>
      {body.length === 0 ? <span className="field-hint">台本タブで {LANG_NAME[props.lang]} のフック/本文の行を追加すると選べます。</span> : null}
    </label>
  );
}
