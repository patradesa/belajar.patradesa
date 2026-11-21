/** Impor bank soal: per potongan, atomik, hanya draft & editor/admin, hasil dipakai acak kuis. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUESTION_IMPORT_CHUNK, questionBankFileSchema, type QuestionCreate } from '@patradesa/shared';
import { Client, createHarness, type Harness } from '../helpers/harness';

let h: Harness;
let admin: Client;
let courseId: string;
let lessonId: string;
let assessmentId: string;

const mcq = (i: number, topic: string): QuestionCreate => ({
  type: 'mcq',
  stem: `Soal uji fiktif nomor ${i}?`,
  topic,
  difficulty: (i % 3) + 1,
  points: 2,
  options: [
    { body: `Benar ${i}`, isCorrect: true },
    { body: `Salah A ${i}`, isCorrect: false },
    { body: `Salah B ${i}`, isCorrect: false },
    { body: `Salah C ${i}`, isCorrect: false },
  ],
});
const essay = (i: number): QuestionCreate => ({
  type: 'essay',
  stem: `Esai uji fiktif nomor ${i}?`,
  topic: 'esai',
  difficulty: 2,
  points: 8,
  rubric: [
    { criterion: 'Konsep', maxScore: 60 },
    { criterion: 'Kejelasan', maxScore: 40 },
  ],
  modelAnswer: 'Contoh jawaban.',
});

async function importAll(qs: QuestionCreate[]) {
  for (let i = 0; i < qs.length; i += QUESTION_IMPORT_CHUNK) {
    const r = await admin.json('POST', `/api/v1/admin/assessments/${assessmentId}/questions/import`, { questions: qs.slice(i, i + QUESTION_IMPORT_CHUNK) });
    if (r.status !== 201) throw new Error(`import ${r.status} ${JSON.stringify(r.body)}`);
  }
}
const countQ = async () =>
  (await h.env.DB.prepare('SELECT type, COUNT(*) AS n FROM questions WHERE assessment_id = ? AND is_active = 1 GROUP BY type').bind(assessmentId).all<{ type: string; n: number }>())
    .results;

beforeAll(async () => {
  h = await createHarness();
  admin = await new Client(h).login('admin@contoh.test', 'Admin', ['admin']);
  courseId = (await admin.json('POST', '/api/v1/admin/courses', { slug: 'kelas-impor', title: 'Kelas Impor' })).body.id;
  lessonId = (await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, { title: 'Modul', contentType: 'html', contentSource: '## Isi', requiredActiveSeconds: 0 })).body.id;
  assessmentId = (
    await admin.json('PUT', `/api/v1/admin/lessons/${lessonId}/assessment`, {
      title: 'Kuis Impor',
      timeLimitSeconds: 3600,
      passingScorePct: 70,
      maxAttempts: 2,
      cooldownSeconds: 0,
      mcqCount: 6,
      essayCount: 2,
    })
  ).body.id;
});
afterAll(() => h.dispose());

describe('impor bank soal', () => {
  it('mengimpor per potongan; urutan & opsi tersimpan; detail admin memuat semua opsi', async () => {
    const qs = [...Array.from({ length: 12 }, (_, i) => mcq(i + 1, ['a', 'b', 'c'][i % 3]!)), essay(1), essay(2), essay(3)];
    await importAll(qs);
    expect(await countQ()).toEqual([
      { type: 'essay', n: 3 },
      { type: 'mcq', n: 12 },
    ]);
    const d = await admin.json('GET', `/api/v1/admin/courses/${courseId}`);
    const bank = d.body.lessons[0].assessment.questions;
    expect(bank.map((q: any) => q.stem)).toEqual(qs.map((q) => q.stem));
    expect(bank.filter((q: any) => q.type === 'mcq').every((q: any) => q.options.length === 4 && q.options.filter((o: any) => o.is_correct === 1).length === 1)).toBe(true);
    const audit = await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action = 'question.import'`).first<{ n: number }>();
    expect(audit?.n).toBe(3);
  });

  it('potongan > batas, soal tidak valid, atau dua jawaban benar ditolak tanpa menyimpan apa pun', async () => {
    const before = await countQ();
    const tooMany = Array.from({ length: QUESTION_IMPORT_CHUNK + 1 }, (_, i) => mcq(100 + i, 'a'));
    expect((await admin.json('POST', `/api/v1/admin/assessments/${assessmentId}/questions/import`, { questions: tooMany })).status).toBe(400);
    const bad = mcq(200, 'a');
    if (bad.type === 'mcq') bad.options[1]!.isCorrect = true;
    expect((await admin.json('POST', `/api/v1/admin/assessments/${assessmentId}/questions/import`, { questions: [mcq(201, 'a'), bad] })).status).toBe(400);
    expect(await countQ()).toEqual(before);
  });

  it('learner ditolak; versi terbit tidak dapat diimpori', async () => {
    const learner = await new Client(h).login('l@contoh.test', 'L');
    expect((await learner.json('POST', `/api/v1/admin/assessments/${assessmentId}/questions/import`, { questions: [mcq(300, 'a')] })).status).toBe(403);
    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);
    expect((await admin.json('POST', `/api/v1/admin/assessments/${assessmentId}/questions/import`, { questions: [mcq(301, 'a')] })).status).toBe(409);
  });

  it('kuis mengacak jumlah sesuai pengaturan dari bank hasil impor', async () => {
    const l = await new Client(h).login('peserta@contoh.test', 'Peserta');
    await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
    await l.json('POST', `/api/v1/lessons/${lessonId}/session`);
    const a = await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`);
    expect(a.status).toBe(201);
    expect(a.body.questions.filter((q: any) => q.type === 'mcq')).toHaveLength(6);
    expect(a.body.questions.filter((q: any) => q.type === 'essay')).toHaveLength(2);
    // Seimbang per topik: 6 dari 3 topik → 2 per topik.
    const stems = a.body.questions.filter((q: any) => q.type === 'mcq').map((q: any) => Number(/nomor (\d+)/.exec(q.stem)![1]));
    const perTopic = [0, 1, 2].map((t) => stems.filter((n: number) => (n - 1) % 3 === t).length);
    expect(perTopic).toEqual([2, 2, 2]);
  });
});

const PRIVATE = join(__dirname, '..', '..', 'content-private', 'bank-soal', 'penyelenggaraan-pemerintahan-desa.json');
describe.skipIf(!existsSync(PRIVATE))('bank Penyelenggaraan Pemerintahan Desa (berkas privat)', () => {
  it('65 soal terimpor dan kuis menyajikan 20 PG + 5 esai', async () => {
    const qs = questionBankFileSchema.parse(JSON.parse(readFileSync(PRIVATE, 'utf8'))).questions;
    const c = (await admin.json('POST', '/api/v1/admin/courses', { slug: 'penyelenggaraan-pemdes', title: 'Penyelenggaraan Pemerintahan Desa' })).body.id;
    lessonId = (await admin.json('POST', `/api/v1/admin/courses/${c}/lessons`, { title: 'Modul', contentType: 'html', contentSource: '## Modul', requiredActiveSeconds: 0 })).body.id;
    assessmentId = (
      await admin.json('PUT', `/api/v1/admin/lessons/${lessonId}/assessment`, {
        title: 'Kuis Penyelenggaraan Pemerintahan Desa',
        timeLimitSeconds: 3600,
        passingScorePct: 70,
        maxAttempts: 2,
        cooldownSeconds: 86400,
        mcqCount: 20,
        essayCount: 5,
      })
    ).body.id;
    await importAll(qs);
    expect(await countQ()).toEqual([
      { type: 'essay', n: 15 },
      { type: 'mcq', n: 50 },
    ]);
    expect((await admin.json('POST', `/api/v1/admin/courses/${c}/publish`)).status).toBe(200);
    const l = await new Client(h).login('peserta2@contoh.test', 'Peserta 2');
    await l.json('POST', `/api/v1/courses/${c}/enroll`);
    await l.json('POST', `/api/v1/lessons/${lessonId}/session`);
    const a = await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`);
    expect(a.body.questions.filter((q: any) => q.type === 'mcq')).toHaveLength(20);
    expect(a.body.questions.filter((q: any) => q.type === 'essay')).toHaveLength(5);
    const sub = await l.json('POST', `/api/v1/attempts/${a.body.id}/submit`);
    expect(sub.body.mcqMax).toBe(40);
    expect(sub.body.essayMax).toBe(40);
  });
});
