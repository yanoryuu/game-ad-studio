import { SHORT_TEMPLATE_IDS, SHORT_TEMPLATE_META, templateUsesSe, type TemplateId } from "@gas/shared";

/**
 * Template catalog for list_templates: the 11 short-form templates come from SHORT_TEMPLATE_META (@gas/shared,
 * the source of truth the web uses); the 4 classic templates are described here in the same shape
 * (ARCHITECTURE §5.4–5.8, web TemplatePanel TEMPLATE_INFO).
 */

export type FieldInfo = { label: string; hint?: string; min?: number; max?: number };
export type TemplateInfo = {
  id: TemplateId;
  name: string;
  desc: string;
  kind: "classic" | "short";
  /** where set_template_data writes */
  dataPath: string;
  recommendedFormat?: string;
  usesSe: boolean;
  slots: Record<"hook" | "main", { label: string; hint: string }>;
  fields: Record<string, FieldInfo>;
  narration: string;
};

const CLASSIC: TemplateInfo[] = [
  {
    id: "hook-play-cta",
    name: "王道",
    desc: "フック → プレイ → エンドカード (hook text + flashy clip, gameplay with narration/captions, end card)",
    kind: "classic",
    dataPath: "texts.<lang>.hook / texts.<lang>.cta",
    usesSe: false,
    slots: {
      hook: { label: "フック", hint: "2〜3 秒の一番派手な場面。上に大きなフック文字が出ます。" },
      main: { label: "本編", hint: "プレイ映像を順に(ナレーション・字幕が乗る)。" },
    },
    fields: {
      hookText: { label: "フックの文字 (texts.hook)", hint: "冒頭に大きく出す一言。言語別。" },
      cta: { label: "CTA (texts.cta)", hint: "エンドカードの誘導文。既定「ウィッシュリストに追加」。" },
    },
    narration: "hook 行 = フック開始 + offsetSec、main 行 = 本編で順に連続、cta 行 = エンドカード。",
  },
  {
    id: "features",
    name: "魅力紹介",
    desc: "タイトル → 魅力ごとの見出し+クリップ → エンド (2–4 selling points, each with heading overlay + clips)",
    kind: "classic",
    dataPath: "templateData.features.items[] = { heading{ja,en}, sub?{ja,en} }",
    usesSe: false,
    slots: {
      hook: { label: "タイトル", hint: "冒頭(タイトル)の映像。" },
      main: { label: "魅力の映像", hint: "clip.featureId で項目に割り当て。未指定は項目へ順番(ラウンドロビン)に配分。" },
    },
    fields: {
      items: { label: "魅力の項目 (heading / sub)", hint: "見出しは言語別。2〜4 個。", min: 2, max: 4 },
    },
    narration: "main 行は line.featureId で項目に紐付け(無ければ全体を順に再生)。",
  },
  {
    id: "trailer",
    name: "トレーラー風",
    desc: "短いカットとテロップを BGM の拍で交互に (short cuts ≤2 s snapped to BGM beats + big text cards + logo reveal)",
    kind: "classic",
    dataPath: "templateData.trailer = { cards[{ text{ja,en}, afterClipIndex }], beatSync, logoReveal }",
    usesSe: false,
    slots: {
      hook: { label: "前半のカット", hint: "hook → main の順に 1 本ずつ最大 2 秒のカットになります。" },
      main: { label: "後半のカット", hint: "同上。" },
    },
    fields: {
      cards: { label: "テロップ", hint: "afterClipIndex = 何本目のカットの後に出すか(-1 = 先頭)。" },
      beatSync: { label: "ビートに合わせる", hint: "BGM のビート解析が必要(set_audio で BGM を入れると自動解析)。" },
      logoReveal: { label: "ロゴ演出", hint: "エンドカード前に 2 秒のロゴ/タイトル。" },
    },
    narration: "ナレーションは任意(hook/main/cta)。BGM 主体。",
  },
  {
    id: "intro",
    name: "紹介動画風",
    desc: "Shorts/TikTok 向け・縦型・ナレーション主導 (headline band, 16:9 footage in the middle, big captions, info card, numbered points)",
    kind: "classic",
    dataPath: "templateData.intro = { headline, kicker, info{enabled, items[{label,value}], durationSec}, points.items[{text}], clipPerLine }",
    recommendedFormat: "9:16",
    usesSe: true,
    slots: {
      hook: { label: "冒頭", hint: "hook → main の順に、台本の行ごとに次のクリップへ切り替わります。" },
      main: { label: "本編", hint: "同上。" },
    },
    fields: {
      headline: { label: "見出し帯", hint: "常時表示。【】で強調、\\n で改行。言語別。" },
      kicker: { label: "見出し上の小ラベル", hint: "例: 今話題 / TRENDING。" },
      info: { label: "ゲーム情報カード", hint: "ジャンル・価格・対応機種・発売日など(行は label/value、言語別)。" },
      points: { label: "おすすめポイント ①②③", hint: "最大 5。main 行に順に自動で割り当て。", min: 0, max: 5 },
      clipPerLine: { label: "行ごとにクリップ切替", hint: "既定 on。" },
    },
    narration: "本文 = hook 行 → main 行を連続再生(早口 1.2〜1.3 倍が合う)、cta 行はエンドカード。尺はナレーション長。",
  },
];

function shortInfo(id: (typeof SHORT_TEMPLATE_IDS)[number]): TemplateInfo {
  const m = SHORT_TEMPLATE_META[id];
  const fields: Record<string, FieldInfo> = {};
  for (const [k, v] of Object.entries(m.fields)) if (v) fields[k] = { ...v };
  return {
    id,
    name: m.name,
    desc: m.desc,
    kind: "short",
    dataPath: `templateData.shorts["${id}"] = { title, sub, note (each {ja,en}), items[{text{ja,en}}], number, flag }`,
    recommendedFormat: "9:16",
    usesSe: templateUsesSe(id),
    slots: m.slots,
    fields,
    narration: "本文 = hook 行 → main 行を連続再生、cta 行はエンドカード。ナレーション無しでも成立。使わないフィールドは無視。",
  };
}

export function templateCatalog(): TemplateInfo[] {
  return [...CLASSIC, ...SHORT_TEMPLATE_IDS.map(shortInfo)];
}

export function templateInfo(id: TemplateId): TemplateInfo {
  return templateCatalog().find((t) => t.id === id)!;
}
