import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { API_BASE } from "./env";

/** Non-2xx answer of the Game Ad Studio API ({ error } body). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly method: string,
    readonly urlPath: string,
  ) {
    super(message);
  }
}

/** The API could not be reached at all (server down / starting). */
export class ApiUnreachableError extends Error {}

type RequestOpts = { timeoutMs?: number };

/**
 * JSON request with node:http (no fetch: undici's 300 s headers timeout would break the long synchronous
 * endpoints such as POST /tts and /stills). timeoutMs 0 = none (default).
 */
export async function apiRequest<T>(method: string, urlPath: string, body?: unknown, opts: RequestOpts = {}): Promise<T> {
  try {
    return await requestOnce<T>(method, urlPath, body, opts);
  } catch (e) {
    // a GET may hit a connection the busy server just dropped: retry once
    if (method === "GET" && e instanceof ApiUnreachableError && /ECONNRESET/.test(e.message)) {
      await new Promise((r) => setTimeout(r, 500));
      return requestOnce<T>(method, urlPath, body, opts);
    }
    throw e;
  }
}

function requestOnce<T>(method: string, urlPath: string, body: unknown, opts: RequestOpts): Promise<T> {
  const url = new URL(urlPath, API_BASE);
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), "utf8");
  return new Promise<T>((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        // no keep-alive: polling every few seconds would race the server's 5 s keepAliveTimeout (ECONNRESET)
        agent: false,
        headers: {
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": String(payload.length) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          let json: unknown = undefined;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            /* not JSON */
          }
          if (status >= 200 && status < 300) {
            resolve(json as T);
            return;
          }
          const msg =
            json && typeof json === "object" && "error" in json && typeof (json as { error: unknown }).error === "string"
              ? (json as { error: string }).error
              : text.slice(0, 500) || `HTTP ${status}`;
          reject(new ApiError(status, msg, method, urlPath));
        });
        res.on("error", reject);
      },
    );
    if (opts.timeoutMs) {
      req.setTimeout(opts.timeoutMs, () => req.destroy(new Error(`${method} ${urlPath} timed out after ${opts.timeoutMs} ms`)));
    }
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ECONNREFUSED" || e.code === "ECONNRESET" || e.code === "EHOSTUNREACH") {
        reject(new ApiUnreachableError(`Game Ad Studio API is not reachable at ${API_BASE} (${e.code})`));
      } else reject(e);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

export const apiGet = <T>(p: string, opts?: RequestOpts) => apiRequest<T>("GET", p, undefined, opts);
export const apiPost = <T>(p: string, body?: unknown, opts?: RequestOpts) => apiRequest<T>("POST", p, body ?? {}, opts);
export const apiPut = <T>(p: string, body: unknown, opts?: RequestOpts) => apiRequest<T>("PUT", p, body, opts);

/**
 * Multipart upload of a local file (field "file"), streamed from disk (fs.openAsBlob), like the web's
 * drag & drop. Returns the parsed JSON body.
 */
export async function apiUpload<T>(urlPath: string, filePath: string): Promise<T> {
  const blob = await fs.openAsBlob(filePath);
  const form = new FormData();
  form.append("file", blob, path.basename(filePath));
  let res: Response;
  try {
    res = await fetch(new URL(urlPath, API_BASE), { method: "POST", body: form });
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause;
    if (cause?.code === "ECONNREFUSED") throw new ApiUnreachableError(`Game Ad Studio API is not reachable at ${API_BASE}`);
    throw e;
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const msg = json && typeof json === "object" && "error" in json ? String((json as { error: unknown }).error) : text.slice(0, 500);
    throw new ApiError(res.status, msg || `HTTP ${res.status}`, "POST", urlPath);
  }
  return json as T;
}

export const enc = encodeURIComponent;
