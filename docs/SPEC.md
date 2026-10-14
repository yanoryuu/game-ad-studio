# Game Ad Studio — 仕様書 (v0.1 ドラフト)

Remotion を使った、PC インディーゲーム向け広告動画の半自動編集ツール。
長いプレイ動画からハイライト候補を自動抽出し、テンプレート・ナレーション・字幕・BGM を当てた「草案」を自動生成、Web UI で人が手直しして書き出す。

## 1. 決定事項

| 項目 | 決定 |
|---|---|
| 用途 | PC インディーゲームの広告(Steam ウィッシュリスト誘導が主目的) |
| 利用者 | 個人(Remotion は無料ライセンスの範囲) / ローカル PC で動かす |
| 入力素材 | ゲームプレイ動画(長尺可)、静止画(スクショ・キーアート・ロゴ) |
| 出力サイズ | 横 16:9 (1920×1080) / 縦 9:16 (1080×1920) |
| 尺 | 15秒 / 30秒 / 自由 |
| 自動化範囲 | 自動で草案 → Web UI で人が修正 → 書き出し |
| 使う部分の選び方 | ffmpeg で自動検出したハイライト候補を UI に並べ、人が選択・トリム・並べ替え |
| 構成 | 複数テンプレートから選ぶ |
| 音声 | BGM / AI ナレーション(VOICEVOX) / 自動字幕 |
| 文字起こし・TTS | ローカル・無料(whisper.cpp / VOICEVOX) |
| 操作 | Web UI + Remotion Player によるリアルタイムプレビュー |
| 言語 | 日本語 + 英語。台本・字幕は言語ごとに持ち、言語別に書き出す。TTS は日本語=VOICEVOX、英語=Piper(ローカル) |
| fps | 既定 30fps、60fps も選択可 |

### Phase 2 での追加決定

| 項目 | 決定 |
|---|---|
| project.json | schemaVersion 2。読み込み時に `migrateProject` で v1 → v2 を自動変換(詳細は ARCHITECTURE §4) |
| ソース取り込み | 登録は即時に返し、プロキシ生成はバックグラウンド(`proxyStatus`: pending → ready / error)。UI はポーリング |
| ハイライト候補 | ソースごとに解析ボタン → 2〜6 秒の候補(score と scene/motion/loudness 特徴量、サムネ付き)→ 採用で clip 化 |
| 台本 | 言語 × セクション(hook/main/cta)ごとに複数行。行ごとに声・速度・オフセット。text/voice を変えたら stale |
| 日本語 TTS | VOICEVOX ENGINE(`D:Toolsoicevox`、既定 ずんだもん ノーマル = style 3)。字幕タイミングは audio_query のモーラ長 |
| 英語 TTS | Piper(`D:Toolspiper`、既定 en_US-lessac-medium)+ whisper.cpp(base.en)で単語タイミング |
| クレジット | VOICEVOX の声を使ったら「VOICEVOX:キャラ名」を表示(行ごとに `credit` を保存し UI で一覧表示) |
| ナレーション配置 | hook/cta はセクション開始 + オフセット、main は順番に連続。尺「自由」ならセクションが伸び、固定尺なら溢れた分を切って UI で警告 |
| BGM | アップロード(mp3/wav/m4a/ogg/aac)、ループ可、末尾フェードアウト、ナレーション中は duckingDb 下げる |
| ゲーム音 | ナレーション中は `gameVolumeUnderNarration` 倍に下げる |
| Phase 1 の修正 | 発売情報を言語別に / ウォーターマーク位置を選択可(none 含む、既定 右上)/ 字幕スタイル(on/off・位置・サイズ) |
| ツール設定 | `gas.config.json`(任意)で VOICEVOX URL・run.exe、Piper、whisper の場所を上書き |

### Phase 3 での追加決定

