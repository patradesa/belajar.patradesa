/**
 * Harness integrasi: Hono app asli + D1 & R2 asli (workerd lokal via Miniflare), jam yang dapat
 * dikendalikan, dan AI provider spy. Tidak ada mock database.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { createApp } from '../../apps/api/src/app';
import type { Deps, Env } from '../../apps/api/src/env';
import type { AiProvider, AiRequest, AiResponse } from '../../apps/api/src/ai/provider';
import { runMaintenance } from '../../apps/api/src/scheduled';
import demo from '../../db/seed/demo-course.json';

const ROOT = join(__dirname, '..', '..');
export const ORIGIN = 'http://localhost';

export class SpyAiProvider implements AiProvider {
  enabled = true;
  calls: AiRequest[] = [];
  /** Hook opsional yang dijalankan selama "inference" (untuk uji balapan). */
  during: (() => Promise<void>) | null = null;
  async generate(req: AiRequest): Promise<AiResponse> {
    this.calls.push(req);
    if (this.during) await this.during();
    return { text: 'jawaban uji', inputTokens: 10, outputTokens: 5, modelId: 'spy' };
  }
}

export function splitSql(sql: string): string[] {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface Harness {
  mf: Miniflare;
  env: Env;
  clock: { t: number };
  ai: SpyAiProvider;
  app: ReturnType<typeof createApp>;
  deps: Deps;
  fetchLog: { url: string; init?: RequestInit }[];
  fetchMock: (url: string, init?: RequestInit) => Promise<Response>;
  maintenance: () => Promise<{ expired: number }>;
  dispose: () => Promise<void>;
}

export async function createHarness(envOverrides: Partial<Env> = {}): Promise<Harness> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response(null, { status: 404 }); } }',
    compatibilityDate: '2026-08-01',
    d1Databases: { DB: `test-${crypto.randomUUID()}` },
    r2Buckets: { FILES: `files-${crypto.randomUUID()}` },
  });
  const DB = (await mf.getD1Database('DB')) as unknown as D1Database;
  const FILES = (await mf.getR2Bucket('FILES')) as unknown as R2Bucket;
  const migDir = join(ROOT, 'db', 'migrations');
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql')).sort()) {
    const stmts = splitSql(readFileSync(join(migDir, f), 'utf8'));
    await DB.batch(stmts.map((s) => DB.prepare(s)));
  }
  const clock = { t: Date.UTC(2026, 10, 21, 2, 0, 0) };
  const ai = new SpyAiProvider();
  const fetchLog: Harness['fetchLog'] = [];
  const h: Partial<Harness> = {};
  h.fetchMock = async () => new Response('{}', { status: 500 });
  const deps: Deps = {
    now: () => clock.t,
    ai,
    fetch: (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      fetchLog.push({ url, init });
      return h.fetchMock!(url, init);
    },
    verifyGoogleIdToken: async () => {
      throw new Error('not configured in test');
    },
  };
  const env: Env = {
    DB,
    FILES,
    ENVIRONMENT: 'development',
    APP_ORIGIN: ORIGIN,
    DEV_LOGIN_ENABLED: 'true',
    SESSION_SECRET: 'test-secret-not-for-production-0123456789abcdef',
    ...envOverrides,
  };
  return Object.assign(h, {
    mf,
    env,
    clock,
    ai,
    deps,
    app: createApp(deps),
    fetchLog,
    maintenance: () => runMaintenance(DB, clock.t),
    dispose: () => mf.dispose(),
  }) as Harness;
}

/** Klien HTTP dengan cookie jar + token CSRF; satu instance = satu "perangkat/browser". */
export class Client {
  cookie: string | null = null;
  csrf: string | null = null;
  constructor(
    private h: Harness,
    public label = 'device',
  ) {}

