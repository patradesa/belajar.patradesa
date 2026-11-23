/** Editor sederhana: ringkasan perubahan draf, validasi sebelum terbit, dan log perubahan per kelas. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, type Harness } from '../helpers/harness';

let h: Harness;
let admin: Client;
let courseId: string;
const lessonsOf = async () => (await admin.json('GET', `/api/v1/admin/courses/${courseId}`)).body.lessons as any[];
const byKey = async (k: string) => (await lessonsOf()).find((l) => l.lesson_key === k);
const quiz = (extra: Record<string, unknown> = {}) => ({ title: 'Post-test', timeLimitSeconds: 900, passingScorePct: 0, maxAttempts: 3, cooldownSeconds: 0, mcqCount: 1, essayCount: 0, ...extra });
const mcq = { type: 'mcq', stem: 'Soal uji editor?', options: [{ body: 'Ya', isCorrect: true }, { body: 'Tidak', isCorrect: false }] };

beforeAll(async () => {
  h = await createHarness();
  admin = await new Client(h).login('admin@contoh.test', 'Admin Uji', ['admin']);
  courseId = (await admin.json('POST', '/api/v1/admin/courses', { slug: 'kelas-editor-uji', title: 'Kelas Editor Uji', visibility: 'private' })).body.id;
  await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, { title: 'Unit 1', contentType: 'html', contentSource: '## A\n\nIsi.', requiredActiveSeconds: 300, lessonKey: 'u01' });
  await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, { title: 'Post-test', contentType: 'html', contentSource: 'Post-test.', requiredActiveSeconds: 300, lessonKey: 'post-test' });
});
afterAll(() => h.dispose());

describe('editor sederhana', () => {
  it('kelas baru: ringkasan = materi baru; kuis kurang soal ditolak saat terbit dengan pesan jelas', async () => {
    const pt = await byKey('post-test');
    await admin.json('PUT', `/api/v1/admin/lessons/${pt.id}/assessment`, quiz());
    const ch = await admin.json('GET', `/api/v1/admin/courses/${courseId}/changes`);
    expect(ch.body.changes).toEqual(['Materi baru: Unit 1', 'Materi baru: Post-test']);
    expect(ch.body.problems[0]).toContain('butuh 1 soal PG');
    const pub = await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`);
    expect(pub.status).toBe(409);
    expect(pub.body.error.details).toHaveLength(1);

    await admin.json('POST', `/api/v1/admin/assessments/${(await byKey('post-test')).assessment.id}/questions`, mcq);
    expect((await admin.json('GET', `/api/v1/admin/courses/${courseId}/changes`)).body.problems).toEqual([]);
    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);
    expect((await admin.json('GET', `/api/v1/admin/courses/${courseId}/changes`)).body).toEqual({ draftVersionId: null, changes: [], problems: [] });
  });

  it('draf: ringkasan menyebut sebelum → sesudah untuk angka, "diubah" untuk teks, materi baru/dihapus', async () => {
    await admin.json('POST', `/api/v1/admin/courses/${courseId}/draft`);
    const pt = await byKey('post-test');
    await admin.json('PUT', `/api/v1/admin/lessons/${pt.id}`, { title: 'Post-test', contentType: 'html', contentSource: 'Post-test baru.', requiredActiveSeconds: 0 });
    await admin.json('PUT', `/api/v1/admin/lessons/${pt.id}/assessment`, quiz({ passingScorePct: 70 }));
    const u1 = await byKey('u01');
    await admin.json('DELETE', `/api/v1/admin/lessons/${u1.id}`);
    await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, { title: 'Unit 2', contentType: 'html', contentSource: 'Isi 2.', lessonKey: 'u02' });
    const ch = (await admin.json('GET', `/api/v1/admin/courses/${courseId}/changes`)).body.changes as string[];
    expect(ch).toContain('Post-test: isi diubah; waktu minimum 5 menit → 0 menit; nilai lulus 0% → 70%');
    expect(ch).toContain('Materi baru: Unit 2');
    expect(ch).toContain('Materi dihapus: Unit 1');
  });

  it('log kelas: siapa/kapan/apa, termasuk materi yang sudah dihapus; hanya editor/admin', async () => {
    const log = (await admin.json('GET', `/api/v1/admin/courses/${courseId}/log`)).body.log as any[];
    const labels = log.map((x) => x.label);
    for (const l of ['Kelas dibuat', 'Materi ditambahkan', 'Pengaturan kuis disimpan', 'Soal ditambahkan', 'Versi diterbitkan', 'Draf dibuat', 'Materi disimpan', 'Materi dihapus']) {
      expect(labels).toContain(l);
    }
    expect(log[0].actor).toBe('Admin Uji');
    expect(log.find((x) => x.label === 'Pengaturan kuis disimpan' && x.detail.includes('nilai lulus 0% → 70%'))).toBeTruthy();
    expect(log.find((x) => x.label === 'Materi dihapus').detail).toContain('Unit 1');
    expect(JSON.stringify(log)).not.toContain('@contoh.test');

    const learner = await new Client(h).login('peserta@contoh.test', 'P');
    expect((await learner.json('GET', `/api/v1/admin/courses/${courseId}/log`)).status).toBe(403);
    expect((await learner.json('GET', `/api/v1/admin/courses/${courseId}/changes`)).status).toBe(403);
  });
});
