import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import type { ApiError } from "@gas/shared";

/** Throw from any handler to produce `{ error }` with the given status. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const notFound = (msg: string) => new HttpError(404, msg);

/** Parse with a zod schema; throws HttpError(400) with a readable message. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown, what = "request body"): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw badRequest(`Invalid ${what}: ${z.prettifyError(r.error)}`);
  return r.data;
}

/** Client went away mid-response (seeking video, cancelled Range request). Not an error worth logging. */
export function isClientAbort(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "ECONNABORTED" || code === "ECONNRESET" || code === "EPIPE" || code === "ERR_STREAM_PREMATURE_CLOSE";
}

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiError = { error: `Not found: ${req.method} ${req.path}` };
  res.status(404).json(body);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (isClientAbort(err)) return;
  let status = 500;
  let message = "Internal server error";
  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
  } else if (err instanceof z.ZodError) {
    status = 400;
    message = z.prettifyError(err);
  } else if (err instanceof multer.MulterError) {
    status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    message = `Upload error: ${err.message}${err.field ? ` (field "${err.field}")` : ""}`;
  } else if (typeof err?.status === "number" && err.status >= 400 && err.status < 500) {
    // body-parser (invalid JSON, payload too large), send (range not satisfiable) ...
    status = err.status;
    message = err.message || message;
  } else {
    message = err instanceof Error ? err.message : String(err);
  }
  if (status >= 500) console.error(`[server] ${req.method} ${req.originalUrl} ->`, err);
  if (res.headersSent) {
    res.end();
    return;
  }
  const body: ApiError = { error: message };
  res.status(status).json(body);
};
