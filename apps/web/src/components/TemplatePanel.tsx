import { useMemo } from "react";
import {
  assignFeatureClips,
  generateId,
  isShortTemplate,
  SHORT_TEMPLATE_IDS,
  SHORT_TEMPLATE_META,
  trailerClipOrder,
  type FeatureItem,
  type Format,
  type Lang,
  type Project,
  type TemplateId,
  type TrailerCard,
  type TrailerData,
} from "@gas/shared";
import { getSectionDurations } from "@gas/compositions";
import { beatState, hasUsableBeats, useBgmAnalyze } from "../hooks/useBgmAnalysis";
import type { MutateOnServer, UpdateProject } from "../hooks/useProject";
import { basename, cx, formatSec, formatTime } from "../util";
import { IntroEditor, IntroFormatHint } from "./IntroEditor";
import { ShortFormEditor } from "./ShortFormEditor";
import { LangAside, LocalizedInput, moveItem, withoutKey } from "./templateBits";
import { Banner, Icon, Section, Spinner, Switch } from "./ui";

export const TEMPLATE_INFO: { id: TemplateId; name: string; desc: string; tag?: string }[] = [
  { id: "hook-play-cta", name: "王道", desc: "フック → プレイ → エンドカード" },
  { id: "features", name: "魅力紹介", desc: "タイトル → 魅力ごとの見出し+クリップ → エンド" },
  { id: "trailer", name: "トレーラー風", desc: "短いカットとテロップを BGM の拍で交互に" },
  { id: "intro", name: "紹介動画風", desc: "Shorts/TikTok 向け・縦型・ナレーション主導", tag: "9:16" },
];

const MAX_FEATURES = 4;
const MIN_FEATURES = 2;
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥"];

