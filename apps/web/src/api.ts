// Thin REST client for @gas/server (docs/ARCHITECTURE.md §6).
// All URLs are relative: Vite proxies /api and /files to :3101.
import type {
  AddSourceRequest,
  CreateProjectRequest,
  HealthResponse,
  Project,
  ProjectSummary,
  RenderBatchRequest,
  RenderBatchResponse,
  RenderJob,
  RenderListResponse,
  RenderRequest,
  RenderStartResponse,
  SeListResponse,
  BgmListResponse,
  BgmManifestUpdateRequest,
  SeManifestUpdateRequest,
  TtsEngine,
  TtsPreviewRequest,
  TtsStatusResponse,
  TtsSynthesizeRequest,
  TtsVoice,
  UploadAssetResponse,
  UploadSourceResponse,
} from "@gas/shared";

export class ApiError extends Error {
  /** HTTP status; 0 = network failure (server unreachable) */
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
  get isNetwork(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  let res: Response;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined && !isForm ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      ...init,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "サーバーに接続できません");
  }
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }
  if (!res.ok) {
    // Vite's dev proxy answers an empty 500 when :3101 refuses the connection.
    if (!text && res.status >= 500) throw new ApiError(0, "サーバーに接続できません");
    const msg =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : res.status >= 502 && res.status <= 504
          ? "サーバーに接続できません"
          : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  // Vite's proxy answers non-JSON HTML when the route is unknown; treat as failure.
  if (data === undefined && text) throw new ApiError(res.status, "不正なレスポンス");
  return data as T;
}

/** Upload progress: bytes sent so far / total bytes. */
export type UploadProgress = (loaded: number, total: number) => void;

/**
 * multipart POST via XMLHttpRequest (fetch has no upload progress). Same error mapping as request().
 * `signal` aborts the upload (rejects with an AbortError).
 */
