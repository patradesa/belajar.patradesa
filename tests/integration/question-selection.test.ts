/** Pilihan soal kuis dari bank: hanya soal yang dipakai yang diundi; tersalin ke draft baru; hanya draft & editor. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QuestionCreate } from '@patradesa/shared';
import { Client, createHarness, type Harness } from '../helpers/harness';

let h: Harness;
let admin: Client;
let courseId: string;
let lessonId: string;
let assessmentId: string;

const mcq = (i: number): QuestionCreate => ({
  type: 'mcq',
  stem: `Soal pilihan fiktif nomor ${i}?`,
  topic: 'umum',
  difficulty: 2,
  points: 2,
  options: [
    { body: `Benar ${i}`, isCorrect: true },
    { body: `Salah ${i}`, isCorrect: false },
  ],
});
const essay = (i: number): QuestionCreate => ({
  type: 'essay',
  stem: `Esai pilihan fiktif nomor ${i}?`,
  topic: 'esai',
  difficulty: 2,
  points: 8,
  rubric: [{ criterion: 'Konsep', maxScore: 100 }],
  modelAnswer: 'Contoh.',
});

const bank = async () => {
  const d = await admin.json('GET', `/api/v1/admin/courses/${courseId}`);
  return d.body.lessons[0].assessment as {
    id: string;
    questions: { id: string; stem: string; type: string; in_quiz: number }[];
  };
};

beforeAll(async () => {
  h = await createHarness();
  admin = await new Client(h).login('admin@contoh.test', 'Admin', ['admin']);
  courseId = (
    await admin.json('POST', '/api/v1/admin/courses', {
      slug: 'kelas-pilihan',
      title: 'Kelas Pilihan Soal',
    })
  ).body.id;
  lessonId = (
    await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, {
      title: 'Modul',
      contentType: 'html',
      contentSource: '## Isi',
      requiredActiveSeconds: 0,
    })
  ).body.id;
  assessmentId = (
    await admin.json('PUT', `/api/v1/admin/lessons/${lessonId}/assessment`, {
      title: 'Kuis Pilihan',
      timeLimitSeconds: 600,
      passingScorePct: 70,
      maxAttempts: 3,
      cooldownSeconds: 0,
      mcqCount: 3,
      essayCount: 1,
    })
  ).body.id;
  const qs = [...Array.from({ length: 8 }, (_, i) => mcq(i + 1)), essay(1), essay(2), essay(3)];
  for (let i = 0; i < qs.length; i += 5) {
    await admin.json('POST', `/api/v1/admin/assessments/${assessmentId}/questions/import`, { questions: qs.slice(i, i + 5) });
  }
});
afterAll(() => h.dispose());

describe('pilihan soal kuis', () => {
  it('soal baru otomatis dipakai; simpan pilihan mengembalikan jumlah per jenis dan tercatat di audit', async () => {
    const a = await bank();
    expect(a.questions).toHaveLength(11);
    expect(a.questions.every((q) => q.in_quiz === 1)).toBe(true);
    const wanted = ['Soal pilihan fiktif nomor 2?', 'Soal pilihan fiktif nomor 5?', 'Soal pilihan fiktif nomor 7?', 'Esai pilihan fiktif nomor 3?'];
    const keep = a.questions.filter((q) => wanted.includes(q.stem));
    expect(keep).toHaveLength(4);
    const r = await admin.json('POST', `/api/v1/admin/assessments/${assessmentId}/questions/selection`, { ids: keep.map((q) => q.id) });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ mcq: 3, essay: 1 });
    const after = await bank();
    expect(
      after.questions
        .filter((q) => q.in_quiz === 1)
        .map((q) => q.id)
        .sort(),
    ).toEqual(keep.map((q) => q.id).sort());
    const audit = await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action = 'question.select'`).first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it('peserta hanya mendapat soal yang dipakai', async () => {
    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);
    for (let i = 0; i < 3; i++) {
      const l = await new Client(h).login(`p${i}@contoh.test`, `P${i}`);
      await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
      await l.json('POST', `/api/v1/lessons/${lessonId}/session`);
      const at = await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`);
      expect(at.status).toBe(201);
      const stems = at.body.questions.map((q: { stem: string }) => q.stem).sort();
      expect(stems).toEqual(
        ['Esai pilihan fiktif nomor 3?', 'Soal pilihan fiktif nomor 2?', 'Soal pilihan fiktif nomor 5?', 'Soal pilihan fiktif nomor 7?'].sort(),
      );
    }
  });

  it('versi terbit tidak dapat diubah; learner ditolak; draft baru menyalin pilihan', async () => {
    const a = await bank();
    expect((await admin.json('POST', `/api/v1/admin/assessments/${a.id}/questions/selection`, { ids: [] })).status).toBe(409);
    const learner = await new Client(h).login('bukan-editor@contoh.test', 'L');
    expect((await learner.json('POST', `/api/v1/admin/assessments/${a.id}/questions/selection`, { ids: [] })).status).toBe(403);

    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/draft`)).status).toBe(201);
    const draft = await bank();
    expect(draft.id).not.toBe(a.id);
    expect(
      draft.questions
        .filter((q) => q.in_quiz === 1)
        .map((q) => q.stem)
        .sort(),
    ).toEqual(
      a.questions
        .filter((q) => q.in_quiz === 1)
        .map((q) => q.stem)
        .sort(),
    );
    // ID soal dari versi lain diabaikan (tidak mengubah apa pun di draft).
    const r = await admin.json('POST', `/api/v1/admin/assessments/${draft.id}/questions/selection`, { ids: a.questions.map((q) => q.id) });
    expect(r.body).toEqual({ mcq: 0, essay: 0 });
    // Skema ketat: field lain ditolak.
    expect((await admin.json('POST', `/api/v1/admin/assessments/${draft.id}/questions/selection`, { ids: [], all: true })).status).toBe(400);
  });
});
