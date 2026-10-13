// Thin REST client for @gas/server (docs/ARCHITECTURE.md §6).
// All URLs are relative: Vite proxies /api and /files to :3101.
import type {
  AddSourceRequest,
  CreateProjectRequest,
  HealthResponse,
  Project,
  ProjectSummary,
  RenderJob,
  RenderRequest,
  RenderStartResponse,
  UploadAssetResponse,
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

export const api = {
  health: (signal?: AbortSignal) => request<HealthResponse>("GET", "/api/health", undefined, { signal }),
  listProjects: () => request<ProjectSummary[]>("GET", "/api/projects"),
  createProject: (body: CreateProjectRequest) => request<Project>("POST", "/api/projects", body),
  getProject: (id: string) => request<Project>("GET", `/api/projects/${encodeURIComponent(id)}`),
  saveProject: (p: Project) => request<Project>("PUT", `/api/projects/${encodeURIComponent(p.id)}`, p),
  addSource: (id: string, body: AddSourceRequest) =>
    request<Project>("POST", `/api/projects/${encodeURIComponent(id)}/sources`, body),
  uploadAsset: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<UploadAssetResponse>("POST", `/api/projects/${encodeURIComponent(id)}/assets`, fd);
  },
  startRender: (id: string, body: RenderRequest) =>
    request<RenderStartResponse>("POST", `/api/projects/${encodeURIComponent(id)}/render`, body),
  getRenderJob: (jobId: string) => request<RenderJob>("GET", `/api/render/${encodeURIComponent(jobId)}`),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