| 項目 | 決定 |
|---|---|
| project.json | schemaVersion 3。`templateData`(features / trailer の設定)と `style.vertical` を追加。v1/v2 は読み込み時に自動変換(ARCHITECTURE §4.2) |
| テンプレートの作り | 1 つのコンポジション `AdVideo` が `project.template` でテンプレートモジュールに振り分け。各テンプレートは `buildTimeline`(尺・構成・ナレーション配置)と映像コンポーネントを持つ。字幕・ナレーション・BGM・エンドカードは共通部品 |
| `features`(魅力紹介) | タイトル → 魅力 2〜4 項目(見出しは言語別、映像の上に重ねるオーバーレイ。専用カードの時間は取らない)→ エンドカード。main クリップは `featureId` で項目に割り当て、未指定は配列順にラウンドロビン。main 台本行は `featureId` で項目に紐付け(項目内で順番に再生)、未指定は全体を通して順番に再生 |
| `trailer`(トレーラー風) | hook → main の順のクリップを最大 2 秒の短いカットに。テロップ(言語別)は「何本目のカットの後」で指定。BGM のビートを解析してカット点をビートに吸着(beatSync)。エンドカード前にロゴ演出(2 秒、任意) |
| BGM ビート解析 | サーバーが BGM を解析して `audio.bgm.beats`(秒)と `bpm` を保存。依存追加なし(ffmpeg + 自前のオンセット検出) |
| 9:16 | `style.vertical.mode`: ぼかし背景(既定)/ クロップ。クロップはクリップごとの `focusX`(0..1)で切り出し位置を決める。字幕位置もモードに合わせる |
| 一括書き出し | 形式 × 言語の組を 1 回のリクエストでキューに積む(順に処理)。書き出し履歴(renders/ のファイル一覧 + 実行中ジョブ)を表示 |
| 録音ナレーション | 台本行の声に「録音」を追加。アップロードした音声を正規化して使い、whisper.cpp で字幕化(日本語 = 多言語モデル small、英語 = base.en)。台本テキストがあれば字幕の文言に使う |
| 警告 | whisper 失敗などの非致命的な問題は台本行の `warning` に保存し UI に表示 |
| クレジット | `collectCredits(project, lang, voices)` に声一覧を渡すと未合成の VOICEVOX 行のクレジットも含める(共通化) |
| 開発 | サーバーは `GAS_PORT` でポートを変えられる(テスト用の別インスタンス) |

### Phase 3.5: 紹介動画風テンプレート `intro`(YouTube Shorts / TikTok 向け)

ゲーム紹介メディアのショート動画のような、ナレーション主導でテンポよく見せる縦型の紹介動画。参考にするのは型(レイアウト・テンポ・テロップ表現)だけで、特定メディアのロゴや名称などは使わない。

| 項目 | 決定 |
|---|---|
| 形式 | 9:16 が主(16:9 も破綻しないこと)。尺は台本(ナレーション)に合わせて自由、目安 30〜60 秒 |
| レイアウト | 上:見出し帯(常時表示。例「【今話題】このゲーム神すぎるんだが！」、言語別)/ 中央:16:9 のプレイ映像 / 下:ナレーションに同期した大きな字幕 |
| ナレーション | 合成音声を早口(1.2〜1.3 倍)で。台本の行ごとにクリップを切り替えてテンポを出す |
| 強調ワード | 台本・字幕で `【】` で囲んだ語を色付き(黄・赤など)で大きく表示。読み上げ時は括弧を除く |
| ゲーム情報カード | ジャンル・価格・対応機種・発売日などを途中で表示(言語別) |
| おすすめポイント | ①②③の番号付きポイントを順に表示(言語別、台本行と紐付け可) |
| 効果音 | 字幕の出現・見出し・ポイント・情報カード・場面転換などのスロットに効果音を割り当てる。音源はユーザーが用意したフリー素材(例:効果音ラボ、OtoLogic)をローカルの SE ライブラリに置いて使う。リポジトリや配布物には同梱しない。クレジットが必要な素材(OtoLogic など)はクレジット一覧に含める |

## 2. 全体の流れ

```
[1 取り込み] → [2 ハイライト検出] → [3 クリップ選択] → [4 テンプレ適用]
   → [5 台本・ナレーション・字幕] → [6 BGM] → [7 プレビュー修正] → [8 書き出し]
```

1. **取り込み**: ffprobe でメタ情報取得。プレビュー用の軽量プロキシ(720p / 30fps / H.264)を生成。元ファイルは書き出し時のみ使用。
2. **ハイライト検出**(ffmpeg で数値化 → 区間スコアリング)
   - シーン切り替え: `select='gt(scene,X)'`
   - 動きの量: 連続フレーム差分
   - 音の盛り上がり: ゲーム音のラウドネス変化(`ebur128` / `astats`)
   - 2〜6秒程度の区間に切り、スコア上位を候補化。サムネイルとプレビュー付きで一覧表示。
3. **クリップ選択**: 候補から採用、in/out の微調整、並べ替え、テンプレートのスロットへの割り当て。手動での範囲追加も可。
4. **テンプレート適用**: 選んだテンプレートと尺に合わせ、各クリップの長さを自動で配分。
5. **台本 → ナレーション → 字幕**
   - セクション(フック・本編・CTA など)ごとに台本を入力
   - VOICEVOX(`localhost:50021`)で音声を合成
   - 字幕のタイミングは VOICEVOX の `audio_query`(モーラの長さ)から算出 → whisper 不要
   - whisper.cpp は **自分で録った声やプレイ中の音声を字幕にする場合** に使う
