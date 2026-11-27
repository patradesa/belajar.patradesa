/**
 * Arsipkan / pulihkan / hapus permanen kelas (khusus admin).
 * Arsip menutup katalog dan akses peserta tanpa menghapus data; hapus permanen hanya untuk kelas tanpa peserta dan sertifikat.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, type Harness } from '../helpers/harness';

let h: Harness;
let admin: Client;
let editor: Client;

async function makeCourse(slug: string, withQuiz = false): Promise<{ id: string; lessonId: string }> {
  const created = await admin.json('POST', '/api/v1/admin/courses', { slug, title: `Kelas ${slug}`, description: 'Uji arsip dan hapus.', visibility: 'public' });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  const lr = await admin.json('POST', `/api/v1/admin/courses/${id}/lessons`, {
    lessonKey: `${slug}-u01`,
    title: 'Materi satu',
    contentType: 'html',
    contentSource: '## Bacaan\nIsi contoh.',
    requiredActiveSeconds: 0,
  });
  expect(lr.status).toBe(201);
  if (withQuiz) {
    const a = await admin.json('PUT', `/api/v1/admin/lessons/${lr.body.id}/assessment`, {
      title: 'Kuis',
      timeLimitSeconds: 600,
      passingScorePct: 70,
      maxAttempts: 3,
      cooldownSeconds: 0,
      mcqCount: 1,
      essayCount: 0,
    });
    expect(a.status).toBe(200);
    const q = await admin.json('POST', `/api/v1/admin/assessments/${a.body.id}/questions/import`, {
      questions: [{ type: 'mcq', stem: 'Pertanyaan contoh?', options: [{ body: 'Benar', isCorrect: true }, { body: 'Salah', isCorrect: false }] }],
    });
    expect(q.status).toBeLessThan(300);
  }
  return { id, lessonId: lr.body.id as string };
}

const count = async (sql: string, ...binds: unknown[]) => (await h.env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

beforeAll(async () => {
  h = await createHarness();
  admin = await new Client(h).login('admin-arsip@contoh.test', 'Admin', ['admin']);
  editor = await new Client(h).login('editor-arsip@contoh.test', 'Editor', ['content_editor']);
});
afterAll(() => h.dispose());

describe('arsipkan dan pulihkan kelas', () => {
  it('arsip menyembunyikan dari katalog dan menutup akses peserta; data tetap; pulihkan mengembalikan', async () => {
    const { id } = await makeCourse('kelas-arsip-uji');
    expect((await admin.json('POST', `/api/v1/admin/courses/${id}/publish`)).status).toBe(200);
    const p = await new Client(h).login('peserta-arsip@contoh.test', 'Peserta');
    expect((await p.json('POST', `/api/v1/courses/${id}/enroll`)).status).toBeLessThan(300);
    const lessonId = (await p.json('GET', `/api/v1/courses/${id}`)).body.lessons[0].id;
    expect((await p.json('GET', `/api/v1/lessons/${lessonId}/content`)).status).toBe(200);

    expect((await editor.json('POST', `/api/v1/admin/courses/${id}/archive`)).status).toBe(403);
    const ar = await admin.json('POST', `/api/v1/admin/courses/${id}/archive`);
    expect(ar.body).toMatchObject({ ok: true, status: 'archived' });

    const catalog = (await p.json('GET', '/api/v1/catalog')).body.courses.map((x: any) => x.id);
    expect(catalog).not.toContain(id);
    expect((await p.json('GET', `/api/v1/lessons/${lessonId}/content`)).status).toBeGreaterThanOrEqual(400);
    expect(await count('SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ?', id)).toBe(1);

    const detail = (await admin.json('GET', `/api/v1/admin/courses/${id}`)).body;
    expect(detail.course.status).toBe('archived');
    expect(detail.enrollmentCount).toBe(1);

    // Kelas berpeserta tidak bisa dihapus permanen.
    const del = await admin.json('DELETE', `/api/v1/admin/courses/${id}`);
    expect(del.status).toBe(409);
    expect(JSON.stringify(del.body)).toContain('Arsipkan saja');

    const un = await admin.json('POST', `/api/v1/admin/courses/${id}/unarchive`);
    expect(un.body).toMatchObject({ ok: true, status: 'published' });
    expect((await p.json('GET', '/api/v1/catalog')).body.courses.map((x: any) => x.id)).toContain(id);
    expect((await p.json('GET', `/api/v1/lessons/${lessonId}/content`)).status).toBe(200);

    const log = (await admin.json('GET', `/api/v1/admin/courses/${id}/log`)).body.log.map((l: any) => l.label);
    expect(log).toEqual(expect.arrayContaining(['Kelas diarsipkan', 'Kelas dipulihkan dari arsip']));
  });

  it('kelas yang belum pernah terbit kembali menjadi draf saat dipulihkan', async () => {
    const { id } = await makeCourse('kelas-arsip-draf');
    await admin.json('POST', `/api/v1/admin/courses/${id}/archive`);
    expect((await admin.json('POST', `/api/v1/admin/courses/${id}/unarchive`)).body.status).toBe('draft');
  });
});

describe('hapus permanen kelas', () => {
  it('menghapus kelas tanpa peserta beserta materi, kuis, dan soal; tercatat di audit', async () => {
    const { id, lessonId } = await makeCourse('kelas-hapus-uji', true);
    expect(await count('SELECT COUNT(*) AS n FROM questions q JOIN assessments a ON a.id = q.assessment_id WHERE a.lesson_id = ?', lessonId)).toBe(1);

    expect((await editor.json('DELETE', `/api/v1/admin/courses/${id}`)).status).toBe(403);
    const del = await admin.json('DELETE', `/api/v1/admin/courses/${id}`);
    expect(del.status).toBe(200);

    expect((await admin.json('GET', `/api/v1/admin/courses/${id}`)).status).toBe(404);
    expect(await count('SELECT COUNT(*) AS n FROM course_versions WHERE course_id = ?', id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM lessons WHERE id = ?', lessonId)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM assessments WHERE lesson_id = ?', lessonId)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action = 'course.delete' AND target_id = ?`, id)).toBe(1);

    // Slug bisa dipakai lagi untuk impor ulang.
    expect((await admin.json('POST', '/api/v1/admin/courses', { slug: 'kelas-hapus-uji', title: 'Kelas impor ulang', visibility: 'private' })).status).toBe(201);
  });

  it('kelas yang tidak ada → 404', async () => {
    expect((await admin.json('DELETE', '/api/v1/admin/courses/tidak-ada')).status).toBe(404);
  });
});
