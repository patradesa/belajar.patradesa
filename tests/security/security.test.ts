/** Uji keamanan: authN/Z, IDOR, CSRF, dev-login, OAuth state/PKCE, Turnstile, R2 privat, upload, header, injeksi. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, ORIGIN, createHarness, readyLearner, seedDemoCourse, type Harness } from '../helpers/harness';

let h: Harness;
let admin: Client;
let courseId: string;
let lessonIds: string[];
let assessmentId: string;

beforeAll(async () => {
  h = await createHarness({ GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-secret', TURNSTILE_SECRET_KEY: 'turnstile-test' });
  admin = await new Client(h).login('admin@contoh.test', 'Admin Uji', ['admin']);
  ({ courseId, lessonIds, assessmentId } = await seedDemoCourse(admin));
});
afterAll(() => h.dispose());

describe('autentikasi & otorisasi', () => {
  it('endpoint privat menolak anonim; admin menolak learner/mentor sesuai role', async () => {
    const anon = new Client(h);
    for (const p of ['/api/v1/me', '/api/v1/me/courses', `/api/v1/lessons/${lessonIds[0]}/content`, '/api/v1/admin/courses']) {
      expect((await anon.json('GET', p)).status, p).toBe(401);
    }
    const learner = await new Client(h).login('l@contoh.test', 'L');
    expect((await learner.json('GET', '/api/v1/admin/courses')).status).toBe(403);
    expect((await learner.json('POST', '/api/v1/admin/courses', { slug: 'abc', title: 'abc' })).status).toBe(403);
    expect((await learner.json('GET', '/api/v1/admin/reviews')).status).toBe(403);
    const mentor = await new Client(h).login('m@contoh.test', 'M', ['mentor']);
    expect((await mentor.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(403);
  });

  it('PATCH /me tidak bisa menyuntik role sistem (mass assignment)', async () => {
    const l = await new Client(h).login('esc@contoh.test', 'Esc');
    const r = await l.json('PATCH', '/api/v1/me', { villageRole: 'perbekel', roles: ['admin'] });
    expect(r.status).toBe(400);
    const me = await l.json('GET', '/api/v1/me');
    expect(me.body.roles).toEqual(['learner']);
  });

  it('admin biasa tidak dapat memberi role admin (hanya super_admin); perubahan role mencabut sesi target', async () => {
    const target = await new Client(h).login('t@contoh.test', 'T');
    const tid = (await target.json('GET', '/api/v1/me')).body.user.id;
    expect((await admin.json('POST', `/api/v1/admin/users/${tid}/roles`, { role: 'admin', grant: true })).status).toBe(403);
    expect((await admin.json('POST', `/api/v1/admin/users/${tid}/roles`, { role: 'mentor', grant: true })).status).toBe(200);
    expect((await target.json('GET', '/api/v1/me')).status).toBe(401);
  });

  it('IDOR: attempt/hasil milik orang lain → 404', async () => {
    const a = await new Client(h).login('owner@contoh.test', 'Owner');
    await readyLearner(a, courseId, lessonIds[1]!);
    const att = (await a.json('POST', `/api/v1/assessments/${assessmentId}/attempts`)).body;
    const b = await new Client(h).login('intruder@contoh.test', 'Intruder');
    await readyLearner(b, courseId, lessonIds[1]!);
    expect((await b.json('GET', `/api/v1/attempts/${att.id}`)).status).toBe(404);
    expect((await b.json('PATCH', `/api/v1/attempts/${att.id}/answers`, { answers: [{ questionId: att.questions[0].id, optionKey: null }] })).status).toBe(404);
    expect((await b.json('POST', `/api/v1/attempts/${att.id}/submit`)).status).toBe(404);
    expect((await b.json('GET', `/api/v1/attempts/${att.id}/result`)).status).toBe(404);
    await a.json('POST', `/api/v1/attempts/${att.id}/submit`);
  });

  it('IDOR: pengguna yang tidak terdaftar di kelas tidak bisa membaca materi, mencatat waktu belajar, atau memulai kuis', async () => {
    const outsider = await new Client(h).login('luar@contoh.test', 'Orang Luar');
    const results = {
      content: (await outsider.json('GET', `/api/v1/lessons/${lessonIds[0]}/content`)).status,
      file: (await outsider.json('GET', `/api/v1/lessons/${lessonIds[0]}/file`)).status,
      session: (await outsider.json('POST', `/api/v1/lessons/${lessonIds[0]}/session`)).status,
      heartbeat: (await outsider.json('POST', `/api/v1/lessons/${lessonIds[0]}/heartbeat`, { sessionId: 'sesi-milik-orang-lain', visible: true, interacted: true })).status,
      attempt: (await outsider.json('POST', `/api/v1/assessments/${assessmentId}/attempts`)).status,
    };
    expect(results).toEqual({ content: 404, file: 404, session: 404, heartbeat: 404, attempt: 404 });
    // Tidak ada attempt/progres yang tercipta untuk pengguna tanpa enrollment.
    const orphan = await h.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM attempts WHERE user_id NOT IN (SELECT user_id FROM enrollments)) +
              (SELECT COUNT(*) FROM lesson_progress WHERE user_id NOT IN (SELECT user_id FROM enrollments)) AS n`,
    ).first<{ n: number }>();
    expect(orphan!.n).toBe(0);
  });

  it('sesi: logout mencabut token; login merotasi sesi (anti session fixation)', async () => {
    const c = await new Client(h).login('sess@contoh.test', 'Sess');
    const oldCookie = c.cookie;
    await c.login('sess@contoh.test', 'Sess');
    expect(c.cookie).not.toBe(oldCookie);
    const fixated = new Client(h);
    fixated.cookie = oldCookie;
    expect((await fixated.json('GET', '/api/v1/me')).status).toBe(401);
    const stolen = c.cookie;
    expect((await c.json('POST', '/api/v1/auth/logout')).status).toBe(200);
    const replay = new Client(h);
    replay.cookie = stolen;
    expect((await replay.json('GET', '/api/v1/me')).status).toBe(401);
    const hash = await h.env.DB.prepare('SELECT token_hash FROM sessions LIMIT 1').first<{ token_hash: string }>();
    expect(stolen).not.toContain(hash!.token_hash); // hanya hash yang disimpan
  });

  it('cookie sesi: __Host-, HttpOnly, Secure, SameSite=Lax, Path=/', async () => {
    const res = await new Client(h).raw('POST', '/api/v1/auth/dev-login', { email: 'ck@contoh.test', name: 'Ck' });
    const sc = res.headers.get('set-cookie')!;
    expect(sc).toMatch(/^__Host-pd_session=/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/Secure/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toMatch(/Path=\//);
    expect(sc).not.toMatch(/Domain=/i);
  });
});

describe('CSRF', () => {
  it('mutasi tanpa Origin same-origin atau tanpa token CSRF ditolak', async () => {
    const c = await new Client(h).login('csrf@contoh.test', 'Csrf');
    expect((await c.json('PATCH', '/api/v1/me', { villageRole: 'kader' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await c.json('PATCH', '/api/v1/me', { villageRole: 'kader' }, { 'x-csrf-token': 'salah' })).status).toBe(403);
    const noOrigin = await h.app.request(`${ORIGIN}/api/v1/me`, { method: 'PATCH', headers: { cookie: c.cookie!, 'content-type': 'application/json', 'x-csrf-token': c.csrf! }, body: '{}' }, h.env);
    expect(noOrigin.status).toBe(403);
    expect((await c.json('PATCH', '/api/v1/me', { villageRole: 'kader' })).status).toBe(200);
  });

  it('token CSRF terikat sesi: token sesi lain tidak berlaku', async () => {
    const a = await new Client(h).login('csrf-a@contoh.test', 'A');
    const b = await new Client(h).login('csrf-b@contoh.test', 'B');
    expect((await a.json('PATCH', '/api/v1/me', { villageRole: 'kader' }, { 'x-csrf-token': b.csrf! })).status).toBe(403);
  });
});

describe('login', () => {
  it('dev-login 404 di staging/production dan pada host non-localhost', async () => {
    for (const ENVIRONMENT of ['staging', 'production'] as const) {
      const env = { ...h.env, ENVIRONMENT };
      const r = await h.app.request(`${ORIGIN}/api/v1/auth/dev-login`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@contoh.test', name: 'X', roles: ['super_admin'] }) }, env);
      expect(r.status, ENVIRONMENT).toBe(404);
    }
    const env = { ...h.env, APP_ORIGIN: 'https://belajar.patradesa.id' };
    const r = await h.app.request('https://belajar.patradesa.id/api/v1/auth/dev-login', { method: 'POST', headers: { origin: 'https://belajar.patradesa.id', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@contoh.test', name: 'X' }) }, env);
    expect(r.status).toBe(404);
    const off = { ...h.env, DEV_LOGIN_ENABLED: 'false' };
    const r2 = await h.app.request(`${ORIGIN}/api/v1/auth/dev-login`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@contoh.test', name: 'X' }) }, off);
    expect(r2.status).toBe(404);
  });

  it('Google start: Turnstile diverifikasi server-side; gagal → 403; sukses → URL PKCE S256 + state + nonce', async () => {
    const c = new Client(h);
    h.fetchMock = async () => new Response(JSON.stringify({ success: false }));
    const bad = await c.json('POST', '/api/v1/auth/google/start', { turnstileToken: 'x' });
    expect(bad.status).toBe(403);
    expect(bad.body.error.code).toBe('TURNSTILE_FAILED');
    expect(h.fetchLog.at(-1)!.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    h.fetchMock = async () => new Response(JSON.stringify({ success: true }));
    const ok = await c.json('POST', '/api/v1/auth/google/start', { turnstileToken: 'x', returnTo: '/kelas/abc' });
    expect(ok.status).toBe(200);
    const u = new URL(ok.body.url);
    expect(u.origin).toBe('https://accounts.google.com');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/v1/auth/google/callback`);
    expect(u.searchParams.get('state')!.length).toBeGreaterThan(30);
    expect(u.searchParams.get('nonce')).toBeTruthy();
    // returnTo open-redirect ditolak.
    expect((await c.json('POST', '/api/v1/auth/google/start', { turnstileToken: 'x', returnTo: '//evil.example' })).status).toBe(400);
  });

  it('callback: state sekali pakai, nonce diverifikasi, email harus terverifikasi', async () => {
    h.fetchMock = async (url) =>
      url.includes('siteverify') ? new Response(JSON.stringify({ success: true })) : new Response(JSON.stringify({ id_token: 'fake.jwt.token' }));
    const c = new Client(h);
    const start = await c.json('POST', '/api/v1/auth/google/start', { turnstileToken: 'x' });
    const u = new URL(start.body.url);
    const state = u.searchParams.get('state')!;
    const nonce = u.searchParams.get('nonce')!;
    let seenNonce = '';
    h.deps.verifyGoogleIdToken = async (_t, aud, n) => {
      seenNonce = n;
      expect(aud).toBe('test-client.apps.googleusercontent.com');
      return { sub: 'google-sub-1', email: 'Warga.Fiktif@Contoh.test', emailVerified: true, name: 'Warga Fiktif' };
    };
    const cb = await c.raw('GET', `/api/v1/auth/google/callback?code=abc&state=${state}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/profil?baru=1');
    expect(seenNonce).toBe(nonce);
    const tokenCall = h.fetchLog.find((f) => f.url === 'https://oauth2.googleapis.com/token')!;
    expect(String(tokenCall.init!.body)).toContain('code_verifier=');
    expect((await c.json('GET', '/api/v1/me')).body.user.email).toBe('warga.fiktif@contoh.test');
    // Replay state → gagal.
    const replay = await new Client(h).raw('GET', `/api/v1/auth/google/callback?code=abc&state=${state}`);
    expect(replay.headers.get('location')).toBe('/masuk?galat=1');
    // Email belum terverifikasi → gagal.
    // Klien yang sudah login wajib menyertakan CSRF; gunakan browser anonim baru untuk alur kedua.
    const s2 = new URL((await new Client(h).json('POST', '/api/v1/auth/google/start', { turnstileToken: 'x' })).body.url).searchParams.get('state')!;
    h.deps.verifyGoogleIdToken = async () => ({ sub: 'google-sub-2', email: 'x@contoh.test', emailVerified: false, name: 'X' });
    const unv = await new Client(h).raw('GET', `/api/v1/auth/google/callback?code=abc&state=${s2}`);
    expect(unv.headers.get('location')).toBe('/masuk?galat=1');
  });

  it('rate limit pada endpoint login', async () => {
    h.fetchMock = async () => new Response(JSON.stringify({ success: false }));
    const c = new Client(h);
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const r = await c.json('POST', '/api/v1/auth/google/start', { turnstileToken: 'x' }, { 'cf-connecting-ip': '203.0.113.9' });
      if (r.status === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});

describe('konten & berkas', () => {
  it('PDF privat: anonim 401, tidak terdaftar 404, terdaftar 200 dengan no-store', async () => {
    const d = await admin.json('POST', `/api/v1/admin/courses/${courseId}/draft`);
    expect([200, 201]).toContain(d.status);
    const detail = await admin.json('GET', `/api/v1/admin/courses/${courseId}`);
    const lid = detail.body.lessons[0].id;
    const notPdf = await admin.raw('PUT', `/api/v1/admin/lessons/${lid}/file`, new TextEncoder().encode('<script>alert(1)</script>'), { 'content-type': 'application/pdf' });
    expect(notPdf.status).toBe(415);
    const wrongType = await admin.raw('PUT', `/api/v1/admin/lessons/${lid}/file`, new TextEncoder().encode('%PDF-1.4 x'), { 'content-type': 'text/html' });
    expect(wrongType.status).toBe(415);
    const pdf = new TextEncoder().encode('%PDF-1.4\n% dokumen uji fiktif\n%%EOF');
    expect((await admin.raw('PUT', `/api/v1/admin/lessons/${lid}/file`, pdf, { 'content-type': 'application/pdf' })).status).toBe(200);
    await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`);
    const learner = await new Client(h).login('pdf@contoh.test', 'Pdf');
    expect((await learner.json('GET', `/api/v1/lessons/${lid}/file`)).status).toBe(404);
    expect((await new Client(h).json('GET', `/api/v1/lessons/${lid}/file`)).status).toBe(401);
    await learner.json('POST', `/api/v1/courses/${courseId}/enroll`);
    const f = await learner.raw('GET', `/api/v1/lessons/${lid}/file`);
    expect(f.status).toBe(200);
    expect(f.headers.get('content-type')).toBe('application/pdf');
    expect(f.headers.get('cache-control')).toContain('no-store');
    // Kunci objek R2 tidak dibocorkan ke learner.
    const content = await learner.json('GET', `/api/v1/lessons/${lid}/content`);
    expect(content.body.fileUrl).toBe(`/api/v1/lessons/${lid}/file`);
    const key = await h.env.DB.prepare('SELECT file_key FROM lessons WHERE id = ?').bind(lid).first<{ file_key: string }>();
    expect(JSON.stringify(content.body)).not.toContain(key!.file_key);
  });

  it('XSS lewat materi: HTML mentah disimpan sebagai teks, tautan javascript: dibuang', async () => {
    await admin.json('POST', `/api/v1/admin/courses/${courseId}/draft`);
    const detail = await admin.json('GET', `/api/v1/admin/courses/${courseId}`);
    const lid = detail.body.lessons[0].id;
    const src = '<img src=x onerror=alert(1)>\n\n[klik](javascript:alert(1)) dan [aman](https://contoh.test/a)';
    expect((await admin.json('PUT', `/api/v1/admin/lessons/${lid}`, { title: 'XSS', contentType: 'html', contentSource: src })).status).toBe(200);
    const row = await h.env.DB.prepare('SELECT content_json FROM lessons WHERE id = ?').bind(lid).first<{ content_json: string }>();
    const blocks = JSON.parse(row!.content_json);
    expect(blocks[0]).toEqual({ type: 'p', inlines: [{ t: 'text', v: '<img src=x onerror=alert(1)>' }] });
    expect(JSON.stringify(blocks)).not.toContain('"href":"javascript');
    expect(JSON.stringify(blocks)).toContain('"href":"https://contoh.test/a"');
  });

  it('injeksi SQL pada parameter & pencarian tidak berefek (prepared statements)', async () => {
    const r = await admin.json('GET', `/api/v1/admin/users?q=${encodeURIComponent("' OR 1=1; DROP TABLE users; --")}`);
    expect(r.status).toBe(200);
    expect(r.body.users).toHaveLength(0);
    expect((await admin.json('GET', `/api/v1/courses/${encodeURIComponent("x' OR '1'='1")}`)).status).toBe(404);
    const still = await h.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
    expect(still!.n).toBeGreaterThan(0);
  });

  it('header keamanan & no-store pada respons API personal', async () => {
    const c = await new Client(h).login('hdr@contoh.test', 'Hdr');
    const r = await c.raw('GET', '/api/v1/me');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    const prod = await h.app.request(`${ORIGIN}/api/v1/health`, {}, { ...h.env, ENVIRONMENT: 'production' });
    expect(prod.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('body JSON tidak valid / terlalu besar ditolak dengan rapi', async () => {
    const c = await new Client(h).login('json@contoh.test', 'Json');
    const bad = await c.raw('PATCH', '/api/v1/me', undefined, { 'content-type': 'application/json' });
    expect(bad.status).toBe(400);
    const big = await c.json('PATCH', '/api/v1/me', { villageName: 'x'.repeat(300_000) });
    expect(big.status).toBe(413);
  });

  it('AI lock tidak dapat dimatikan di DB (CHECK constraint) dan audit log tidak menyimpan teks esai', async () => {
    await expect(h.env.DB.prepare('UPDATE assessment_policies SET ai_lock_enabled = 0').run()).rejects.toThrow(/CHECK/);
    const logs = await h.env.DB.prepare('SELECT metadata_redacted FROM admin_audit_logs').all<{ metadata_redacted: string }>();
    for (const l of logs.results) expect(l.metadata_redacted.length).toBeLessThan(300);
  });
});