6. **BGM**: ファイルを指定。尺に合わせたループ/トリム、終わりのフェードアウト、ナレーション中の音量自動ダウン(ダッキング)。ゲーム音の音量も個別に調整可。
7. **プレビュー修正**: 字幕テキストとタイミング、クリップの in/out、テキストの差し替えを UI で行い、Player で即時確認。
8. **書き出し**: バックエンドで `@remotion/renderer` の `renderMedia` を実行し、進捗を UI に表示。16:9 と 9:16 の一括書き出しにも対応。

## 3. テンプレート(初期3種)

| ID | 名前 | 構成 |
|---|---|---|
| `hook-play-cta` | 王道 | フック(強い一言+派手なクリップ 2〜3秒) → プレイ+ナレーション/字幕 → エンドカード |
| `features` | 魅力紹介 | タイトル → 「魅力①②③」の見出し+クリップを繰り返す → エンドカード |
| `trailer` | トレーラー風 | 短いカットを BGM のテンポで繋ぐ+合間に大きなテロップ → ロゴ → エンドカード |

**エンドカード(全テンプレート共通)**: ゲームロゴ、キーアート、「ウィッシュリストに追加」、Steam 表記、発売日/発売中、対応プラットフォーム。

### 縦 9:16 の作り方(16:9 のプレイ映像を縦に収める)
- **ぼかし背景**(既定): 映像を中央に置き、上下を同じ映像のぼかしで埋める。空いた上下にテロップ・ロゴを置く。
- **クロップ**: クリップごとに切り出す中心(フォーカス位置)を UI で指定する。(Phase 3 で実装: `style.vertical.mode` + `clip.focusX`)

## 4. 構成(案)

```
game-ad-studio/
  apps/
    web/        Vite + React + @remotion/player  (編集 UI)
    server/     Node + Express (ffmpeg・VOICEVOX・whisper.cpp・レンダリング)
  packages/
    compositions/  Remotion のコンポジション/テンプレート(web と server で共有)
    shared/        プロジェクト JSON の型(zod スキーマ)
  projects/<id>/   project.json, proxies/, thumbs/, tts/, renders/
```

- npm workspaces のモノレポ構成。テンプレートは 1 か所に置き、プレビューと書き出しで同じコードを使う。
- 状態はすべて `project.json` に保存(DB は使わない)。素材はサーバーが HTTP で配信する。
- 外部の常駐プロセス: VOICEVOX エンジン(別途インストール)。whisper.cpp は `@remotion/install-whisper-cpp` で導入。

### project.json(概略 — Phase 1 時点の案。現行の正確な形は ARCHITECTURE.md §4)
```ts
{
  id, name, template: "hook-play-cta" | "features" | "trailer",
  formats: ["16:9", "9:16"], durationSec: 15 | 30 | null,
  game: { title, logo, keyArt, releaseText, steamUrl, platforms[] },
  sources: [{ id, path, proxyPath, durationSec, fps, width, height }],
  candidates: [{ sourceId, startSec, endSec, score, thumb }],
  clips: [{ sourceId, inSec, outSec, slot, focusX?, gameVolume }],
  languages: ["ja", "en"], fps: 30 | 60,
  script: [{ section, lang, text, voice: { speakerId, speed }, audioPath?, captions: [{ text, startSec, endSec }] }],
  bgm: { path, volume, duckingDb, fadeOutSec },
  style: { font, primaryColor, captionStyle }
}
```

## 5. MVP の範囲(フェーズ分け)

- **Phase 1(土台)**: モノレポ構築、取り込み+プロキシ生成、`hook-play-cta` テンプレート、手動クリップ指定、Player プレビュー、16:9 書き出し
- **Phase 2(自動化)**: ハイライト検出と候補 UI、VOICEVOX ナレーション+字幕自動生成、BGM(ループ・フェード・ダッキング)
- **Phase 3(拡張)**: 9:16(ぼかし背景/クロップ)、`features`・`trailer` テンプレート、一括書き出し、whisper.cpp 字幕
- **Phase 3.5**: `intro`(紹介動画風)テンプレート、強調ワード、情報カード、おすすめポイント、効果音ライブラリ

## 6. 未決事項・リスク

1. **英語の字幕タイミング**: Piper は VOICEVOX のようなモーラ情報を返さない → 合成した音声を whisper.cpp にかけて単語タイミングを取る
2. **フォント**: 商用利用できる日本語フォント(Noto Sans JP など)を既定にする
3. **VOICEVOX のクレジット**: キャラクターごとの利用規約とクレジット表記(「VOICEVOX:○○」)を守る必要がある → 書き出し時に注意を表示する
4. **BGM の権利**: ユーザーが用意する前提(フリー素材や自作曲)
5. **重い素材**: 4K/60fps のプレイ動画はプロキシ必須。書き出し時間は PC の性能に依存する
