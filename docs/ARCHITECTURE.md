# Game Ad Studio — アーキテクチャ / 実装契約 (Phase 3.5)

このドキュメントは `packages/compositions` / `apps/server` / `apps/web` を並行実装する際の **唯一の契約** です。
仕様の背景は `docs/SPEC.md` を参照。ここに書かれた名前・パス・型・URL は勝手に変えないこと。変更が必要なら実装せずに報告する。
Phase 2 で変わった/増えた箇所には **[v2]**、Phase 3 で変わった/増えた箇所には **[v3]**、
Phase 3.5(テンプレート `intro`・強調ワード・効果音)で変わった/増えた箇所には **[v4]** を付けている。

---

## 0. 環境・バージョン

- Windows 11 / Node 20.12.2 / npm 10.5 / ffmpeg・ffprobe は PATH 上
- npm workspaces モノレポ。**依存はすべてインストール済み**。`npm install` やパッケージ追加はしない(必要なら報告)。
- 固定バージョン(すべて exact pin)

| パッケージ | バージョン |
|---|---|
| remotion / @remotion/* (player, bundler, renderer, cli, google-fonts, media-utils, **captions [v2]**, **install-whisper-cpp [v2]**) | 4.0.535 |
| react / react-dom | 19.3.0 |
| zod | 4.3.6(v4。`import { z } from "zod"`) |
| express | 5.3.0(Express 5: async ハンドラの reject は自動で error handler へ。パスのワイルドカードは `/*path` 形式) |
| multer | 2.4.0 |
| nanoid | 5.1.16(ESM only) |
| cors | 2.8.6 |
| vite | 6.4.4(Node 20.12 のため 7 系は不可) / @vitejs/plugin-react 4.7.0 |
| tsx | 4.23.15 / typescript 5.9.3 |

- [v2] `@remotion/install-whisper-cpp` は `apps/server`、`@remotion/captions` / `@remotion/media-utils` は `packages/compositions` の依存。
- TypeScript: `tsconfig.base.json`(strict, ES2022, moduleResolution "bundler", jsx "react-jsx", noEmit)。
  全パッケージ `"type": "module"`。import は拡張子なし(`./foo`)。
- `@gas/shared` と `@gas/compositions` はビルドせず **TS ソースのまま** 消費する(`exports` → `./src/index.ts`)。

### 0.1 外部ツール [v2]

| ツール | 既定の場所 | 備考 |
|---|---|---|
| VOICEVOX ENGINE 0.25.2 (CPU) | `D:\Tools\voicevox\windows-cpu\run.exe` | 起動: `run.exe --host 127.0.0.1 --port 50021`(冷起動 ~5 秒)。HTTP `http://127.0.0.1:50021` |
| Piper | `D:\Tools\piper\piper.exe` | 声: `D:\Tools\piper\voices\<name>.onnx` + `<name>.onnx.json`(`en_US-lessac-medium`, `en_US-ryan-high`) |
| whisper.cpp | `D:\Tools\whisper` | `@remotion/install-whisper-cpp` の `installWhisperCpp({ to })` / `downloadWhisperModel({ model, folder })` で導入(server-tts が必要時に実行) |

設定は `apps/server/src/config.ts`(§6.8)。

## 1. ディレクトリ構成

```
game-ad-studio/
  package.json            ルート(workspaces, scripts: dev / typecheck / studio)
  gas.config.example.json [v2] ツール設定の例。実際の設定は gas.config.json(git 管理外・任意)
  docs/SPEC.md, docs/ARCHITECTURE.md
  packages/
    shared/               @gas/shared       zod スキーマ + 型 + API 型 + migrateProject
      src/index.ts, project.ts, migrate.ts, api.ts, [v4] emphasis.ts
    compositions/         @gas/compositions Remotion コンポジション [v3: テンプレート別に再構成、§5.4]
      src/index.ts          公開 API(§5)
      src/entry.ts, Root.tsx, constants.ts
      src/AdVideo.tsx       唯一のコンポジション。project.template でテンプレートに振り分け + 共通の音声/字幕
      src/metadata.ts       calcAdMetadata / getSectionDurations(レジストリ経由)
      src/narration.ts      buildNarrationPlan(レジストリ経由)
      src/common/**         [v3] 全テンプレート共通の部品(ClipTrack, Captions, NarrationTrack, Bgm, audioMix,
                            Backdrop, EndCard, Watermark, NoFootage, fonts, theme, phrases, urls, clips, narrationLayout,
                            [v4] RichText(強調ワード描画), SeTrack(効果音))
      src/templates/types.ts   [v3] TemplateModule インターフェース
      src/templates/index.ts   [v3] レジストリ(TEMPLATES / getTemplate)
      src/templates/hookPlayCta/**  [v3] 王道テンプレート(Phase 2 の実装をそのまま移動)
      src/templates/features/**     [v3] 魅力紹介テンプレート(実装済み)
      src/templates/trailer/**      [v3] トレーラー風テンプレート(実装済み)
      src/templates/intro/**        [v4] 紹介動画風テンプレート(現在スタブ = hook-play-cta の描画 + SE/字幕の配線、§5.8)
  apps/
    server/               @gas/server  Express :3101
      src/index.ts        アプリ組み立て(Phase 1 ルート + ルートモジュール登録)
      src/store.ts        project.json の読み書き・ロック・updateProject・mergeServerOwned
      src/sources.ts      [v2] 非同期ソース登録(プロキシ生成)・起動時リカバリ([v3] BGM 解析の中断も回収)
      src/config.ts       [v2] ツール設定
      src/media.ts        ffprobe / ffmpeg ヘルパ(probe, makeProxy, makeThumb, toolAvailable)
      src/errors.ts, files.ts, paths.ts, render.ts
      src/routes/analysis.ts [v2] registerAnalysisRoutes(app)
      src/analysis/**        [v2] ハイライト解析の実装
      src/routes/tts.ts      [v2] registerTtsRoutes(app)
      src/tts/**             [v2] TTS の実装([v3] 録音ナレーション)
      src/routes/renders.ts  [v3] registerRenderRoutes(app) 一括書き出し・書き出し履歴(実装済み)
      src/routes/bgm.ts      [v3] registerBgmRoutes(app) BGM ビート解析の起動(実装済み、解析本体はスタブ)
      src/beats/**           [v3] ビート検出の実装(analyzeBeats)
      src/routes/se.ts       [v4] registerSeRoutes(app) / initSeLibrary() SE ライブラリ API(実装済み、§6.12)
      src/se/**              [v4] SE ライブラリ(library.ts: 一覧・マニフェスト・パス解決 / placeholders.ts: 仮 SE 生成)
    web/                  @gas/web     Vite + React :5173
  projects/               実行時データ(git 管理外)

D:\Tools\se\              [v4] SE ライブラリ(リポジトリ外。config `se.dir`、§6.12)
  _placeholder/           ffmpeg で合成した仮 SE(pop / headline / point / info / transition / cta .wav、無ければ server が起動時に生成)
  se.json                 マニフェスト(ファイル id → { credit })
  <任意のサブフォルダ>/    ユーザーが置くフリー素材(効果音ラボ / OtoLogic など。再配布・コミット禁止)
```

### 担当範囲(Phase 3.5 の並行作業、厳守)[v4]

| 担当 | 書いてよい場所 |
|---|---|
| compositions-intro | `packages/compositions/src/templates/intro/**` のみ |
| server | `apps/server/src/se/**`, `apps/server/src/routes/se.ts`, `apps/server/src/tts/**`, `apps/server/src/routes/tts.ts` のみ |
| web | `apps/web/src/**` のみ |

(Phase 3 の表: compositions-features → `templates/features/**`、compositions-trailer → `templates/trailer/**`、
server → `beats/**`, `routes/bgm.ts`, `tts/**`, `routes/tts.ts`。これらは Phase 3.5 では凍結。)

- **凍結**: `packages/compositions/src/common/**`、`templates/types.ts`、`templates/index.ts`(レジストリ)、
  `templates/hookPlayCta/**`、[v4] `templates/features/**`、`templates/trailer/**`、compositions 直下のファイル。テンプレート担当は `common` を **import して使うだけ**。
  共通部品に変更が必要なら実装せずに報告する(自分のフォルダ内にコピー/ラップして解決できるならそれでよい)。
- それ以外(`package.json` / `tsconfig*.json` / `vite.config.ts` / `packages/shared/**` / `docs/**` /
  `apps/server/src/` 直下のファイル / `apps/server/src/routes/{analysis,renders}.ts` / `.gitignore` / `gas.config*.json`)は誰も編集しない。必要な変更は報告する。
- テンプレート担当は自分の `index.ts` が export する名前(`featuresTemplate` / `trailerTemplate` / [v4] `introTemplate`、`TemplateModule`)を変えない。
  タイムライン型は `TemplateTimeline` を拡張して自由に定義してよい。
- server 担当は直下のモジュール(`store.ts`, `errors.ts`, `media.ts`, `paths.ts`, `config.ts`, `files.ts`, `render.ts`, `index.ts`)を **import して使うだけ**。
  [v4] `routes/se.ts` の export(`registerSeRoutes`, `initSeLibrary`)と `se/library.ts` の `seFileExists`(render.ts が使う)の名前・シグネチャは変えない。
  ffmpeg 実行ヘルパが足りなければ自分のフォルダ内に書く(`media.ts` の `run` は非 export)。
- `npm install` は禁止(依存は揃っている)。
- 完了条件: ルートで `npm run typecheck` が通ること(web は `npm run build -w @gas/web` も)。

## 2. ポート・オリジン

- server: `http://localhost:3101`(`SERVER_PORT`)。web(Vite dev): `http://localhost:5173`。`/api` と `/files` を 3101 にプロキシ。
  → web のコードは **常に相対 URL**(`/api/...`, `/files/...`)。
- server は `cors()` を有効にする(レンダリング時のヘッドレス Chrome 用)。
- [v4] SE ファイルは `/api/se/file/<id>`(§6.12)。プレビューは相対 URL(Vite の `/api` プロキシ経由)、レンダーは assetBaseUrl
  `http://localhost:<LISTEN_PORT>` を前に付ける(`seFileUrl(baseUrl, id)`)。プロジェクトファイルと同じ仕組みなので追加設定は不要。
- [v3] 待ち受けポートは環境変数 `GAS_PORT`(無ければ `PORT`、どちらも無ければ 3101)で上書きできる(`paths.ts` の `LISTEN_PORT`。
  レンダー時の assetBaseUrl もこのポート)。テスト用の別インスタンスは `GAS_PORT=3111 GAS_PROJECTS_DIR=<tmp> npx tsx src/index.ts`(apps/server で)。

## 3. プロジェクトの保存形式

```
projects/<projectId>/
  project.json     Project(schemaVersion 4)
  proxies/         <sourceId>.mp4      720p 30fps H.264 + AAC
  thumbs/          <sourceId>.jpg / [v2] <candidateId>.jpg(= cand_<nanoid>.jpg)
  assets/          アップロード画像・音声 <nanoid>.<ext>
  tts/             [v2] <lineId>.wav   ナレーション音声
  renders/         書き出し結果 .mp4
```

- ID: プロジェクト `p_<nanoid(10)>`、ソース `src_<nanoid(8)>`、クリップ `clip_<nanoid(8)>`、
  [v2] 候補 `cand_<nanoid(8)>`、台本行 `line_<8 文字>`(web が `createScriptLine()` / `generateId("line", 8)` で生成)。英数と `_` `-` のみ。
- **アセット参照の規約**: project.json に入るパスはプロジェクトディレクトリからの相対パス、区切りは `/`。
  例外: `sources[].originalPath` だけは元動画の絶対パス。
- [v2] **マイグレーション**: server は project.json を読むたびに `migrateProject(raw)`(`@gas/shared`)を通す。
  v1 ファイルはメモリ上で v2 に変換され、次の保存時に v2 で書かれる(読むだけではファイルは変わらない)。
  [v3] 同様に v1 / v2 → v3。[v4] 同様に v1 / v2 / v3 → v4。
- [v3] 特徴(魅力)項目 `feat_<id>`、トレーラーのテロップ `card_<id>`(web が `generateId("feat", 8)` / `generateId("card", 8)`。既定値は `feat_1..3`, `card_1..2`)。
- [v4] intro の情報カード行 `info_<id>`、おすすめポイント `point_<id>`(web が `generateId("info", 8)` / `generateId("point", 8)`。既定値は `info_1..4`, `point_1..3`)。

## 4. データモデル(`@gas/shared`, schemaVersion 4)

正は `packages/shared/src/project.ts`。要点:

```ts
Project = {
  schemaVersion: 4, id, name, createdAt, updatedAt,
  template /*[v4] + "intro"*/, formats: Format[], durationSec: 15 | 30 | null, fps: 30 | 60, languages: Lang[],
  game: { title, logo?, keyArt?, releaseText: { ja, en } /*[v2]*/, steamUrl?, platforms: string[] },
  sources: {
    id, originalPath, proxyPath, thumbPath, durationSec, fps, width, height, hasAudio,
    proxyStatus: "pending" | "ready" | "error", proxyError?,                 // [v2]
    analysisStatus: "none" | "running" | "done" | "error", analysisError?,  // [v2]
  }[],
  candidates: {                                                              // [v2]
    id /*cand_*/, sourceId, startSec, endSec /*source 秒, 長さ 2..6*/, score /*0..1*/,
    features: { scene, motion, loudness } /*各 0..1*/, thumbPath /*"thumbs/<id>.jpg"*/, adopted?: boolean,
  }[],
  clips: {
    id, sourceId, inSec, outSec, slot: "hook" | "main", gameVolume: 0..1,
    focusX?: 0..1,          // [v3] 9:16 crop の切り出し中心(既定 0.5)。blur モードではぼかし背景の位置
    featureId?: string,     // [v3] features テンプレート: main クリップが属する魅力項目の id(§5.5)
  }[],
  texts: { ja: { hook, cta }, en: { hook, cta } },
  script: ScriptLine[],                                                      // [v2]
  captions: { ja: Caption[], en: Caption[] },   // 手動/追加字幕(出力動画上の秒)。従来どおり
  audio: {                                                                   // [v2] v1 の top-level bgm を置換
    narrationVolume: 0..1,               // 既定 1
    gameVolumeUnderNarration: 0..1,      // 既定 0.35。ナレーション中、各 clip.gameVolume に掛ける倍率
    bgm?: {
      path, volume: 0..1, duckingDb: -60..0, fadeOutSec, loop: boolean,
      // [v3] server-owned(POST /bgm/analyze, §6.11)。現在の path に対してのみ有効
      beats?: number[],        // ビート時刻(ファイル先頭からの秒、昇順)
      bpm?: number,
      analysisStatus?: "none" | "running" | "done" | "error",   // 無し = "none"
      analysisError?: string,
    },
    se: {                                // [v4] 効果音(§5.9 / §6.12)。SE を出すテンプレート(SE_TEMPLATES = ["intro"])だけが鳴らす
      enabled: boolean,                  // 既定 true
      volume: 0..1,                      // 既定 0.7(ダッキングしない)
      slots: { captionPop?, headline?, point?, info?, transition?, cta?: SeFileId },  // 既定 = 全スロット _placeholder/*.wav
      credits?: Record<SeFileId, string>, // web が保持するクレジットのスナップショット(§6.12)
    },
  },
  style: {
    primaryColor, accentColor, font: "noto-sans-jp",
    watermark: { position: "top-left"|"top-right"|"bottom-left"|"bottom-right"|"none", scale: 0.25..3 },  // [v2] 既定 top-right, 1
    captions: { enabled: boolean, position: "bottom" | "center", size: "m" | "l" },                        // [v2] 既定 true, bottom, m
    vertical: { mode: "blur" | "crop" },                                                                    // [v3] 既定 blur(§5.7)
    emphasisColor: string,   // [v4] 【強調】の色。既定 "#FFE14D"(黄)。プリセット EMPHASIS_COLORS = { yellow "#FFE14D", red "#FF4B4B" }
  },
  templateData: {                                                            // [v3] テンプレート別設定(選択中でなくても保持)
    features: {
      items: { id /*feat_*/, heading: { ja, en }, sub?: { ja, en } }[],   // 0..4 件(UI は 2..4 を維持)。配列順 = 再生順
    },
    trailer: {
      cards: { id /*card_*/, text: { ja, en }, afterClipIndex: int >= -1 }[],  // trailerClipOrder の index の直後に表示(-1 = 先頭)
      beatSync: boolean,       // BGM のビートにカット点を合わせる
      logoReveal: boolean,     // エンドカード前のロゴ演出
    },
    intro: {                                                                 // [v4] 紹介動画風(§5.8)
      headline: { ja, en },                // 見出し帯。【強調】と "\n" 改行可。"" = その言語は見出し文なし(タイトルを出す)
      kicker?: { ja, en },                 // 見出しの上の小ラベル(既定 今話題 / TRENDING)。stripEmphasis して全体をバッジで描く
      info: {
        enabled: boolean,
        items: { id /*info_*/, label: { ja, en }, value: { ja, en } /*【強調】可, "" = その言語で非表示*/ }[],  // 0..6
        atLineId?: { ja?: lineId, en?: lineId },   // この行の開始でカードを出す(言語別)。無し/無効 = 本文 2 行目
        durationSec: 0.5..20,                      // 表示時間。既定 4
      },
      points: {
        items: { id /*point_*/, text: { ja, en } /*【強調】可*/, lineId?: { ja?: lineId, en?: lineId } }[],  // 0..5、配列順 = ①②③
      },
      clipPerLine: boolean,                // 既定 true: 本文の台本行ごとに次のクリップへ切り替え
    },
  },
}