  async raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const hdrs: Record<string, string> = { ...headers };
    if (this.cookie) hdrs.cookie = this.cookie;
    if (method !== 'GET' && method !== 'HEAD') {
      hdrs.origin ??= ORIGIN;
      if (this.csrf) hdrs['x-csrf-token'] ??= this.csrf;
    }
    let payload: BodyInit | undefined;
    if (body instanceof ArrayBuffer || body instanceof Uint8Array) {
      payload = body as BodyInit;
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      hdrs['content-type'] ??= 'application/json';
    }
    const res = await this.h.app.request(`${ORIGIN}${path}`, { method, headers: hdrs, body: payload }, this.h.env);
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = /__Host-pd_session=([^;]*)/.exec(set);
      if (m) this.cookie = m[1] ? `__Host-pd_session=${m[1]}` : null;
    }
    return res;
  }

  async json<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T }> {
    const res = await this.raw(method, path, body, headers);
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }

  async login(email: string, name: string, roles: string[] = []): Promise<this> {
    const r = await this.json('POST', '/api/v1/auth/dev-login', { email, name, roles });
    if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.body)}`);
    const me = await this.json('GET', '/api/v1/me');
    this.csrf = me.body.csrfToken;
    return this;
  }
}

type DemoAssessment = NonNullable<(typeof demo.lessons)[1]['assessment']>;
type DemoQuestion = DemoAssessment['questions'][number] | DemoAssessment['essays'][number];

/** Bangun kelas demo fiktif lewat API admin (sekaligus menguji alur admin). */
export async function seedDemoCourse(admin: Client): Promise<{ courseId: string; lessonIds: string[]; assessmentId: string }> {
  const created = await admin.json('POST', '/api/v1/admin/courses', {
    slug: demo.course.slug,
    title: demo.course.title,
    description: demo.course.description,
    visibility: demo.course.visibility,
  });
  if (created.status !== 201) throw new Error(`create course ${created.status} ${JSON.stringify(created.body)}`);
  const courseId: string = created.body.id;
  const lessonIds: string[] = [];
  let assessmentId = '';
  for (const l of demo.lessons) {
    const lr = await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, {
      title: l.title,
      summary: l.summary,
      contentType: l.contentType,
      contentSource: l.contentSource,
      requiredActiveSeconds: l.requiredActiveSeconds,
      isRequired: l.isRequired,
    });
    if (lr.status !== 201) throw new Error(`lesson ${lr.status} ${JSON.stringify(lr.body)}`);
    lessonIds.push(lr.body.id);
    if ('assessment' in l && l.assessment) {
      const { questions, essays, ...settings } = l.assessment;
      const ar = await admin.json('PUT', `/api/v1/admin/lessons/${lr.body.id}/assessment`, settings);
      if (ar.status !== 200) throw new Error(`assessment ${ar.status} ${JSON.stringify(ar.body)}`);
      assessmentId = ar.body.id;
      for (const q of [...questions, ...essays] as DemoQuestion[]) {
        const qr = await admin.json('POST', `/api/v1/admin/assessments/${assessmentId}/questions`, q);
        if (qr.status !== 201) throw new Error(`question ${qr.status} ${JSON.stringify(qr.body)}`);
      }
    }
  }
  const pub = await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`);
  if (pub.status !== 200) throw new Error(`publish ${pub.status} ${JSON.stringify(pub.body)}`);
  await admin.json('PATCH', `/api/v1/admin/courses/${courseId}`, { recommendedFor: demo.course.recommendedFor });
  // Kuis baru di versi terbit: assessment id berubah? Tidak â€” publish tidak meng-clone, draft langsung jadi terbit.
  return { courseId, lessonIds, assessmentId };
}

/** Enroll learner, buka lesson kuis, dan penuhi syarat waktu belajar (lesson kuis demo: 0 detik). */
export async function readyLearner(learner: Client, courseId: string, quizLessonId: string): Promise<void> {
  const e = await learner.json('POST', `/api/v1/courses/${courseId}/enroll`);
  if (e.status !== 201 && e.status !== 200) throw new Error(`enroll ${e.status} ${JSON.stringify(e.body)}`);
  const s = await learner.json('POST', `/api/v1/lessons/${quizLessonId}/session`);
  if (s.status !== 201) throw new Error(`session ${s.status} ${JSON.stringify(s.body)}`);
}
