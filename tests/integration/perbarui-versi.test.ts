/**
 * Pindah ke versi kelas terbaru tanpa hapus pendaftaran: progres materi ikut lewat kode materi,
 * hasil skenario tetap, percobaan skenario yang berjalan bisa dilanjutkan, dan pengaman (kuis aktif, sertifikat).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, type Harness } from '../helpers/harness';

const ROOT = join(import.meta.dirname, '..', '..');
let h: Harness;
let admin: Client;
let courseId: string;

const lesson = (title: string, lessonKey: string, contentSource = 'Isi materi.', requiredActiveSeconds = 0) => ({
  title,
  contentType: 'html',
  contentSource,
  requiredActiveSeconds,
  lessonKey,
});
const lessonsOf = async () => (await admin.json('GET', `/api/v1/admin/courses/${courseId}`)).body.lessons as any[];
const byKey = async (key: string) => (await lessonsOf()).find((l) => l.lesson_key === key);

async function learnerOnV1(email: string) {
  const l = await new Client(h).login(email, email.split('@')[0]!);
  await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
  return l;
}

let v1U01: string;
let v1U02: string;

beforeAll(async () => {
  h = await createHarness();
  admin = await new Client(h).login('admin@contoh.test', 'Admin', ['admin']);
  const def = JSON.parse(readFileSync(join(ROOT, 'docs', 'scenario-block', 'contoh-adm01-beda-nama-bali.json'), 'utf8'));
  const s = await admin.json('POST', '/api/v1/admin/scenarios', { definition: def });
  await admin.json('POST', `/api/v1/admin/scenarios/${s.body.id}/status`, {
    status: 'published',
    review: { reviewedBy: 'Penelaah Uji', reviewedAt: '2026-11-20', nextReviewDue: '2027-11-20' },
  });
  courseId = (await admin.json('POST', '/api/v1/admin/courses', { slug: 'kelas-versi-uji', title: 'Kelas Versi Uji', visibility: 'public' })).body.id;
  await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, lesson('Unit 1', 'u01', '[[skenario:adm01-beda-nama-bali]]'));
  await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, lesson('Unit 2', 'u02'));
  expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);
  v1U01 = (await byKey('u01')).id;
  v1U02 = (await byKey('u02')).id;
});
afterAll(() => h.dispose());

/** Versi 2: tambah Unit 3; Unit 2 kini butuh 10 menit (progres lama 0 detik tidak lagi "selesai"). */
async function publishV2() {
  await admin.json('POST', `/api/v1/admin/courses/${courseId}/draft`);
  const u02 = await byKey('u02');
  await admin.json('PUT', `/api/v1/admin/lessons/${u02.id}`, lesson('Unit 2', 'u02', 'Isi materi.', 600));
  await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, lesson('Unit 3', 'u03'));
  expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);
}