ScriptLine = {                                 // [v2]
  id, lang, section: "hook" | "main" | "cta", text,   // [v4] text は【強調】を含んでよい(読み上げは stripEmphasis(text))
  voice: {
    engine: "voicevox" | "piper" | "recorded",   // [v3] "recorded" = アップロードした録音
    speaker: string,       // VOICEVOX: style id を文字列で("3")。Piper: 声の名前(.onnx の basename)。recorded: "" 可(TTS エンジンは必須)
    speed: 0.5..2,         // recorded では無視(1 を入れる)
    sourcePath?: string,   // [v3] recorded のみ: アップロードした録音の asset ref("assets/<nanoid>.<ext>")
  },
  offsetSec: number >= 0,      // hook/cta: セクション開始からの遅延。main: この行の前に入れる追加の間
  audioPath?: "tts/<lineId>.wav", durationSec?: number,
  captions: { text, startSec, endSec }[],   // ★行の開始からの相対秒。[v4] text は【強調】マーカー付き(§6.13)
  status: "none" | "ok" | "stale" | "error", error?,
  credit?: string,             // 合成時に server が設定。VOICEVOX は "VOICEVOX:<キャラ名>"。Piper / recorded は無し
  warning?: string,            // [v3] server-owned: 直近の合成の非致命的な問題(whisper 失敗 → 比例配分 など)。次の合成で消える
  featureId?: string,          // [v3] features テンプレートの main 行: この魅力項目の中で再生(§5.5)。他テンプレートでは無視
}
```

- 任意フィールドは「キーが無い」で表現する(`null` 不可)。
- `script` 配列内で同じ (lang, section) の行の **配列順 = 再生順**。
- **status の規則**: `none` 未合成 / `ok` 現在の text+voice と音声が一致 / `stale` 合成後に text か voice が変わった /
  `error` 前回の合成失敗(`error` にメッセージ)。
  **web は `ok` または `error` の行の text / voice を変更したら必ず `status: "stale"` にする**(offsetSec の変更は stale にしない)。
  `stale` / `error` でも古い `audioPath` があればそのまま再生してよい。
  [v3] voice の比較は `sameVoice(a, b)`(engine / speaker / speed / sourcePath)。recorded 行は録音を差し替えたら stale。
  featureId の変更は stale にしない。
- [v3] **録音行**(`voice.engine === "recorded"`): 音声は `voice.sourcePath` を `POST /tts` が変換したもの(§6.10)。
  text は任意(空でも再生対象)。text があれば字幕の文言に使い(タイミングは whisper)、空なら whisper の書き起こしを字幕にする。
  `hasNarrationInput(line)` = TTS 行は text が空でない([v4] `stripEmphasis(text).trim()` で判定)/ recorded 行は sourcePath がある。
- 定数・ヘルパ(`@gas/shared`):
  `DEFAULT_VOICES`(ja: `{ engine: "voicevox", speaker: "3", speed: 1 }` = ずんだもん(ノーマル)/ en: `{ engine: "piper", speaker: "en_US-lessac-medium", speed: 1 }`)、
  `DEFAULT_VOICEVOX_URL`、`DEFAULT_VOICEVOX_SPEAKER`、`DEFAULT_VOICEVOX_CREDIT` (`"VOICEVOX:ずんだもん"`)、`DEFAULT_PIPER_VOICE`、
  `DEFAULT_AUDIO`、`DEFAULT_BGM`(path 以外: volume 0.5, duckingDb -12, fadeOutSec 1.5, loop true)、`DEFAULT_STYLE`、
  `createScriptLine(lang, section, text?, id?)`、`collectCredits(project, lang?, voices?)`(必要なクレジット一覧)、
  `migrateProject(raw)`、`createDefaultProject(name, opts)`。
  [v3] `createDefaultTemplateData()`、`assignFeatureClips(project)`(§5.5)、`trailerClipOrder(project)`(§5.6)、
  `sameVoice(a, b)`、`hasNarrationInput(line)`、`createRecordedVoice(sourcePath?)`、
  `voiceEngineSchema`("voicevox" | "piper" | "recorded"。`ttsEngineSchema` は合成エンジンだけ = 声一覧・試聴用)、
  `verticalModeSchema`、`templateDataSchema` ほか各 zod スキーマ。
  [v4] `parseEmphasis` / `stripEmphasis` / `hasEmphasis` / `EMPHASIS_COLORS`(§4.4)、`createDefaultIntroData()`、
  `introClipOrder(project)`(= trailerClipOrder: hook → main)、`introBodyLines(project, lang)`(hook 行 → main 行、配列順。全行)、
  `seSlotSchema` / `SE_SLOTS`、`seFileIdSchema`、`seSettingsSchema`、`DEFAULT_SE`、`SE_PLACEHOLDER_DIR` ("_placeholder")、
  `SE_PLACEHOLDER_FILES`(slot → "_placeholder/<pop|headline|point|info|transition|cta>.wav")、`SE_TEMPLATES` / `templateUsesSe(id)`、
  `collectSeCredits(project, seFiles?)`、`introDataSchema`、`langLineRefSchema`。
- **VOICEVOX のクレジット**: VOICEVOX の声を使った動画には「VOICEVOX:<キャラ名>」の表記が必要。
  web は `collectCredits(project, lang, voices)` を書き出しパネル等に表示し、注意を促す。
  [v3] `voices`(`GET /api/tts/voices?engine=voicevox` の結果。`{ speaker, credit? }[]` なら何でも可)を渡すと、
  未合成で `credit` の無い VOICEVOX 行も speaker から引いて含める(web 側の重複実装は不要になる)。
  [v4] `collectCredits(project, lang?, voices?, seFiles?)` は **SE のクレジットも含める**(`collectSeCredits`):
  SE を出すテンプレート(`templateUsesSe`)で `audio.se.enabled` かつ volume > 0 のとき、スロットに割り当てたファイルの credit
  (`seFiles` = `GET /api/se` の `files` を渡せばそれ、無ければ `audio.se.credits` スナップショット)。言語に依存しない。
  EndCard は `collectCredits(project, lang)`(スナップショット)なので、OtoLogic 等のクレジットは書き出し動画のエンドカードにも出る。
- API 型: `packages/shared/src/api.ts`(Phase 1 の型 + [v2] `AddSourceResponse`, `AnalyzeStartResponse`,
  `TtsStatusResponse`, `TtsVoice`, `ttsVoicesQuerySchema`, `TtsSynthesizeRequest`, `TtsPreviewRequest`
  + [v3] `RenderTarget`, `RenderBatchRequest`, `RenderBatchResponse`, `RenderFile`, `RenderListResponse`, `BgmAnalyzeStartResponse`,
  `RenderJob.createdAt?`, `TtsStatusResponse.whisper.multilingual?`
  + [v4] `SE_EXTS`, `seManifestSchema`/`SeManifest`, `seFileSchema`/`SeFile`, `seListResponseSchema`/`SeListResponse`,
  `seManifestUpdateRequestSchema`/`SeManifestUpdateRequest`)。

### 4.1 v1 → v2 マイグレーション(`migrateProject`)
- `game.releaseText: string` → `{ ja: s, en: s }`
- `sources[]` に `proxyStatus: "ready"`, `analysisStatus: "none"` を追加
- `candidates`: v2 形式でないものは削除(v1 では常に空)
- `script`: v1 エントリは v2 行に変換(ja の speakerId → speaker 文字列、status "none"、音声は捨てる)
- `bgm` → `audio.bgm`(`loop: true` 追加)。`audio` の他項目は既定値
- `style.watermark` / `style.captions` に既定値

### 4.2 v2 → v3 マイグレーション [v3]
- `templateData` が無ければ `createDefaultTemplateData()`(魅力 3 件: 爽快なアクション / 奥深い戦略 / 美しい世界、
  テロップ 2 件: 運命に抗え(afterClipIndex 1)/ すべてを賭けろ(3)、beatSync true、logoReveal true。id は固定 `feat_1..3` / `card_1..2`)
- `style.vertical` が無ければ `{ mode: "blur" }`
- その他の追加は任意フィールドのみ(変換なし)。v1 は v1→v2→v3 と順に通る。

### 4.3 v3 → v4 マイグレーション [v4]
- `templateData.intro` が無ければ `createDefaultIntroData()`:
  見出し ja「このゲーム\n【神すぎる】んだが！」/ en「This game is\n【INSANELY GOOD】」、kicker 今話題 / TRENDING、
  情報カード(enabled、4 行: ジャンル アクション / 価格 1,500円 / 対応機種 PC(Steam) / 発売日 2026年冬、en も同様、durationSec 4、atLineId 無し)、
  ポイント 3 件(【爽快】なアクション / 毎回変わる【ステージ】/ やり込み要素が【無限】、lineId 無し)、clipPerLine true。id は固定 `info_1..4` / `point_1..3`。
- `audio.se` が無ければ `DEFAULT_SE`(enabled, volume 0.7, 全スロット = プレースホルダ)。既存テンプレートは SE イベントを出さないので音は変わらない。
- `style.emphasisColor` が無ければ "#FFE14D"。
- 既存テキスト中の【】はそのまま強調マークアップとして扱われる(変換なし)。v1/v2 は順に通る。

### 4.4 強調ワード(【】)[v4]
- 対象: 台本 `line.text`、字幕(`line.captions[].text`, `project.captions[lang][].text`)、intro の headline / points / info の value。
  (`texts.hook` / `texts.cta` やテロップ・魅力見出しは今回は対象外 = そのまま表示。テンプレートが `RichText` を使えば対応できる)
- 書式: `【…】` で囲んだ部分が強調。**【 と 】は常にマークアップで、画面には出さず読み上げない。**
  ネスト不可(強調中の【は捨てる)、対応しない】は捨てる、閉じない【は文末まで強調。改行 `\n` は保持。エスケープは無い。
- `parseEmphasis(text) => { text, emph }[]`(マーカー除去・隣接併合・空は除く)、`stripEmphasis(text)`(【】を除去 = TTS 入力・照合用)、
  `hasEmphasis(text)`。
- 描画(`common/RichText`): 強調部分は色 `style.emphasisColor`、大きさ `EMPHASIS_SCALE` = 1.15em。日本語は字幕と同じ文節単位の改行
  (`jaPhrases` を stripEmphasis 後の文に適用し、文節の中で強調部分を色分け)。【】が無い文は v3 と同じ DOM(字幕の見た目は不変)。
  テンプレートは `<RichText text lang emphasisColor emphasisScale? emphasisStyle? />` と `estimateRichEm(text)`(幅の目安)を使える。

## 5. Compositions パッケージ API(`@gas/compositions`)

```ts
export type AdVideoProps = { project: Project; format: Format; lang: Lang; assetBaseUrl: string; useProxy: boolean };
export const AdVideo: React.FC<AdVideoProps>;
export function calcAdMetadata(project: Project, format: Format, lang: Lang, fps?: Fps):   // [v2] lang 追加
  { durationInFrames: number; fps: number; width: number; height: number };
