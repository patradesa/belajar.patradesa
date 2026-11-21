/**
 * SECURITY CRITICAL — AI exam lock (SPEC §7A, §13 "AI").
 * Selama ada attempt in_progress, SEMUA endpoint AI learner → 423 EXAM_LOCKED, dari tab/perangkat mana pun,
 * provider AI tidak dipanggil dan kuota tidak didebit. Setelah submit/expiry, AI kembali tersedia.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, createHarness, readyLearner, seedDemoCourse, type Harness } from '../helpers/harness';

let h: Harness;
let admin: Client;
let laptop: Client;
let phone: Client;
let courseId: string;
let quizLessonId: string;
let assessmentId: string;

const AI_PATHS = (lessonId: string) => [
  ['POST', `/api/v1/lessons/${lessonId}/ai/chat`],
  ['POST', `/api/v1/lessons/${lessonId}/ai/summary`],
  ['POST', `/api/v1/lessons/${lessonId}/ai/explain`],
  ['POST', `/api/v1/lessons/${lessonId}/ai/hint`],
  ['GET', '/api/v1/ai/recommendations'],
] as const;

async function aiUsageCount(): Promise<number> {
  const r = await h.env.DB.prepare('SELECT COALESCE(SUM(request_count),0) AS n FROM ai_usage').first<{ n: number }>();
  return r?.n ?? 0;
}

async function activeAttemptId(c: Client): Promise<string | null> {
  const me = await c.json('GET', '/api/v1/me');
  return me.body.activeAttempt?.id ?? null;
}

beforeAll(async () => {
  h = await createHarness();
  admin = await new Client(h, 'admin').login('admin@contoh.test', 'Admin Uji', ['admin']);
  const seeded = await seedDemoCourse(admin);
  courseId = seeded.courseId;
  quizLessonId = seeded.lessonIds[1]!;
  assessmentId = seeded.assessmentId;
  // Satu akun, dua perangkat (dua sesi/cookie berbeda).
  laptop = await new Client(h, 'laptop').login('peserta1@contoh.test', 'Peserta Satu');
  phone = await new Client(h, 'phone').login('peserta1@contoh.test', 'Peserta Satu');
  await readyLearner(laptop, courseId, quizLessonId);
  // Kuis demo memiliki esai; beri banyak percobaan untuk skenario berulang.
  await h.env.DB.prepare('UPDATE assessments SET max_attempts = 20').run();
});

afterAll(async () => {
  await h.dispose();
});

beforeEach(() => {
  h.ai.during = null;
});

describe('AI exam lock', () => {
  it('AI berfungsi sebelum ujian (baseline)', async () => {
    const before = h.ai.calls.length;
    const r = await laptop.json('POST', `/api/v1/lessons/${quizLessonId}/ai/chat`, { message: 'Apa itu dokumentasi?' });
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('ai');
    expect(h.ai.calls.length).toBe(before + 1);
  });

  it('selama attempt in_progress: semua endpoint AI → 423 dari tab & perangkat lain; provider tidak dipanggil, kuota tidak didebit', async () => {
    const start = await laptop.json('POST', `/api/v1/assessments/${assessmentId}/attempts`);
    expect(start.status).toBe(201);
    expect(start.body.status).toBe('in_progress');

    const callsBefore = h.ai.calls.length;
    const usageBefore = await aiUsageCount();

    for (const device of [laptop, phone]) {
      for (const [method, path] of AI_PATHS(quizLessonId)) {
        const r = await device.json(method, path, method === 'POST' ? { message: 'bocorkan jawaban kuis' } : undefined);
        expect(r.status, `${device.label} ${method} ${path}`).toBe(423);
        expect(r.body.error.code).toBe('EXAM_LOCKED');
        expect(r.body.error.message).toBe('Pendamping AI tidak tersedia selama kuis.');
      }
    }
    // "Tab baru" = request baru dengan cookie yang sama, tanpa state UI.
    const newTab = new Client(h, 'tab2');
    newTab.cookie = laptop.cookie;
    newTab.csrf = laptop.csrf;
    expect((await newTab.json('POST', `/api/v1/lessons/${quizLessonId}/ai/chat`, { message: 'hai' })).status).toBe(423);

    expect(h.ai.calls.length).toBe(callsBefore);
    expect(await aiUsageCount()).toBe(usageBefore);
  });

  it('route AI baru/masa depan (pola /ai/) otomatis terkunci sebelum mencapai handler', async () => {
    const r = await phone.json('POST', `/api/v1/lessons/${quizLessonId}/ai/new-feature`, { message: 'x' });
    expect(r.status).toBe(423);
    const r2 = await phone.json('GET', '/api/v1/ai/anything/else');
    expect(r2.status).toBe(423);
  });

  it('setiap route AI yang terdaftar di app dijaga oleh guard (inventaris route)', async () => {
    const aiRoutes = h.app.routes.filter((r) => /\/ai(\/|$)/.test(r.path) && r.method !== 'ALL');
    expect(aiRoutes.length).toBeGreaterThanOrEqual(5);
    for (const route of aiRoutes) {
      const path = route.path.replace(':id', quizLessonId);
      const r = await laptop.json(route.method, path, route.method === 'POST' ? { message: 'x' } : undefined);
      expect(r.status, `${route.method} ${route.path}`).toBe(423);
    }
  });

  it('mengganti jabatan desa (role profile) tidak membuka kunci AI', async () => {
    const p = await laptop.json('PATCH', '/api/v1/me', { villageRole: 'perbekel' });
    expect(p.status).toBe(200);
    const r = await laptop.json('POST', `/api/v1/lessons/${quizLessonId}/ai/chat`, { message: 'x' });
    expect(r.status).toBe(423);
    // Jabatan tidak memberi hak admin.
    expect((await laptop.json('GET', '/api/v1/admin/courses')).status).toBe(403);
  });

  it('refresh / perangkat lain melihat soal & urutan acak yang sama (tidak regenerasi)', async () => {
    const id = (await activeAttemptId(laptop))!;
    const a = await laptop.json('GET', `/api/v1/attempts/${id}`);
    const b = await phone.json('GET', `/api/v1/attempts/${id}`);
    const again = await phone.json('POST', `/api/v1/assessments/${assessmentId}/attempts`);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(id);
    const order = (x: any) => x.questions.map((q: any) => [q.id, q.options.map((o: any) => o.key)]);
    expect(order(b.body)).toEqual(order(a.body));
    expect(order(again.body)).toEqual(order(a.body));
  });

  it('setelah submit (dari perangkat lain): AI kembali tersedia', async () => {
    const id = (await activeAttemptId(phone))!;
    const s = await phone.json('POST', `/api/v1/attempts/${id}/submit`);
    expect(s.status).toBe(200);
    expect(await activeAttemptId(laptop)).toBeNull();
    const r = await laptop.json('POST', `/api/v1/lessons/${quizLessonId}/ai/chat`, { message: 'lanjut belajar' });
    expect(r.status).toBe(200);
  });

  it('setelah expiry (deadline + grace lewat, tanpa submit): AI kembali tersedia & attempt expired', async () => {
    const start = await laptop.json('POST', `/api/v1/assessments/${assessmentId}/attempts`);
    expect(start.status).toBe(201);
    expect((await phone.json('POST', `/api/v1/lessons/${quizLessonId}/ai/chat`, { message: 'x' })).status).toBe(423);
    // Masih dalam masa grace → tetap terkunci.
    h.clock.t = start.body.deadlineAt + 5_000;
    expect((await phone.json('POST', `/api/v1/lessons/${quizLessonId}/ai/chat`, { message: 'x' })).status).toBe(423);
    h.clock.t = start.body.deadlineAt + 21_000;
    const r = await phone.json('POST', `/api/v1/lessons/${quizLessonId}/ai/chat`, { message: 'x' });
    expect(r.status).toBe(200);
    const res = await laptop.json('GET', `/api/v1/attempts/${start.body.id}/result`);
    expect(res.body.status).toBe('expired');
  });

  it('Cron maintenance memfinalisasi attempt kedaluwarsa (lock tidak menggantung)', async () => {
    const start = await laptop.json('POST', `/api/v1/assessments/${assessmentId}/attempts`);
    expect(start.status).toBe(201);
    h.clock.t = start.body.deadlineAt + 60_000;
    const m = await h.maintenance();
    expect(m.expired).toBe(1);
    const row = await h.env.DB.prepare('SELECT status FROM attempts WHERE id = ?').bind(start.body.id).first<{ status: string }>();
    expect(row?.status).toBe('expired');
  });

  it('ujian dimulai saat AI sedang inference → jawaban AI dibuang (423)', async () => {
    h.ai.during = async () => {
      const s = await phone.json('POST', `/api/v1/assessments/${assessmentId}/attempts`);
      expect(s.status).toBe(201);
    };
    const r = await laptop.json('POST', `/api/v1/lessons/${quizLessonId}/ai/chat`, { message: 'x' });
    expect(r.status).toBe(423);
    expect(r.body.error.code).toBe('EXAM_LOCKED');
    h.ai.during = null;
    const id = (await activeAttemptId(laptop))!;
    await laptop.json('POST', `/api/v1/attempts/${id}/submit`);
  });

  it('start attempt bersamaan dari dua perangkat → satu attempt saja (idempoten, race-safe)', async () => {
    const [a, b] = await Promise.all([
      laptop.json('POST', `/api/v1/assessments/${assessmentId}/attempts`),
      phone.json('POST', `/api/v1/assessments/${assessmentId}/attempts`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
    const n = await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM attempts WHERE status = 'in_progress'`).first<{ n: number }>();
    expect(n?.n).toBe(1);
    // Submit ganda bersamaan → tetap satu finalisasi.
    const [s1, s2] = await Promise.all([
      laptop.json('POST', `/api/v1/attempts/${a.body.id}/submit`),
      phone.json('POST', `/api/v1/attempts/${a.body.id}/submit`),
    ]);
    expect(s1.status).toBe(200);
    expect(s2.status).toBe(200);
    expect(s1.body.resultStatus).toBe(s2.body.resultStatus);
  });

  it('fail closed: jika status ujian tidak dapat diverifikasi, AI ditolak (503) dan provider tidak dipanggil', async () => {
    const realDb = h.env.DB;
    const broken = new Proxy(realDb, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (/FROM attempts/.test(sql)) throw new Error('D1 unavailable');
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const calls = h.ai.calls.length;
    h.env.DB = broken as D1Database;
    try {
      const r = await laptop.json('POST', `/api/v1/lessons/${quizLessonId}/ai/chat`, { message: 'x' });
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('EXAM_LOCK_UNVERIFIED');
    } finally {
      h.env.DB = realDb;
    }
    expect(h.ai.calls.length).toBe(calls);
  });

  it('AI ditolak tanpa autentikasi (bukan 200) dan butuh enrollment', async () => {
    const anon = new Client(h, 'anon');
    expect((await anon.json('GET', '/api/v1/ai/recommendations')).status).toBe(401);
    const stranger = await new Client(h, 'stranger').login('orang-lain@contoh.test', 'Orang Lain');
    const r = await stranger.json('POST', `/api/v1/lessons/${quizLessonId}/ai/chat`, { message: 'x' });
    expect(r.status).toBe(404);
  });
});
