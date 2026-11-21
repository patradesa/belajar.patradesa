import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ERROR_CODES, devLoginSchema, googleStartSchema, type SystemRole } from '@patradesa/shared';
import type { AppEnv, Deps, GoogleClaims } from '../env';
import { HttpError, readJson } from '../lib/http';
import { newId, pkceChallenge, randomToken, sha256 } from '../lib/crypto';
import { enforceRateLimit } from '../lib/rateLimit';
import { securityEvent } from '../lib/audit';
import { SESSION_COOKIE, createSession } from '../middleware/auth';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const STATE_TTL_MS = 10 * 60 * 1000;

/** Verifikasi ID token Google: tanda tangan RS256 (JWKS), issuer, audience, expiry, nonce. */
export async function verifyGoogleIdToken(idToken: string, clientId: string, nonce: string): Promise<GoogleClaims> {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId,
    algorithms: ['RS256'],
    clockTolerance: 60,
  });
  if (payload.nonce !== nonce) throw new Error('nonce mismatch');
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') throw new Error('missing claims');
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : payload.email.split('@')[0]!,
  };
}

async function clientKey(c: Context<AppEnv>): Promise<string> {
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  // IP dipseudonimkan; tidak disimpan mentah.
  return (await sha256(`${c.env.SESSION_SECRET}:${ip}`)).slice(0, 22);
}

