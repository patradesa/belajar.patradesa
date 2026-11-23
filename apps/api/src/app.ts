import { Hono } from 'hono';
import { ERROR_CODES } from '@patradesa/shared';
import type { AppEnv, Deps } from './env';
import { HttpError, errorBody } from './lib/http';
import { loadSession } from './middleware/auth';
import { apiSecurityHeaders, csrfProtection } from './middleware/security';
import { canonicalHost } from './middleware/canonical';
import { examLockGuard } from './services/examLock';
import { authRoutes } from './routes/auth';
import { learnerRoutes } from './routes/learner';
import { aiRoutes } from './routes/ai';
import { adminRoutes } from './routes/admin';
import { seoRoutes } from './routes/seo';
import { scenarioAdminRoutes } from './routes/adminScenarios';

/**
 * Urutan middleware penting (lihat ADR-0004):
 *   security headers -> load session -> CSRF -> EXAM LOCK GUARD (semua path /ai/) -> router.
 * Exam lock guard berada DI DEPAN router sehingga tidak ada route AI learner yang bisa lolos.
 */
export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  // Alamat lama *.workers.dev → APP_ORIGIN (domain resmi).
  app.use('*', canonicalHost);
  app.use('/api/*', apiSecurityHeaders);
  app.use('/api/*', loadSession(deps));
  app.use('/api/*', csrfProtection);
  app.use('/api/*', examLockGuard(deps));

  app.get('/api/v1/health', (c) => c.json({ ok: true }));
  app.route('/api/v1/auth', authRoutes(deps));
  app.route('/api/v1/admin/scenarios', scenarioAdminRoutes(deps));
  app.route('/api/v1/admin', adminRoutes(deps));
  app.route('/api/v1', aiRoutes(deps));
  app.route('/api/v1', learnerRoutes(deps));
  // robots.txt & sitemap.xml harus ditangani sebelum SPA fallback (notFound → ASSETS).
  app.route('/', seoRoutes());

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) return c.json(errorBody(ERROR_CODES.NOT_FOUND, 'Tidak ditemukan.'), 404);
    // Non-API: serahkan ke static assets (SPA fallback dikonfigurasi di wrangler.toml).
    return c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('Not found', 404);
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(errorBody(err.code, err.message, err.details), err.status);
    }
    // Jangan log body/header (bisa berisi esai/token); cukup nama & pesan teknis.
    console.error('unhandled', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown');
    return c.json(errorBody(ERROR_CODES.INTERNAL, 'Terjadi kesalahan pada server.'), 500);
  });

  return app;
}
