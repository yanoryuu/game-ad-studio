# Game Ad Studio — アーキテクチャ / 実装契約 (Phase 2)

このドキュメントは `packages/compositions` / `apps/server` / `apps/web` を並行実装する際の **唯一の契約** です。
仕様の背景は `docs/SPEC.md` を参照。ここに書かれた名前・パス・型・URL は勝手に変えないこと。変更が必要なら実装せずに報告する。
Phase 2 で変わった/増えた箇所には **[v2]** を付けている。

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
      src/index.ts, project.ts, migrate.ts, api.ts
    compositions/         @gas/compositions Remotion コンポジション
  apps/
    server/               @gas/server  Express :3101
      src/index.ts        アプリ組み立て(Phase 1 ルート + Phase 2 ルートモジュール登録)
      src/store.ts        project.json の読み書き・ロック・updateProject・mergeServerOwned
      src/sources.ts      [v2] 非同期ソース登録(プロキシ生成)・起動時リカバリ
      src/config.ts       [v2] ツール設定
      src/media.ts        ffprobe / ffmpeg ヘルパ(probe, makeProxy, makeThumb, toolAvailable)
      src/errors.ts, files.ts, paths.ts, render.ts
      src/routes/analysis.ts [v2] registerAnalysisRoutes(app)   ← server-highlight
      src/analysis/**        [v2] 解析の実装                      ← server-highlight
      src/routes/tts.ts      [v2] registerTtsRoutes(app)         ← server-tts
      src/tts/**             [v2] TTS の実装                      ← server-tts
    web/                  @gas/web     Vite + React :5173
  projects/               実行時データ(git 管理外)
```

### 担当範囲(Phase 2、厳守)

| 担当 | 書いてよい場所 |
|---|---|
| server-highlight | `apps/server/src/analysis/**` と `apps/server/src/routes/analysis.ts` のみ |
| server-tts | `apps/server/src/tts/**` と `apps/server/src/routes/tts.ts` のみ |
| compositions | `packages/compositions/src/**` のみ |
| web | `apps/web/src/**` のみ |

- それ以外(`package.json` / `tsconfig*.json` / `vite.config.ts` / `packages/shared/**` / `docs/**` /
  `apps/server/src/` 直下のファイル / `.gitignore` / `gas.config*.json`)は誰も編集しない。必要な変更は報告する。
- server の 2 エージェントは直下のモジュール(`store.ts`, `errors.ts`, `media.ts`, `paths.ts`, `config.ts`, `files.ts`)を **import して使うだけ**。
  ffmpeg 実行ヘルパが足りなければ自分のフォルダ内に書く(`media.ts` の `run` は非 export)。
- `npm install` は禁止(依存は揃っている)。
- 完了条件: ルートで `npm run typecheck` が通ること。

## 2. ポート・オリジン

- server: `http://localhost:3101`(`SERVER_PORT`)。web(Vite dev): `http://localhost:5173`。`/api` と `/files` を 3101 にプロキシ。
  → web のコードは **常に相対 URL**(`/api/...`, `/files/...`)。
- server は `cors()` を有効にする(レンダリング時のヘッドレス Chrome 用)。

## 3. プロジェクトの保存形式

```
projects/<projectId>/
  project.json     Project(schemaVersion 2)
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

## 4. データモデル(`@gas/shared`, schemaVersion 2)

正は `packages/shared/src/project.ts`。要点:

```ts
Project = {
  schemaVersion: 2, id, name, createdAt, updatedAt,
  template, formats: Format[], durationSec: 15 | 30 | null, fps: 30 | 60, languages: Lang[],
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
  clips: { id, sourceId, inSec, outSec, slot: "hook" | "main", gameVolume: 0..1, focusX? }[],
  texts: { ja: { hook, cta }, en: { hook, cta } },
  script: ScriptLine[],                                                      // [v2]
  captions: { ja: Caption[], en: Caption[] },   // 手動/追加字幕(出力動画上の秒)。従来どおり
  audio: {                                                                   // [v2] v1 の top-level bgm を置換
    narrationVolume: 0..1,               // 既定 1
    gameVolumeUnderNarration: 0..1,      // 既定 0.35。ナレーション中、各 clip.gameVolume に掛ける倍率
    bgm?: { path, volume: 0..1, duckingDb: -60..0, fadeOutSec, loop: boolean },
  },
  style: {
    primaryColor, accentColor, font: "noto-sans-jp",
    watermark: { position: "top-left"|"top-right"|"bottom-left"|"bottom-right"|"none", scale: 0.25..3 },  // [v2] 既定 top-right, 1
    captions: { enabled: boolean, position: "bottom" | "center", size: "m" | "l" },                        // [v2] 既定 true, bottom, m
  },
}

ScriptLine = {                                 // [v2]
  id, lang, section: "hook" | "main" | "cta", text,
  voice: { engine: "voicevox" | "piper", speaker: string, speed: 0.5..2 },
     // VOICEVOX: style id を文字列で("3")。Piper: 声の名前(.onnx の basename)
  offsetSec: number >= 0,      // hook/cta: セクション開始からの遅延。main: この行の前に入れる追加の間
  audioPath?: "tts/<lineId>.wav", durationSec?: number,
  captions: { text, startSec, endSec }[],   // ★行の開始からの相対秒
  status: "none" | "ok" | "stale" | "error", error?,
  credit?: string,             // 合成時に server が設定。VOICEVOX は "VOICEVOX:<キャラ名>"。Piper は無し
}
```

- 任意フィールドは「キーが無い」で表現する(`null` 不可)。
- `script` 配列内で同じ (lang, section) の行の **配列順 = 再生順**。
- **status の規則**: `none` 未合成 / `ok` 現在の text+voice と音声が一致 / `stale` 合成後に text か voice が変わった /
  `error` 前回の合成失敗(`error` にメッセージ)。
  **web は `ok` または `error` の行の text / voice を変更したら必ず `status: "stale"` にする**(offsetSec の変更は stale にしない)。
  `stale` / `error` でも古い `audioPath` があればそのまま再生してよい。
- 定数・ヘルパ(`@gas/shared`):
  `DEFAULT_VOICES`(ja: `{ engine: "voicevox", speaker: "3", speed: 1 }` = ずんだもん(ノーマル)/ en: `{ engine: "piper", speaker: "en_US-lessac-medium", speed: 1 }`)、
  `DEFAULT_VOICEVOX_URL`、`DEFAULT_VOICEVOX_SPEAKER`、`DEFAULT_VOICEVOX_CREDIT` (`"VOICEVOX:ずんだもん"`)、`DEFAULT_PIPER_VOICE`、
  `DEFAULT_AUDIO`、`DEFAULT_BGM`(path 以外: volume 0.5, duckingDb -12, fadeOutSec 1.5, loop true)、`DEFAULT_STYLE`、
  `createScriptLine(lang, section, text?, id?)`、`collectCredits(project, lang?)`(必要なクレジット一覧)、
  `migrateProject(raw)`、`createDefaultProject(name, opts)`。
- **VOICEVOX のクレジット**: VOICEVOX の声を使った動画には「VOICEVOX:<キャラ名>」の表記が必要。
  web は `collectCredits(project, lang)` を書き出しパネル等に表示し、注意を促す。
- API 型: `packages/shared/src/api.ts`(Phase 1 の型 + [v2] `AddSourceResponse`, `AnalyzeStartResponse`,
  `TtsStatusResponse`, `TtsVoice`, `ttsVoicesQuerySchema`, `TtsSynthesizeRequest`, `TtsPreviewRequest`)。

### 4.1 v1 → v2 マイグレーション(`migrateProject`)
- `game.releaseText: string` → `{ ja: s, en: s }`
- `sources[]` に `proxyStatus: "ready"`, `analysisStatus: "none"` を追加
- `candidates`: v2 形式でないものは削除(v1 では常に空)
- `script`: v1 エントリは v2 行に変換(ja の speakerId → speaker 文字列、status "none"、音声は捨てる)
- `bgm` → `audio.bgm`(`loop: true` 追加)。`audio` の他項目は既定値
- `style.watermark` / `style.captions` に既定値

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
export const COMPOSITION_ID = "AdVideo";
```

- `calcAdMetadata` / `<AdVideo>` / `buildNarrationPlan` は同じタイムライン計算を共有し、必ず一致させる。
  `Root` の `calculateMetadata` は `calcAdMetadata(props.project, props.format, props.lang)`。
- web は `buildNarrationPlan(...).overflowLineIds` で「ナレーションが入りきらない」警告を出す。
- その他 Phase 1 の規則(OffthreadVideo、NotoSansJP、空プロジェクトで落ちない、未知 sourceId のクリップはスキップ)は継続。
- [v2] **`proxyStatus !== "ready"` のソースを参照するクリップは `useProxy=true`(プレビュー)では描画しない**(プロキシファイルがまだ無い)。
  レンダー(`useProxy=false`)は元動画を使うので描画してよい。尺計算はどちらでも同じにする(黒で埋める)。
- [v2] `game.releaseText[lang]` を表示。ウォーターマーク(main セクションのロゴ/タイトル)は `style.watermark.position` の角に
  `scale` 倍で表示、`"none"` なら非表示。

### 5.1 ナレーションのタイムライン規則 [v2](テンプレート `hook-play-cta`)

対象は `script` のうち `lang === props.lang`、`text.trim() !== ""`、`audioPath` と `durationSec` を持つ行(status が stale/error でも音声があれば使う)。

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

### 5.3 音声ミックスとダッキング [v2]
- **ナレーション**: `<Audio>` 音量 = `audio.narrationVolume`。
- **「ナレーション中」** = 再生中のいずれかのナレーション区間 [from, from + durationInFrames) に入っているフレーム。
- **ゲーム音**: クリップ音量 = `clip.gameVolume × (ナレーション中 ? audio.gameVolumeUnderNarration : 1)`。
- **BGM**(`audio.bgm` があるとき): 基本音量 `bgm.volume`、ナレーション中は `× 10^(duckingDb/20)`。
  `loop: true` なら動画全体をループで埋め、false なら 1 回だけ。末尾 `fadeOutSec` でフェードアウト(先頭は短いフェードイン可)。
- ダッキングの切り替えは急変させず、前後 ~0.2 秒(`Math.round(0.2*fps)` フレーム)で補間する。
- 音量は Remotion の `volume` コールバック(フレーム関数)で実装する。

## 6. Server HTTP API(`@gas/server`, port 3101)

- JSON API。エラーは常に `{ error: string }` + ステータス(400 / 404 / 409 / 500 / 501 / 503)。
- リクエストボディは `@gas/shared` の zod スキーマで検証(`parseBody` in `errors.ts`)。

| Method | Path | Body | レスポンス |
|---|---|---|---|
| GET | `/api/health` | — | `HealthResponse` |
| GET | `/api/projects` | — | `ProjectSummary[]` |
| POST | `/api/projects` | `{ name }` | 201 `Project` |
| GET | `/api/projects/:id` | — | `Project`(v2 に migrate 済み) |
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

### 6.1 ソース登録 [v2: 非同期]
1. path の存在確認(無ければ 400)→ ffprobe(読めなければ 400)。durationSec/fps/width/height/hasAudio はこの時点で確定。
2. `sources` に `proxyStatus: "pending"`, `analysisStatus: "none"` で追加して保存し、**201 で Project を即返す**。
3. バックグラウンドでプロキシ(Phase 1 と同じ ffmpeg 引数、同時 2 本まで)+ サムネイルを生成し、
   `updateProject` で `proxyStatus: "ready"`(または `"error"` + `proxyError`)に更新。
4. web は pending のソースがある間 `GET /api/projects/:id` を ~1.5 秒間隔でポーリングする。
- サーバー起動時: pending のまま残ったソースはプロキシを作り直し、`analysisStatus: "running"` のまま残ったものは `"error"`("Interrupted")にする(`sources.ts` の `recoverInterruptedJobs`)。

### 6.2 PUT のマージ規則(`store.ts` の `mergeServerOwned`)[v2]
web のデバウンス保存が、バックグラウンド処理の結果を古いスナップショットで上書きしないように:
- `sources`: web は **削除と並べ替えのみ** 可。サーバーが知らないソースは捨てる。各ソースの全フィールドは保存済みの値を使う。
- `candidates`: 一覧は保存済みの値(残っているソースのもの)。`adopted` だけ body の値を採用。
- `script`: body が正。ただし text・voice・lang が保存済みと同じで、保存済みが `ok`・body が `ok` 以外の行は、保存済みの合成結果
  (audioPath, durationSec, captions, status, credit)を残す。
- web はさらに: TTS(`POST /tts`)を呼ぶ前に保留中の保存を flush し、応答の Project で state を置き換える。

### 6.3 アセットアップロード
- 画像(png/jpg/jpeg/webp/gif/svg)+ **音声(mp3/wav/m4a/ogg/aac)** を許可。BGM は upload → `audio.bgm.path` に設定して PUT。

### 6.4 共有ヘルパ(route モジュールが使うもの)
- `store.ts`:
  - `updateProject(id, mutate)` — **ロック付き read(migrate 済み)→ mutate → 検証 → 原子的 write**。保存後の Project を返す。
    mutate 内で throw すると書き込まずに中断。**長い処理(ffmpeg・TTS)はロックの外で行い、結果だけ updateProject で書く。**
  - `readProject(id)`(404 は HttpError)、`projectExists(id)`、`assertSafeId(id, what?)`、`withProjectLock(id, fn)`。
- `errors.ts`: `HttpError(status, msg)`, `badRequest`, `notFound`, `parseBody(schema, body)`。
- `paths.ts`: `projectDir(id)`, `REPO_ROOT`。 `media.ts`: `probe(file)`, `toolAvailable("ffmpeg"|"ffprobe")`。
- `config.ts`: `config`, `resolveVoicevoxEnginePath()`(§6.8)。
- ルート関数シグネチャ(固定): `export function registerAnalysisRoutes(app: Express): void` / `export function registerTtsRoutes(app: Express): void`
  (`import type { Express } from "express"`)。index.ts が `/files` の後・404 ハンドラの前で呼ぶ。現在はスタブ(501)。

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

### 6.6 TTS [v2](server-tts)
- `GET /api/tts/status` → `TtsStatusResponse`:
  `voicevox: { ok, version?, url, error? }`(`GET <url>/version`)、`piper: { ok, error? }`(exe と既定声の存在)、`whisper: { ok, model, error? }`(whisper.cpp とモデルの存在)。
  status は副作用なし(エンジン自動起動はしない)。
- `GET /api/tts/voices?engine=voicevox|piper` → `TtsVoice[]` `{ engine, speaker, name, lang, credit? }`。
  VOICEVOX: `/speakers` の各 style を 1 件に(speaker = style id 文字列、name = "キャラ名(スタイル名)"、lang "ja"、credit "VOICEVOX:キャラ名")。
  Piper: voicesDir の `*.onnx`(name = basename、lang は `.onnx.json` の language から、en 以外は除外してよい)。
  エンジンが使えなければ 503。
- `POST /api/projects/:id/tts` body `{ lang, lineIds? }` → **200 Project(同期)**。
  - 対象: lineIds 省略時は `lang` の行で text が空でなく status が `ok` 以外のもの。指定時はその行(`lang` が違う行は 400)。
  - text が空の行は音声を消して status `"none"`。
  - 各行: 合成 → `tts/<lineId>.wav`(上書き)→ `audioPath`, `durationSec`(wav の実長)、`captions`(行頭からの相対秒)、
    `status: "ok"`、`error` 削除、`credit` 設定。失敗した行は `status: "error"` + `error`(要求全体は 200)。
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
  whisper:  { dir: "D:\\Tools\\whisper", model: "base.en" },
}
resolveVoicevoxEnginePath(): Promise<string | null>
  // enginePath があればそれ(存在しなければ null)。無ければ D:\Tools\voicevox 以下の run.exe を探す
  // (深さ 3、結果キャッシュ)。既定で D:\Tools\voicevox\windows-cpu\run.exe が見つかる。
```

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
- 保存は `PUT /api/projects/:id` に Project 全体(デバウンス)。サーバーが返した Project で state を置き換える
  (ただし編集中の入力を巻き戻さないよう注意。ポーリング結果と保存の競合は §6.2 のマージで server 側が吸収する)。

## 8. 動作確認の手順(参考)

1. `npm run dev` → `http://localhost:5173`
2. `curl http://localhost:3101/api/health` / `curl http://localhost:3101/api/tts/status`
3. `npm run studio` で AdVideo を単体確認(defaultProps は空プロジェクト)