function uploadWithProgress<T>(url: string, file: File, onProgress?: UploadProgress, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => onProgress?.(e.loaded, e.lengthComputable ? e.total : file.size);
    xhr.onerror = () => reject(new ApiError(0, "サーバーに接続できません"));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    xhr.onload = () => {
      const text = xhr.responseText;
      let data: unknown = undefined;
      try {
        data = text ? JSON.parse(text) : undefined;
      } catch {
        data = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data !== undefined) return resolve(data as T);
      if (!text && xhr.status >= 500) return reject(new ApiError(0, "サーバーに接続できません"));
      const msg =
        data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
          ? (data as { error: string }).error
          : xhr.status === 413
            ? "ファイルが大きすぎます"
            : xhr.status >= 200 && xhr.status < 300
              ? "不正なレスポンス"
              : `HTTP ${xhr.status}`;
      reject(new ApiError(xhr.status, msg));
    };
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

export const api = {
  health: (signal?: AbortSignal) => request<HealthResponse>("GET", "/api/health", undefined, { signal }),
  listProjects: () => request<ProjectSummary[]>("GET", "/api/projects"),
  createProject: (body: CreateProjectRequest) => request<Project>("POST", "/api/projects", body),
  getProject: (id: string) => request<Project>("GET", `/api/projects/${encodeURIComponent(id)}`),
  saveProject: (p: Project) => request<Project>("PUT", `/api/projects/${encodeURIComponent(p.id)}`, p),
  addSource: (id: string, body: AddSourceRequest) =>
    request<Project>("POST", `/api/projects/${encodeURIComponent(id)}/sources`, body),
  /** Upload a video / image as a source (multipart, one file) -> 201 Project (new source "pending"). */
  uploadSource: (id: string, file: File, onProgress?: UploadProgress, signal?: AbortSignal) =>
    uploadWithProgress<UploadSourceResponse>(`/api/projects/${encodeURIComponent(id)}/sources/upload`, file, onProgress, signal),
  uploadAsset: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<UploadAssetResponse>("POST", `/api/projects/${encodeURIComponent(id)}/assets`, fd);
  },
  startRender: (id: string, body: RenderRequest) =>
    request<RenderStartResponse>("POST", `/api/projects/${encodeURIComponent(id)}/render`, body),
  getRenderJob: (jobId: string) => request<RenderJob>("GET", `/api/render/${encodeURIComponent(jobId)}`),

  /* ---- Phase 3 ---- */
  renderBatch: (id: string, body: RenderBatchRequest) =>
    request<RenderBatchResponse>("POST", `/api/projects/${encodeURIComponent(id)}/render-batch`, body),
  listRenders: (id: string) => request<RenderListResponse>("GET", `/api/projects/${encodeURIComponent(id)}/renders`),
  /** 202 Project (audio.bgm.analysisStatus "running"); 409 when there is no BGM / already running. */
  analyzeBgm: (id: string) => request<Project>("POST", `/api/projects/${encodeURIComponent(id)}/bgm/analyze`),
  /** 202 Project (audio.bgm.voiceCarveStatus "running"): voice-band ducking copy (§5.3.1); 409 = no BGM / already running. */
  carveBgm: (id: string) => request<Project>("POST", `/api/projects/${encodeURIComponent(id)}/bgm/carve`),

  /* ---- Phase 3.5: SE library (§6.12) ---- */
  listSe: () => request<SeListResponse>("GET", "/api/se"),
  /** Re-reads the library dir (after the user added files) and returns the list. */
  rescanSe: () => request<SeListResponse>("POST", "/api/se/rescan"),
  /** Merges credits into se.json ("" removes one) and returns the list. */
  updateSeManifest: (body: SeManifestUpdateRequest) => request<SeListResponse>("PUT", "/api/se/manifest", body),
  /** Copies an audio file into the SE library root (name kept, " (2)" on collisions) and returns the list. */
  uploadSe: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<SeListResponse>("POST", "/api/se/upload", fd);
  },

  /* ---- BGM library (§6.14) ---- */
  listBgm: () => request<BgmListResponse>("GET", "/api/bgm"),
  rescanBgm: () => request<BgmListResponse>("POST", "/api/bgm/rescan"),
  /** Merges per id / field into bgm.json ("" / [] removes) and returns the list. */
  updateBgmManifest: (body: BgmManifestUpdateRequest) => request<BgmListResponse>("PUT", "/api/bgm/manifest", body),
  uploadBgm: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<BgmListResponse>("POST", "/api/bgm/upload", fd);
  },
  /** Copies a library track into the project's assets, sets audio.bgm (+ library) and starts beat analysis. */
  bgmFromLibrary: (id: string, fileId: string) =>
    request<Project>("POST", `/api/projects/${encodeURIComponent(id)}/bgm/from-library`, { id: fileId }),

  /* ---- Phase 2 ---- */
  /** 202 Project (analysisStatus "running"); 409 when busy / proxy not ready. */
  analyzeSource: (id: string, sourceId: string) =>
    request<Project>(
      "POST",
      `/api/projects/${encodeURIComponent(id)}/sources/${encodeURIComponent(sourceId)}/analyze`,
    ),
  ttsStatus: (signal?: AbortSignal) => request<TtsStatusResponse>("GET", "/api/tts/status", undefined, { signal }),
  ttsVoices: (engine: TtsEngine) => request<TtsVoice[]>("GET", `/api/tts/voices?engine=${engine}`),
  /** Synchronous; returns the updated Project. */
  synthesize: (id: string, body: TtsSynthesizeRequest) =>
    request<Project>("POST", `/api/projects/${encodeURIComponent(id)}/tts`, body),
  /** Returns audio/wav. Nothing is saved on the server. */
  ttsPreview: async (body: TtsPreviewRequest): Promise<Blob> => {
    let res: Response;
    try {
      res = await fetch("/api/tts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "サーバーに接続できません");
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = text || res.status < 500 ? `HTTP ${res.status}` : "サーバーに接続できません";
      try {
        const data = JSON.parse(text) as unknown;
        if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
          msg = (data as { error: string }).error;
        }
      } catch {
        /* not JSON */
      }
      throw new ApiError(text || res.status < 500 ? res.status : 0, msg);
    }
    return res.blob();
  },
};

/** Message for Phase 2 endpoints that may still be stubs (501) or whose engine is down (503). */
export function featureErrorMessage(e: unknown, feature: string): string {
  if (e instanceof ApiError) {
    if (e.status === 501) return `${feature}はまだサーバーに実装されていません(501)`;
    if (e.status === 0) return "サーバーに接続できません";
  }
  return errorMessage(e);
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
