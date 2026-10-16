import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  BGM_MOODS,
  formatSchema,
  fpsSchema,
  isStillImageSource,
  type BgmListResponse,
  type Format,
  type HealthResponse,
  type Lang,
  type ProjectSummary,
  type RenderJob,
  type RenderListResponse,
  type SeListResponse,
  type TtsStatusResponse,
  type TtsVoice,
} from "@gas/shared";
import { ApiError, ApiUnreachableError, apiGet, enc } from "./api";
import { ensureServer, SERVER_LOG } from "./autostart";
import { API_BASE, log, REPO_ROOT } from "./env";
import { draftScript, draftTemplateData, sellingPoints } from "./heuristics";
import {
  addSources,
  applyScript,
  autoClips,
  buildClip,
  createProject,
  defaultTimes,
  hasUnsynthesized,
  jobReport,
  renderStills,
  scriptReport,
  setAudio,
  setClips,
  setTemplateData,
  startRender,
  startRenderBatch,
  synthesize,
  waitRender,
  applySettings,
  type Progress,
} from "./ops";
import { editProject, getProject, projectDirOf, summarizeProject, timelineOf } from "./project";
import { templateCatalog } from "./templates";
import { applyTemplateData, langInput, templateDataInput, templateIdInput } from "./templateEdit";

/* ------------------------------------------------------------------ */
/* Plumbing                                                             */
/* ------------------------------------------------------------------ */

type Extra = {
  _meta?: { progressToken?: string | number };
  sendNotification: (n: { method: "notifications/progress"; params: { progressToken: string | number; progress: number; total?: number; message?: string } }) => Promise<void>;
};

function progressOf(extra: Extra, tool: string): Progress {
  let n = 0;
  return (message) => {
    log(`${tool}: ${message}`);
    const token = extra._meta?.progressToken;
    if (token === undefined) return;
    void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++n, message } }).catch(() => {});
  };
}

const json = (obj: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 1) }] });

function errorResult(tool: string, e: unknown): CallToolResult {
  let msg = e instanceof Error ? e.message : String(e);
  if (e instanceof ApiError) {
    const hint =
      e.status === 404
        ? " -> check the id (list_projects / get_project / get_candidates)."
        : e.status === 409
          ? " -> the resource is busy or not ready yet (wait and retry, or check get_project)."
          : e.status === 503
            ? " -> an engine is unavailable (get_status shows TTS engines)."
            : "";
    msg = `API ${e.method} ${e.urlPath} failed (${e.status}): ${e.message}${hint}`;
  } else if (e instanceof ApiUnreachableError) {
    msg = `${e.message}. The server may have stopped; see ${SERVER_LOG} or start it with start.ps1.`;
  }
  log(`${tool} failed: ${msg}`);
  return { isError: true, content: [{ type: "text", text: `${tool} failed: ${msg}` }] };
}

type Handler<A> = (args: A, extra: Extra) => Promise<CallToolResult>;

function tool<S extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  config: { title: string; description: string; input: S; readOnly?: boolean; destructive?: boolean },
  handler: Handler<z.infer<z.ZodObject<S>>>,
) {
  server.registerTool(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.input as never,
      annotations: { readOnlyHint: !!config.readOnly, destructiveHint: !!config.destructive, openWorldHint: false },
    },
    (async (args: z.infer<z.ZodObject<S>>, extra: Extra) => {
      try {
        await ensureServer();
        return await handler(args, extra);
      } catch (e) {
        return errorResult(name, e);
      }
    }) as never,
  );
}

const projectId = z.string().min(1).describe("project id (p_xxxx), see list_projects");
const formatIn = formatSchema.describe('"16:9" (1920x1080) or "9:16" (1080x1920)');
const r2 = (n: number) => Math.round(n * 100) / 100;

async function firstFormatLang(id: string, format?: Format, lang?: Lang) {
  const p = await getProject(id);
  return { p, format: format ?? p.formats[0] ?? "16:9", lang: lang ?? p.languages[0] ?? "ja" };
}

/* ------------------------------------------------------------------ */
/* Tools                                                                */
/* ------------------------------------------------------------------ */