/** "構成" tab: template choice + the template's own settings (ARCHITECTURE §7 [v3]). */
export function TemplatePanel(props: {
  project: Project;
  update: UpdateProject;
  mutateOnServer: MutateOnServer;
  lang: Lang;
  setLang: (l: Lang) => void;
  serverOk: boolean;
  onOpenAudio: () => void;
  onOpenClips: () => void;
  format: Format;
  setFormat: (f: Format) => void;
}) {
  const { project, update } = props;
  const select = (id: TemplateId) => update((p) => (p.template === id ? p : { ...p, template: id }));
  const short = isShortTemplate(project.template) ? project.template : null;
  return (
    <div className="tpl-panel">
      <Section title="テンプレート">
        <div className="tpl-list" role="radiogroup" aria-label="テンプレート">
          {TEMPLATE_INFO.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={project.template === t.id}
              className={cx("tpl", project.template === t.id && "is-active")}
              onClick={() => select(t.id)}
            >
              <TemplateGlyph id={t.id} />
              <span className="tpl-text">
                <span className="tpl-name">
                  {t.name}
                  {t.tag ? <span className="badge tpl-tag">{t.tag}</span> : null}
                </span>
                <span className="tpl-desc">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="tpl-group-head">
          <span>ショート向け(Shorts / TikTok / Reels)</span>
          <span className="badge tpl-tag">9:16</span>
        </div>
        <div className="tpl-grid" role="radiogroup" aria-label="ショート向けテンプレート">
          {SHORT_TEMPLATE_IDS.map((id) => {
            const m = SHORT_TEMPLATE_META[id];
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={project.template === id}
                className={cx("tpl-mini", project.template === id && "is-active")}
                title={`${m.name} — ${m.desc}`}
                onClick={() => select(id)}
              >
                <span className="tpl-mini-name">{m.name}</span>
                <span className="tpl-mini-desc">{m.desc}</span>
              </button>
            );
          })}
        </div>
        {project.template === "intro" || short ? (
          <IntroFormatHint
            project={project}
            update={update}
            format={props.format}
            setFormat={props.setFormat}
            name={short ? `「${SHORT_TEMPLATE_META[short].name}」` : undefined}
          />
        ) : null}
        <div className="field-hint">切り替えてもクリップ・台本・各テンプレートの設定はそのまま残ります。</div>
      </Section>

      {project.template === "features" ? (
        <FeaturesEditor {...props} />
      ) : project.template === "trailer" ? (
        <TrailerEditor {...props} />
      ) : project.template === "intro" ? (
        <IntroEditor {...props} />
      ) : short ? (
        <ShortFormEditor key={short} {...props} id={short} />
      ) : (
        <Section title="王道の構成">
          <ol className="tpl-steps">
            <li>
              <span className="st-dot st-hook" /> <b>フック</b> 「フック」スロットのクリップ + キャッチコピー(冒頭 2.5〜5 秒)
            </li>
            <li>
              <span className="st-dot st-main" /> <b>本編</b> 「本編」スロットのクリップを順にカットでつなぐ
            </li>
            <li>
              <span className="st-dot st-end" /> <b>エンド</b> ロゴ・発売情報・CTA のエンドカード
            </li>
          </ol>
        </Section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* features                                                              */
/* ------------------------------------------------------------------ */

function FeaturesEditor(props: {
  project: Project;
  update: UpdateProject;
  lang: Lang;
  setLang: (l: Lang) => void;
  onOpenClips: () => void;
}) {
  const { project, update, lang } = props;
  const items = project.templateData.features.items;
  const assigned = useMemo(() => assignFeatureClips(project), [project]);
  const secById = useMemo(() => {
    try {
      return new Map(getSectionDurations(project, lang).sections.map((s) => [s.id, s.sec]));
    } catch {
      return new Map<string, number>();
    }
  }, [project, lang]);

  const setItems = (fn: (items: FeatureItem[]) => FeatureItem[]) =>
    update((p) => ({
      ...p,
      templateData: { ...p.templateData, features: { ...p.templateData.features, items: fn(p.templateData.features.items) } },
    }));
  const patchItem = (id: string, patch: Partial<FeatureItem>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const addItem = () =>
    setItems((list) =>
      list.length >= MAX_FEATURES ? list : [...list, { id: generateId("feat", 6), heading: { ja: "新しい魅力", en: "New feature" } }],
    );
  const removeItem = (id: string) =>
    update((p) => ({
      ...p,
      templateData: {
        ...p.templateData,
        features: { ...p.templateData.features, items: p.templateData.features.items.filter((it) => it.id !== id) },
      },
      // clips / lines bound to the removed item fall back to automatic / unbound
      clips: p.clips.map((c) => (c.featureId === id ? withoutKey(c, "featureId") : c)),
      script: p.script.map((l) => (l.featureId === id ? withoutKey(l, "featureId") : l)),
    }));

  const mainLines = project.script.filter((l) => l.lang === lang && l.section === "main");
  const ids = new Set(items.map((i) => i.id));
  const bound = mainLines.filter((l) => l.featureId && ids.has(l.featureId));
  const mixed = bound.length > 0 && bound.length < mainLines.length;
  const autoClips = project.clips.filter((c) => c.slot === "main" && !(c.featureId && ids.has(c.featureId))).length;

  return (
    <Section title="魅力項目" aside={<LangAside lang={lang} setLang={props.setLang} />}>
      {items.length === 0 ? (
        <div className="field-hint warn">魅力項目がありません。本編はひとまとまりで再生されます。</div>
      ) : null}
      <ol className="feat-items">
        {items.map((it, i) => {
          const clips = assigned[it.id] ?? [];
          const autoN = clips.filter((c) => c.featureId !== it.id).length;
          const lines = mainLines.filter((l) => l.featureId === it.id).length;
          const sec = secById.get(it.id);
          return (
            <li key={it.id} className="feat-item">
              <div className="feat-item-head">
                <span className="feat-badge">魅力{CIRCLED[i]}</span>
                <span className="feat-stats mono">
                  {clips.length} 本{autoN ? <span className="muted">(自動 {autoN})</span> : null}
                  {lines ? ` · ナレ ${lines} 行` : ""}
                  {sec !== undefined ? ` · ${formatSec(sec)}` : ""}
                </span>
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
                    title={items.length <= MIN_FEATURES ? `魅力は ${MIN_FEATURES} 件以上にしてください` : "削除"}
                    aria-label={`魅力${i + 1} を削除`}
                    disabled={items.length <= MIN_FEATURES}
                    onClick={() => removeItem(it.id)}
                  >
                    <Icon.Trash />
                  </button>
                </span>
              </div>
              <LocalizedInput
                value={it.heading}
                lang={lang}
                big
                ariaLabel={`魅力${i + 1} の見出し`}
                placeholder={{ ja: "見出し(例: 爽快なアクション)", en: "Heading (e.g. Thrilling action)" }}
                onChange={(heading) => patchItem(it.id, { heading })}
              />
              <LocalizedInput
                value={it.sub ?? { ja: "", en: "" }}
                lang={lang}
                ariaLabel={`魅力${i + 1} のサブテキスト`}
                placeholder={{ ja: "サブテキスト(任意)", en: "Sub line (optional)" }}
                onChange={(sub) => (sub.ja || sub.en ? patchItem(it.id, { sub }) : setItems((l) => l.map((x) => (x.id === it.id ? withoutKey(x, "sub") : x))))}
              />
              {clips.length === 0 ? <div className="field-hint">クリップがありません(背景+見出しだけになります)。</div> : null}
            </li>
          );
        })}
      </ol>
      <button className="btn btn-sm btn-ghost add-line" onClick={addItem} disabled={items.length >= MAX_FEATURES}>
        <Icon.Plus /> 魅力を追加{items.length >= MAX_FEATURES ? `(最大 ${MAX_FEATURES} 件)` : ""}
      </button>
      <div className="field-hint">
        本編クリップの所属は「素材・クリップ」タブのクリップ一覧で選べます。「自動」のクリップ({autoClips} 本)は順番に各魅力へ振り分けます。{" "}
        <button className="link-btn" onClick={props.onOpenClips}>
          クリップ一覧を開く
        </button>
      </div>
      {mixed ? (
        <div className="field-hint warn">
          本編ナレーションに「魅力に紐付けた行」と「全体の行」が混在しています。全体の行は最初の魅力から続けて再生されるため、重なることがあります。
        </div>
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* trailer                                                               */
/* ------------------------------------------------------------------ */

function TrailerEditor(props: {
  project: Project;
  update: UpdateProject;
  mutateOnServer: MutateOnServer;
  lang: Lang;
  setLang: (l: Lang) => void;
  serverOk: boolean;
  onOpenAudio: () => void;
  onOpenClips: () => void;
}) {
  const { project, update, lang } = props;
  const data = project.templateData.trailer;
  const order = useMemo(() => trailerClipOrder(project), [project]);
  const analyze = useBgmAnalyze(props.mutateOnServer);

  const setData = (fn: (d: TrailerData) => TrailerData) =>
    update((p) => ({ ...p, templateData: { ...p.templateData, trailer: fn(p.templateData.trailer) } }));
  const setCards = (fn: (c: TrailerCard[]) => TrailerCard[]) => setData((d) => ({ ...d, cards: fn(d.cards) }));
  const patchCard = (id: string, patch: Partial<TrailerCard>) => setCards((l) => l.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const addCard = () =>
    setCards((l) => {
      const last = l[l.length - 1];
      const after = order.length === 0 ? -1 : Math.min(order.length - 1, last ? last.afterClipIndex + 2 : 0);
      return [...l, { id: generateId("card", 6), text: { ja: "", en: "" }, afterClipIndex: after }];
    });

  const bgm = project.audio.bgm;
  const st = beatState(bgm);
  const beatsOk = hasUsableBeats(project);
  const running = st.kind === "running" || analyze.starting;

  const clipLabel = (i: number) => {
    const c = order[i]!;
    const s = project.sources.find((x) => x.id === c.sourceId);
    return `カット${i + 1} の後 — ${s ? basename(s.originalPath) : "素材なし"} ${formatTime(c.inSec)}`;
  };

  return (
    <>
      <Section title="テロップ" aside={<LangAside lang={lang} setLang={props.setLang} />}>
        {data.cards.length === 0 ? <div className="field-hint">カットの合間に全画面で出す短い言葉です。</div> : null}
        <ol className="feat-items">
          {data.cards.map((c, i) => {
            const beyond = c.afterClipIndex >= order.length;
            return (
              <li key={c.id} className="feat-item card-item">
                <div className="feat-item-head">
                  <span className="feat-badge is-card">テロップ {i + 1}</span>
                  <span className="feat-actions">
                    <button className="btn btn-icon btn-ghost" title="上へ" aria-label="上へ" disabled={i === 0} onClick={() => setCards((l) => moveItem(l, i, -1))}>
                      <Icon.Up />
                    </button>
                    <button
                      className="btn btn-icon btn-ghost"
                      title="下へ"
                      aria-label="下へ"
                      disabled={i === data.cards.length - 1}
                      onClick={() => setCards((l) => moveItem(l, i, 1))}
                    >
                      <Icon.Down />
                    </button>
                    <button
                      className="btn btn-icon btn-ghost btn-danger"
                      title="削除"
                      aria-label={`テロップ ${i + 1} を削除`}
                      onClick={() => setCards((l) => l.filter((x) => x.id !== c.id))}
                    >
                      <Icon.Trash />
                    </button>
                  </span>
                </div>
                <LocalizedInput
                  value={c.text}
                  lang={lang}
                  big
                  ariaLabel={`テロップ ${i + 1}`}
                  placeholder={{ ja: "例: 運命に抗え", en: "e.g. DEFY YOUR FATE" }}
                  onChange={(text) => patchCard(c.id, { text })}
                />
                <label className="card-pos">
                  <span className="field-label">位置</span>
                  <select
                    className="input input-sm"
                    value={c.afterClipIndex}
                    onChange={(e) => patchCard(c.id, { afterClipIndex: Number(e.target.value) })}
                  >
                    <option value={-1}>先頭(最初のカットの前)</option>
                    {order.map((_, k) => (
                      <option key={k} value={k}>
                        {clipLabel(k)}
                      </option>
                    ))}
                    {beyond && c.afterClipIndex !== -1 ? (
                      <option value={c.afterClipIndex}>
                        {order.length ? "最後のカットの後" : `カット${c.afterClipIndex + 1} の後(カットがありません)`}
                      </option>
                    ) : null}
                  </select>
                </label>
                {!c.text[lang].trim() ? (
                  <div className="field-hint">{lang === "ja" ? "日本語" : "English"} が空のため、この言語では表示されません。</div>
                ) : null}
              </li>
            );
          })}
        </ol>
        <button className="btn btn-sm btn-ghost add-line" onClick={addCard}>
          <Icon.Plus /> テロップを追加
        </button>
        <div className="field-hint">
          カットの順番 = フック → 本編のクリップ順({order.length} カット)。{" "}
          <button className="link-btn" onClick={props.onOpenClips}>
            クリップ一覧を開く
          </button>
        </div>
      </Section>

      <Section title="演出">
        <Switch
          checked={data.beatSync}
          onChange={(beatSync) => setData((d) => ({ ...d, beatSync }))}
          label="BGM の拍に合わせてカットを切り替える"
        />
        {data.beatSync ? (
          beatsOk && !running ? (
            <div className="beat-ok mono">
              <Icon.Pulse size={13} /> {st.kind === "done" && st.bpm ? `${Math.round(st.bpm)} BPM · ` : ""}
              {bgm?.beats?.length ?? 0} 拍に同期
            </div>
          ) : (
            <Banner
              tone="warn"
              action={
                bgm ? (
                  <button className="btn btn-sm" onClick={() => void analyze.start()} disabled={running || !props.serverOk}>
                    {running ? <Spinner size={11} /> : <Icon.Pulse size={13} />} {running ? "検出中…" : "拍を検出"}
                  </button>
                ) : (
                  <button className="btn btn-sm" onClick={props.onOpenAudio}>
                    音声タブへ
                  </button>
                )
              }
            >
              {!bgm
                ? "ビート同期には BGM が必要です。音声タブで BGM を追加してください。"
                : running
                  ? "BGM の拍を検出しています…"
                  : st.kind === "error"
                    ? `拍の検出に失敗しました: ${st.message}`
                    : "BGM のビート解析が必要です(未解析のため拍に合わせられません)。"}
            </Banner>
          )
        ) : null}
        {analyze.error ? <div className="field-hint warn">{analyze.error}</div> : null}
        <Switch
          checked={data.logoReveal}
          onChange={(logoReveal) => setData((d) => ({ ...d, logoReveal }))}
          label="エンドカードの前にロゴ演出を入れる"
        />
        <div className="field-hint">トレーラー風ではフックのキャッチコピーとウォーターマークは使いません(テロップ・ロゴ演出が担います)。</div>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */

export function TemplateGlyph({ id }: { id: TemplateId }) {
  // Tiny timeline diagram of each template's structure.
  const blocks: [number, string][] =
    id === "hook-play-cta"
      ? [[2, "a"], [6, "b"], [2, "c"]]
      : id === "features"
        ? [[1, "c"], [2, "b"], [2, "b"], [2, "b"], [2, "c"]]
        : id === "intro"
          ? [[1, "a"], [1, "b"], [1, "b"], [1, "b"], [1, "b"], [1, "b"], [2, "c"]]
          : [[1, "b"], [1, "a"], [1, "b"], [1, "a"], [1, "b"], [2, "c"]];
  return (
    <span className="tpl-glyph" aria-hidden>
      {blocks.map(([w, k], i) => (
        <span key={i} className={`g-${k}`} style={{ flexGrow: w }} />
      ))}
    </span>
  );
}
