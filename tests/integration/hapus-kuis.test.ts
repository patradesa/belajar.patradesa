/** Hapus kuis dari materi (hanya di draft): kasus kuis wajib tanpa soal yang tidak sengaja dibuat. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, type Harness } from '../helpers/harness';

let h: Harness;
let admin: Client;
let courseId: string;

const quiz = { title: 'Kuis Tak Sengaja', timeLimitSeconds: 600, passingScorePct: 70, maxAttempts: 3, cooldownSeconds: 0, mcqCount: 5, essayCount: 0 };
const lessonOf = async (key: string) => (await admin.json('GET', `/api/v1/admin/courses/${courseId}`)).body.lessons.find((l: any) => l.lesson_key === key);

beforeAll(async () => {
  h = await createHarness();
  admin = await new Client(h).login('admin@contoh.test', 'Admin', ['admin']);
  courseId = (await admin.json('POST', '/api/v1/admin/courses', { slug: 'kelas-hapus-kuis', title: 'Kelas Hapus Kuis', visibility: 'public' })).body.id;
  await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, { title: 'Unit 1', contentType: 'html', contentSource: 'Isi unit.', requiredActiveSeconds: 0, lessonKey: 'unit-1' });
  const u1 = await lessonOf('unit-1');
  expect((await admin.json('PUT', `/api/v1/admin/lessons/${u1.id}/assessment`, quiz)).status).toBe(200);
  expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);
});
afterAll(() => h.dispose());

describe('hapus kuis', () => {
  it('kuis wajib tanpa soal memblokir kelulusan; versi terbit tidak bisa dihapus kuisnya (409)', async () => {
    const l = await new Client(h).login('p1@contoh.test', 'P1');
    await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
    const u1 = await lessonOf('unit-1');
    await l.json('GET', `/api/v1/lessons/${u1.id}/content`);
    const detail = await l.json('GET', `/api/v1/courses/${courseId}`);
    expect(detail.body.completion.reasons).toContain('Kuis "Kuis Tak Sengaja" belum lulus.');
    const del = await admin.json('DELETE', `/api/v1/admin/lessons/${u1.id}/assessment`);
    expect(del.status).toBe(409);
  });

  it('di draft: learner/mentor 403, admin menghapus kuis + soal, diaudit; setelah terbit kelas bisa lulus', async () => {
    await admin.json('POST', `/api/v1/admin/courses/${courseId}/draft`);
    const u1 = await lessonOf('unit-1');
    expect(u1.assessment).not.toBeNull();
    await admin.json('POST', `/api/v1/admin/assessments/${u1.assessment.id}/questions`, {
      type: 'mcq',
      stem: 'Soal yang ikut terhapus?',
      options: [
        { body: 'Ya', isCorrect: true },
        { body: 'Tidak', isCorrect: false },
      ],
    });

    const learner = await new Client(h).login('p2@contoh.test', 'P2');
    expect((await learner.json('DELETE', `/api/v1/admin/lessons/${u1.id}/assessment`)).status).toBe(403);
    const mentor = await new Client(h).login('m@contoh.test', 'M', ['mentor']);
    expect((await mentor.json('DELETE', `/api/v1/admin/lessons/${u1.id}/assessment`)).status).toBe(403);

    expect((await admin.json('DELETE', `/api/v1/admin/lessons/${u1.id}/assessment`)).status).toBe(200);
    expect((await lessonOf('unit-1')).assessment).toBeNull();
    const orphans = await h.env.DB.prepare('SELECT COUNT(*) AS n FROM questions WHERE assessment_id = ?').bind(u1.assessment.id).first<{ n: number }>();
    expect(orphans!.n).toBe(0);
    const audit = await h.env.DB.prepare(`SELECT metadata_redacted FROM admin_audit_logs WHERE action = 'assessment.delete'`).first<{ metadata_redacted: string }>();
    expect(JSON.parse(audit!.metadata_redacted)).toMatchObject({ lessonId: u1.id, questions: 1 });
    expect((await admin.json('DELETE', `/api/v1/admin/lessons/${u1.id}/assessment`)).status).toBe(404);

    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);
    // Peserta baru memakai versi terbaru: tanpa kuis, materi selesai → lulus.
    const p = await new Client(h).login('p3@contoh.test', 'P3');
    await p.json('POST', `/api/v1/courses/${courseId}/enroll`);
    const fresh = await lessonOf('unit-1');
    await p.json('GET', `/api/v1/lessons/${fresh.id}/content`);
    expect((await p.json('GET', `/api/v1/courses/${courseId}`)).body.completion).toEqual({ passed: true, reasons: [] });
  });

  it('kuis yang sudah pernah dikerjakan tidak bisa dihapus walau di draft', async () => {
    const row = await h.env.DB.prepare(
      `SELECT a.id, l.id AS lesson_id FROM assessments a JOIN lessons l ON l.id = a.lesson_id JOIN course_versions cv ON cv.id = l.course_version_id
       WHERE cv.course_id = ? AND cv.version_no = 1`,
    )
      .bind(courseId)
      .first<{ id: string; lesson_id: string }>();
    // Simulasikan draft yang memuat kuis dengan riwayat attempt.
    await h.env.DB.prepare(`UPDATE course_versions SET status = 'draft' WHERE course_id = ? AND version_no = 1`).bind(courseId).run();
    await h.env.DB.prepare(
      `INSERT INTO attempts (id, assessment_id, user_id, enrollment_id, assessment_version, attempt_no, started_at, deadline_at, grace_seconds, status, passing_score_pct)
       SELECT 'att-uji-hapus', ?, e.user_id, e.id, 1, 1, 1, 2, 20, 'submitted', 70 FROM enrollments e WHERE e.course_id = ? LIMIT 1`,
    )
      .bind(row!.id, courseId)
      .run();
    const has = await h.env.DB.prepare('SELECT COUNT(*) AS n FROM attempts WHERE assessment_id = ?').bind(row!.id).first<{ n: number }>();
    expect(has!.n).toBe(1);
    const r = await admin.json('DELETE', `/api/v1/admin/lessons/${row!.lesson_id}/assessment`);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('sudah pernah dikerjakan');
  });
});
