import { Hono } from 'hono';
import type { AppEnv } from '../env';

/**
 * /robots.txt dan /sitemap.xml untuk crawler.
 * Tanpa rute ini keduanya jatuh ke SPA fallback (wrangler.toml: not_found_handling) dan mengembalikan HTML.
 *
 * Pengindeksan hanya diizinkan bila permintaan datang ke APP_ORIGIN https (domain resmi). Host lain
 * (localhost, pratinjau) mendapat `Disallow: /` agar salinan non-resmi tidak terindeks.
 */

/** Slug panduan di apps/web/src/guide/content.ts (GUIDES). Dicocokkan oleh tests/integration/seo.test.ts. */
export const GUIDE_SLUGS = ['peserta', 'admin'] as const;

/** Halaman privat/transaksional: tidak berguna di hasil pencarian. */
const DISALLOW = ['/api/', '/admin', '/masuk', '/profil', '/kelas-saya', '/materi/', '/kuis/', '/hasil/', '/sertifikat/'];

const CACHE = 'public, max-age=3600';

function canonicalOrigin(appOrigin: string, requestUrl: string): string | null {
  try {
    const canonical = new URL(appOrigin);
    if (canonical.protocol !== 'https:') return null;
    return canonical.host === new URL(requestUrl).host ? canonical.origin : null;
  } catch {
    return null;
  }
}

const xmlEscape = (s: string): string =>
  s.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch]!);

export function seoRoutes() {
  const r = new Hono<AppEnv>();

  r.get('/robots.txt', (c) => {
    const origin = canonicalOrigin(c.env.APP_ORIGIN, c.req.url);
    const body = origin
      ? ['User-agent: *', 'Allow: /', ...DISALLOW.map((p) => `Disallow: ${p}`), '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n')
      : 'User-agent: *\nDisallow: /\n';
    c.header('Cache-Control', CACHE);
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(body, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
  });

  r.get('/sitemap.xml', async (c) => {
    const origin = canonicalOrigin(c.env.APP_ORIGIN, c.req.url) ?? new URL(c.req.url).origin;
    const { results } = await c.env.DB.prepare(
      `SELECT c.slug, COALESCE(cv.published_at, c.updated_at) AS ts
         FROM courses c LEFT JOIN course_versions cv ON cv.id = c.current_version_id
        WHERE c.status = 'published' AND c.visibility = 'public' AND c.current_version_id IS NOT NULL
        ORDER BY c.slug`,
    ).all<{ slug: string; ts: number | null }>();

    const urls: { loc: string; lastmod?: string }[] = [
      { loc: '/' },
      { loc: '/panduan' },
      ...GUIDE_SLUGS.map((s) => ({ loc: `/panduan/${s}` })),
      ...results.map((row) => ({
        loc: `/kelas/${encodeURIComponent(row.slug)}`,
        lastmod: row.ts ? new Date(row.ts).toISOString().slice(0, 10) : undefined,
      })),
    ];
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls
        .map((u) => `  <url><loc>${xmlEscape(origin + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
        .join('\n') +
      '\n</urlset>\n';
    c.header('Cache-Control', CACHE);
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(body, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
  });

  return r;
}
