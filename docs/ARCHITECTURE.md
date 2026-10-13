# Game Ad Studio — アーキテクチャ / 実装契約 (Phase 1)

このドキュメントは `packages/compositions` / `apps/server` / `apps/web` を並行実装する際の **唯一の契約** です。
仕様の背景は `docs/SPEC.md` を参照。ここに書かれた名前・パス・型・URL は勝手に変えないこと。変更が必要なら実装せずに報告する。

---

## 0. 環境・バージョン

- Windows 11 / Node 20.12.2 / npm 10.5 / ffmpeg・ffprobe は PATH 上
- npm workspaces モノレポ。**依存はすべてインストール済み**。`npm install` やパッケージ追加はしない(必要なら報告)。
- 固定バージョン(すべて exact pin)

| パッケージ | バージョン |
|---|---|
| remotion / @remotion/* (player, bundler, renderer, cli, google-fonts, media-utils) | 4.0.535 |
| react / react-dom | 19.3.0 |
| zod | 4.3.6(v4。`import { z } from "zod"`) |
| express | 5.3.0(Express 5: async ハンドラの reject は自動で error handler へ。パスのワイルドカードは `/*path` 形式) |
| multer | 2.4.0 |
| nanoid | 5.1.16(ESM only) |
| cors | 2.8.6 |
| vite | 6.4.4(Node 20.12 のため 7 系は不可) / @vitejs/plugin-react 4.7.0 |
| tsx | 4.23.15 / typescript 5.9.3 |

- TypeScript: `tsconfig.base.json`(strict, ES2022, moduleResolution "bundler", jsx "react-jsx", noEmit)。
  全パッケージ `"type": "module"`。import は拡張子なし(`./foo`)。
- `@gas/shared` と `@gas/compositions` はビルドせず **TS ソースのまま** 消費する(`exports` → `./src/index.ts`)。
  server は tsx、web は Vite、レンダリングは @remotion/bundler(webpack + esbuild)がそれぞれ TS を直接変換する。

## 1. ディレクトリ構成

```
game-ad-studio/
  package.json            ルート(workspaces, scripts: dev / typecheck / studio)
  tsconfig.base.json
  docs/SPEC.md, docs/ARCHITECTURE.md
  packages/
    shared/               @gas/shared       zod スキーマ + 型 + API 型   (scaffold 所有。変更禁止)
      src/index.ts, project.ts, api.ts
    compositions/         @gas/compositions Remotion コンポジション
      src/index.ts        公開 API(§5)
      src/entry.ts        registerRoot(Root)  ← server が bundle する
      src/Root.tsx        <Composition id="AdVideo" calculateMetadata=…>
      src/AdVideo.tsx, metadata.ts, urls.ts, constants.ts (+ 自由に追加)
  apps/
    server/               @gas/server  Express :3101
      src/index.ts, src/paths.ts (+ 自由に追加)
    web/                  @gas/web     Vite + React :5173
      index.html, vite.config.ts, src/main.tsx, src/App.tsx (+ 自由に追加)
  projects/               実行時データ(git 管理外。サーバーが作る)
```

### 担当範囲(厳守)

| 担当 | 書いてよい場所 |
|---|---|
| compositions エージェント | `packages/compositions/src/**` のみ |
| server エージェント | `apps/server/src/**` のみ |
| web エージェント | `apps/web/src/**` と `apps/web/index.html` のみ |

- `package.json` / `tsconfig*.json` / `vite.config.ts` / `packages/shared/**` / `docs/**` は誰も編集しない。必要な変更は報告する。
- 完了条件: ルートで `npm run typecheck` が通ること。

### ルートスクリプト

- `npm run dev` … server (`tsx watch src/index.ts`) と web (`vite`) を concurrently で同時起動
- `npm run typecheck` … 全 workspace で `tsc -p tsconfig.json`
- `npm run studio` … `remotion studio packages/compositions/src/entry.ts`

## 2. ポート・オリジン

- server: `http://localhost:3101`(`SERVER_PORT` が `@gas/shared` にある)
- web(Vite dev): `http://localhost:5173`。`/api` と `/files` を `http://localhost:3101` にプロキシ(vite.config.ts 設定済み)。
  → web のコードは **常に相対 URL**(`/api/...`, `/files/...`)で叩く。
- server は `cors()` を有効にする(レンダリング時のヘッドレス Chrome から `http://localhost:3101` を読むため)。

## 3. プロジェクトの保存形式

```
projects/<projectId>/
  project.json     Project(@gas/shared の projectSchema)を JSON.stringify(p, null, 2)
  proxies/         <sourceId>.mp4      720p 30fps H.264 + AAC
  thumbs/          <sourceId>.jpg
  assets/          アップロード画像など <nanoid>.<ext>
  renders/         書き出し結果 .mp4
```

- `projects/` の場所: `<repo>/projects`(環境変数 `GAS_PROJECTS_DIR` で上書き可)。`apps/server/src/paths.ts` 参照。
- ID: プロジェクト `p_<nanoid(10)>`、ソース `src_<nanoid(8)>`、クリップ `clip_<nanoid(8)>`。
  英数と `_` `-` のみ(`projectSchema` が id を検証)。`@gas/shared` の `generateId(prefix)` を使ってもよい。
- **アセット参照の規約**: project.json に入るパスは **プロジェクトディレクトリからの相対パス、区切りは `/`**
  (例 `"proxies/src_ab12cd34.mp4"`, `"assets/k3j2h4.png"`)。`assetRefSchema` が先頭 `/`・`\`・ドライブ文字・`..` を拒否する。
- 例外: `sources[].originalPath` だけは **元動画の絶対ローカルパス**(プロジェクト外。コピーしない)。

## 4. データモデル(`@gas/shared`)

正は `packages/shared/src/project.ts`。要点のみ:

```ts
Format = "16:9" | "9:16";   FORMAT_SIZE["16:9"] = {1920,1080}, ["9:16"] = {1080,1920}
Lang = "ja" | "en";  Fps = 30 | 60;  TemplateId = "hook-play-cta" | "features" | "trailer"
Project = {
  schemaVersion: 1, id, name, createdAt, updatedAt,          // ISO 文字列
  template, formats: Format[], durationSec: 15 | 30 | null, fps, languages: Lang[],
  game: { title, logo?, keyArt?, releaseText, steamUrl?, platforms: string[] },   // logo/keyArt はアセット参照
  sources: { id, originalPath, proxyPath, thumbPath, durationSec, fps, width, height, hasAudio }[],
  candidates: { id, sourceId, startSec, endSec, score, thumbPath? }[],   // Phase 2(Phase 1 は常に [])
  clips: { id, sourceId, inSec, outSec, slot: "hook" | "main", gameVolume: 0..1, focusX?: 0..1 }[],
  texts: { ja: { hook, cta }, en: { hook, cta } },   // cta 既定 "ウィッシュリストに追加" / "Wishlist now on Steam"
  script: ScriptEntry[],                             // Phase 2(Phase 1 は [])
  captions: { ja: Caption[], en: Caption[] },        // Caption = { text, startSec, endSec }(出力動画上の秒)。Phase 1 は空でよい
  bgm?: { path, volume, duckingDb, fadeOutSec },
  style: { primaryColor, accentColor, font: "noto-sans-jp" },
}
```

- `createDefaultProject(name, { id?, now? })` で既定値つきの Project を作る。
- `projectSchema.parse(x)` で検証。サーバーは読み込み時・PUT 時に必ず parse する。
- `clips` の配列順 = 各 slot 内の再生順。`inSec/outSec` は **ソース動画上の秒**(プロキシと元動画は同じ時間軸)。
- 任意フィールド(`logo` など)は「キーが無い」で表現する(`null` は不可)。
- API の入出力型(`CreateProjectRequest`, `AddSourceRequest`, `UploadAssetResponse`, `RenderRequest`,
  `RenderStartResponse`, `RenderJob`, `RenderStatus`, `ProjectSummary`, `HealthResponse`, `ApiError`)と zod スキーマは
  `packages/shared/src/api.ts`。

## 5. Compositions パッケージ API(`@gas/compositions`)

`packages/compositions/src/index.ts` から以下を export する(シグネチャ固定):

```ts
export type AdVideoProps = {        // interface ではなく type(Remotion の Record<string, unknown> 制約のため)
  project: Project;
  format: Format;
  lang: Lang;
  assetBaseUrl: string;             // プレビュー: ""  /  レンダー: "http://localhost:3101"
  useProxy: boolean;                // プレビュー: true /  レンダー: false
};
export const AdVideo: React.FC<AdVideoProps>;
export function calcAdMetadata(project: Project, format: Format, fps?: Fps):
  { durationInFrames: number; fps: number; width: number; height: number };
export function assetUrl(baseUrl: string, projectId: string, relPath: string): string;
  // => `${baseUrl}/files/${projectId}/${relPath}`(セグメントごとに encodeURIComponent)
export function sourceUrl(baseUrl: string, project: Project, sourceId: string, useProxy: boolean): string;
  // useProxy=true  => assetUrl(baseUrl, project.id, source.proxyPath)
  // useProxy=false => `${baseUrl}/api/projects/${project.id}/sources/${sourceId}/original`
export const COMPOSITION_ID = "AdVideo";
```

- `index.ts` は `entry.ts` を import しない(registerRoot の副作用を web/server に持ち込まない)。
- `entry.ts`: `registerRoot(Root)`。`Root` は `<Composition id="AdVideo" component={AdVideo} defaultProps=… calculateMetadata={({props}) => calcAdMetadata(props.project, props.format)} />`。
  `calculateMetadata` は `props.project.fps` を使う(fps 上書きは server が project.fps を書き換えて渡す。§6.6)。
- `calcAdMetadata` の尺と `AdVideo` の描画タイムラインは必ず一致させる(同じタイムライン計算関数を共有すること)。
- ビデオは `OffthreadVideo`(remotion)推奨: Player では `<video>` にフォールバックし、レンダー時は元動画のコーデック(mkv 等)も扱える。
  `startFrom`/`trimBefore` 相当で `inSec` から再生、`volume = clip.gameVolume`。
- フォント: `@remotion/google-fonts/NotoSansJP` の `loadFont()`(モジュールトップで呼ぶ)。
- 画像: `Img` + `assetUrl(assetBaseUrl, project.id, ref)`。
- 空のプロジェクト(clips/sources なし、logo なし、テキスト空)でも例外を出さず描画できること(Studio/Player で必ず開ける)。
- 存在しない sourceId を参照するクリップはスキップ(`sourceUrl` は throw するので事前に確認)。

### テンプレート `hook-play-cta`(Phase 1 で実装する唯一のテンプレート)

| セクション | 長さ(目安) | 内容 |
|---|---|---|
| hook | 2.5 秒 | `slot:"hook"` のクリップ(順に連結)+ 大きな `texts[lang].hook` |
| main | 残り | `slot:"main"` のクリップを順にカットで連結 |
| end card | 3 秒 | keyArt(背景)/ logo(無ければ title を大きく)、`game.title`、`game.releaseText`、`texts[lang].cta`、`game.platforms`("Steam" 表記) |

- `durationSec === null`(自由): main は各クリップの自然長(`outSec - inSec`)の合計。hook も hook クリップの合計を 2.5 秒にトリム(hook クリップが無ければ main 先頭を流用、それも無ければ黒+テキスト)。
- `durationSec` が 15 / 30: 全体をちょうど `durationSec * fps` フレームにする。main の尺 = 全体 − hook − end card を、各 main クリップへ自然長に比例して配分(長ければトリム=`outSec` 側を詰める、短ければ速度は変えずに最後のフレームで保持 or 比例配分の結果として各クリップを均等に縮める — いずれも compositions の裁量)。
- 字幕(`captions[lang]`)が空でなければ下部に表示(Phase 1 は空で可)。
- 9:16 は Phase 3。ただし `format` に応じて `FORMAT_SIZE` の解像度で崩れない最低限のレイアウトにはしておく(映像は contain + ぼかし背景が理想)。

## 6. Server HTTP API(`@gas/server`, port 3101)

- JSON API。エラーは常に `{ error: string }` + 適切なステータス(400 検証エラー / 404 無し / 500)。
- リクエストボディは `@gas/shared` の zod スキーマで検証する。

| Method | Path | Body | 200 レスポンス |
|---|---|---|---|
| GET | `/api/health` | — | `HealthResponse` `{ ok: true, ffmpeg: boolean, ffprobe: boolean }` |
| GET | `/api/projects` | — | `ProjectSummary[]`(updatedAt 降順) |
| POST | `/api/projects` | `CreateProjectRequest` `{ name }` | `Project`(201 でも可)。`createDefaultProject` で生成し保存、ディレクトリ作成 |
| GET | `/api/projects/:id` | — | `Project` |
| PUT | `/api/projects/:id` | `Project`(全体) | `Project`(保存後。`updatedAt` はサーバーが更新、`id`/`createdAt` は URL/既存値を優先) |
| POST | `/api/projects/:id/sources` | `AddSourceRequest` `{ path }`(絶対パス) | 更新後の `Project` |
| GET | `/api/projects/:id/sources/:sourceId/original` | — | 元動画(Range 対応) |
| POST | `/api/projects/:id/assets` | multipart, field `"file"` | `UploadAssetResponse` `{ path: "assets/<nanoid>.<ext>" }`(project.json は変更しない。web が PUT で参照を書く) |
| GET | `/files/:projectId/*path` | — | プロジェクトディレクトリ内のファイル(Range 対応) |
| POST | `/api/projects/:id/render` | `RenderRequest` `{ format, lang, fps? }` | `RenderStartResponse` `{ jobId }` |
| GET | `/api/render/:jobId` | — | `RenderJob` `{ jobId, projectId, format, lang, status, progress, outputPath?, error? }` |

### 6.1 ソース登録 `POST /api/projects/:id/sources`
1. `path` の存在確認(無ければ 400)。
2. `ffprobe -v error -print_format json -show_streams -show_format <path>` → durationSec, fps(`r_frame_rate` / `avg_frame_rate` を数値化), width, height, hasAudio。
3. プロキシ生成(同期で完了を待ってからレスポンス。長尺は時間がかかるので web はローディング表示):
   `ffmpeg -y -i <in> -vf "scale=-2:720,fps=30" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -ac 2 -ar 48000 -movflags +faststart proxies/<sid>.mp4`
   (音声なしなら `-an`。720p 未満の素材は拡大しない: `scale=-2:'min(720,ih)'`)
4. サムネイル: `ffmpeg -y -ss <min(1, dur/2)> -i <in> -frames:v 1 -vf scale=-2:360 thumbs/<sid>.jpg`
5. `sources` に追加して保存、Project を返す。
- ffmpeg/ffprobe は `child_process.spawn`(shell なし、引数配列)。Windows パスの空白・日本語に注意。

### 6.2 ファイル配信(Range)
- `/files/:projectId/*path` と `/sources/:sid/original` はどちらも HTTP Range(206, `Accept-Ranges: bytes`, `Content-Range`)に対応。
  `res.sendFile(absPath)` は Range 対応済みなので利用してよい(`/files` は root オプションまたは手動検証で **プロジェクトディレクトリ外へのトラバーサルを拒否**)。
- Content-Type は拡張子から(mp4/mov/mkv/webm/jpg/png/webp/mp3/wav)。

### 6.3 アセットアップロード
- multer で `projects/<id>/assets/<nanoid(10)><ext小文字>` に保存。画像(png/jpg/jpeg/webp/gif/svg)+ 音声(mp3/wav/m4a/ogg、Phase 2 の BGM 用)を許可。

### 6.4 レンダリング
- `bundle({ entryPoint: COMPOSITIONS_ENTRY })`(`apps/server/src/paths.ts`。`<repo>/packages/compositions/src/entry.ts`)。
  bundle はプロセス内でキャッシュして再利用してよい(初回 ~15 秒)。
- `inputProps: AdVideoProps = { project, format, lang, assetBaseUrl: "http://localhost:3101", useProxy: false }`。
- `selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps })` → `renderMedia({ composition, serveUrl, codec: "h264", outputLocation, inputProps, onProgress })`。
- 出力: `projects/<id>/renders/<YYYYMMDD-HHmmss>_<16x9|9x16>_<lang>.mp4`、`outputPath` は project 相対(`renders/...`)。
  web は `/files/<pid>/<outputPath>` でダウンロード/再生する。
- ジョブはメモリ上に保持、同時実行 1(キュー)。status: `queued` → `bundling` → `rendering`(progress 0..1)→ `done` / `error`。
- ヘッドレス Chrome は初回レンダー時に Remotion が自動ダウンロードする(事前操作不要)。
- `fps` 指定時は `project` を複製して `project.fps = fps` にして渡す(AdVideoProps に fps は無い)。
- Phase 1 の UI は 16:9 のみ書き出すが、API は 9:16 も受け付ける。

### 6.5 その他
- `express.json({ limit: "10mb" })`、`cors()`。
- `__dirname` は無い(ESM)。`paths.ts` の `REPO_ROOT` / `PROJECTS_DIR` / `projectDir()` を使う。
- project.json の書き込みは一時ファイル → rename で原子的に。

## 7. Web(`@gas/web`, Vite :5173)

- API は相対 URL(`/api/...`)。型は `@gas/shared` から import。
- プレビュー: `@remotion/player` の `<Player component={AdVideo} inputProps={{ project, format, lang, assetBaseUrl: "", useProxy: true }} {...calcAdMetadata(project, format)} />`
  (`durationInFrames`, `fps`, `compositionWidth=width`, `compositionHeight=height` を渡す)。`inputProps` は `useMemo` で安定させる。
- 画像/サムネは `assetUrl("", project.id, rel)`、ソース動画は `sourceUrl("", project, sid, true)`。
- Phase 1 の画面(最低限): プロジェクト一覧/作成 → 編集画面(ソース追加: 絶対パス入力 / ゲーム情報・ロゴ・キーアートのアップロード / hook・CTA テキスト(言語タブ)/ クリップ追加・in/out・slot・並べ替え・gameVolume / 尺・fps 選択 / Player プレビュー / 16:9 書き出しボタン+進捗ポーリング(`GET /api/render/:jobId` を 1 秒間隔)+ 完了後のリンク)。
- 保存は `PUT /api/projects/:id` に Project 全体(デバウンス保存推奨)。サーバーが返した Project で state を置き換える。

## 8. 動作確認の手順(参考)

1. `npm run dev` → `http://localhost:5173`
2. `curl http://localhost:3101/api/health`
3. `npm run studio` で AdVideo を単体確認(defaultProps は空プロジェクト)
