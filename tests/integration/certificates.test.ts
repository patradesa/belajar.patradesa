/** Sertifikat: terbit otomatis setelah lulus (via Sertifikat Studio, HMAC), coba ulang, verifikasi publik, pencabutan. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, readyLearner, seedDemoCourse, type Harness } from '../helpers/harness';
import { hmacHex, integrationProblem, retryPendingCertificates } from '../../apps/api/src/services/certificates';

const STUDIO = 'https://sertifikat.test';
const SECRET = 's'.repeat(48);
const CODE = 'ABCD2345EFGH6789';

let h: Harness;
let admin: Client;
let courseId: string;
let lessonIds: string[];
let assessmentId: string;
const studioCalls: { path: string; body: any; validSig: boolean }[] = [];
let studioDown = true;

beforeAll(async () => {
  h = await createHarness({
    SERTIFIKAT_BASE_URL: STUDIO,
    SERTIFIKAT_INTEGRATION_SECRET: SECRET,
  });
  h.fetchMock = async (url, init) => {
    const path = url.replace(STUDIO, '');
    const raw = String(init?.body ?? '');
    const headers = new Headers(init?.headers);
    const ts = headers.get('x-pd-timestamp');
    const validSig = (await hmacHex(SECRET, `${ts}.${raw}`)) === headers.get('x-pd-signature');
    studioCalls.push({ path, body: JSON.parse(raw), validSig });
    if (studioDown)
      return new Response(JSON.stringify({ error: 'Sedang pemeliharaan' }), {
        status: 503,
      });
    if (path === '/api/integrasi/terbitkan') {
      return Response.json(
        {
          serial: '0001/PD/BELAJAR/2026',
          code: CODE,
          codeFormatted: 'ABCD-2345-EFGH-6789',
          verifyUrl: 'https://jahat.example/v/x',
          status: 'valid',
          issuedAt: '2026-11-21T02:05:00.000Z',
          repeated: false,
        },
        { status: 201 },
      );
    }
    if (path === '/api/integrasi/cabut') return Response.json({ ok: true, status: 'dicabut' });
    return new Response('{}', { status: 404 });
  };
  admin = await new Client(h).login('admin@contoh.test', 'Admin Uji', ['admin']);
  ({ courseId, lessonIds, assessmentId } = await seedDemoCourse(admin));
});
afterAll(() => h.dispose());

/** Peserta lulus kuis (PG benar semua + esai dinilai admin) dan materi 1 ditandai selesai. */
async function graduate(name: string, opts: { finishLesson1?: boolean } = {}): Promise<{ learner: Client; userId: string }> {
  const learner = await new Client(h).login(`${name}@contoh.test`, name);
  await readyLearner(learner, courseId, lessonIds[1]!);
  const userId = (await learner.json('GET', '/api/v1/me')).body.user.id as string;
  if (opts.finishLesson1 !== false) {
    const enr = await h.env.DB.prepare('SELECT id FROM enrollments WHERE user_id = ?').bind(userId).first<{ id: string }>();
    await h.env.DB.prepare(
      `INSERT INTO lesson_progress (user_id, lesson_id, enrollment_id, active_seconds, completed_at) VALUES (?, ?, ?, 60, ?)
       ON CONFLICT (user_id, lesson_id) DO UPDATE SET completed_at = excluded.completed_at`,
    )
      .bind(userId, lessonIds[0], enr!.id, h.clock.t)
      .run();
  }
  const a = (await learner.json('POST', `/api/v1/assessments/${assessmentId}/attempts`)).body;
  const { results } = await h.env.DB.prepare('SELECT id, answer_key_snapshot FROM attempt_questions WHERE attempt_id = ?')
    .bind(a.id)
    .all<{ id: string; answer_key_snapshot: string | null }>();
  const keys = new Map(results.map((r) => [r.id, r.answer_key_snapshot]));
  const answers = a.questions.map((q: any) =>
    q.type === 'mcq' ? { questionId: q.id, optionKey: keys.get(q.id) } : { questionId: q.id, essayText: 'Jawaban esai lengkap.' },
  );
  await learner.json('PATCH', `/api/v1/attempts/${a.id}/answers`, { answers });
  const sub = await learner.json('POST', `/api/v1/attempts/${a.id}/submit`);
  expect(sub.body.resultStatus).toBe('pending_review');
  const item = (await admin.json('GET', '/api/v1/admin/reviews')).body.reviews.find((r: any) => r.attempt_id === a.id);
  const dec = await admin.json('POST', `/api/v1/admin/reviews/${item.answer_id}/decision`, {
    rubricScores: [
      { criterion: 'Ketepatan konsep', score: 30 },
      { criterion: 'Penerapan konteks', score: 20 },
      { criterion: 'Keamanan/etika data', score: 15 },
      { criterion: 'Kejelasan', score: 5 },
    ],
  });
  expect(dec.status).toBe(200);
  return { learner, userId };
}

