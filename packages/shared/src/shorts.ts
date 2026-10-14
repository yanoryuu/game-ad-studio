import type { ClipSlot, ShortTemplateId } from "./project";

/**
 * v5: UI metadata + field meanings of the 10 short-form templates (ARCHITECTURE §5.10). The web builds the
 * template picker, clip-slot labels and the generic editor (templateData.shorts[id]) from this; the templates
 * implement exactly these meanings. A field absent here is unused by that template (hidden in the UI).
 */

export type ShortTextField = {
  /** UI label */
  label: string;
  hint?: string;
};

export type ShortTemplateMeta = {
  /** Japanese display name */
  name: string;
  /** one-line description for the picker */
  desc: string;
  /** what the clip slots mean in this template */
  slots: Record<ClipSlot, { label: string; hint: string }>;
  fields: {
    title?: ShortTextField;
    sub?: ShortTextField;
    note?: ShortTextField;
    items?: ShortTextField & { min: number; max: number };
    number?: ShortTextField & { min: number; max: number };
    flag?: ShortTextField;
  };
};

export const SHORT_TEMPLATE_META: Record<ShortTemplateId, ShortTemplateMeta> = {
  question: {
    name: "質問フック",
    desc: "大きな質問 → プレイ → 投票ボタンとコメント誘導",
    slots: {
      hook: { label: "冒頭", hint: "質問が出る瞬間の背景。一番派手な場面を。" },
      main: { label: "本編", hint: "質問の答えを考えたくなるプレイ映像を順に。" },
    },
    fields: {
      title: { label: "質問", hint: "冒頭で大きく出し、そのまま上部に残ります。" },
      sub: { label: "コメント誘導", hint: "最後に出す一言(例: コメントで教えて！)。" },
      items: { label: "選択肢", hint: "最後に投票ボタン風に表示(0〜3個)。", min: 0, max: 3 },
      flag: { label: "投票ボタンを表示", hint: "オフ = 選択肢を出さない。" },
    },
  },
  challenge: {
    name: "挑戦状",
    desc: "「クリアできる？」→ ギリギリのプレイ → 結果は伏せて CTA",
    slots: {
      hook: { label: "挑戦シーン", hint: "難所が一目で分かる場面。" },
      main: { label: "プレイ", hint: "ギリギリの攻防。最後のクリップの結末は伏せられます。" },
    },
    fields: {
      title: { label: "挑戦文", hint: "例: これ、クリアできる？" },
      sub: { label: "結果を伏せる文", hint: "暗転と同時に出す一言(例: 結果は…)。" },
      note: { label: "エンド前の一言", hint: "例: 挑戦はウィッシュリストから" },
      number: { label: "タイマー(秒)", hint: "画面上のカウントダウン。0 = 表示しない。", min: 0, max: 99 },
      flag: { label: "結果を伏せる", hint: "最後のクリップの終わりを暗転させます。" },
    },
  },
  "fail-win": {
    name: "失敗→逆転",
    desc: "派手な失敗 → 「でも…」→ スローで大逆転",
    slots: {
      hook: { label: "失敗シーン", hint: "やられる・落ちるなど失敗の瞬間。" },
      main: { label: "逆転シーン", hint: "勝つ・突破する場面。" },
    },
    fields: {
      title: { label: "失敗テキスト", hint: "例: 下手すぎて【詰んだ】…" },
      sub: { label: "つなぎ", hint: "失敗と逆転の間のカード(例: でも…)。" },
      note: { label: "逆転テキスト", hint: "例: 【大逆転】！" },
      flag: { label: "逆転の瞬間をスロー", hint: "逆転シーンの冒頭をスローモーションに。" },
    },
  },
  payoff: {
    name: "溜め→爆発",
    desc: "「最後まで見て」→ ゲージが溜まる → 最後に爆発",
    slots: {
      hook: { label: "溜め(前半)", hint: "フック → 本編の順につながり、最後のクリップが爆発シーンになります。" },
      main: { label: "溜め → 爆発", hint: "最後のクリップ = 一番気持ちいい瞬間(ペイオフ)。" },
    },
    fields: {
      title: { label: "煽り文", hint: "全編の上部に表示(例: 【最後】まで見て)。" },
      note: { label: "爆発の一言", hint: "ペイオフの瞬間に大きく(例: 【気持ちよすぎ】！)。" },
      flag: { label: "溜めゲージを表示", hint: "爆発に向けて溜まるゲージ。" },
    },
  },
  "before-after": {
    name: "ビフォーアフター",
    desc: "昔の開発画面 → ハードカット → 今の画面",
    slots: {
      hook: { label: "ビフォー", hint: "昔の映像・スクショ(画像も可)。" },
      main: { label: "アフター", hint: "今の映像。" },
    },
    fields: {
      title: { label: "見出し", hint: "例: 1年でここまで【変わった】" },
      sub: { label: "ビフォーのラベル", hint: "例: 1年前" },
      note: { label: "アフターのラベル", hint: "例: 今" },
      flag: { label: "最後に並べて比較", hint: "9:16 は上下、16:9 は左右に並べて見比べます。" },
    },
  },
  devlog: {
    name: "開発日記",
    desc: "大きく「DAY 37」→ 今日の成果 → フォロー誘導",
    slots: {
      hook: { label: "冒頭", hint: "DAY 表示の背景。" },
      main: { label: "今日の成果", hint: "作ったもの・直したものの映像。" },
    },
    fields: {
      number: { label: "DAY", hint: "開発何日目か。", min: 0, max: 9999 },
      title: { label: "今日のテーマ", hint: "例: ボス戦を【作った】" },
      sub: { label: "シリーズ名・タグ", hint: "例: #インディーゲーム開発" },
      note: { label: "最後の誘導", hint: "例: フォローで続きを見る" },
    },
  },
  "dev-pitch": {
    name: "開発者ピッチ",
    desc: "上に一人称の一言・中央にプレイ・下に常時 CTA",
    slots: {
      hook: { label: "冒頭", hint: "ゲームの核が 2 秒で分かる場面。" },
      main: { label: "本編", hint: "基本ループが伝わる映像を順に。" },
    },
    fields: {
      title: { label: "ピッチ", hint: "一人称で(例: 【一人で】こんなゲームを作っています)。上部に常時表示。" },
      sub: { label: "開発者名・アカウント", hint: "下部の CTA バーに表示(例: @your_studio)。" },
    },
  },
  loop: {
    name: "無限ループ",
    desc: "文字は最小限。気持ちいい映像が継ぎ目なく繰り返す",
    slots: {
      hook: { label: "冒頭(継ぎ目)", hint: "最後がここにつながります。動きの続く場面を。" },
      main: { label: "本編", hint: "気持ちいい挙動(連鎖・破壊・建築など)。" },
    },
    fields: {
      title: { label: "小見出し(任意)", hint: "空なら文字なし。" },
      flag: { label: "継ぎ目なくループ", hint: "最後を冒頭の映像にクロスフェードしてつなぎます。CTA は小さく重ねます。" },
    },
  },
  list: {
    name: "〇〇選リスト",
    desc: "「小ネタ 3選」→ 番号付きで 1 項目ずつ",
    slots: {
      hook: { label: "見出しの背景", hint: "見出しを出す冒頭の映像。" },
      main: { label: "各項目", hint: "項目の順に 1 つずつ割り当てます(足りなければ繰り返し)。" },
    },
    fields: {
      title: { label: "見出し", hint: "例: 9割が気づかない【小ネタ】3選" },
      items: { label: "項目", hint: "2〜5 個。", min: 2, max: 5 },
      flag: { label: "ランキング形式", hint: "第 N 位 → 第 1 位のカウントダウンで見せます。" },
    },
  },
  trivia: {
    name: "雑学ストーリー",
    desc: "白背景・赤帯の2行見出し・黒文字の字幕で、ナレーションが物語る雑学ショート",
    slots: {
      hook: { label: "冒頭", hint: "見出しと一緒に出る最初の映像。" },
      main: { label: "本編", hint: "台本の行ごとに次の映像へ。スクショ・画像も混ぜられます。" },
    },
    fields: {
      title: { label: "見出し(2行)", hint: "1行目は赤帯に白文字、2行目は白地に黒文字。改行で2行に分けます。" },
      sub: { label: "映像下の小さな一言(任意)", hint: "例: Steamで配信中。空なら出しません。" },
      flag: { label: "エンドカードなし", hint: "最後まで同じ画面で終わります(元ネタの型)。オフで通常のエンドカード。" },
    },
  },
  comment: {
    name: "コメント返信",
    desc: "視聴者コメントの吹き出し → 答えになるプレイ",
    slots: {
      hook: { label: "コメント表示中", hint: "コメントが出ている間の映像。" },
      main: { label: "回答", hint: "コメントへの答えになる映像。" },
    },
    fields: {
      title: { label: "コメント", hint: "例: これって【協力プレイ】できますか？" },
      sub: { label: "投稿者名", hint: "例: @player_1234" },
      note: { label: "回答の一言", hint: "例: 【できます】！" },
    },
  },
};
