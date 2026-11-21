// Isi D1 LOKAL dengan kelas demo FIKTIF lewat API admin (dev-login). Hanya untuk localhost.
// Pemakaian: `npm run dev` (terminal 1), lalu `npm run seed:dev` (terminal 2).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.SEED_BASE ?? 'http://localhost:8787';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error('Seed hanya untuk server lokal.');
  process.exit(1);
}
const demo = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'db', 'seed', 'demo-course.json'), 'utf8'));
let cookie = '';
let csrf = '';

async function call(method, path, body) {
  const headers = { origin: BASE, accept: 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  const m = set && /__Host-pd_session=([^;]+)/.exec(set);
  if (m) cookie = `__Host-pd_session=${m[1]}`;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

await call('POST', '/api/v1/auth/dev-login', { email: 'admin@contoh.test', name: 'Admin Contoh', roles: ['admin', 'mentor'] });
csrf = (await call('GET', '/api/v1/me')).csrfToken;
const cat = await call('GET', '/api/v1/catalog');
if (cat.courses.some((c) => c.slug === demo.course.slug)) {
  console.log('Kelas demo sudah ada.');
  process.exit(0);
}
const { course } = demo;
const created = await call('POST', '/api/v1/admin/courses', { slug: course.slug, title: course.title, description: course.description, visibility: course.visibility });
for (const l of demo.lessons) {
  const lr = await call('POST', `/api/v1/admin/courses/${created.id}/lessons`, {
    title: l.title,
    summary: l.summary,
    contentType: l.contentType,
    contentSource: l.contentSource,
    requiredActiveSeconds: l.requiredActiveSeconds,
    isRequired: l.isRequired,
  });
  if (l.assessment) {
    const { questions, essays, ...settings } = l.assessment;
    const a = await call('PUT', `/api/v1/admin/lessons/${lr.id}/assessment`, settings);
    for (const q of [...questions, ...essays]) await call('POST', `/api/v1/admin/assessments/${a.id}/questions`, q);
  }
}
await call('POST', `/api/v1/admin/courses/${created.id}/publish`);
await call('PATCH', `/api/v1/admin/courses/${created.id}`, { recommendedFor: course.recommendedFor });
console.log(`Kelas demo dibuat: ${BASE}/kelas/${course.slug} (admin: admin@contoh.test via dev-login)`);
