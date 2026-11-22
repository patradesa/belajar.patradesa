/** Kelas demo penilaian: peserta fiktif sudah mengumpulkan kuis → admin menilai esai → lulus/gagal → sertifikat. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, type Harness } from '../helpers/harness';

let h: Harness;
let admin: Client;
const STUDIO = 'https://sertifikat.test';

beforeAll(async () => {
  h = await createHarness({
    SERTIFIKAT_BASE_URL: STUDIO,
    SERTIFIKAT_INTEGRATION_SECRET: 'k'.repeat(40),
  });
  let n = 0;
  h.fetchMock = async () => {
    n++;
    return Response.json(
      {
        serial: `000${n}/PD/BELAJAR/2026`,
        code: `DEMQ2345EFGH678${n}`,
        issuedAt: new Date(h.clock.t).toISOString(),
      },
      { status: 201 },
    );
  };
  admin = await new Client(h).login('admin@contoh.test', 'Admin', ['admin']);
});
afterAll(() => h.dispose());

const grade = async (attemptId: string, scores: [number, number, number]) => {
  const queue = (await admin.json('GET', '/api/v1/admin/reviews')).body.reviews.filter((r: any) => r.attempt_id === attemptId);
  expect(queue).toHaveLength(2);
  for (const item of queue) {
    const r = await admin.json('POST', `/api/v1/admin/reviews/${item.answer_id}/decision`, {
      rubricScores: [
        { criterion: 'Ketepatan isi', score: scores[0] },
        { criterion: 'Contoh konkret', score: scores[1] },
        { criterion: 'Kejelasan', score: scores[2] },
      ],
      feedback: 'Umpan balik demo.',
    });
    expect(r.status).toBe(200);
  }
};

describe('demo penilaian', () => {
  it('membuat kelas privat 3 materi + kuis terkumpul (PG 8/10, esai menunggu review); tidak tampil di katalog', async () => {
    const list = await admin.json('GET', '/api/v1/admin/courses');
    expect(list.body.demoAvailable).toBe(true);
    const r = await admin.json('POST', '/api/v1/admin/demo/grading');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ mcqCorrect: 4, mcqTotal: 5, essays: 2 });
    const at = await h.env.DB.prepare('SELECT status, result_status, mcq_score, mcq_max, essay_max FROM attempts WHERE id = ?')
      .bind(r.body.attemptId)
      .first();
    expect(at).toMatchObject({
      status: 'submitted',
      result_status: 'pending_review',
      mcq_score: 8,
      mcq_max: 10,
      essay_max: 20,
    });
    const detail = (await admin.json('GET', `/api/v1/admin/courses/${r.body.courseId}`)).body;
    expect(detail.lessons).toHaveLength(3);
    expect(detail.lessons[2].assessment.questions).toHaveLength(7);
    expect(detail.course).toMatchObject({
      status: 'published',
      visibility: 'private',
    });
    const catalog = (await new Client(h).json('GET', '/api/v1/catalog')).body.courses;
    expect(catalog.find((c: any) => c.id === r.body.courseId)).toBeUndefined();
  });

  it('esai dinilai tinggi → lulus 93,33% → sertifikat terbit atas nama sertifikat peserta demo', async () => {
    const r = (await admin.json('POST', '/api/v1/admin/demo/grading')).body;
    await grade(r.attemptId, [50, 30, 20]);
    const at = await h.env.DB.prepare('SELECT result_status, final_score_pct FROM attempts WHERE id = ?').bind(r.attemptId).first();
    expect(at).toMatchObject({
      result_status: 'passed',
      final_score_pct: 93.33,
    });
    const certs = (await admin.json('GET', '/api/v1/admin/certificates')).body.certificates;
    const cert = certs.find((c: any) => c.recipient_name === r.learnerName);
    expect(cert).toMatchObject({ status: 'issued', final_score_pct: 93.3 });
    expect(cert.course_title).toMatch(/^Demo Penilaian & Sertifikat .* \(Fiktif\)$/);
    const pub = (await new Client(h).json('GET', `/api/v1/certificates/${cert.verification_code}`)).body;
    expect(pub.recipientName).toBe(r.learnerName);
  });

  it('esai dinilai rendah → gagal → tidak ada sertifikat', async () => {
    const r = (await admin.json('POST', '/api/v1/admin/demo/grading')).body;
    await grade(r.attemptId, [10, 5, 5]); // 2 poin per esai → (8+4)/30 = 40%
    const at = await h.env.DB.prepare('SELECT result_status, final_score_pct FROM attempts WHERE id = ?').bind(r.attemptId).first();
    expect(at).toMatchObject({ result_status: 'failed', final_score_pct: 40 });
    const certs = (await admin.json('GET', '/api/v1/admin/certificates')).body.certificates;
    expect(certs.find((c: any) => c.recipient_name === r.learnerName)).toBeUndefined();
  });

  it('hanya admin; tidak tersedia di produksi', async () => {
    const learner = await new Client(h).login('peserta@contoh.test', 'Peserta');
    expect((await learner.json('POST', '/api/v1/admin/demo/grading')).status).toBe(403);
    const prev = h.env.ENVIRONMENT;
    h.env.ENVIRONMENT = 'production';
    try {
      expect((await admin.json('POST', '/api/v1/admin/demo/grading')).status).toBe(404);
      expect((await admin.json('GET', '/api/v1/admin/courses')).body.demoAvailable).toBe(false);
    } finally {
      h.env.ENVIRONMENT = prev;
    }
  });
});