async function verifyTurnstile(c: Context<AppEnv>, deps: Deps, token: string): Promise<boolean> {
  const secret = c.env.TURNSTILE_SECRET_KEY;
  if (!secret) return c.env.ENVIRONMENT === 'development' || c.env.ENVIRONMENT === 'test';
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  const ip = c.req.header('cf-connecting-ip');
  if (ip) body.append('remoteip', ip);
  try {
    const res = await deps.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

/** Upsert user dari identitas terverifikasi. Role default `learner`; role lain hanya oleh admin. */
async function upsertUser(db: D1Database, provider: 'google' | 'dev', subject: string, email: string, name: string, now: number): Promise<string> {
  const emailNorm = email.trim().toLowerCase();
  const ident = await db
    .prepare('SELECT user_id FROM identities WHERE provider = ? AND provider_subject = ?')
    .bind(provider, subject)
    .first<{ user_id: string }>();
  if (ident) return ident.user_id;
  const existing = await db.prepare('SELECT id FROM users WHERE email_normalized = ?').bind(emailNorm).first<{ id: string }>();
  const userId = existing?.id ?? newId();
  const stmts = [];
  if (!existing) {
    stmts.push(
      db
        .prepare(`INSERT INTO users (id, email_normalized, display_name, status, created_at) VALUES (?, ?, ?, 'active', ?)`)
        .bind(userId, emailNorm, name.slice(0, 120) || 'Peserta', now),
      db.prepare('INSERT INTO user_profiles (user_id, updated_at) VALUES (?, ?)').bind(userId, now),
      db.prepare(`INSERT INTO system_roles (user_id, role, assigned_by, assigned_at) VALUES (?, 'learner', 'system', ?)`).bind(userId, now),
    );
  }
  stmts.push(
    db
      .prepare('INSERT INTO identities (id, user_id, provider, provider_subject, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(newId(), userId, provider, subject, now),
  );
  await db.batch(stmts);
  return userId;
}

async function isPrivileged(db: D1Database, userId: string): Promise<boolean> {
  const r = await db
    .prepare(`SELECT 1 AS x FROM system_roles WHERE user_id = ? AND role IN ('admin','super_admin','content_editor','mentor')`)
    .bind(userId)
    .first();
  return !!r;
}

export function devLoginAllowed(c: Context<AppEnv>): boolean {
  const host = new URL(c.req.url).hostname;
  return c.env.ENVIRONMENT === 'development' && c.env.DEV_LOGIN_ENABLED === 'true' && (host === 'localhost' || host === '127.0.0.1');
}

export function authRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  r.get('/config', (c) =>
    c.json({
      turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? null,
      googleEnabled: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
      devLoginEnabled: devLoginAllowed(c),
    }),
  );

  // Turnstile diverifikasi server-side sebelum alur OAuth dimulai (registrasi/login).
  r.post('/google/start', async (c) => {
    const now = deps.now();
    await enforceRateLimit(c.env.DB, `auth:${await clientKey(c)}`, 10, 60_000, now);
    const body = await readJson(c, googleStartSchema);
    if (!c.env.GOOGLE_CLIENT_ID) throw new HttpError(503, ERROR_CODES.INTERNAL, 'Login Google belum dikonfigurasi.');
    if (!(await verifyTurnstile(c, deps, body.turnstileToken))) {
      await securityEvent(c.env.DB, now, 'turnstile_failed', null);
      throw new HttpError(403, ERROR_CODES.TURNSTILE_FAILED, 'Verifikasi keamanan gagal. Coba lagi.');
    }
    const state = randomToken(32);
    const verifier = randomToken(48);
    const nonce = randomToken(24);
    await c.env.DB.prepare(
      'INSERT INTO oauth_states (state_hash, code_verifier, nonce, return_to, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(await sha256(state), verifier, nonce, body.returnTo ?? '/', now + STATE_TTL_MS, now)
      .run();
    const url = new URL(GOOGLE_AUTH);
    url.search = new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      // redirect_uri dari konfigurasi (allowlist), BUKAN dari header Host.
      redirect_uri: `${c.env.APP_ORIGIN}/api/v1/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return c.json({ url: url.toString() });
  });

  r.get('/google/callback', async (c) => {
    const now = deps.now();
    const fail = async (reason: string) => {
      await securityEvent(c.env.DB, now, 'oauth_callback_failed', null, { reason });
      return c.redirect('/masuk?galat=1', 302);
    };
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state || state.length > 200 || code.length > 2000) return fail('missing_params');
    // State sekali pakai: ambil lalu hapus.
    const st = await c.env.DB.prepare('DELETE FROM oauth_states WHERE state_hash = ? RETURNING code_verifier, nonce, return_to, expires_at')
      .bind(await sha256(state))
      .first<{ code_verifier: string; nonce: string; return_to: string; expires_at: number }>();
    if (!st || st.expires_at < now) return fail('bad_state');
    if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return fail('not_configured');

    let idToken: string;
    try {
      const res = await deps.fetch(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: c.env.GOOGLE_CLIENT_ID,
          client_secret: c.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${c.env.APP_ORIGIN}/api/v1/auth/google/callback`,
          grant_type: 'authorization_code',
          code_verifier: st.code_verifier,
        }),
      });
      const tok = (await res.json()) as { id_token?: string };
      if (!res.ok || !tok.id_token) return fail('token_exchange');
      idToken = tok.id_token;
    } catch {
      return fail('token_exchange');
    }
    let claims: GoogleClaims;
    try {
      claims = await deps.verifyGoogleIdToken(idToken, c.env.GOOGLE_CLIENT_ID, st.nonce);
    } catch {
      return fail('id_token_invalid');
    }
    if (!claims.emailVerified) return fail('email_unverified');
    const userId = await upsertUser(c.env.DB, 'google', claims.sub, claims.email, claims.name, now);
    const user = await c.env.DB.prepare('SELECT status FROM users WHERE id = ?').bind(userId).first<{ status: string }>();
    if (user?.status !== 'active') return fail('user_inactive');
    await createSession(c, deps, userId, await isPrivileged(c.env.DB, userId));
    const consent = await c.env.DB.prepare('SELECT privacy_consent_at FROM user_profiles WHERE user_id = ?')
      .bind(userId)
      .first<{ privacy_consent_at: number | null }>();
    const target = /^\/(?!\/)/.test(st.return_to) ? st.return_to : '/';
    return c.redirect(consent?.privacy_consent_at ? target : '/profil?baru=1', 302);
  });

  r.post('/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
        .bind(deps.now(), await sha256(token))
        .run();
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
    return c.json({ ok: true });
  });

  /**
   * HANYA untuk pengembangan lokal & e2e: aktif bila ENVIRONMENT=development, DEV_LOGIN_ENABLED=true,
   * dan host localhost. Staging/produksi selalu 404 (diuji di tests/security).
   */
  r.post('/dev-login', async (c) => {
    if (!devLoginAllowed(c)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Tidak ditemukan.');
    const now = deps.now();
    const body = await readJson(c, devLoginSchema);
    const userId = await upsertUser(c.env.DB, 'dev', body.email.toLowerCase(), body.email, body.name, now);
    for (const role of body.roles ?? []) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO system_roles (user_id, role, assigned_by, assigned_at) VALUES (?, ?, ?, ?)')
        .bind(userId, role as SystemRole, 'dev-login', now)
        .run();
    }
    await createSession(c, deps, userId, false);
    return c.json({ ok: true, userId });
  });

  return r;
}