describe('perbarui ke versi terbaru', () => {
  let budi: Client;
  let scenarioAttempt: string;

  it('peserta lama: progres U01+U02, skenario setengah jalan; versi baru terbit → tawaran pembaruan', async () => {
    budi = await learnerOnV1('budi@contoh.test');
    await budi.json('GET', `/api/v1/lessons/${v1U01}/content`);
    await budi.json('GET', `/api/v1/lessons/${v1U02}/content`);
    const content = await budi.json('GET', `/api/v1/lessons/${v1U01}/content`);
    const start = await budi.json('POST', `/api/v1/scenarios/${content.body.scenarios[0].blockId}/attempts`, { lessonId: v1U01 });
    scenarioAttempt = start.body.attempt.id;
    await budi.json('POST', `/api/v1/scenario-attempts/${scenarioAttempt}/choices`, { nodeId: 'intro', continue: true });

    expect((await budi.json('GET', `/api/v1/courses/${courseId}`)).body.upgrade).toBeNull();
    await publishV2();
    const detail = await budi.json('GET', `/api/v1/courses/${courseId}`);
    expect(detail.body.upgrade).toEqual({ fromVersion: 1, toVersion: 2, blockedReason: null, carriedLessons: 2 });
    // Masih di versi 1 sampai memilih memperbarui.
    expect(detail.body.lessons.map((l: any) => l.title)).toEqual(['Unit 1', 'Unit 2']);
  });

  it('memperbarui: progres dicocokkan lewat kode materi, waktu minimum versi baru dihormati, skenario berjalan bisa dilanjutkan', async () => {
    const r = await budi.json('POST', `/api/v1/courses/${courseId}/upgrade`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ fromVersion: 1, toVersion: 2, carriedLessons: 2 });

    const detail = await budi.json('GET', `/api/v1/courses/${courseId}`);
    expect(detail.body.upgrade).toBeNull();
    const done = Object.fromEntries(detail.body.lessons.map((l: any) => [l.title, l.completed]));
    expect(done).toEqual({ 'Unit 1': true, 'Unit 2': false, 'Unit 3': false });

    // Materi versi lama tidak bisa dibuka lagi; versi baru bisa.
    expect((await budi.json('GET', `/api/v1/lessons/${v1U01}/content`)).status).toBe(404);
    const newU01 = (await byKey('u01')).id;
    const c = await budi.json('GET', `/api/v1/lessons/${newU01}/content`);
    expect(c.status).toBe(200);
    expect(c.body.scenarios[0]).toMatchObject({ activeAttemptId: scenarioAttempt, attemptsUsed: 1 });
    const next = await budi.json('POST', `/api/v1/scenario-attempts/${scenarioAttempt}/choices`, { nodeId: 'd1', optionKey: 'p1' });
    expect(next.status).toBe(200);

    const again = await budi.json('POST', `/api/v1/courses/${courseId}/upgrade`);
    expect(again.status).toBe(409);
    const audit = await h.env.DB.prepare(`SELECT metadata_redacted FROM admin_audit_logs WHERE action = 'enrollment.upgrade'`).first<{ metadata_redacted: string }>();
    expect(JSON.parse(audit!.metadata_redacted)).toMatchObject({ fromVersion: 1, toVersion: 2, carriedLessons: 2, self: true });
  });

  it('ditolak bila ada kuis yang sedang dikerjakan atau sertifikat sudah ada', async () => {
    await admin.json('POST', `/api/v1/admin/courses/${courseId}/draft`);
    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);

    const sari = await learnerOnV1('sari@contoh.test'); // terdaftar di v3
    await admin.json('POST', `/api/v1/admin/courses/${courseId}/draft`);
    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200); // v4
    const enr = await h.env.DB.prepare(`SELECT e.id, e.user_id, e.course_version_id FROM enrollments e JOIN users u ON u.id = e.user_id WHERE u.display_name = 'sari'`).first<{
      id: string;
      user_id: string;
      course_version_id: string;
    }>();
    await h.env.DB.prepare(
      `INSERT INTO certificates (id, user_id, course_id, course_version_id, status, recipient_name, course_title, completed_at) VALUES ('cert-uji', ?, ?, ?, 'pending', 'Sari', 'Kelas Versi Uji', 1)`,
    )
      .bind(enr!.user_id, courseId, enr!.course_version_id)
      .run();
    const blocked = await sari.json('GET', `/api/v1/courses/${courseId}`);
    expect(blocked.body.upgrade.blockedReason).toContain('Sertifikat');
    const r = await sari.json('POST', `/api/v1/courses/${courseId}/upgrade`);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('Sertifikat');
  });

  it('ditolak saat peserta sedang mengerjakan kuis', async () => {
    await admin.json('POST', `/api/v1/admin/courses/${courseId}/draft`);
    const u03 = await byKey('u03');
    const quiz = await admin.json('PUT', `/api/v1/admin/lessons/${u03.id}/assessment`, {
      title: 'Kuis Unit 3',
      timeLimitSeconds: 600,
      passingScorePct: 70,
      maxAttempts: 3,
      cooldownSeconds: 0,
      mcqCount: 1,
      essayCount: 0,
    });
    await admin.json('POST', `/api/v1/admin/assessments/${quiz.body.id}/questions`, {
      type: 'mcq',
      stem: 'Soal uji kuis aktif?',
      options: [
        { body: 'Ya', isCorrect: true },
        { body: 'Tidak', isCorrect: false },
      ],
    });
    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);
    const eka = await learnerOnV1('eka@contoh.test');
    const quizLesson = await byKey('u03');
    await eka.json('POST', `/api/v1/lessons/${quizLesson.id}/session`);
    expect((await eka.json('POST', `/api/v1/assessments/${quiz.body.id}/attempts`)).status).toBe(201);

    await admin.json('POST', `/api/v1/admin/courses/${courseId}/draft`);
    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);
    expect((await eka.json('GET', `/api/v1/courses/${courseId}`)).body.upgrade.blockedReason).toBe('Selesaikan kuis yang sedang berjalan terlebih dahulu.');
    const r = await eka.json('POST', `/api/v1/courses/${courseId}/upgrade`);
    expect(r.status).toBe(409);
  });

  it('admin bisa memindahkan peserta dari laporan; peserta/mentor tidak bisa memakai rute admin', async () => {
    const tono = await learnerOnV1('tono@contoh.test'); // versi terbaru saat ini
    await admin.json('POST', `/api/v1/admin/courses/${courseId}/draft`);
    await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`);
    const report = await admin.json('GET', `/api/v1/admin/reports/${courseId}`);
    const row = report.body.learners.find((x: any) => x.display_name === 'tono');
    expect(row.current_version_no).toBe(row.version_no + 1);

    expect((await tono.json('POST', `/api/v1/admin/courses/${courseId}/enrollments/${row.user_id}/upgrade`)).status).toBe(403);
    const mentor = await new Client(h).login('mentor@contoh.test', 'Mentor', ['mentor']);
    expect((await mentor.json('POST', `/api/v1/admin/courses/${courseId}/enrollments/${row.user_id}/upgrade`)).status).toBe(403);

    const ok = await admin.json('POST', `/api/v1/admin/courses/${courseId}/enrollments/${row.user_id}/upgrade`);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ fromVersion: row.version_no, toVersion: row.current_version_no });
    expect((await tono.json('GET', `/api/v1/courses/${courseId}`)).body.upgrade).toBeNull();
    const audit = await h.env.DB.prepare(`SELECT metadata_redacted FROM admin_audit_logs WHERE action = 'enrollment.upgrade' ORDER BY created_at DESC, rowid DESC`).first<{
      metadata_redacted: string;
    }>();
    expect(JSON.parse(audit!.metadata_redacted)).toMatchObject({ self: false });
  });
});