export function buildNarrationPlan(project: Project, lang: Lang, fps: number): NarrationPlan;  // [v2]
export type NarrationPlan = { lines: PlacedNarration[]; overflowLineIds: string[] };
export type PlacedNarration = {
  lineId: string; section: "hook" | "main" | "cta";
  from: number;               // 出力タイムライン上の絶対開始フレーム
  durationInFrames: number;   // 実際に再生するフレーム数(セクション末で切った後)
  naturalFrames: number;      // 音声本来の長さ
  cut: boolean;               // 切られた(または入りきらず落とされた)
};
export function assetUrl(baseUrl, projectId, relPath): string;
export function sourceUrl(baseUrl, project, sourceId, useProxy): string;
export function seFileUrl(baseUrl, fileId): string;   // [v4] "<base>/api/se/file/<id>"(§6.12)
export function buildSeSchedule(...): ScheduledSe[];   // [v4] §5.9(web は通常使わない)
export type { SeEvent, ScheduledSe }; export const SE_MAX_SEC;  // [v4]
export const COMPOSITION_ID = "AdVideo";

// [v3] 構成バー用。どのテンプレートでも同じ形
export function getSectionDurations(project: Project, lang: Lang, fps?: number): SectionDurations;
export type SectionDurations = {
  sections: { id: string; kind: SectionKind; label: string; sec: number }[];  // 再生順。合計 = totalSec
  hookSec: number;   // kind "hook" | "intro" の合計
  mainSec: number;   // kind "main" | "feature" の合計(= main スロットの映像が埋める時間。テロップ/ロゴは含まない)
  endSec: number;    // kind "end" の合計
  totalSec: number;
};
export type SectionKind = "intro" | "hook" | "main" | "feature" | "card" | "logo" | "end";
export { getTemplate, TEMPLATES };                 // [v3] レジストリ(§5.4)
export type { TemplateModule, TemplateTimeline, TemplateRenderProps, TimelineSectionInfo };
export { HOOK_SEC, END_CARD_SEC, MAX_HOOK_SEC, MAX_END_CARD_SEC };   // hook-play-cta の定数(従来どおり)
```

- [v3] `calcAdMetadata` / `getSectionDurations` / `buildNarrationPlan` / `<AdVideo>` はすべて
  `getTemplate(project.template).buildTimeline(project, fps, lang)` を通る。web は構成バーを `sections` から汎用に描く
  (`kind` で色分け、`label` を表示)。hook-play-cta では sections = [hook "フック", main "本編", end "エンド"]。[v4] intro は §5.8。
- `calcAdMetadata` / `<AdVideo>` / `buildNarrationPlan` は同じタイムライン計算を共有し、必ず一致させる。
  `Root` の `calculateMetadata` は `calcAdMetadata(props.project, props.format, props.lang)`。
- web は `buildNarrationPlan(...).overflowLineIds` で「ナレーションが入りきらない」警告を出す。
- その他 Phase 1 の規則(OffthreadVideo、NotoSansJP、空プロジェクトで落ちない、未知 sourceId のクリップはスキップ)は継続。
- [v2] **`proxyStatus !== "ready"` のソースを参照するクリップは `useProxy=true`(プレビュー)では描画しない**(プロキシファイルがまだ無い)。
  レンダー(`useProxy=false`)は元動画を使うので描画してよい。尺計算はどちらでも同じにする(黒で埋める)。
- [v2] `game.releaseText[lang]` を表示。ウォーターマーク(main セクションのロゴ/タイトル)は `style.watermark.position` の角に
  `scale` 倍で表示、`"none"` なら非表示。

### 5.1 ナレーションのタイムライン規則 [v2](テンプレート `hook-play-cta`)

対象は `script` のうち `lang === props.lang`、`text.trim() !== ""`([v3] recorded 行は text 不要。[v4] `stripEmphasis(text).trim()` で判定)、`audioPath` と `durationSec` を持つ行
(status が stale/error でも音声があれば使う)。= `common/narrationLayout.ts` の `playableLines()`。全テンプレート共通。
hook-play-cta では `featureId` は無視(普通の main 行)。

- **hook 行**: 各行 `from = hook 開始 + offsetSec`(行同士は独立。重なっても良い)。
- **main 行**: main 開始から順番に連続再生。`t = main 開始` から始め、各行で `t += offsetSec` → その行を `t` に配置 → `t += durationSec`。
- **cta 行**: `from = エンドカード開始 + offsetSec`。
- **`durationSec === null`(自由)**: 各セクションはナレーションが収まるまで伸びる。
  - hook の長さ = max(2.5 秒, max(hook 行の offsetSec + durationSec))
  - main の長さ = max(クリップの自然長の合計, main 行の offsetSec + durationSec の総和)。映像が足りない分は最後のフレームを保持(または黒)— compositions の裁量
  - エンドカード = max(3 秒, max(cta 行の offsetSec + durationSec))
- **`durationSec` が 15 / 30(固定)**: フック = max(2.5秒, min(5秒, フック行の offset+長さの最大))、エンドカード = max(3秒, min(5秒, cta 行の同値))。本編 = 全体 − フック − エンドで、合計は常に durationSec ちょうど。web は `getSectionDurations()` で同じ値を得る(定数を複製しない)。
  セクション末を越えるナレーションはセクション末で **切る**(短いフェード可)。開始位置がすでにセクション外の行は落とす。
  切った/落とした行の id は `overflowLineIds` に入り、web が警告を出す。
- 秒→フレームは `Math.round(sec * fps)`。

### 5.2 字幕 [v2]
- `style.captions.enabled` が false なら字幕を一切出さない。
- ナレーション字幕: 各配置行の `captions[i]` を `from + round(startSec*fps)` 〜 `from + round(endSec*fps)` に表示(切られた行は再生範囲内のみ)。
- 手動字幕 `project.captions[lang]` も従来どおり(出力タイムライン秒)表示。重なったら後に始まった方を優先。
- 位置 `bottom` / `center`、サイズ `m` / `l`。
- [v3] 字幕・ナレーション・BGM・ダッキングは `<AdVideo>` が全テンプレート共通で描く(テンプレートは映像だけ)。
  9:16 の `bottom`: blur モードは映像下の帯の中、crop モードは画面下端から 16% 上(ショート動画アプリの UI を避ける)。
- [v4] 字幕の【強調】は §4.4 のとおり色 `style.emphasisColor`・1.15 倍で描き、括弧は出さない(全テンプレート共通、【】が無ければ見た目は v3 と同一)。
- [v4] テンプレートは `TemplateTimeline.captionLayout` で字幕の配置を上書きできる: `scale`(フォントサイズ倍率、既定 1)、
  `verticalMode`(9:16 の配置計算に使うモード。intro は "blur" = 中央の 16:9 帯の下の帯に置く。project の vertical.mode より優先)。

### 5.3 音声ミックスとダッキング [v2]
- **ナレーション**: `<Audio>` 音量 = `audio.narrationVolume`。
- **「ナレーション中」** = 再生中のいずれかのナレーション区間 [from, from + durationInFrames) に入っているフレーム。
- **ゲーム音**: クリップ音量 = `clip.gameVolume × (ナレーション中 ? audio.gameVolumeUnderNarration : 1)`。
- **BGM**(`audio.bgm` があるとき): 基本音量 `bgm.volume`、ナレーション中は `× 10^(duckingDb/20)`。
  `loop: true` なら動画全体をループで埋め、false なら 1 回だけ。末尾 `fadeOutSec` でフェードアウト(先頭は短いフェードイン可)。
- ダッキングの切り替えは急変させず、前後 ~0.2 秒(`Math.round(0.2*fps)` フレーム)で補間する。
- 音量は Remotion の `volume` コールバック(フレーム関数)で実装する。
- [v4] **効果音**: 音量 `audio.se.volume × イベントの gain`。ダッキングしない(ナレーション・BGM・ゲーム音の計算にも影響しない)。§5.9。

### 5.4 テンプレートモジュールとレジストリ [v3]

```ts
// templates/types.ts
type TemplateTimeline = {
  fps: number; totalFrames: number;
  sections: TimelineSectionInfo[];   // 再生順・隙間なし・[0, totalFrames) を覆う
  narration: NarrationPlan;          // この lang のナレーション配置(common/narrationLayout.ts の型)
  seEvents?: SeEvent[];              // [v4] 効果音イベント(絶対フレーム + スロット、§5.9)。無し = なし
  captionPopSe?: boolean;            // [v4] true: 字幕チャンクの出現ごとに "captionPop" を鳴らす(<AdVideo> が中央で計算)
  captionLayout?: { scale?: number; verticalMode?: VerticalMode };  // [v4] 字幕配置の上書き(§5.2)
};
type SeEvent = { frame: number; slot: SeSlot; gain?: number /*0..1, 既定 1*/ };   // [v4] common/SeTrack
type TimelineSectionInfo = { id: string; kind: SectionKind; label: string /*日本語 UI ラベル*/; from: number; durationInFrames: number };
type TemplateRenderProps<T> = { project; format; lang; assetBaseUrl; useProxy; timeline: T };
type TemplateModule<T extends TemplateTimeline = TemplateTimeline> = {
  id: TemplateId;
  buildTimeline(project: Project, fps: number, lang: Lang): T;   // 純関数・決定的・整数フレーム。有効な Project で throw しない
  Component: React.FC<TemplateRenderProps<T>>;                   // 映像だけ(セクションを <Sequence> で)
};
function defineTemplate<T>(m: TemplateModule<T>): TemplateModule;  // レジストリ用に型を消す

