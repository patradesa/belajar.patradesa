import { request, type APIRequestContext } from '@playwright/test';
import demo from '../../db/seed/demo-course.json' with { type: 'json' };
import { startMockStudio } from './mock-studio';

const BASE = 'http://localhost:8787';

export async function apiLogin(email: string, name: string, roles: string[] = []): Promise<{ ctx: APIRequestContext; csrf: string }> {
  const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
  const r = await ctx.post('/api/v1/auth/dev-login', { data: { email, name, roles } });
  if (!r.ok()) throw new Error(`dev-login ${r.status()} ${await r.text()}`);
  const me = await (await ctx.get('/api/v1/me')).json();
  return { ctx, csrf: me.csrfToken };
}

/** Isi D1 lokal e2e dengan kelas demo FIKTIF lewat API admin (idempoten). */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const studio = await startMockStudio();
  await seed();
  return async () => {
    await new Promise((r) => (studio ? studio.close(r) : r(null)));
  };
}

async function seed(): Promise<void> {
  const { ctx, csrf } = await apiLogin('admin-e2e@contoh.test', 'Admin E2E', ['admin']);
  const h = { 'x-csrf-token': csrf };
  const cat = await (await ctx.get('/api/v1/catalog')).json();
  if (cat.courses.some((c: { slug: string }) => c.slug === demo.course.slug)) return;
  const { course } = demo;
  const created = await (await ctx.post('/api/v1/admin/courses', { headers: h, data: { slug: course.slug, title: course.title, description: course.description, visibility: course.visibility } })).json();
  for (const l of demo.lessons) {
    const lr = await (
      await ctx.post(`/api/v1/admin/courses/${created.id}/lessons`, {
        headers: h,
        data: { title: l.title, summary: l.summary, contentType: l.contentType, contentSource: l.contentSource, requiredActiveSeconds: l.requiredActiveSeconds, isRequired: l.isRequired },
      })
    ).json();
    if ('assessment' in l && l.assessment) {
      const { questions, essays, ...settings } = l.assessment;
      // E2E: banyak percobaan agar spesifikasi dapat diulang.
      const a = await (await ctx.put(`/api/v1/admin/lessons/${lr.id}/assessment`, { headers: h, data: { ...settings, maxAttempts: 20 } })).json();
      for (const q of [...questions, ...essays]) await ctx.post(`/api/v1/admin/assessments/${a.id}/questions`, { headers: h, data: q });
    }
  }
  const pub = await ctx.post(`/api/v1/admin/courses/${created.id}/publish`, { headers: h });
  if (!pub.ok()) throw new Error(`publish ${pub.status()}`);
  await ctx.patch(`/api/v1/admin/courses/${created.id}`, { headers: h, data: { recommendedFor: course.recommendedFor } });
  await ctx.dispose();
}