describe('sertifikat', () => {
  it('belum ada sertifikat bila materi wajib belum selesai walau kuis lulus', async () => {
    const { learner } = await graduate('p-belum', { finishLesson1: false });
    const d = (await learner.json('GET', `/api/v1/courses/${courseId}`)).body;
    expect(d.completion.passed).toBe(false);
    expect(d.certificate).toBeNull();
    expect(studioCalls).toHaveLength(0);
  });

  it('lulus → pending saat Studio gagal; backoff; Cron menerbitkan dengan kunci idempotensi yang sama', async () => {
    const before = studioCalls.length;
    const { learner, userId } = await graduate('p-lulus');
    expect(studioCalls.length).toBe(before + 1);
    const call = studioCalls.at(-1)!;
    expect(call.path).toBe('/api/integrasi/terbitkan');
    expect(call.validSig).toBe(true);
    expect(call.body).toMatchObject({
      eventTitle: 'Dasar Transparansi Informasi Desa (Simulasi)',
      recipientName: 'p-lulus',
    });
    expect(call.body.idempotencyKey).toMatch(/^belajar-[a-f0-9]{32}$/);
    expect(Object.keys(call.body).sort()).toEqual(['eventDate', 'eventTitle', 'idempotencyKey', 'recipientName']);

    const d1 = (await learner.json('GET', `/api/v1/courses/${courseId}`)).body;
    expect(d1.completion.passed).toBe(true);
    expect(d1.certificate).toMatchObject({
      status: 'pending',
      code: null,
      certificateNo: null,
      courseSlug: 'dasar-transparansi-desa',
      finalScorePct: 80,
    });
    // Dalam masa backoff: membuka halaman kelas tidak memanggil Studio lagi.
    expect(studioCalls.length).toBe(before + 1);
    const enr = await h.env.DB.prepare('SELECT status, completed_at FROM enrollments WHERE user_id = ?')
      .bind(userId)
      .first<{ status: string; completed_at: number }>();
    expect(enr?.status).toBe('completed');

    studioDown = false;
    h.clock.t += 2 * 60_000;
    expect(await retryPendingCertificates(h.env, h.deps.fetch, h.clock.t)).toBe(1);
    expect(studioCalls.at(-1)!.body.idempotencyKey).toBe(call.body.idempotencyKey);

    const d2 = (await learner.json('GET', `/api/v1/courses/${courseId}`)).body;
    expect(d2.certificate).toMatchObject({
      status: 'issued',
      certificateNo: '0001/PD/BELAJAR/2026',
      code: CODE,
      // URL verifikasi dibangun dari alamat Studio yang dikonfigurasi, bukan dari jawaban Studio.
      verifyUrl: `${STUDIO}/v/${CODE}`,
      issuedAt: Date.parse('2026-11-21T02:05:00.000Z'),
    });
    const mine = (await learner.json('GET', '/api/v1/me/certificates')).body.certificates;
    expect(mine).toHaveLength(1);
    expect(mine[0].code).toBe(CODE);
  });

  it('halaman publik: kode (boleh berstrip) → data minimal; kode salah → 404', async () => {
    const anon = new Client(h);
    const r = await anon.raw('GET', '/api/v1/certificates/abcd-2345-efgh-6789');
    expect(r.status).toBe(200);
    expect(r.headers.get('x-robots-tag')).toBe('noindex');
    const body = (await r.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 'issued',
      recipientName: 'p-lulus',
      certificateNo: '0001/PD/BELAJAR/2026',
      verifyUrl: `${STUDIO}/v/${CODE}`,
    });
    expect(JSON.stringify(body)).not.toMatch(/email|user_id|contoh\.test/);
    expect((await anon.raw('GET', '/api/v1/certificates/ABCD2345EFGH6780')).status).toBe(404);
    expect((await anon.raw('GET', '/api/v1/certificates/bukan-kode')).status).toBe(404);
  });

  it('admin: daftar, pencabutan (juga di Studio), hanya admin', async () => {
    const list = await admin.json('GET', '/api/v1/admin/certificates');
    expect(list.body.integrationConfigured).toBe(true);
    const cert = list.body.certificates.find((x: any) => x.verification_code === CODE);
    expect(cert.status).toBe('issued');

    const learner = await new Client(h).login('p-lulus@contoh.test', 'p-lulus');
    expect((await learner.json('POST', `/api/v1/admin/certificates/${cert.id}/revoke`, { reason: 'Coba cabut sendiri' })).status).toBe(403);
    expect((await admin.json('POST', `/api/v1/admin/certificates/${cert.id}/revoke`, { reason: 'x' })).status).toBe(400);

    studioDown = true;
    const fail = await admin.json('POST', `/api/v1/admin/certificates/${cert.id}/revoke`, { reason: 'Data peserta keliru' });
    expect(fail.status).toBe(502);
    expect((await h.env.DB.prepare('SELECT status FROM certificates WHERE id = ?').bind(cert.id).first<{ status: string }>())?.status).toBe('issued');

    studioDown = false;
    const ok = await admin.json('POST', `/api/v1/admin/certificates/${cert.id}/revoke`, { reason: 'Data peserta keliru' });
    expect(ok.status).toBe(200);
    expect(studioCalls.at(-1)).toMatchObject({
      path: '/api/integrasi/cabut',
      validSig: true,
      body: { code: CODE, reason: 'Data peserta keliru' },
    });
    const pub = (await new Client(h).json('GET', `/api/v1/certificates/${CODE}`)).body;
    expect(pub.status).toBe('revoked');
    // Sertifikat yang dicabut tidak diterbitkan ulang saat peserta membuka kelas.
    const n = studioCalls.length;
    expect((await learner.json('GET', `/api/v1/courses/${courseId}`)).body.certificate.status).toBe('revoked');
    expect(studioCalls.length).toBe(n);
    const audit = await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action = 'certificate.revoke'`).first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it('tanpa konfigurasi integrasi: sertifikat tetap pending dan admin melihat alasannya', async () => {
    const h2 = await createHarness();
    try {
      const adm = await new Client(h2).login('admin@contoh.test', 'Admin', ['admin']);
      const seeded = await seedDemoCourse(adm);
      const l = await new Client(h2).login('solo@contoh.test', 'Solo');
      await readyLearner(l, seeded.courseId, seeded.lessonIds[1]!);
      const uid = (await l.json('GET', '/api/v1/me')).body.user.id;
      const enr = await h2.env.DB.prepare('SELECT id FROM enrollments WHERE user_id = ?').bind(uid).first<{ id: string }>();
      await h2.env.DB.prepare(`INSERT INTO lesson_progress (user_id, lesson_id, enrollment_id, active_seconds, completed_at) VALUES (?, ?, ?, 60, 1)`)
        .bind(uid, seeded.lessonIds[0], enr!.id)
        .run();
      // Tandai kuis lulus langsung (alur kuis sudah diuji di atas).
      await h2.env.DB.prepare(
        `INSERT INTO attempts (id, assessment_id, user_id, enrollment_id, assessment_version, attempt_no, started_at, deadline_at, grace_seconds, status, passing_score_pct, result_status, final_score_pct, submitted_at, finalized_at)
         VALUES ('att-solo-0000001', ?, ?, ?, 1, 1, 1, 2, 0, 'submitted', 60, 'passed', 90, 2, 2)`,
      )
        .bind(seeded.assessmentId, uid, enr!.id)
        .run();
      const d = (await l.json('GET', `/api/v1/courses/${seeded.courseId}`)).body;
      expect(d.certificate.status).toBe('pending');
      expect(h2.fetchLog).toHaveLength(0);
      const list = (await adm.json('GET', '/api/v1/admin/certificates')).body;
      expect(list.integrationConfigured).toBe(false);
      expect(list.certificates[0].last_error).toMatch(/belum siap: Variabel SERTIFIKAT_BASE_URL belum ada/);
      expect(list.integrationProblem).toMatch(/SERTIFIKAT_BASE_URL/);
    } finally {
      await h2.dispose();
    }
  });
});

describe('konfigurasi integrasi', () => {
  it('alasan spesifik: URL, secret kosong, secret terlalu pendek (tanpa membocorkan nilainya)', () => {
    const base = { ...h.env, SERTIFIKAT_BASE_URL: STUDIO };
    expect(integrationProblem({ ...base, SERTIFIKAT_BASE_URL: undefined })).toMatch(/SERTIFIKAT_BASE_URL belum ada/);
    expect(integrationProblem({ ...base, SERTIFIKAT_INTEGRATION_SECRET: undefined })).toMatch(/belum dipasang/);
    const short = integrationProblem({ ...base, SERTIFIKAT_INTEGRATION_SECRET: 'a1b2c3d4e5f60718' })!;
    expect(short).toContain('terlalu pendek (16 karakter; minimal 32)');
    expect(short).not.toContain('a1b2c3d4');
    expect(integrationProblem({ ...base, SERTIFIKAT_INTEGRATION_SECRET: SECRET })).toBeNull();
  });
});

describe('uji koneksi Studio', () => {
  it('404 bertanda tangan → terhubung; 522 dari tepi → gagal dengan keterangan cf-ray; hanya admin', async () => {
    studioDown = false;
    const prev = h.fetchMock;
    // Studio nyata menjawab 404 untuk kode yang tidak ada (setelah tanda tangan diterima).
    h.fetchMock = async (url, init) => {
      const res = await prev!(url, init);
      return JSON.parse(String(init?.body ?? '{}')).code === 'ZZZZZZZZZZZZZZZZ' ? Response.json({ error: 'Sertifikat tidak ditemukan.' }, { status: 404 }) : res;
    };
    const ok = await admin.json('POST', '/api/v1/admin/certificates/studio-check');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, status: 404 });
    const last = studioCalls.at(-1)!;
    expect(last).toMatchObject({ path: '/api/integrasi/cabut', validSig: true });
    expect(last.body.code).toBe('ZZZZZZZZZZZZZZZZ');

    h.fetchMock = async () =>
      new Response('<html><title>Connection timed out</title><body>Error code 522</body></html>', {
        status: 522,
        headers: { server: 'cloudflare', 'cf-ray': 'abc123-SIN', 'content-type': 'text/html' },
      });
    const bad = await admin.json('POST', '/api/v1/admin/certificates/studio-check');
    expect(bad.body).toMatchObject({ ok: false, status: 522 });
    expect(bad.body.diag).toContain('cf-ray abc123-SIN');
    expect(bad.body.diag).toContain('Error code 522');
    h.fetchMock = prev;

    const learner = await new Client(h).login('bukan-admin-cek@contoh.test', 'Peserta');
    expect((await learner.json('POST', '/api/v1/admin/certificates/studio-check')).status).toBe(403);
  });
});