// templates/index.ts
const TEMPLATES: Record<TemplateId, TemplateModule>;  // hook-play-cta / features / trailer / [v4] intro
function getTemplate(id: TemplateId): TemplateModule;
```

- 各テンプレートは `templates/<name>/index.ts` から 1 つの TemplateModule を export する:
  `hookPlayCtaTemplate`(`templates/hookPlayCta`)、`featuresTemplate`(`templates/features`)、`trailerTemplate`(`templates/trailer`)、[v4] `introTemplate`(`templates/intro`)。
- `<AdVideo>` = `DuckContext.Provider` > `AbsoluteFill(黒, BODY_FONT)` > [`<module.Component timeline={tl} …/>`, `<Captions>`, `<Narration>`, `<Bgm>`, [v4] `<SeTrack>`]。
  テンプレートは字幕・ナレーション・BGM を描かない(`tl.narration` を作るだけ)。
- 共通部品(`src/common/**`, `common/index.ts` から import 可):
  `ClipTrack`(カット + パンチ + 9:16 blur/crop + ゲーム音ダッキング + プロキシ未準備のプレースホルダ)、`Backdrop`、`EndCard`(全テンプレート共通の
  エンドカード、VOICEVOX クレジット込み)、`Watermark`、`NoFootage`、`fonts`(`BODY_FONT`, `displayFont(lang)`)、`theme`(`unitFor`, `isVertical`,
  `readableOn`, `withAlpha`, `outline`)、`phrases`(`jaPhrases`)、`urls`、`clips`(`toSegments`, `fitSegments`, `consumeFrames`, `segLen`,
  `MIN_CLIP_SEC`, `PlacedClip`, `TimelineSection`)、`narrationLayout`(`playableLines`, `layoutNarration`, `placeSection`, `toFrames`,
  `PlacedNarration`, `NarrationPlan`, `RelLine`)、`audioMix` / `mixContext`。
- `PlacedNarration.section` は台本のセクション("hook" | "main" | "cta")。
- 共通の規則(全テンプレート): 秒→フレームは `Math.round(sec*fps)`。`durationSec` 15/30 なら totalFrames は **ちょうど** `durationSec*fps`、
  null(自由)なら自然長 + ナレーションが収まる長さ。固定尺でセクションを越えるナレーションは `placeSection(…, fixed=true)` と同じく切る/落とし、
  `overflowLineIds` に入れる。空プロジェクト(クリップ 0・台本 0)でも落ちずに 1 フレーム以上。未知 sourceId のクリップは無視。
  エンドカード = `END_CARD_SEC`(3 秒)、cta 行に合わせて伸びる(自由: 制限なし / 固定: 最大 `MAX_END_CARD_SEC` 5 秒)、cta 行は
  エンドカード開始 + offsetSec(hook-play-cta と同じ)。エンドカードは `common/EndCard` を使う。

### 5.5 テンプレート `features`(魅力紹介)[v3]

構成: **タイトル(intro)→ 魅力 1 … 魅力 N(各 feature セクション)→ エンドカード**。N = `templateData.features.items.length`。

- 定数(features/ 内に定義): `INTRO_SEC = 2.5`, `MAX_INTRO_SEC = 5`, `FEATURE_MIN_SEC = 2.0`, `FEATURE_HEADING_SEC = 1.5`。
- **intro**(kind "intro", id "intro", label "タイトル"): hook スロットのクリップを `fitSegments(…, minFrames=1)` で敷く
  (無ければ `Backdrop`。main からは借りない)。ロゴ(無ければタイトル)+ `texts[lang].hook`(キャッチ、空なら出さない)。
  長さ: 自由 = max(2.5 秒, hook 行の need)、固定 = max(2.5 秒, min(5 秒, hook 行の need))。hook 行は intro 開始 + offsetSec。
  (need = max(行の offsetSec + durationSec)、`layoutNarration` の hookNeed と同じ)
- **クリップの割り当て**: `assignFeatureClips(project)`(@gas/shared)。main クリップで `featureId` が項目に一致するものはその項目へ、
  それ以外(無し/未知 id)は **配列順にラウンドロビン**(未割当の k 本目 → items[k % N])。各項目内は配列順。hook クリップは intro 用。
- **feature セクション**(kind "feature", id = item.id, label = `魅力${i+1} ${heading[lang]}`):
  見出しは **専用カードではなくオーバーレイ**(セクション時間 = その項目のクリップ時間)。
  番号バッジ(ja「魅力①②③④」/ en「FEATURE 1」等)+ `heading[lang]` + `sub?.[lang]`(空なら出さない)。
  最初の `FEATURE_HEADING_SEC` は大きく、その後はセクション終わりまで小さなラベルとして残す(見た目は担当の裁量)。
  クリップは `fitSegments(segs, len_i, MIN_CLIP_SEC*fps, "feat-<id>")`(足りなければ素材を延長→最後のフレームを保持)。クリップ 0 本の項目は `Backdrop` + 見出し。
  ウォーターマーク(`common/Watermark`)を feature セクションに表示。
- **ナレーション**:
  - main 行で `featureId` が項目に一致 = **bound**: その項目の開始から順番に連続(`t += offsetSec` → 配置 → `t += durationSec`)。
  - main 行で featureId 無し/未知 = **unbound**: 最初の feature の開始から、feature 群全体を通して順番に連続(hook-play-cta の main と同じ)。
    bound 行と重なりうる(web は同じ lang に bound と unbound が混在していたら注意を出してよい)。
  - cta 行はエンドカード(§5.4)。
- **長さ**(natural_i = 項目 i のクリップ自然長の合計、narr_i = bound 行の need、U = unbound 行の need):
  - 自由: `len_i = max(FEATURE_MIN_SEC, natural_i, narr_i)`。Σlen_i < U なら最後の feature を差分だけ伸ばす。何も切らない。
  - 固定: `B = durationSec − intro − end`(フレーム)。重み `w_i = max(FEATURE_MIN_SEC, natural_i, narr_i)`、
    `len_i = floor(B * w_i / Σw)`、端数は最後の feature に足す(合計はちょうど B)。bound 行は自分の feature の末尾で、
    unbound 行は feature 群の末尾で切る(`placeSection` と同じ規則)。
- **N = 0**: feature の代わりに 1 つの main セクション(kind "main", id "main", label "本編")に全 main クリップ/全 main 行(hook-play-cta の main と同じ規則)。
- sections = [intro, feature…(または main), end]。

### 5.6 テンプレート `trailer`(トレーラー風)[v3]

構成: **カットとテロップを交互に(cold open、intro なし)→ ロゴ演出(任意)→ エンドカード**。

- 定数(trailer/ 内に定義): `CUT_MAX_SEC = 2.0`, `CUT_MIN_SEC = 0.5`, `CARD_SEC = 1.5`, `CARD_MIN_SEC = 1.0`, `CARD_MAX_SEC = 2.5`, `LOGO_REVEAL_SEC = 2.0`。
- **カット列** = `trailerClipOrder(project)`(@gas/shared: hook クリップ → main クリップ、各配列順)。使えないクリップ(未知ソース等)はカットを作らないが index は占める。
  各カット i の基本長 `b_i = min(clip の自然長, CUT_MAX_SEC)`、clip.inSec から再生(`ClipTrack` / `PlacedClip` を使う、パンチ有り)。
- **テロップ**(`templateData.trailer.cards`): `afterClipIndex = k` のカードはカット列 index k のカードの直後(index k のクリップが使えなければ、
  index ≤ k の最後の使えるカットの直後)。`-1` = 先頭、`k >= 列の長さ` = 最後のカットの後。同じ位置のカードは配列順。
  全画面(黒または `Backdrop`)に `text[lang]` を大きく(`displayFont(lang)`)。基本長 `CARD_SEC`。text[lang] が空のカードは出さない。
- **ビート同期**: `beatSync && audio.bgm && bgm.beats.length >= 2` のとき有効。グリッド G = bgm.beats(BGM は出力の frame 0 から再生、オフセット無し)。
  `bgm.loop` が true なら最後のビート以降を周期 `60/bpm`(bpm 無しなら隣接ビート間隔の中央値)で動画末尾まで延長。false なら延長しない。
  要素(カット/カード)を先頭から順に、カーソル t(秒)で: 目標終了 e = t + 基本長。窓 [t + 最小長, t + 最大長] 内で e に最も近い G の点に終了をスナップ
  (カット: 最小 `CUT_MIN_SEC`・最大 = clip の自然長、カード: `CARD_MIN_SEC`〜`CARD_MAX_SEC`)。窓に点が無ければ e のまま。
  境界のフレーム = `Math.round(終了秒 * fps)`(累積で丸める = ずれが溜まらない)。無効時はスナップ無し。
- **ロゴ演出**(`logoReveal` が true のとき、kind "logo", id "logo", label "ロゴ"): `LOGO_REVEAL_SEC`。`Backdrop` 上にロゴ(無ければタイトル)を光/スケールで出す。
- **長さ**:
  - 自由: カット・カードを上記で並べた合計 + ロゴ + エンドカード。
  - 固定: `B = durationSec − logo − end`(フレーム)。上記で並べた合計 S が
    - S > B: 末尾からカットを落とす(落ちたカットの後ろのカードは最後に残ったカットの後へ)。カットが 1 本になっても超えるなら末尾のカードを落とす。
    - S < B: 各カットの基本長を `B/S` 倍(各 clip の自然長まで)にして並べ直し(スナップも再計算)。
    - それでも足りない分は全カットに比例配分し、各カットを outSec の先の素材へ延長する(素材の終わりに達したら最後のフレーム保持)。beatSync 有効時はスナップを再計算。カードは 2.5 秒を超えて伸ばさない(長い黒画面を作らない)。
    - 最後に端数を最後のカットで調整して合計をちょうど B にする。
  - カットが 0 本: `NoFootage` を 1 セクション(kind "main")として B(自由なら 2 秒)を埋める + カード。
- **ナレーション**: hook 行 = frame 0 + offsetSec(独立)。main 行 = hookNeed から順番に連続(`t += offsetSec` …)。どちらもカット/カード区間
  [0, ロゴ開始) に置き、固定尺ではロゴ開始で切る。自由尺で main の need が区間を超えるなら最後の要素を伸ばす。cta 行はエンドカード(§5.4)。
  `texts[lang].hook` は trailer では使わない(テロップが担う)。ウォーターマークは出さない(ロゴ演出があるため)。
- sections = 連続するカットを 1 つにまとめた {kind "main", id `cuts-<n>`, label "カット"}、カード {kind "card", id = card.id, label "テロップ"}、
  logo、end。

### 5.7 9:16 の作り方 [v3]
- `style.vertical.mode`(9:16 のときだけ効く。16:9 は常に cover):
  - `"blur"`(既定): 16:9 の映像を横幅いっぱいに中央配置、上下の帯を同じ映像のぼかしで埋める(Phase 2 と同じ)。
  - `"crop"`: 映像を全面 cover で切り出す。横方向の中心 = `clip.focusX`(既定 0.5、0 = 左端、1 = 右端。CSS `object-position: focusX*100% 50%`)。
- 実装は `common/ClipTrack.tsx`(テンプレートは ClipTrack を使えば自動で対応)。字幕は §5.2。
- テンプレートの大きな文字の置き場所: blur モードでは上下の帯(各 (1920−1080·9/16)/2 ≈ 656px)が空いているのでそこを使ってよい。
  crop モードでは映像の上に重なるので縁取り/影を付け、画面下 16%(字幕)と上端の安全域を避ける。`project.style.vertical.mode` で分岐する。

### 5.8 テンプレート `intro`(紹介動画風)[v4](担当: compositions-intro、`templates/intro/**`)

ナレーション主導のテンポの速い縦型ゲーム紹介ショート。構成: **本文(つかみ → 本編。上に見出し帯・中央に 16:9 プレイ映像・下に大きな字幕)→ エンドカード**。
現在の `templates/intro` はスタブ(hook-play-cta の描画 + SE/字幕の配線)。以下の規則で置き換える。定数は intro/ 内に定義:
`BODY_MIN_SEC = 3`, `BODY_TAIL_SEC = 0.4`, `LINE_CLIP_MIN_SEC = 0.6`(= MIN_CLIP_SEC), `TAIL_SPLIT_SEC = 1.0`, `NO_NARRATION_INFO_SEC = 1.0`。

**ナレーション(本文)**
- 本文行 = `playableLines(project, lang)` のうち section が hook / main のもの。順序 = `introBodyLines` と同じ(hook 行 → main 行、各配列順)。
- hook 行も main 行も **区別せず順番に連続再生**(hook-play-cta と違い hook 行は独立配置しない): `t = 0` から、各行 `t += offsetSec` → `from = t` → `t += durationSec`。
  need = 最後の t。行の `section` は PlacedNarration にそのまま入れる(hook / main)。
- cta 行: エンドカード開始 + offsetSec(§5.4 共通)。featureId は無視。
- 速度(1.2〜1.3 倍)は台本行の voice.speed で行う(テンプレートは関与しない。web が intro 選択時の新規行の既定を 1.25 にしてよい)。

**長さ**
- エンドカード: §5.4 共通(3 秒、cta 行に合わせて伸びる。自由: 無制限 / 固定: 最大 5 秒)。`common/EndCard` を使う。
- 自由(`durationSec === null`): 本文 = need > 0 なら `max(BODY_MIN_SEC, need + BODY_TAIL_SEC)`(**クリップの長さでは伸ばさない**)、
  ナレーションが無ければ `max(BODY_MIN_SEC, 使えるクリップの自然長の合計)`。何も切らない。
- 固定(15 / 30): 本文 = durationSec − エンドカード。本文末を越える行は本文末で切り、開始が本文末以降の行は落とす(`placeSection(…, fixed=true)` と同じ)→ `overflowLineIds`。
  合計はちょうど durationSec。
- sections: hook {kind "hook", id "hook", label "つかみ"} = [0, 最後に配置された hook 行の終わり)(hook 行が無い/0 フレームなら省く)、
  main {kind "main", id "main", label "本編"} = 本文の残り、end {kind "end", id "end", label "エンド"}。空プロジェクトでも 1 フレーム以上。

**クリップ(中央の 16:9 帯)**
- クリップ列 = `introClipOrder(project)`(hook スロット → main スロット、各配列順)から使えないもの(未知 sourceId)を除いた n 本。
  プレビューでプロキシ未準備のクリップも尺計算には含める(描画は ClipTrack の規則どおり)。
- `clipPerLine === true` かつ本文行が 1 本以上: 切り替え点 b_0 = 0、b_k = 本文行 k の from(k ≥ 1)。本文行 k の区間 [b_k, b_{k+1})
  (最後の行は行の終わりまで)にクリップ `clips[j % n]` を clip.inSec から再生(区間が自然長より長ければ outSec の先へ延長、素材末で最終フレーム保持 =
  `fitSegments` と同じ扱い)。j は「切り替えた回数」: 区間が `LINE_CLIP_MIN_SEC` 未満の行では切り替えず前のクリップを続ける(j を進めない)。
  最後の行の終わり〜本文末の残り: `TAIL_SPLIT_SEC` 以下なら最後の区間を延ばす。それより長ければ続きのクリップ(j+1, j+2, …)を自然長
  (最短 MIN_CLIP_SEC)で並べ、最後の 1 本が残りを埋める。
- `clipPerLine === false` またはナレーション無し: 全クリップを順に `fitSegments(toSegments(clips), 本文フレーム数, MIN_CLIP_SEC*fps, "intro")` で敷く。
- クリップ 0 本: 帯の中に `Backdrop`(または `NoFootage`)。ゲーム音は ClipTrack のダッキング規則どおり。

**見出し帯・情報カード・ポイント**
- 見出し帯: 本文 [0, 本文末) の間ずっと表示(エンドカード中は出さない)。kicker(`stripEmphasis` した全体をバッジで)+ `headline[lang]`
  (`RichText`、【強調】・改行対応)。headline[lang] が空ならゲームタイトルを出す。frame 0 で登場アニメ + SE "headline"。
- 情報カード(`info.enabled` かつ label か value が空でない行が 1 つ以上): 開始 = `atLineId[lang]` の行が本文に配置されていればその from、
  無ければ本文 2 行目の from、1 行しか無ければ 1 行目、ナレーション無しなら `round(NO_NARRATION_INFO_SEC*fps)`(本文がそれより短ければ 0)。
  表示 = [開始, min(開始 + round(durationSec*fps), 本文末))。value が空の行は出さない。label/value は言語別、value は RichText。SE "info" を開始時に。
- ポイント(`text[lang]` が空でない項目。番号 ①②③… は表示する項目の中での順番):
  - bound: `lineId[lang]` が本文に配置された行 → その行の再生中 [from, from + durationInFrames) にバッジ表示。
  - unbound(lineId 無し/無効): 候補行 = 配置された **main** 行のうち、bound ポイントの行でも情報カードの開始行でもないもの(再生順)。
    k 番目の unbound ポイント → k 番目の候補行。候補が足りないポイントは出さない(web が注意を出してよい)。
  - ナレーション無し: 情報カードの後(無ければ 0)〜本文末を表示ポイント数で等分。
  - 新しいポイントが出たら前のポイントは消す(または小さく残す — 見た目は担当の裁量)。各ポイントの開始で SE "point"。
- ウォーターマークは出さない(見出し帯が担う)。`texts[lang].hook` は使わない。

**効果音(`seEvents`)**: "headline" @ 0、"transition" @ 本文内でクリップが実際に切り替わる各フレーム(> 0)、"info" @ 情報カード開始、
"point" @ 各ポイント開始、"cta" @ エンドカード開始。`captionPopSe: true`(字幕チャンクごとの pop は <AdVideo> が付ける)。
gain は担当の裁量(例: transition 0.7)。同じフレーム・同じスロットは 1 つにまとめられる。

**レイアウト 9:16(1080×1920)**: `style.vertical.mode` は無視(常にこのレイアウト、focusX は使わない)。
- 上: 見出し帯 y ∈ [0, 656)。上端 ~120px はアプリ UI 用の安全域。背景はテーマ色の帯 or 同じ映像のぼかし(担当の裁量)。
- 中央: 16:9 プレイ映像 1080×608、y ∈ [656, 1264)(= blur モードの映像位置と同じ)。情報カード・ポイントバッジはこの帯の上か近くに重ねる。
- 下: 字幕(共通 `<Captions>`)。`captionLayout = { verticalMode: "blur", scale: 1.15〜1.3 }` で帯の下 [1264+30, 1920−150) に大きく出る。
  テンプレートはこの領域に他の要素を置かない。
**レイアウト 16:9(1920×1080)**(破綻しないこと): 映像は全面(ClipTrack cover)、見出しは上部の半透明バー(高さ 22% 以内、文字は小さめ)、
字幕は共通の下部(scale はそのまま)、情報カードは右側パネル、ポイントは見出しの下・左側。

### 5.9 効果音(SE)[v4](共通: `common/SeTrack.tsx`、URL: `common/urls.ts` の `seFileUrl`)
- スロット(`SE_SLOTS`): `captionPop`(字幕の出現)/ `headline`(見出し・タイトル)/ `point`(ポイント)/ `info`(情報カード)/
  `transition`(場面転換)/ `cta`(エンドカード)。`audio.se.slots[slot]` = SE ライブラリのファイル id(無し = 無音)。
- テンプレートは **イベントを出すだけ**(`timeline.seEvents`、絶対フレーム)。<AdVideo> が `buildSeSchedule(project, tl.seEvents, captionItems, tl.captionPopSe, totalFrames, fps)`
  で解決して `<SeTrack>` で鳴らす(テンプレートは SE の <Audio> を自分で置かない)。
- `buildSeSchedule`: `audio.se.enabled` が false か volume 0 なら空。`captionPopSe` なら字幕アイテム(ナレーション字幕チャンク + 手動字幕、
  字幕 off なら無し)の開始ごとに captionPop を足す — ただしテンプレートのイベントから ±`SE_POP_SUPPRESS_SEC`(0.1 秒)以内なら足さない。
  ファイル未割当のスロット・[0, totalFrames) 外は捨て、(frame, slot) で重複除去、frame 順。
- `<SeTrack>`: 1 イベント = `<Sequence from={frame} durationInFrames={min(SE_MAX_SEC(4 秒), 残り)} layout="none"><Audio src={seFileUrl(assetBaseUrl, id)} volume={se.volume*gain}/>`。
- caption pop を中央(<AdVideo>)で付ける理由: 字幕アイテムは <AdVideo> が作るため(テンプレートが字幕を再計算しなくてよい)。テンプレートは opt-in するだけ。
- **SE を出すのは `SE_TEMPLATES`(@gas/shared、現在 ["intro"])のテンプレートだけ**。他テンプレートは seEvents/captionPopSe を出さない(既存の音は不変)。
  collectCredits もこの一覧で SE クレジットの要否を決める。
- レンダー時、ライブラリに存在しないファイルのスロットは server(render.ts の `dropMissingSe`)がスナップショットから外す(404 でレンダーが落ちないように)。
  プレビューでは web が `GET /api/se` の一覧に無いファイルを割り当て済みスロットに警告表示する。

## 6. Server HTTP API(`@gas/server`, port 3101)

- JSON API。エラーは常に `{ error: string }` + ステータス(400 / 404 / 409 / 500 / 501 / 503)。
- リクエストボディは `@gas/shared` の zod スキーマで検証(`parseBody` in `errors.ts`)。

| Method | Path | Body | レスポンス |
|---|---|---|---|
| GET | `/api/health` | — | `HealthResponse` |
| GET | `/api/projects` | — | `ProjectSummary[]` |
| POST | `/api/projects` | `{ name }` | 201 `Project` |
| GET | `/api/projects/:id` | — | `Project`(v3 に migrate 済み) |
| PUT | `/api/projects/:id` | `Project` | `Project`(§6.2 のマージ後) |
| POST | `/api/projects/:id/sources` | `{ path }` | **[v2] 201 `Project`(即時。新ソースは末尾、proxyStatus "pending")** |
| GET | `/api/projects/:id/sources/:sourceId/original` | — | 元動画(Range 対応) |
| POST | `/api/projects/:id/assets` | multipart `"file"` | `{ path: "assets/<nanoid>.<ext>" }` |
| GET | `/files/:projectId/*path` | — | プロジェクト内ファイル(Range 対応) |
| POST | `/api/projects/:id/render` | `{ format, lang, fps? }` | `{ jobId }` |
| GET | `/api/render/:jobId` | — | `RenderJob` |
| POST | `/api/projects/:id/sources/:sourceId/analyze` | — | **[v2] 202 `Project`**(server-highlight、§6.5) |
| GET | `/api/tts/status` | — | **[v2] `TtsStatusResponse`**(server-tts、§6.6) |
| GET | `/api/tts/voices?engine=voicevox\|piper` | — | **[v2] `TtsVoice[]`** |
| POST | `/api/projects/:id/tts` | `TtsSynthesizeRequest` | **[v2] 200 `Project`** |
| POST | `/api/tts/preview` | `TtsPreviewRequest` | **[v2] `audio/wav`** |
| POST | `/api/projects/:id/render-batch` | `RenderBatchRequest` | **[v3] `RenderBatchResponse` `{ jobIds }`**(§6.9、実装済み) |
| GET | `/api/projects/:id/renders` | — | **[v3] `RenderListResponse` `{ files, jobs }`**(§6.9、実装済み) |
| POST | `/api/projects/:id/bgm/analyze` | — | **[v3] 202 `Project`**(§6.11、ルート実装済み・検出本体は server 担当) |
| GET | `/api/se` | — | **[v4] `SeListResponse` `{ dir, exists, files }`**(§6.12、実装済み) |
| POST | `/api/se/rescan` | — | **[v4] `SeListResponse`**(キャッシュ破棄 + 欠けた仮 SE の再生成) |
| PUT | `/api/se/manifest` | `SeManifestUpdateRequest` | **[v4] `SeListResponse`**(クレジットをマージ) |
| GET | `/api/se/file/*path` | — | **[v4] SE ファイル(Range 対応、no-cache)** |

### 6.1 ソース登録 [v2: 非同期]
1. path の存在確認(無ければ 400)→ ffprobe(読めなければ 400)。durationSec/fps/width/height/hasAudio はこの時点で確定。
2. `sources` に `proxyStatus: "pending"`, `analysisStatus: "none"` で追加して保存し、**201 で Project を即返す**。
3. バックグラウンドでプロキシ(Phase 1 と同じ ffmpeg 引数、同時 2 本まで)+ サムネイルを生成し、
   `updateProject` で `proxyStatus: "ready"`(または `"error"` + `proxyError`)に更新。
4. web は pending のソースがある間 `GET /api/projects/:id` を ~1.5 秒間隔でポーリングする。
- サーバー起動時: pending のまま残ったソースはプロキシを作り直し、`analysisStatus: "running"` のまま残ったものは `"error"`("Interrupted")にする(`sources.ts` の `recoverInterruptedJobs`)。
  [v3] `audio.bgm.analysisStatus: "running"` のまま残ったものも `"error"` + `analysisError: "Interrupted (server restarted)"`。

### 6.2 PUT のマージ規則(`store.ts` の `mergeServerOwned`)[v2]
web のデバウンス保存が、バックグラウンド処理の結果を古いスナップショットで上書きしないように:
- `sources`: web は **削除と並べ替えのみ** 可。サーバーが知らないソースは捨てる。各ソースの全フィールドは保存済みの値を使う。
- `candidates`: 一覧は保存済みの値(残っているソースのもの)。`adopted` だけ body の値を採用。
- `script`: body が正。ただし text・voice・lang が保存済みと同じで、保存済みが `ok`・body が `ok` 以外の行は、保存済みの合成結果
  (audioPath, durationSec, captions, status, credit, [v3] warning)を残す。[v3] voice の比較は `sameVoice`(sourcePath 込み)。
- [v3] `audio.bgm`: 保存済みと body の BGM の `path` が同じなら `beats` / `bpm` / `analysisStatus` / `analysisError` は **保存済みの値**
  (無ければ無し)。path が違う(差し替え)/ 保存済みに BGM が無いなら body のこれらのフィールドは捨てる(古い解析結果)。
  web は BGM を差し替えるとき新しいオブジェクト(`DEFAULT_BGM` + path)にする。
- [v3] `templateData`, `style.vertical`, `clip.featureId/focusX`, `line.featureId` は web が正(body をそのまま採用)。
- web はさらに: TTS(`POST /tts`)を呼ぶ前に保留中の保存を flush し、応答の Project で state を置き換える。

### 6.3 アセットアップロード
- 画像(png/jpg/jpeg/webp/gif/svg)+ **音声(mp3/wav/m4a/ogg/aac)** を許可。BGM は upload → `audio.bgm.path` に設定して PUT。

### 6.4 共有ヘルパ(route モジュールが使うもの)
- `store.ts`:
  - `updateProject(id, mutate)` — **ロック付き read(migrate 済み)→ mutate → 検証 → 原子的 write**。保存後の Project を返す。
    mutate 内で throw すると書き込まずに中断。**長い処理(ffmpeg・TTS)はロックの外で行い、結果だけ updateProject で書く。**
  - `readProject(id)`(404 は HttpError)、`projectExists(id)`、`assertSafeId(id, what?)`、`withProjectLock(id, fn)`。
- `errors.ts`: `HttpError(status, msg)`, `badRequest`, `notFound`, `parseBody(schema, body)`。
- `paths.ts`: `projectDir(id)`, `REPO_ROOT`, [v3] `LISTEN_PORT`。 `media.ts`: `probe(file)`, `toolAvailable("ffmpeg"|"ffprobe")`。
- `config.ts`: `config`, `resolveVoicevoxEnginePath()`(§6.8)。
- `render.ts`: `enqueueRender(projectId, { format, lang, fps? })`, `getJob(jobId)`, [v3] `listProjectJobs(projectId)`。
- ルート関数シグネチャ(固定、`import type { Express } from "express"`): `registerAnalysisRoutes` / `registerTtsRoutes` /
  [v3] `registerBgmRoutes`(routes/bgm.ts)/ `registerRenderRoutes`(routes/renders.ts)。各 `(app: Express): void`。
  index.ts が `/files` の後・404 ハンドラの前で呼ぶ。
- [v3] `beats/index.ts`(server 担当、シグネチャ固定): `analyzeBeats(file: string): Promise<{ beats: number[]; bpm: number }>`(失敗は throw)。

### 6.5 ハイライト解析 [v2](server-highlight)
`POST /api/projects/:id/sources/:sourceId/analyze`(body なし)
- 404: プロジェクト/ソースが無い。409: `proxyStatus !== "ready"` または既に `analysisStatus === "running"`。
- `analysisStatus: "running"`(`analysisError` 削除)にして保存し、**202 で Project を返す**。処理はバックグラウンド。
- 解析は **プロキシ**(720p/30fps)を入力にしてよい(速い)。時間はソースと同じ時間軸。
  特徴量: シーン切替(`select='gt(scene,X)'` / scdet)、動き(フレーム差分)、音の盛り上がり(`ebur128` / `astats`)。各 0..1 に正規化。
- 候補: 2〜6 秒の区間、`score` 0..1、重なりは避ける。上限は 1 ソースあたり 30 件程度。
  サムネ `thumbs/<candId>.jpg`(区間中央、高さ 360 程度)。
- 完了時 `updateProject` で: **そのソースの既存候補を全部置き換え**(他ソースの候補は残す。古い候補のサムネファイルは削除してよい)、
  `analysisStatus: "done"`。失敗時 `"error"` + `analysisError`(候補はそのまま)。途中でソースが消えていたら何もしない。
- web は running の間 GET をポーリングする。

### 6.6 TTS [v2](server-tts。[v3] 録音行は §6.10)
- `GET /api/tts/status` → `TtsStatusResponse`:
  `voicevox: { ok, version?, url, error? }`(`GET <url>/version`)、`piper: { ok, error? }`(exe と既定声の存在)、`whisper: { ok, model, error? }`(whisper.cpp とモデルの存在)。
  status は副作用なし(エンジン自動起動はしない)。
- `GET /api/tts/voices?engine=voicevox|piper` → `TtsVoice[]` `{ engine, speaker, name, lang, credit? }`。
  VOICEVOX: `/speakers` の各 style を 1 件に(speaker = style id 文字列、name = "キャラ名(スタイル名)"、lang "ja"、credit "VOICEVOX:キャラ名")。
  Piper: voicesDir の `*.onnx`(name = basename、lang は `.onnx.json` の language から、en 以外は除外してよい)。
  エンジンが使えなければ 503。
- `POST /api/projects/:id/tts` body `{ lang, lineIds? }` → **200 Project(同期)**。
  - 対象: lineIds 省略時は `lang` の行で text が空でなく status が `ok` 以外のもの([v3] `hasNarrationInput(line)` が true で status が `ok` 以外)。
    指定時はその行(`lang` が違う行は 400)。
  - text が空の行([v3] `hasNarrationInput` が false の行)は音声を消して status `"none"`。
  - 各行: 合成 → `tts/<lineId>.wav`(上書き)→ `audioPath`, `durationSec`(wav の実長)、`captions`(行頭からの相対秒)、
    `status: "ok"`、`error` 削除、`credit` 設定。失敗した行は `status: "error"` + `error`(要求全体は 200)。
  - [v3] 非致命的な問題(whisper 失敗 → 比例配分など)は **`line.warning` に保存**(ok と一緒に。問題が無ければ warning を消す)。
    従来の `X-Tts-Warnings` ヘッダは併用してよいが web は `line.warning` を表示する。
  - [v3] 合成時と比べる「変わっていないか」は text・lang・`sameVoice`(sourcePath 込み)。
  - 合成はロックの外で行い、最後に `updateProject` で結果を書く。その時点で行の text/voice が合成時と変わっていたらその行は書かない(stale のまま)。
  - VOICEVOX: `POST /audio_query?text=<encodeURIComponent>&speaker=<id>` → `speedScale = voice.speed` → `POST /synthesis?speaker=<id>`。
    字幕タイミングは audio_query の accent_phrases のモーラ長(+ pause_mora、prePhonemeLength、speedScale で補正)から算出し、
    句読点・アクセント句単位で読みやすい長さ(~15 文字以内目安)にまとめる。
    エンジン未起動なら `resolveVoicevoxEnginePath()` の run.exe を `--host 127.0.0.1 --port <url のポート>` で起動して最大 ~30 秒待つ(server 終了時に kill)。
  - Piper: `piper.exe --model <voicesDir>/<voice>.onnx --output_file <wav> --length_scale <1/speed>`(text は stdin、UTF-8)。
    **Piper の出力はピーク 0 dBFS なので、-3 dBFS 程度に正規化/ゲインを下げる**(ffmpeg で可)。
    単語タイミングは whisper.cpp(`@remotion/install-whisper-cpp` の `transcribe`, tokenLevelTimestamps)で取得し、
    元の台本テキストの単語に合わせて字幕チャンク(数語ずつ)を作る。whisper が無い場合は文字数比例で配分(status は ok)。
  - 出力 wav は 48kHz or エンジンのネイティブで可(Remotion が再生できる PCM WAV)。
- `POST /api/tts/preview` body `{ engine, speaker, speed, text }` → `audio/wav` バイナリ(保存しない)。

### 6.7 その他
- `express.json({ limit: "10mb" })`、`cors()`。`server.requestTimeout = 0`(TTS が長くなりうる)。
- `__dirname` は無い(ESM)。`paths.ts` を使う。project.json の書き込みは一時ファイル → rename。

### 6.8 設定 `apps/server/src/config.ts` [v2]
`<repo>/gas.config.json`(任意、git 管理外。例: `gas.config.example.json`)を起動時に 1 回読む。キーはすべて任意。

```ts
config = {
  voicevox: { url: "http://127.0.0.1:50021", enginePath?: string },
  piper:    { exePath: "D:\\Tools\\piper\\piper.exe", voicesDir: "D:\\Tools\\piper\\voices" },
  whisper:  { dir: "D:\\Tools\\whisper", model: "base.en", multilingualModel: "small" },   // [v3] multilingualModel
  se:       { dir: "D:\\Tools\\se" },   // [v4] SE ライブラリ。環境変数 GAS_SE_DIR が優先(テスト用)
}
resolveVoicevoxEnginePath(): Promise<string | null>
  // enginePath があればそれ(存在しなければ null)。無ければ D:\Tools\voicevox 以下の run.exe を探す
  // (深さ 3、結果キャッシュ)。既定で D:\Tools\voicevox\windows-cpu\run.exe が見つかる。
```
- [v3] `whisper.model`(既定 "base.en")= 英語用(Piper の単語タイミング、英語の録音行)。
  `whisper.multilingualModel`(既定 "small"、".en" 無しのモデル)= 日本語の録音行の書き起こし(language "ja")。初回使用時に `dir` へダウンロード。

### 6.9 一括書き出し・書き出し履歴 [v3](実装済み: `routes/renders.ts`)
- `POST /api/projects/:id/render-batch` body `{ targets: { format, lang }[] (1..8), fps? }` → `{ jobIds }`。
  重複ターゲットは 1 回だけ。ターゲット順にグローバルキューへ積む(1 本ずつ順に処理、既存の `/render` と同じキュー)。404: プロジェクト無し。
  各ジョブは `GET /api/render/:jobId` でポーリング。プロジェクトはジョブ開始時点の保存内容を使う。
- `GET /api/projects/:id/renders` → `{ files, jobs }`:
  - `files`: `renders/*.mp4` を mtime 降順。`{ name, path: "renders/<name>", url: "/files/<pid>/renders/<name>", format?, lang?, sizeBytes, mtime }`。
    format/lang はファイル名 `<yyyymmdd-hhmmss>_<16x9|9x16>_<ja|en>[-n].mp4` から(合わなければ無し)。
  - `jobs`: このプロジェクトのジョブ(メモリ上、サーバー再起動で消える)を新しい順。queued/bundling/rendering と終わったもの(done/error)の両方。
- 削除 API は無し(Phase 3 の範囲外)。

### 6.10 録音ナレーション [v3](server 担当: `tts/**`, `routes/tts.ts`)
- web: 録音ファイル(mp3/wav/m4a/ogg/aac)を `POST /assets` でアップロード → 行の voice を `createRecordedVoice(path)`
  = `{ engine: "recorded", speaker: "", speed: 1, sourcePath }` にして保存 → `POST /api/projects/:id/tts`(既存エンドポイント)。
- server(`POST /tts` の各行で `voice.engine === "recorded"`):
  - `sourcePath` が無い / ファイルが無い → その行は `status: "error"`(例: "録音ファイルがありません")。
  - ffmpeg で `tts/<lineId>.wav` に変換(PCM WAV、mono、48kHz 程度、ピーク -3 dBFS に正規化。先頭/末尾の長い無音はトリムしてよい)。
  - `durationSec` = 変換後 wav の実長。`credit` は付けない。`speed` は無視。
  - 字幕: whisper.cpp で書き起こし(lang "en" → `config.whisper.model`(base.en)、lang "ja" → `config.whisper.multilingualModel`(small)、language 指定)。
    `text` が空でなければ text を字幕の文言にしてタイミングを whisper に合わせる(en: Piper と同じ単語合わせ、ja: 書き起こしの区間に text を比例配分してよい)。
    `text` が空なら whisper の書き起こし(セグメント/単語)をそのまま読みやすいチャンクにする。**server は `text` を書き換えない**。
  - whisper が失敗/未導入: 音声は ok のまま、字幕は text があれば全長に比例配分、無ければ空。`line.warning` に理由。
  - `GET /api/tts/status` の `whisper.multilingual = { ok, model, error? }` を埋める。
- `POST /api/tts/preview` と `GET /api/tts/voices` は TTS エンジン専用のまま(recorded は対象外 = 400)。

### 6.11 BGM ビート解析 [v3](ルート実装済み: `routes/bgm.ts`、検出本体は server 担当: `beats/**`)
- `POST /api/projects/:id/bgm/analyze`(body なし)→ **202 Project**(`audio.bgm.analysisStatus: "running"`、`analysisError` 削除)。
  404: プロジェクト無し。409: `audio.bgm` が無い / 同じ BGM の解析が実行中。処理はバックグラウンド。
- バックグラウンド: `analyzeBeats(<projectDir>/<bgm.path>)` → 完了時 `updateProject` で、**その時点の `bgm.path` が解析開始時と同じなら**
  `beats`, `bpm`, `analysisStatus: "done"` を書く(失敗は `"error"` + `analysisError`、古い beats は残す)。path が変わっていたら何もしない。
- `analyzeBeats` の要件: beats はファイル先頭からの秒(昇順・重複なし)、曲全体をカバー、bpm は 60〜200 程度に正規化。
  ffmpeg でモノラル PCM にデコードしてオンセット検出 + テンポ推定(依存追加なし)。数秒以内。
- web: BGM をアップロードしたら自動で解析を開始してよい(または「ビート解析」ボタン)。running の間 GET をポーリング。bpm と状態を表示。
- 起動時リカバリは §6.1。

### 6.12 SE ライブラリ [v4](実装済み: `routes/se.ts` + `se/**`。以後 server 担当)
- 場所: `config.se.dir`(既定 `D:\Tools\se`、`gas.config.json` の `se.dir` / 環境変数 `GAS_SE_DIR`)。**リポジトリ外**。ユーザーが効果音ラボ・OtoLogic などの
  フリー素材を好きなサブフォルダに置く。リポジトリにも配布物にも含めない(`.gitignore` で音声拡張子を除外済み)。
- ファイル id = ライブラリからの相対パス、区切り `/`(`seFileIdSchema`: `..`・先頭 `/`・ドライブ文字・`\`・ドット始まりのセグメント不可)。
  対象拡張子 `SE_EXTS` = .wav .mp3 .ogg .m4a .aac。一覧は再帰(深さ 6、ドット始まりは除外、最大 2000 件)、id 昇順。
- **仮 SE**: `_placeholder/{pop,headline,point,info,transition,cta}.wav`(ffmpeg の aevalsrc で合成、48kHz mono、ピーク -1 dBFS)。
  server 起動時(`initSeLibrary()`)と rescan で **無いものだけ** 生成(`se/placeholders.ts`)。`DEFAULT_SE` は全スロットをこれに割り当てる。
- **マニフェスト** `<se.dir>/se.json`: `{ "version": 1, "files": { "<id>": { "credit": "効果音:OtoLogic" } } }`(`seManifestSchema`)。
  無ければ起動時に空で作る。壊れていたら空として扱う(警告ログ)。書き込みは一時ファイル → rename、直列化。
- `GET /api/se` → `{ dir, exists, files: { id, name, durationSec (ffprobe、(size, mtime) でキャッシュ、不明は 0), credit? }[] }`。
- `POST /api/se/rescan` → 長さキャッシュを捨て、仮 SE / se.json を補ってから一覧を返す(ユーザーがファイルを追加した後に押す)。
- `PUT /api/se/manifest` body `{ credits: { "<id>": "<credit>" } }` → se.json の該当 id にマージ(`""` = クレジット削除)→ 一覧を返す。
  id の形式は検証する(存在は問わない)。
- `GET /api/se/file/*path` → ファイル(`sendFileWithRange`、`Cache-Control: no-cache`)。不正 id / 拡張子 → 400、無い → 404。
  URL は `seFileUrl(baseUrl, id)`: プレビュー `/api/se/file/<id>`(相対、Vite プロキシ)、レンダー `http://localhost:<LISTEN_PORT>/api/se/file/<id>`。
- **クレジット**: project 側は `audio.se.credits`(スナップショット)。web は `GET /api/se` を読んだ時・スロットを変えた時・マニフェストを
  編集した時に「スロットに割り当てたファイルの credit」だけを入れ直して保存する(PUT は body が正 = web-owned)。
  UI 表示では `collectCredits(project, lang, voices, seFiles)` で最新値を使う。レンダー/EndCard はスナップショットを使う。
- render.ts は書き出し開始時に、存在しないファイルのスロットをスナップショットから外す(ログを出す)。

### 6.13 TTS と強調ワード [v4](server 担当: `tts/**`, `routes/tts.ts`)
- 合成(VOICEVOX / Piper)と `POST /api/tts/preview` の入力は **`stripEmphasis(text).trim()`**(【】は読まない)。
  対象行の選択(`hasNarrationInput`)も stripEmphasis 後で判定。**server は `line.text` を書き換えない。**
- 字幕 `line.captions[].text` は **元の text(【】付き)の部分文字列** にする:
  - 各チャンクの `stripEmphasis(chunk.text)` をつなげると `stripEmphasis(text)` の読み上げ部分と一致する(従来どおり空白・句読点の扱いは自由)。
  - マーカーはチャンクごとに閉じる: 強調がチャンク境界をまたぐときは前のチャンク末で 】 を補い、次のチャンク頭で 【 を補う
    (例: 「これは【めちゃくちゃ面白い】ゲーム」→「これは【めちゃくちゃ】」「【面白い】ゲーム」)。
  - チャンク分割はできるだけ強調の途中で切らない(強調部分を 1 つの塊として扱い、最大長を超える場合だけ分ける)。
  - 例: text「このゲーム【神すぎる】んだが！」→ captions `[{ text: "このゲーム【神すぎる】", … }, { text: "んだが！", … }]`(または 1 チャンク)。
- ja(VOICEVOX): audio_query のモーラ列は stripEmphasis 後の文に対応する。文字位置の対応表(元 text ↔ stripped)でチャンク境界を元 text に写して 【】 を戻す。
- en(Piper + whisper): 単語合わせは stripped の単語で行い、元 text で強調内にあった単語の前後に 【 】 を戻す。
- 録音行: text があればそれ(【】付き)を字幕の文言に使い、whisper の書き起こしとの照合(一致率チェック)は stripEmphasis 後で行う。
  text が空なら書き起こし(強調なし)。
- 字幕の表示側(共通 `<Captions>`)は【】を色付きで描き、括弧は出さない(§4.4)。

## 7. Web(`@gas/web`, Vite :5173)

- API は相対 URL、型は `@gas/shared`。プレビューは `calcAdMetadata(project, format, lang)`(**[v2] lang 追加**)。
- [v2] 画面に追加するもの:
  - ソース: 登録は即完了 → pending 表示(ポーリング)/ error 表示。ready のソースに「ハイライト解析」ボタン → running 表示 → 候補一覧
    (サムネ・スコア・特徴量バー・プレビュー再生・「hook に採用」「main に採用」= clip 追加 + `adopted: true`)。
  - 台本: 言語タブ × セクション(hook/main/cta)ごとに行の追加・削除・並べ替え、text、声(`GET /api/tts/voices`)、速度、offsetSec、
    status 表示、「合成」(`POST /tts`)、「試聴」(`POST /tts/preview`)。text/voice 変更で stale にする(§4)。
    TTS 状態(`GET /api/tts/status`)を表示。`buildNarrationPlan(...).overflowLineIds` で溢れ警告。`collectCredits` でクレジット表示。
  - BGM: 音声アップロード → `audio.bgm`(`DEFAULT_BGM` で初期化)、volume / duckingDb / fadeOutSec / loop、削除。
    `audio.narrationVolume` / `audio.gameVolumeUnderNarration`。
  - スタイル: ウォーターマーク位置(none 含む)・サイズ、字幕 on/off・位置・サイズ。
  - 発売情報は言語タブごと(`game.releaseText[lang]`)。
- [v3] 画面に追加/変更するもの:
  - テンプレート選択(`project.template`: 王道 / 魅力紹介 / トレーラー風)と、テンプレート別の設定パネル:
    - features: 魅力項目(2〜4 件)の追加・削除・並べ替え、見出し / サブを言語タブごと(`heading[lang]`, `sub[lang]`)。
      main クリップごとに所属項目(`clip.featureId`、「自動」= featureId 無し → ラウンドロビン。`assignFeatureClips` で実際の割り当てを表示)。
      main 台本行ごとに所属項目(`line.featureId`、「全体」= 無し)。
    - trailer: テロップ(`cards`)の追加・削除・並べ替え、text を言語ごと、表示位置(`afterClipIndex`: `trailerClipOrder(project)` の
      各クリップの「後」または「先頭」= -1 から選ぶ)、beatSync / logoReveal のトグル。beatSync が on でビートが無い場合は「BGM のビート解析が必要」と表示。
  - 構成バー: `getSectionDurations(project, lang).sections` を汎用に描く(kind で色、label、秒)。テンプレートの定数を複製しない。
  - BGM: ビート解析(`POST /bgm/analyze`)の起動・running 表示(ポーリング)・bpm / ビート数 / エラー表示。差し替え時は beats 等を持ち越さない(§6.2)。
  - 9:16: `style.vertical.mode`(ぼかし背景 / クロップ)の切り替え。crop のときクリップごとに `focusX` スライダ(0..1、既定 0.5)。プレビューは 9:16 で確認できること。
  - 書き出し: 形式 × 言語のチェック(`project.formats` × `project.languages` を既定に)→ `POST /render-batch` → 各ジョブの進捗。
    履歴は `GET /renders`(ファイル名・形式・言語・サイズ・日時・ダウンロード/再生リンク `url`)。
  - 録音ナレーション: 行の声の選択肢に「録音」(engine "recorded")。録音ファイルのアップロード → `createRecordedVoice(path)` → 合成ボタン(=変換+書き起こし)。
    録音の差し替え/ text 変更で stale。試聴は録音ファイルそのもの(`/files/...`)を再生。速度欄は隠す。
  - `line.warning` があれば行に注意アイコン+文言。クレジットは `collectCredits(project, lang, voicevoxVoices)`(独自実装は削除)。
  - TTS 状態に `whisper.multilingual` を表示(あれば)。
- [v4] 画面に追加/変更するもの(web 担当、`apps/web/src/**`):
  - テンプレート選択に「紹介動画風」(`intro`)を追加(`TEMPLATE_INFO` / アイコン)。intro を選んだら 9:16 プレビューを推奨表示。
    (step 1 で `ClipList` / `ProjectList` の Record に intro のラベルだけ足してある。文言は自由に変えてよい)
  - intro 設定パネル: 見出し(`headline[lang]`、複数行、【】の挿入ボタン)、kicker、情報カード(enabled、行の追加・削除・並べ替え、label/value を言語別、
    表示開始行 `atLineId[lang]` = `introBodyLines(project, lang)` から選ぶ/「自動(2 行目)」、durationSec)、
    ポイント(追加・削除・並べ替え、最大 5、text を言語別、紐付け行 `lineId[lang]`/「自動」)、clipPerLine のトグル。
  - 強調: 台本・字幕の入力欄に「選択範囲を【】で囲む」ボタン(またはショートカット)。強調色 `style.emphasisColor`(`EMPHASIS_COLORS` の黄/赤 + 任意色)。
    【】を含む行の text 変更も通常どおり stale。
  - 効果音パネル: `audio.se.enabled` / `volume`、スロットごとにライブラリのファイルを選択(`GET /api/se`、試聴 = `/api/se/file/<id>` を再生、「なし」)、
    ライブラリ一覧(id・長さ・クレジット編集 = `PUT /api/se/manifest`、「再読み込み」= `POST /api/se/rescan`、ライブラリの場所 `dir` を表示し
    「効果音ラボ・OtoLogic などのフリー素材をこのフォルダに置く」案内)。一覧に無いファイルが割り当てられていたら警告。
    `audio.se.credits` スナップショットを §6.12 のとおり同期する。SE は intro でのみ鳴る旨を表示。
  - クレジット表示は `collectCredits(project, lang, voicevoxVoices, seFiles)`。
  - intro では「ポイントに割り当てる行が足りない」「情報カードの開始行が見つからない」などを注意表示してよい(テンプレートの規則は §5.8)。
- 保存は `PUT /api/projects/:id` に Project 全体(デバウンス)。サーバーが返した Project で state を置き換える
  (ただし編集中の入力を巻き戻さないよう注意。ポーリング結果と保存の競合は §6.2 のマージで server 側が吸収する)。

## 8. 動作確認の手順(参考)

1. `npm run dev` → `http://localhost:5173`
2. `curl http://localhost:3101/api/health` / `curl http://localhost:3101/api/tts/status`
3. `npm run studio` で AdVideo を単体確認(defaultProps は空プロジェクト)
4. [v3] テンプレートの静止画確認: `@remotion/renderer` の `renderStill`(bundle → selectComposition → renderStill)に
   `inputProps = { project: migrateProject(json), format, lang, assetBaseUrl, useProxy: false }` を渡す。
   素材は 3101 を使わず、自分で立てた静的サーバー(例: 3199、`/files/<pid>/<rel>` と `/api/projects/<pid>/sources/<sid>/original` を返す)から配信するとよい。
   hook-play-cta の出力は Phase 3 の再構成前後でピクセル一致を確認済み。
   [v4] 静的サーバーで `/api/se/file/<id>` も `D:\Tools\se` から返すとよい(静止画では音声は読まれない)。
   hook-play-cta / features / trailer の静止画は Phase 3.5 の共通部品変更(字幕の強調対応・SE)の前後でピクセル一致を確認済み。
5. [v4] SE の確認: `renderMedia({ codec: "wav" })` で音声だけ書き出せば速い(assetBaseUrl は SE を返せるサーバー)。
