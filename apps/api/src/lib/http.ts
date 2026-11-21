import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from '@patradesa/shared';

export class HttpError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Data'): HttpError => new HttpError(404, ERROR_CODES.NOT_FOUND, `${what} tidak ditemukan.`);
export const forbidden = (msg = 'Anda tidak memiliki akses.'): HttpError => new HttpError(403, ERROR_CODES.FORBIDDEN, msg);

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

const MAX_JSON_BYTES = 256 * 1024;

/** Baca & validasi body JSON dengan batas ukuran. */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const len = Number(c.req.header('content-length') ?? '0');
  if (len > MAX_JSON_BYTES) throw new HttpError(413, ERROR_CODES.VALIDATION, 'Data terlalu besar.');
  const ct = c.req.header('content-type') ?? '';
  if (!ct.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, ERROR_CODES.VALIDATION, 'Content-Type harus application/json.');
  }
  const text = await c.req.text();
  if (text.length > MAX_JSON_BYTES) throw new HttpError(413, ERROR_CODES.VALIDATION, 'Data terlalu besar.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, ERROR_CODES.VALIDATION, 'JSON tidak valid.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(
      400,
      ERROR_CODES.VALIDATION,
      'Data tidak valid.',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return parsed.data;
}

export function param(c: Context, name: string): string {
  const v = c.req.param(name);
  if (!v || !/^[A-Za-z0-9_-]{3,80}$/.test(v)) throw notFound();
  return v;
}
