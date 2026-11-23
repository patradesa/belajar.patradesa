/** robots.txt & sitemap.xml disajikan Worker dengan content-type benar (bukan HTML SPA fallback). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GUIDES } from '../../apps/web/src/guide/content';
import { GUIDE_SLUGS } from '../../apps/api/src/routes/seo';
import { Client, createHarness, seedDemoCourse, type Harness } from '../helpers/harness';

const OFFICIAL = 'https://belajar.patradesa.id';
let h: Harness;
let slug: string;

beforeAll(async () => {
  h = await createHarness(); // Client memakai origin localhost (CSRF); APP_ORIGIN resmi diberikan per permintaan.
  const admin = await new Client(h).login('admin@contoh.test', 'Admin', ['admin']);
  const { courseId } = await seedDemoCourse(admin);
  slug = (await admin.json('GET', `/api/v1/courses/${courseId}`)).body.slug;
  // Kelas draft & privat tidak boleh masuk sitemap.
  await admin.json('POST', '/api/v1/admin/courses', { slug: 'kelas-draf-rahasia', title: 'Kelas Draf', description: '', visibility: 'public' });
});
afterAll(() => h.dispose());

const officialEnv = () => ({ ...h.env, APP_ORIGIN: OFFICIAL });
const get = (url: string, env = officialEnv()) => h.app.request(url, { redirect: 'manual' }, env);

describe('robots.txt', () => {
  it('domain resmi: text/plain, izinkan halaman publik, tolak area privat, rujuk sitemap', async () => {
    const r = await get(`${OFFICIAL}/robots.txt`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(r.headers.get('cache-control')).toBe('public, max-age=3600');
    const body = await r.text();
    expect(body).not.toMatch(/<html/i);
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    for (const p of ['/api/', '/admin', '/kuis/', '/materi/', '/sertifikat/']) expect(body).toContain(`Disallow: ${p}`);
    expect(body).toContain(`Sitemap: ${OFFICIAL}/sitemap.xml`);
  });

  it('host selain APP_ORIGIN https (lokal/pratinjau) → Disallow: /', async () => {
    const local = await get('http://localhost/robots.txt', { ...h.env, APP_ORIGIN: 'http://localhost' });
    expect(local.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await local.text()).toBe('User-agent: *\nDisallow: /\n');
    const other = await get('https://salinan.contoh.test/robots.txt');
    expect(await other.text()).toBe('User-agent: *\nDisallow: /\n');
  });

  it('HEAD juga dilayani', async () => {
    const r = await h.app.request(`${OFFICIAL}/robots.txt`, { method: 'HEAD' }, officialEnv());
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });
});

describe('sitemap.xml', () => {
  it('application/xml berisi beranda, panduan, dan kelas publik yang terbit saja', async () => {
    const r = await get(`${OFFICIAL}/sitemap.xml`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    const xml = await r.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(`<loc>${OFFICIAL}/</loc>`);
    expect(xml).toContain(`<loc>${OFFICIAL}/panduan</loc>`);
    expect(xml).toMatch(new RegExp(`<loc>${OFFICIAL}/kelas/${slug}</loc><lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`));
    expect(xml).not.toContain('kelas-draf-rahasia');
    expect(xml).not.toContain(`<loc>${OFFICIAL}/admin`);
  });

  it('daftar panduan sinkron dengan GUIDES di aplikasi web', async () => {
    expect([...GUIDE_SLUGS].sort()).toEqual(Object.keys(GUIDES).sort());
    const xml = await (await get(`${OFFICIAL}/sitemap.xml`)).text();
    for (const s of GUIDE_SLUGS) expect(xml).toContain(`<loc>${OFFICIAL}/panduan/${s}</loc>`);
  });
});
