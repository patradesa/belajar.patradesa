import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { ERROR_CODES, SYSTEM_ROLES, type SystemRole } from '@patradesa/shared';
import type { AppEnv, Deps } from '../env';
import { hmac, newId, randomToken, sha256 } from '../lib/crypto';
import { HttpError, forbidden } from '../lib/http';

export const SESSION_COOKIE = '__Host-pd_session';
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
export const ADMIN_SESSION_TTL_MS = 12 * 3600 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

interface SessionRow {
  session_id: string;
  user_id: string;
  email_normalized: string;
  display_name: string;
  last_seen_at: number;
}

/** Muat sesi dari cookie (jika ada). Tidak menolak request anonim. */
export function loadSession(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('user', null);
    c.set('sessionId', null);
    const token = getCookie(c, SESSION_COOKIE);
    if (token && token.length >= 32 && token.length <= 128) {
      const now = deps.now();
      const row = await c.env.DB.prepare(
        `SELECT s.id AS session_id, s.user_id, u.email_normalized, u.display_name, s.last_seen_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'`,
      )
        .bind(await sha256(token), now)
        .first<SessionRow>();
      if (row) {
        const roles = await c.env.DB.prepare('SELECT role FROM system_roles WHERE user_id = ?')
          .bind(row.user_id)
          .all<{ role: SystemRole }>();
        c.set('user', {
          id: row.user_id,
          email: row.email_normalized,
          displayName: row.display_name,
          roles: roles.results.map((r) => r.role).filter((r) => SYSTEM_ROLES.includes(r)),
        });
        c.set('sessionId', row.session_id);
        if (now - row.last_seen_at > TOUCH_INTERVAL_MS) {
          await c.env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(now, row.session_id).run();
        }
      }
    }
    await next();
  };
}

export function currentUser(c: Context<AppEnv>) {
  const u = c.get('user');
  if (!u) throw new HttpError(401, ERROR_CODES.UNAUTHENTICATED, 'Silakan masuk terlebih dahulu.');
  return u;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  currentUser(c);
  await next();
};

/** Izinkan jika user memiliki salah satu role. super_admin selalu lolos. */
export function requireRole(...roles: SystemRole[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const u = currentUser(c);
    if (!u.roles.includes('super_admin') && !roles.some((r) => u.roles.includes(r))) throw forbidden();
    await next();
  };
}

export function hasRole(c: Context<AppEnv>, ...roles: SystemRole[]): boolean {
  const u = c.get('user');
  return !!u && (u.roles.includes('super_admin') || roles.some((r) => u.roles.includes(r)));
}

export async function csrfTokenFor(secret: string, sessionId: string): Promise<string> {
  return hmac(secret, `csrf:${sessionId}`);
}

/**
 * Buat sesi baru (rotasi saat login, mencegah session fixation): sesi lama dari cookie dicabut.
 * Hanya HASH token yang disimpan di D1.
 */
export async function createSession(c: Context<AppEnv>, deps: Deps, userId: string, privileged: boolean): Promise<void> {
  const now = deps.now();
  const old = getCookie(c, SESSION_COOKIE);
  if (old) {
    await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(now, await sha256(old))
      .run();
  }
  const token = randomToken(32);
  const ttl = privileged ? ADMIN_SESSION_TTL_MS : SESSION_TTL_MS;
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
  )
    .bind(newId(), userId, await sha256(token), now + ttl, now, now)
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(ttl / 1000),
  });
}
