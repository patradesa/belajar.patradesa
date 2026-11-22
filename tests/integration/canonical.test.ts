/** Alamat kanonik: halaman di *.workers.dev dialihkan ke APP_ORIGIN; API dan domain resmi tidak dialihkan. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/harness';

const OLD = 'https://belajar-patradesa.patradesa-id.workers.dev';
const NEW = 'https://belajar.patradesa.id';
let h: Harness;

beforeAll(async () => {
  h = await createHarness({ APP_ORIGIN: NEW });
});
afterAll(() => h.dispose());

const req = (url: string, init: RequestInit = {}) => h.app.request(url, { redirect: 'manual', ...init }, h.env);

describe('alamat kanonik', () => {
  it('halaman di workers.dev → 301 ke domain resmi (path & query dipertahankan)', async () => {
    const r = await req(`${OLD}/kelas/penyelenggaraan-pemerintahan-desa?dari=wa`);
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe(`${NEW}/kelas/penyelenggaraan-pemerintahan-desa?dari=wa`);
    const root = await req(`${OLD}/`, { method: 'HEAD' });
    expect(root.status).toBe(301);
    expect(root.headers.get('location')).toBe(`${NEW}/`);
  });

  it('API di workers.dev tidak dialihkan; POST tetap ditolak CSRF karena asal bukan APP_ORIGIN', async () => {
    const health = await req(`${OLD}/api/v1/health`);
    expect(health.status).toBe(200);
    const post = await req(`${OLD}/api/v1/auth/logout`, { method: 'POST', headers: { origin: OLD } });
    expect(post.status).toBe(403);
  });

  it('domain resmi dan host lain (lokal) tidak dialihkan', async () => {
    expect((await req(`${NEW}/api/v1/health`)).status).toBe(200);
    const page = await req(`${NEW}/kelas/apa-saja`);
    expect(page.status).not.toBe(301);
    const local = await h.app.request('http://localhost/kelas/x', { redirect: 'manual' }, { ...h.env, APP_ORIGIN: 'http://localhost' });
    expect(local.status).not.toBe(301);
  });

  it('APP_ORIGIN bukan https (mis. pengembangan) tidak memicu pengalihan', async () => {
    const r = await h.app.request(`${OLD}/kelas/x`, { redirect: 'manual' }, { ...h.env, APP_ORIGIN: 'http://localhost:8787' });
    expect(r.status).not.toBe(301);
  });
});
