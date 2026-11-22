import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';

/**
 * Alamat kanonik: halaman yang dibuka lewat alamat *.workers.dev dialihkan (301) ke APP_ORIGIN
 * (mis. https://belajar.patradesa.id). Login, cookie __Host- dan cek CSRF Origin hanya berlaku di
 * APP_ORIGIN, jadi alamat lama tidak boleh dipakai untuk belajar. API tidak dialihkan (cek kesehatan,
 * permintaan non-GET tetap ditolak oleh CSRF bila asalnya bukan APP_ORIGIN).
 */
export const canonicalHost: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD') return next();
  const url = new URL(c.req.url);
  if (!url.hostname.endsWith('.workers.dev') || url.pathname.startsWith('/api/')) return next();
  let canonical: URL;
  try {
    canonical = new URL(c.env.APP_ORIGIN);
  } catch {
    return next();
  }
  if (canonical.host === url.host || canonical.protocol !== 'https:') return next();
  return c.redirect(`${canonical.origin}${url.pathname}${url.search}`, 301);
};
