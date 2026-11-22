/** Profil: daftar kelas + progres (materi & kuis wajib) dan sertifikat; nama sertifikat terbaru dipakai selama belum terbit. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, readyLearner, seedDemoCourse, type Harness } from '../helpers/harness';

let h: Harness;
let seeded: { courseId: string; lessonIds: string[]; assessmentId: string };

beforeAll(async () => {
  h = await createHarness(); // tanpa integrasi Studio → sertifikat tetap "pending"
  const admin = await new Client(h).login('admin@contoh.test', 'Admin', ['admin']);
  seeded = await seedDemoCourse(admin);
});
afterAll(() => h.dispose());

async function enrolledLearner(email: string, name: string) {
  const l = await new Client(h).login(email, name);
  await readyLearner(l, seeded.courseId, seeded.lessonIds[1]!);
  const uid = (await l.json('GET', '/api/v1/me')).body.user.id as string;
  const enr = (await h.env.DB.prepare('SELECT id FROM enrollments WHERE user_id = ?').bind(uid).first<{ id: string }>())!.id;
  return { l, uid, enr };
}

describe('profil: kelas & sertifikat', () => {
  it('progres menghitung materi wajib selesai + kuis wajib lulus', async () => {
    const { l } = await enrolledLearner('progres@contoh.test', 'Progres');
    const c = (await l.json('GET', '/api/v1/me/courses')).body.courses[0];
    expect(c).toMatchObject({
      slug: 'dasar-transparansi-desa',
      status: 'active',
      requiredLessons: 2,
      completedLessons: 1, // materi kuis (0 detik) selesai saat dibuka
      requiredQuizzes: 1,
      passedQuizzes: 0,
      reviewingQuizzes: 0,
      certificateStatus: null,
    });
    expect(typeof c.startedAt).toBe('number');
    expect((await l.json('GET', '/api/v1/me/certificates')).body.certificates).toEqual([]);
  });

  it('lulus → sertifikat pending di profil; ganti "Nama untuk sertifikat" memperbarui nama selama belum terbit', async () => {
    const { l, uid, enr } = await enrolledLearner('lulus@contoh.test', 'Nama Panggilan');
    await h.env.DB.prepare(`INSERT INTO lesson_progress (user_id, lesson_id, enrollment_id, active_seconds, completed_at) VALUES (?, ?, ?, 60, 1)`)
      .bind(uid, seeded.lessonIds[0], enr)
      .run();
    await h.env.DB.prepare(
      `INSERT INTO attempts (id, assessment_id, user_id, enrollment_id, assessment_version, attempt_no, started_at, deadline_at, grace_seconds, status, passing_score_pct, result_status, final_score_pct, submitted_at, finalized_at)
       VALUES ('att-profil-000001', ?, ?, ?, 1, 1, 1, 2, 0, 'submitted', 60, 'passed', 85, 2, 2)`,
    )
      .bind(seeded.assessmentId, uid, enr)
      .run();
    await l.json('GET', `/api/v1/courses/${seeded.courseId}`); // memicu pembuatan sertifikat
    const c = (await l.json('GET', '/api/v1/me/courses')).body.courses[0];
    expect(c).toMatchObject({ status: 'completed', completedLessons: 2, passedQuizzes: 1, certificateStatus: 'pending' });

    let certs = (await l.json('GET', '/api/v1/me/certificates')).body.certificates;
    expect(certs).toHaveLength(1);
    expect(certs[0]).toMatchObject({ status: 'pending', recipientName: 'Nama Panggilan', courseSlug: 'dasar-transparansi-desa', code: null });

    expect((await l.json('PATCH', '/api/v1/me', { certificateName: 'I Wayan Lengkap, S.Sos.' })).status).toBe(200);
    certs = (await l.json('GET', '/api/v1/me/certificates')).body.certificates;
    expect(certs[0].recipientName).toBe('I Wayan Lengkap, S.Sos.');

    // Sertifikat yang sudah terbit tidak ikut berubah.
    await h.env.DB.prepare(`UPDATE certificates SET status = 'issued', certificate_no = '0009/PD/BELAJAR/2026', verification_code = 'ABCD2345EFGH6789' WHERE user_id = ?`)
      .bind(uid)
      .run();
    await l.json('PATCH', '/api/v1/me', { certificateName: 'Nama Lain' });
    certs = (await l.json('GET', '/api/v1/me/certificates')).body.certificates;
    expect(certs[0]).toMatchObject({ status: 'issued', recipientName: 'I Wayan Lengkap, S.Sos.' });
  });

  it('data kelas & sertifikat milik sendiri saja; tamu ditolak', async () => {
    const { l } = await enrolledLearner('lain@contoh.test', 'Lain');
    expect((await l.json('GET', '/api/v1/me/certificates')).body.certificates).toEqual([]);
    expect((await new Client(h).json('GET', '/api/v1/me/courses')).status).toBe(401);
    expect((await new Client(h).json('GET', '/api/v1/me/certificates')).status).toBe(401);
  });
});
