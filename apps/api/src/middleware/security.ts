import type { MiddlewareHandler } from 'hono';
import { ERROR_CODES } from '@patradesa/shared';
import type { AppEnv } from '../env';
import { csrfTokenFor } from './auth';
import { timingSafeEqual } from '../lib/crypto';
import { HttpError } from '../lib/http';

/** Header keamanan untuk seluruh respons API. Respons API bersifat personal → no-store default. */
export const apiSecurityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!h.has('Content-Security-Policy')) h.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (!h.has('X-Frame-Options')) h.set('X-Frame-Options', 'DENY');
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
  if (c.env.ENVIRONMENT === 'staging' || c.env.ENVIRONMENT === 'production') {
    h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
};

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Jalur mutasi tanpa sesi yang tetap wajib lolos origin check, tapi belum punya token CSRF. */
const PRE_SESSION_PATHS = new Set(['/api/v1/auth/google/start', '/api/v1/auth/dev-login']);

/**
 * CSRF: (1) Origin/Sec-Fetch-Site harus same-origin untuk semua mutasi;
 * (2) jika ada sesi, header X-CSRF-Token wajib = HMAC(SESSION_SECRET, session_id).
 * Cookie SameSite=Lax menjadi lapisan ketiga.
 */
export const csrfProtection: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!MUTATING.has(c.req.method)) return next();
  const origin = c.req.header('origin');
  const site = c.req.header('sec-fetch-site');
  const originOk = origin ? origin === c.env.APP_ORIGIN : site === 'same-origin';
  if (!originOk) throw new HttpError(403, ERROR_CODES.CSRF_FAILED, 'Permintaan lintas situs ditolak.');

  const sessionId = c.get('sessionId');
  if (sessionId) {
    const sent = c.req.header('x-csrf-token') ?? '';
    const expected = await csrfTokenFor(c.env.SESSION_SECRET, sessionId);
    if (!timingSafeEqual(sent, expected)) {
      throw new HttpError(403, ERROR_CODES.CSRF_FAILED, 'Token keamanan tidak valid. Muat ulang halaman.');
    }
  } else if (!PRE_SESSION_PATHS.has(c.req.path)) {
    throw new HttpError(401, ERROR_CODES.UNAUTHENTICATED, 'Silakan masuk terlebih dahulu.');
  }
  return next();
};