export function registerTools(server: McpServer) {
  /* ---------------- A. status / catalog ---------------- */

  tool(
    server,
    "get_status",
    {
      title: "Status / 状態確認",
      description:
        "Game Ad Studio の状態: API サーバー (自動起動)、ffmpeg/ffprobe、TTS エンジン (VOICEVOX / Piper / whisper)。includeVoices=true で声の一覧 (VOICEVOX は未起動なら起動します)。\n" +
        "API health (auto-starts the API server if it is down), ffmpeg presence, TTS engine status; optional voice list.",
      input: { includeVoices: z.boolean().optional().describe("also list TTS voices (may start VOICEVOX)") },
      readOnly: true,
    },
    async ({ includeVoices }) => {
      const health = await apiGet<HealthResponse>("/api/health");
      const tts = await apiGet<TtsStatusResponse>("/api/tts/status");
      const out: Record<string, unknown> = {
        api: { url: API_BASE, ok: health.ok, repo: REPO_ROOT, autoStartLog: SERVER_LOG },
        ffmpeg: health.ffmpeg,
        ffprobe: health.ffprobe,
        tts,
      };
      if (includeVoices) {
        const voices: Record<string, unknown> = {};
        for (const engine of ["voicevox", "piper"] as const) {
          try {
            const v = await apiGet<TtsVoice[]>(`/api/tts/voices?engine=${engine}`);
            voices[engine] = v.map((x) => ({ speaker: x.speaker, name: x.name, lang: x.lang, ...(x.credit ? { credit: x.credit } : {}) }));
          } catch (e) {
            voices[engine] = { error: (e as Error).message };
          }
        }
        out.voices = voices;
      }
      return json(out);
    },
  );

  tool(
    server,
    "list_templates",
    {
      title: "Templates / テンプレート一覧",
      description:
        "全 15 テンプレートの id・日本語名・説明・クリップスロット (hook/main) の意味・設定フィールドの意味 (set_template_data のキー)。\n" +
        "All 15 template ids with Japanese name/description, clip-slot meanings and template field meanings.",
      input: {},
      readOnly: true,
    },
    async () => json(templateCatalog()),
  );

  tool(
    server,
    "list_projects",
    {
      title: "Projects / プロジェクト一覧",
      description: "プロジェクト一覧 (新しい順)。List projects (newest first): id, name, template, updatedAt.",
      input: {},
      readOnly: true,
    },
    async () => {
      const list = await apiGet<ProjectSummary[]>("/api/projects");
      return json(list.map((p) => ({ id: p.id, name: p.name, template: p.template, updatedAt: p.updatedAt })));
    },
  );

  tool(
    server,
    "get_project",
    {
      title: "Project summary / プロジェクト概要",
      description:
        "プロジェクトの要約: テンプレート・形式・尺/構成 (言語別の秒数)・素材・クリップ・台本 (合成状態)・テンプレート設定・スタイル・音声・警告。full=true で project.json そのもの。\n" +
        "Compact project summary (timeline per language, sources, clips, script lines with TTS status, warnings). full=true returns the raw project JSON.",
      input: { projectId, full: z.boolean().optional().describe("return the raw project JSON") },
      readOnly: true,
    },
    async ({ projectId: id, full }) => {
      const p = await getProject(id);
      return json(full ? p : await summarizeProject(p));
    },
  );

  tool(
    server,
    "list_bgm",
    {
      title: "BGM library / BGM 一覧",
      description:
        `BGM ライブラリ (D:\\Tools\\bgm 等) の曲: id・長さ・ムードタグ・クレジット。mood で絞り込み (${BGM_MOODS.map((m) => `${m.id}=${m.label}`).join(", ")})。set_audio の bgmLibraryId に id を渡す。\n` +
        "BGM library tracks (id, duration, mood tags, credit). Pass an id to set_audio.bgmLibraryId.",
      input: {
        mood: z.string().optional().describe("mood tag filter, e.g. upbeat / chill / epic"),
        query: z.string().optional().describe("substring of the file name / id"),
      },
      readOnly: true,
    },
    async ({ mood, query }) => {
      const lib = await apiGet<BgmListResponse>("/api/bgm");
      const q = query?.toLowerCase();
      const files = lib.files
        .filter((f) => !mood || f.tags.includes(mood as never))
        .filter((f) => !q || f.id.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
        .map((f) => ({ id: f.id, durationSec: r2(f.durationSec), tags: f.tags, ...(f.credit ? { credit: f.credit } : {}), ...(f.source ? { source: f.source } : {}) }));
      return json({ dir: lib.dir, exists: lib.exists, total: lib.files.length, files });
    },
  );

  tool(
    server,
    "list_se",
    {
      title: "SE library / 効果音一覧",
      description:
        "効果音ライブラリのファイル (id・長さ・クレジット)。スロット: captionPop / headline / point / info / transition / cta (set_audio の seSlots)。SE は intro とショート系テンプレートだけで鳴ります。\n" +
        "Sound-effect library files; assign them to slots with set_audio.seSlots.",
      input: {},
      readOnly: true,
    },
    async () => {
      const lib = await apiGet<SeListResponse>("/api/se");
      return json({ dir: lib.dir, exists: lib.exists, files: lib.files.map((f) => ({ id: f.id, durationSec: r2(f.durationSec), ...(f.credit ? { credit: f.credit } : {}) })) });
    },
  );

  /* ---------------- B. editing ---------------- */

  const settingsInput = {
    template: templateIdInput.optional(),
    formats: z.array(formatIn).min(1).optional().describe('output formats, e.g. ["9:16"]'),
    languages: z.array(langInput).min(1).optional().describe('e.g. ["ja"] or ["ja","en"]'),
    durationSec: z.union([z.literal(15), z.literal(30), z.null()]).optional().describe("15 / 30 / null = free (fits narration & clips)"),
    fps: fpsSchema.optional().describe("30 (default) or 60"),
    gameTitle: z.string().optional().describe("game title (end card, watermark)"),
    releaseText: z.union([z.string(), z.object({ ja: z.string().optional(), en: z.string().optional() })]).optional().describe("e.g. 2026年冬 発売予定 (string = first language)"),
    platforms: z.array(z.string()).optional().describe('e.g. ["Steam"]'),
    steamUrl: z.string().optional(),
  };

  tool(
    server,
    "create_project",
    {
      title: "Create project / プロジェクト作成",
      description:
        "新しいプロジェクトを作成 (テンプレート・形式・言語・尺・ゲーム情報)。次は add_sources → get_candidates → set_clips → set_template_data → set_script → set_audio → preview_frames → render。\n" +
        "Create a project. Typical flow: add_sources, get_candidates, set_clips, set_template_data, set_script, set_audio, preview_frames, render (or make_ad for everything at once).",
      input: { name: z.string().min(1), ...settingsInput, template: templateIdInput },
    },
    async (a) => {
      const p = await createProject(a);
      return json({ projectId: p.id, dir: projectDirOf(p.id), template: p.template, formats: p.formats, languages: p.languages, durationSec: p.durationSec });
    },
  );

  tool(
    server,
    "update_project",
    {
      title: "Project settings / 基本設定の変更",
      description: "名前・テンプレート・形式・言語・尺・fps・ゲーム情報 (タイトル・発売情報・プラットフォーム・Steam URL) を変更。Change basic project settings.",
      input: { projectId, name: z.string().min(1).optional(), ...settingsInput },
    },
    async ({ projectId: id, ...s }) => {
      const p = await editProject(id, (p) => applySettings(p, s));
      return json(await summarizeProject(p));
    },
  );

  tool(
    server,
    "add_sources",
    {
      title: "Add footage / 素材の追加",
      description:
        "ローカルの動画・画像 (絶対パス) をプロジェクトに取り込む (既定: Web のドラッグ&ドロップと同じく projects/<id>/media にコピー)。動画はプロキシ生成後に見どころ解析を自動で開始。wait=true なら解析完了まで待つ。\n" +
        `Import local videos/images (absolute paths; ${["mp4", "mov", "mkv", "webm", "avi", "m4v", "png", "jpg", "jpeg", "webp", "bmp"].join("/")}) like the web drag&drop upload, then run highlight analysis.`,
      input: {
        projectId,
        paths: z.array(z.string().min(1)).min(1).max(20).describe("absolute local file paths"),
        mode: z.enum(["upload", "reference"]).optional().describe("upload (default) = copy into the project; reference = use the file in place"),
        analyze: z.boolean().optional().describe("start highlight analysis for videos (default true)"),
        wait: z.boolean().optional().describe("wait for proxies + analysis (default true)"),
        timeoutSec: z.number().int().min(5).max(3600).optional().describe("max wait (default 600)"),
      },
    },
    async (a, extra) => {
      const res = await addSources(
        a.projectId,
        a.paths,
        { mode: a.mode ?? "upload", analyze: a.analyze ?? true, wait: a.wait ?? true, timeoutSec: a.timeoutSec ?? 600 },
        progressOf(extra, "add_sources"),
      );
      const ids = new Set(res.added.map((x) => x.id));
      const cand = (sid: string) => res.project.candidates.filter((c) => c.sourceId === sid).length;
      return json({
        added: res.project.sources
          .filter((s) => ids.has(s.id))
          .map((s) => ({ id: s.id, name: s.name, kind: isStillImageSource(s) ? "image" : "video", durationSec: r2(s.durationSec), proxy: s.proxyStatus, analysis: s.analysisStatus, candidates: cand(s.id), ...(s.analysisError ? { analysisError: s.analysisError } : {}) })),
        errors: res.errors,
        ...(res.timedOut ? { note: "timed out waiting; processing continues in the background (get_project / get_candidates later)" } : {}),
      });
    },
  );

  tool(
    server,
    "get_candidates",
    {
      title: "Highlight candidates / 見どころ候補",
      description:
        "見どころ解析の候補 (2〜6 秒、score 0..1 と scene/motion/loudness)。set_clips に candidateId を渡して使う。thumbnails=true で上位のサムネ画像も返す。\n" +
        "Highlight candidates per source (score-sorted). Use their ids with set_clips.",
      input: {
        projectId,
        sourceId: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional().describe("per source (default 10)"),
        thumbnails: z.number().int().min(0).max(8).optional().describe("return N thumbnail images of the best candidates (default 0)"),
      },
      readOnly: true,
    },
    async ({ projectId: id, sourceId, limit, thumbnails }) => {
      const p = await getProject(id);
      const dir = projectDirOf(id);
      const out = p.sources
        .filter((s) => !sourceId || s.id === sourceId)
        .map((s) => ({
          sourceId: s.id,
          name: s.name ?? path.basename(s.originalPath),
          kind: isStillImageSource(s) ? "image" : "video",
          analysis: s.analysisStatus,
          candidates: p.candidates
            .filter((c) => c.sourceId === s.id)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit ?? 10)
            .map((c) => ({ id: c.id, startSec: r2(c.startSec), endSec: r2(c.endSec), score: r2(c.score), scene: r2(c.features.scene), motion: r2(c.features.motion), loudness: r2(c.features.loudness), ...(c.adopted ? { adopted: true } : {}), thumb: path.join(dir, c.thumbPath) })),
        }));
      const result = json(out);
      if (thumbnails) {
        const best = p.candidates
          .filter((c) => !sourceId || c.sourceId === sourceId)
          .sort((a, b) => b.score - a.score)
          .slice(0, thumbnails);
        for (const c of best) {
          const f = path.join(dir, c.thumbPath);
          if (!fs.existsSync(f)) continue;
          result.content.push({ type: "text", text: `${c.id} (${c.sourceId} ${r2(c.startSec)}-${r2(c.endSec)} s, score ${r2(c.score)})` });
          result.content.push({ type: "image", data: fs.readFileSync(f).toString("base64"), mimeType: "image/jpeg" });
        }
      }
      return result;
    },
  );

  tool(
    server,
    "set_clips",
    {
      title: "Set clips / クリップ配置",
      description:
        "クリップを置き換え (mode=replace, 既定) または追加 (append)。各要素は {candidateId, slot?} か {sourceId, inSec, outSec, slot} (画像素材は outSec 省略で 3 秒)。slot: hook (冒頭) / main (本編) — 意味はテンプレートごと (list_templates)。auto=true なら見どころ候補から自動配置。\n" +
        "Replace/append clips from candidate ids or explicit source ranges; auto=true arranges automatically (best candidate -> hook, next best -> main).",
      input: {
        projectId,
        mode: z.enum(["replace", "append"]).optional(),
        auto: z.boolean().optional().describe("ignore `clips` and arrange automatically from candidates"),
        autoCount: z.number().int().min(1).max(20).optional().describe("auto: number of main clips for free length (default 5)"),
        clips: z
          .array(
            z.object({
              candidateId: z.string().optional(),
              sourceId: z.string().optional(),
              inSec: z.number().min(0).optional(),
              outSec: z.number().min(0).optional(),
              slot: z.enum(["hook", "main"]).optional().describe("default main"),
              focusX: z.number().min(0).max(1).optional().describe("9:16 crop center 0..1"),
              imageMotion: z.enum(["none", "zoomIn", "zoomOut", "panLeft", "panRight"]).optional().describe("image sources only"),
              gameVolume: z.number().min(0).max(1).optional().describe("game audio volume (default 0.8)"),
              featureId: z.string().optional().describe("features template: feat_1..feat_4"),
            }),
          )
          .optional(),
      },
    },
    async ({ projectId: id, mode, auto, autoCount, clips }) => {
      const p = await editProject(id, async (p) => {
        if (auto) {
          const target = p.durationSec === null ? null : (await timelineOf(p, p.languages[0] ?? "ja")).sections.filter((s) => s.kind === "main").reduce((a, s) => a + s.sec, 0) || p.durationSec;
          setClips(p, autoClips(p, { count: autoCount ?? 5, targetSec: target }));
          return;
        }
        if (!clips?.length) throw new Error("Give `clips` or auto=true");
        const built = clips.map((c) => buildClip(p, c));
        setClips(p, mode === "append" ? [...p.clips, ...built] : built);
      });
      const s = await summarizeProject(p);
      return json({ clips: s.clips, timeline: s.timeline, warnings: s.warnings });
    },
  );

  tool(
    server,
    "set_template_data",
    {
      title: "Template texts / テンプレート設定",
      description:
        "テンプレート固有の設定を変更 (スキーマで検証)。ショート系: title / sub / note / items / number / flag (意味は list_templates)。intro: headline / kicker / info / points / clipPerLine。features: features[{heading,sub}]。trailer: cards / beatSync / logoReveal。共通: cta / hookText。文字列は lang (既定 = 最初の言語) に入り、{ja,en} で両方指定。【】で強調、\\n で改行。select=true でそのテンプレートに切り替え。\n" +
        "Set template-specific fields (validated). Plain strings go to `lang`; use {ja,en} for both.",
      input: {
        projectId,
        template: templateIdInput.optional().describe("whose data to edit (default: the project's template)"),
        select: z.boolean().optional().describe("also switch the project to `template`"),
        lang: langInput.optional(),
        data: templateDataInput,
      },
    },
    async ({ projectId: id, template, select, lang, data }) => {
      const { project, warnings } = await setTemplateData(id, template, data, lang, !!select);
      const s = await summarizeProject(project);
      return json({ template: project.template, templateData: s.templateData, cta: s.cta, warnings: [...warnings, ...s.warnings] });
    },
  );

  tool(
    server,
    "set_script",
    {
      title: "Narration / 台本とナレーション",
      description:
        "1 言語分のナレーション台本を設定し、TTS (日本語 = VOICEVOX、英語 = Piper) と字幕を生成 (完了まで待つ)。section: hook (冒頭) / main (本編、順に再生) / cta (エンドカード)。【】で囲んだ語は字幕で強調 (読み上げない)。変わっていない行は再合成しません。\n" +
        "Set narration lines for one language, run TTS + captions synchronously. Unchanged lines keep their audio.",
      input: {
        projectId,
        lang: langInput,
        lines: z
          .array(
            z.object({
              section: z.enum(["hook", "main", "cta"]),
              text: z.string().describe("narration; 【word】 = emphasized in captions"),
              offsetSec: z.number().min(0).optional().describe("hook/cta: delay from section start; main: gap before the line"),
              speed: z.number().min(0.5).max(2).optional(),
              speaker: z.string().optional().describe("override voice (VOICEVOX style id / Piper voice name)"),
              featureId: z.string().optional().describe("features template: bind a main line to feat_N"),
            }),
          )
          .max(40),
        voice: z
          .object({
            engine: z.enum(["voicevox", "piper"]).optional(),
            speaker: z.string().optional().describe('VOICEVOX style id, e.g. "3" = ずんだもん(ノーマル) (default for ja); Piper voice e.g. en_US-lessac-medium'),
            speed: z.number().min(0.5).max(2).optional().describe("1 = normal; intro/shorts sound good at 1.2-1.3"),
          })
          .optional(),
        mode: z.enum(["replace", "append"]).optional().describe("replace (default) all lines of `lang`, or append"),
        synthesize: z.boolean().optional().describe("run TTS now (default true)"),
      },
    },
    async ({ projectId: id, lang, lines, voice, mode, synthesize: synth }, extra) => {
      let p = await editProject(id, (p) => {
        if (!p.languages.includes(lang)) p.languages.push(lang);
        applyScript(p, lang, lines, voice, mode ?? "replace");
      });
      if (synth !== false) p = await synthesize(id, lang, progressOf(extra, "set_script"));
      const t = await timelineOf(p, lang);
      return json({
        lang,
        lines: scriptReport(p, lang),
        timeline: t,
        ...(hasUnsynthesized(p, lang).length ? { unsynthesized: hasUnsynthesized(p, lang) } : {}),
      });
    },
  );

  tool(
    server,
    "set_style",
    {
      title: "Style / スタイル",
      description:
        "色・字幕・トランジション・9:16 の作り方・強調色・ウォーターマーク。transition.preset: auto (テンプレートおすすめ) / none / whip / zoom / glitch / flash。verticalMode: blur (ぼかし背景) / crop (focusX で切り出し)。emphasisColor: yellow / red / CSS 色。\n" +
        "Colors, captions, cut transition preset/intensity, 9:16 mode, emphasis color, watermark.",
      input: {
        projectId,
        primaryColor: z.string().optional(),
        accentColor: z.string().optional(),
        emphasisColor: z.string().optional().describe('"yellow" (#FFE14D), "red" (#FF4B4B) or any CSS color'),
        captions: z.object({ enabled: z.boolean().optional(), position: z.enum(["bottom", "center"]).optional(), size: z.enum(["m", "l"]).optional() }).optional(),
        transition: z.object({ preset: z.enum(["auto", "none", "whip", "zoom", "glitch", "flash"]).optional(), intensity: z.number().min(0).max(1).optional() }).optional(),
        verticalMode: z.enum(["blur", "crop"]).optional(),
        watermark: z
          .object({ position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "none"]).optional(), scale: z.number().min(0.25).max(3).optional() })
          .optional(),
      },
    },
    async ({ projectId: id, ...s }) => {
      const p = await editProject(id, (p) => {
        const st = p.style;
        if (s.primaryColor) st.primaryColor = s.primaryColor;
        if (s.accentColor) st.accentColor = s.accentColor;
        if (s.emphasisColor) st.emphasisColor = s.emphasisColor === "yellow" ? "#FFE14D" : s.emphasisColor === "red" ? "#FF4B4B" : s.emphasisColor;
        if (s.captions) st.captions = { ...st.captions, ...Object.fromEntries(Object.entries(s.captions).filter(([, v]) => v !== undefined)) };
        if (s.transition) {
          const cur = st.transition ?? { preset: "auto" as const };
          st.transition = { preset: s.transition.preset ?? cur.preset, ...(s.transition.intensity ?? cur.intensity) !== undefined ? { intensity: s.transition.intensity ?? cur.intensity } : {} };
        }
        if (s.verticalMode) st.vertical = { mode: s.verticalMode };
        if (s.watermark) st.watermark = { ...st.watermark, ...Object.fromEntries(Object.entries(s.watermark).filter(([, v]) => v !== undefined)) };
      });
      return json({ style: (await summarizeProject(p)).style });
    },
  );

  tool(
    server,
    "set_audio",
    {
      title: "Audio / BGM・効果音",
      description:
        "BGM (ライブラリの id、ムードタグ、またはローカルファイル)、音量、ダッキング (duckMode band = 声の帯域だけ下げる / volume = 全体)、duckingDb、ナレーション・ゲーム音量、効果音 (on/off・音量・スロット)。ライブラリの曲はクレジットも自動で記録。\n" +
        "BGM from the library (id or mood) or a local file, mix/ducking settings, SE on/off/volume/slots.",
      input: {
        projectId,
        bgmLibraryId: z.string().optional().describe("id from list_bgm"),
        bgmMood: z.string().optional().describe("pick the first library track with this mood tag"),
        bgmFile: z.string().optional().describe("absolute path of a local audio file (mp3/wav/m4a/ogg/aac)"),
        removeBgm: z.boolean().optional(),
        bgmVolume: z.number().min(0).max(1).optional().describe("default 0.5"),
        duckMode: z.enum(["band", "volume"]).optional(),
        duckingDb: z.number().min(-60).max(0).optional().describe("dB under narration, default -12"),
        fadeOutSec: z.number().min(0).max(10).optional(),
        loop: z.boolean().optional(),
        narrationVolume: z.number().min(0).max(1).optional(),
        gameVolumeUnderNarration: z.number().min(0).max(1).optional(),
        seEnabled: z.boolean().optional(),
        seVolume: z.number().min(0).max(1).optional(),
        seSlots: z
          .record(z.enum(["captionPop", "headline", "point", "info", "transition", "cta"]), z.string().nullable())
          .optional()
          .describe("slot -> SE library id (list_se), null = silent"),
      },
    },
    async ({ projectId: id, ...a }, extra) => {
      const { project, notes } = await setAudio(id, a, progressOf(extra, "set_audio"));
      return json({ audio: (await summarizeProject(project)).audio, notes });
    },
  );

  /* ---------------- C. preview / render ---------------- */

  tool(
    server,
    "preview_frames",
    {
      title: "Preview frames / 静止画プレビュー",
      description:
        "保存済みプロジェクトの指定秒の静止画を書き出して画像で返す (書き出しと同じ描画、幅 ~540px)。times 省略時は冒頭・途中・終盤の 4 枚。初回はバンドルに 30〜60 秒かかることがあります。\n" +
        "Render still frames at given seconds (same renderer as the final video) and return them as images.",
      input: {
        projectId,
        format: formatIn.optional().describe("default: the project's first format"),
        lang: langInput.optional(),
        times: z.array(z.number().min(0)).min(1).max(12).optional().describe("seconds on the output timeline"),
        width: z.number().int().min(120).max(1920).optional().describe("image width in px (default 540)"),
      },
      readOnly: true,
    },
    async ({ projectId: id, format, lang, times, width }, extra) => {
      const { p, format: f, lang: l } = await firstFormatLang(id, format, lang);
      const t = await timelineOf(p, l);
      progressOf(extra, "preview_frames")(`rendering stills ${f} ${l}`);
      const res = await renderStills(id, f, l, times ?? defaultTimes(t.totalSec), width);
      const pending = hasUnsynthesized(p, l);
      const out: CallToolResult = {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              format: f,
              lang: l,
              durationSec: r2(res.durationSec),
              size: `${res.width}x${res.height}`,
              sections: t.sections,
              frames: res.frames.map((x) => ({ sec: r2(x.sec), frame: x.frame, path: x.absPath })),
              ...(pending.length ? { warning: `unsynthesized narration lines (no audio/captions yet): ${pending.join(", ")}` } : {}),
            }),
          },
        ],
      };
      for (const fr of res.frames) {
        out.content.push({ type: "text", text: `t=${r2(fr.sec)}s (frame ${fr.frame})` });
        out.content.push({ type: "image", data: fr.base64, mimeType: fr.mimeType });
      }
      return out;
    },
  );

  tool(
    server,
    "render",
    {
      title: "Render / 書き出し",
      description:
        "mp4 を書き出す。wait=true (既定) なら完了まで待って mp4 の絶対パスを返す (長い動画は数分)。wait=false なら jobId を返す → get_render_status。\n" +
        "Render an mp4. wait=true returns the absolute mp4 path; wait=false returns a jobId.",
      input: {
        projectId,
        format: formatIn.optional(),
        lang: langInput.optional(),
        fps: fpsSchema.optional(),
        wait: z.boolean().optional(),
        timeoutSec: z.number().int().min(10).max(7200).optional().describe("default 1200"),
      },
    },
    async ({ projectId: id, format, lang, fps, wait, timeoutSec }, extra) => {
      const { p, format: f, lang: l } = await firstFormatLang(id, format, lang);
      const pending = hasUnsynthesized(p, l);
      const jobId = await startRender(id, f, l, fps);
      if (wait === false) return json({ jobId, status: "queued", ...(pending.length ? { warning: `unsynthesized lines: ${pending.join(", ")}` } : {}) });
      const { job, timedOut } = await waitRender(jobId, timeoutSec ?? 1200, progressOf(extra, "render"));
      if (job.status === "error") return { isError: true, content: [{ type: "text", text: `render failed: ${job.error ?? "unknown error"} (job ${jobId}; server log: ${SERVER_LOG})` }] };
      return json({ ...jobReport(job), ...(timedOut ? { note: "still running; poll get_render_status" } : {}), ...(pending.length ? { warning: `unsynthesized lines: ${pending.join(", ")}` } : {}) });
    },
  );

  tool(
    server,
    "render_batch",
    {
      title: "Batch render / 一括書き出し",
      description:
        "形式 × 言語をまとめて書き出す (既定: プロジェクトの formats × languages)。順番に処理。wait=true (既定) で全部終わるまで待ちます。\n" +
        "Queue several format x language renders (default: all project formats x languages).",
      input: {
        projectId,
        targets: z.array(z.object({ format: formatIn, lang: langInput })).min(1).max(8).optional(),
        fps: fpsSchema.optional(),
        wait: z.boolean().optional(),
        timeoutSec: z.number().int().min(10).max(7200).optional().describe("total wait, default 2400"),
      },
    },
    async ({ projectId: id, targets, fps, wait, timeoutSec }, extra) => {
      const p = await getProject(id);
      const tg = targets ?? p.formats.flatMap((format) => p.languages.map((lang) => ({ format, lang })));
      const jobIds = await startRenderBatch(id, tg, fps);
      if (wait === false) return json({ jobIds });
      const deadline = Date.now() + (timeoutSec ?? 2400) * 1000;
      const jobs = [];
      for (const j of jobIds) {
        const { job } = await waitRender(j, Math.max(1, (deadline - Date.now()) / 1000), progressOf(extra, "render_batch"));
        jobs.push(jobReport(job));
      }
      return json({ jobs });
    },
  );

  tool(
    server,
    "get_render_status",
    {
      title: "Render status / 書き出し状況",
      description: "書き出しジョブの状態 (queued / bundling / rendering / done / error、進捗、完了なら mp4 の絶対パス)。Render job status.",
      input: { jobId: z.string().min(1) },
      readOnly: true,
    },
    async ({ jobId }) => json(jobReport(await apiGet<RenderJob>(`/api/render/${enc(jobId)}`))),
  );

  tool(
    server,
    "list_renders",
    {
      title: "Renders / 書き出し履歴",
      description: "書き出し済み mp4 (新しい順、絶対パス・形式・言語・サイズ) と実行中/最近のジョブ。List rendered files and recent jobs.",
      input: { projectId },
      readOnly: true,
    },
    async ({ projectId: id }) => {
      const r = await apiGet<RenderListResponse>(`/api/projects/${enc(id)}/renders`);
      return json({
        files: r.files.map((f) => ({ path: f.absPath ?? path.join(projectDirOf(id), f.path), format: f.format, lang: f.lang, sizeMB: r2(f.sizeBytes / 1048576), mtime: f.mtime })),
        jobs: r.jobs.map(jobReport),
      });
    },
  );

  /* ---------------- D. one-shot ---------------- */

  tool(
    server,
    "make_ad",
    {
      title: "Make an ad (one shot) / 広告を一発生成",
      description:
        "一発で広告動画を作る: プロジェクト作成 → 素材取り込み+見どころ解析 → 上位候補をスロットに配置 → テンプレート文言 → 台本 (省略時はゲーム説明から簡単な規則で作成) と TTS → BGM → 書き出し → mp4 パスとプレビュー画像を返す。数分かかります (クライアントがタイムアウトしても処理は続くので get_project / list_renders で確認)。\n" +
        "One-shot pipeline: create project, import + analyze footage, auto-pick clips, template texts, narration (heuristic draft from the description when `script` is omitted; no LLM), TTS, BGM, render, return mp4 paths + preview frames.",
      input: {
        name: z.string().min(1).describe("project name"),
        template: templateIdInput,
        gameTitle: z.string().min(1),
        gameDescription: z.string().optional().describe("description / selling points as text (sentences or bullet lines)"),
        sellingPoints: z.array(z.string()).max(5).optional().describe("explicit selling points (preferred over the description)"),
        sourcePaths: z.array(z.string().min(1)).min(1).max(20).describe("absolute paths of gameplay videos / screenshots"),
        formats: z.array(formatIn).min(1).optional().describe('default ["9:16"]'),
        lang: langInput.optional().describe("narration / text language (default ja)"),
        durationSec: z.union([z.literal(15), z.literal(30), z.null()]).optional().describe("default null = free length"),
        script: z
          .array(z.object({ section: z.enum(["hook", "main", "cta"]), text: z.string() }))
          .max(20)
          .optional()
          .describe("narration lines; omit for an automatic draft; [] = no narration"),
        voice: z.object({ speaker: z.string().optional(), speed: z.number().min(0.5).max(2).optional() }).optional(),
        templateData: templateDataInput.optional().describe("overrides of the drafted template texts (same keys as set_template_data)"),
        bgmId: z.string().optional().describe("BGM library id (list_bgm)"),
        bgmMood: z.string().optional().describe("BGM mood tag, e.g. upbeat / epic / chill"),
        releaseText: z.string().optional(),
        render: z.boolean().optional().describe("render the mp4(s) (default true)"),
        previewFrames: z.number().int().min(0).max(8).optional().describe("number of preview images to return (default 3)"),
      },
    },
    async (a, extra) => {
      const progress = progressOf(extra, "make_ad");
      const lang = a.lang ?? "ja";
      const formats = a.formats ?? ["9:16"];
      const notes: string[] = [];
      progress("creating project");
      const created = await createProject({ name: a.name, template: a.template, formats, languages: [lang], durationSec: a.durationSec ?? null, gameTitle: a.gameTitle, ...(a.releaseText ? { releaseText: a.releaseText } : {}) });
      const id = created.id;
      try {
        return await makeAdRest(id);
      } catch (e) {
        throw new Error(`${(e as Error).message} [project ${id} was created (${projectDirOf(id)}); continue with get_project / set_* / render]`);
      }

      async function makeAdRest(id: string): Promise<CallToolResult> {
      progress("importing footage");
      const src = await addSources(id, a.sourcePaths, { mode: "upload", analyze: true, wait: true, timeoutSec: 900 }, progress);
      for (const e of src.errors) notes.push(`source ${e.path}: ${e.error}`);
      if (!src.added.length) throw new Error(`no source could be imported (project ${id} was created): ${src.errors.map((e) => `${e.path}: ${e.error}`).join("; ")}`);

      const points = sellingPoints(a.gameDescription, a.sellingPoints);
      const lines = a.script ?? draftScript(a.template, a.gameTitle, points, lang);
      const bodyLines = lines.filter((l) => l.section !== "cta").length;
      const draft = draftTemplateData(a.template, a.gameTitle, points, lang);
      const speed = a.voice?.speed ?? (a.template === "intro" ? 1.2 : a.template === "hook-play-cta" || a.template === "features" || a.template === "trailer" ? 1 : 1.1);

      progress("arranging clips + template texts");
      let warnings: string[] = [];
      await editProject(id, async (p) => {
        setClips(p, autoClips(p, { count: Math.max(4, Math.min(8, bodyLines + 1)), targetSec: p.durationSec ? p.durationSec - 3 : null }));
        warnings = applyTemplateData(p, a.template, { ...draft, ...(a.templateData ?? {}) }, lang);
        applyScript(p, lang, lines, { speed, ...(a.voice?.speaker ? { speaker: a.voice.speaker } : {}) }, "replace");
      });
      notes.push(...warnings);

      if (a.bgmId || a.bgmMood) {
        try {
          const r = await setAudio(id, { ...(a.bgmId ? { bgmLibraryId: a.bgmId } : { bgmMood: a.bgmMood }) }, progress);
          notes.push(...r.notes);
        } catch (e) {
          notes.push(`BGM: ${(e as Error).message}`);
        }
      }

      let p = await getProject(id);
      if (lines.length) {
        p = await synthesize(id, lang, progress);
        const bad = p.script.filter((l) => l.lang === lang && l.status === "error");
        for (const l of bad) notes.push(`TTS ${l.id}: ${l.error}`);
      }

      const renders: unknown[] = [];
      if (a.render !== false) {
        const jobIds = await startRenderBatch(id, formats.map((format) => ({ format, lang })));
        for (const j of jobIds) {
          const { job } = await waitRender(j, 1800, progress);
          renders.push(jobReport(job));
          if (job.status === "error") notes.push(`render ${job.format}: ${job.error}`);
        }
      }

      const summary = await summarizeProject(await getProject(id));
      const result = json({
        projectId: id,
        dir: projectDirOf(id),
        renders,
        timeline: summary.timeline,
        clips: summary.clips.length,
        script: scriptReport(await getProject(id), lang).map((l) => ({ section: l.section, text: l.text, status: l.status, sec: l.sec })),
        templateData: summary.templateData,
        bgm: summary.audio.bgm?.library ?? summary.audio.bgm?.path ?? null,
        notes,
        warnings: summary.warnings,
      });
      const nFrames = a.previewFrames ?? 3;
      if (nFrames > 0) {
        try {
          const tl = await timelineOf(await getProject(id), lang);
          const stills = await renderStills(id, formats[0]!, lang, defaultTimes(tl.totalSec, nFrames));
          for (const fr of stills.frames) {
            result.content.push({ type: "text", text: `preview ${formats[0]} t=${r2(fr.sec)}s` });
            result.content.push({ type: "image", data: fr.base64, mimeType: fr.mimeType });
          }
        } catch (e) {
          result.content.push({ type: "text", text: `preview failed: ${(e as Error).message}` });
        }
      }
      return result;
      }
    },
  );
}
