/**
 * Kelengkapan untuk impor paket kelas: kode materi (lessonKey) yang bisa diatur, tautan remedial skenario,
 * penjelasan soal PG, dan pembahasan hasil kuis yang hanya tampil setelah lulus / kesempatan habis.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, type Harness } from '../helpers/harness';

const ROOT = join(import.meta.dirname, '..', '..');
let h: Harness;
let admin: Client;
let courseId: string;
let unitId: string;
let quizLessonId: string;
let assessmentId: string;

const mcq = (n: number) => ({
  type: 'mcq',
  stem: `Soal simulasi nomor ${n}: pilih jawaban terbaik.`,
  topic: `U0${n}`,
  points: 10,
  options: [
    { body: `Benar ${n}`, isCorrect: true },
    { body: `Keliru ${n}`, isCorrect: false },
  ],
  explanation: `Penjelasan soal ${n}: periksa aturan sebelum memutuskan.`,
});

beforeAll(async () => {
  h = await createHarness();
  admin = await new Client(h).login('admin@contoh.test', 'Admin', ['admin']);
  courseId = (await admin.json('POST', '/api/v1/admin/courses', { slug: 'kelas-impor-uji', title: 'Kelas Impor Uji', visibility: 'public' })).body.id;
});
afterAll(() => h.dispose());

const lessonBody = (extra: Record<string, unknown> = {}) => ({ title: 'Unit Uji', summary: '', contentType: 'html', contentSource: 'Isi unit.', requiredActiveSeconds: 0, ...extra });

describe('kode materi (lessonKey)', () => {
  it('bisa diatur saat membuat; duplikat di versi yang sama → 409; format salah → 400; sunting tanpa kode tidak mengubahnya', async () => {
    const a = await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, lessonBody({ lessonKey: 'dd26-u01-pilih-dasar-aturan' }));
    expect(a.status).toBe(201);
    unitId = a.body.id;
    const dup = await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, lessonBody({ lessonKey: 'dd26-u01-pilih-dasar-aturan' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toContain('Kode materi');
    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, lessonBody({ lessonKey: 'Kode Salah' }))).status).toBe(400);

    expect((await admin.json('PUT', `/api/v1/admin/lessons/${unitId}`, lessonBody({ title: 'Unit Uji (ubah)' }))).status).toBe(200);
    const detail = await admin.json('GET', `/api/v1/admin/courses/${courseId}`);
    expect(detail.body.lessons.find((l: any) => l.id === unitId)).toMatchObject({ lesson_key: 'dd26-u01-pilih-dasar-aturan', title: 'Unit Uji (ubah)' });
  });

  it('tautan remedial skenario menuju materi dengan lessonKey yang cocok', async () => {
    const def = JSON.parse(readFileSync(join(ROOT, 'docs', 'scenario-block', 'contoh-adm01-beda-nama-bali.json'), 'utf8'));
    def.id = 'remedial-uji';
    def.remedial = { label: 'Ulangi unit 1', lessonKey: 'dd26-u01-pilih-dasar-aturan' };
    const s = await admin.json('POST', '/api/v1/admin/scenarios', { definition: def });
    expect(s.status).toBe(201);
    await admin.json('POST', `/api/v1/admin/scenarios/${s.body.id}/status`, {
      status: 'published',
      review: { reviewedBy: 'Penelaah Uji', reviewedAt: '2026-11-20', nextReviewDue: '2027-11-20' },
    });
    const withScenario = await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, lessonBody({ title: 'Unit Skenario', contentSource: '[[skenario:remedial-uji]]', isRequired: false }));
    expect(withScenario.status).toBe(201);

    // Kuis dengan pembahasan setelah selesai (dipakai describe berikutnya).
    quizLessonId = (await admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, lessonBody({ title: 'Post-test', lessonKey: 'post-test' }))).body.id;
    const as = await admin.json('PUT', `/api/v1/admin/lessons/${quizLessonId}/assessment`, {
      title: 'Post-test Uji',
      timeLimitSeconds: 600,
      passingScorePct: 70,
      maxAttempts: 2,
      cooldownSeconds: 0,
      mcqCount: 3,
      essayCount: 0,
      reviewPolicy: 'after_done',
    });
    expect(as.status).toBe(200);
    assessmentId = as.body.id;
    const imp = await admin.json('POST', `/api/v1/admin/assessments/${assessmentId}/questions/import`, { questions: [mcq(1), mcq(2), mcq(3)] });
    expect(imp.status).toBeLessThan(300);
    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);

    const l = await new Client(h).login('remedial@contoh.test', 'Remedial');
    await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
    const content = await l.json('GET', `/api/v1/lessons/${withScenario.body.id}/content`);
    const blockId = content.body.scenarios[0].blockId;
    let d = (await l.json('POST', `/api/v1/scenarios/${blockId}/attempts`, { lessonId: withScenario.body.id })).body;
    for (let i = 0; i < 10 && !d.final; i++) {
      const body = d.node.type === 'info' ? { nodeId: d.node.id, continue: true } : { nodeId: d.node.id, optionKey: 'p1' };
      d = (await l.json('POST', `/api/v1/scenario-attempts/${d.attempt.id}/choices`, body)).body.delivery;
    }
    // Versi kelas terbit: lesson id berubah? Tidak — draft pertama langsung menjadi versi terbit.
    expect(d.final.remedial).toEqual({ label: 'Ulangi unit 1', lessonId: unitId });
    expect(content.body.scenarios[0].localValidationNote).toContain('Disdukcapil');
  });
});

describe('pembahasan kuis (review_policy after_done)', () => {
  async function attempt(l: Client, correct: number) {
    const a = (await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`)).body;
    const answers = a.questions.map((q: any, i: number) => ({
      questionId: q.id,
      optionKey: q.options.find((o: any) => (i < correct ? o.body.startsWith('Benar') : o.body.startsWith('Keliru'))).key,
    }));
    expect((await l.json('PATCH', `/api/v1/attempts/${a.id}/answers`, { answers })).status).toBe(200);
    expect((await l.json('POST', `/api/v1/attempts/${a.id}/submit`)).status).toBe(200);
    return (await l.json('GET', `/api/v1/attempts/${a.id}/result`)).body;
  }

  it('gagal dengan sisa kesempatan → tanpa kunci; kesempatan habis → pembahasan lengkap dengan penjelasan', async () => {
    const l = await new Client(h).login('bahas@contoh.test', 'Bahas');
    await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
    await l.json('POST', `/api/v1/lessons/${quizLessonId}/session`);
    const first = await attempt(l, 1);
    expect(first.resultStatus).toBe('failed');
    expect(first.mcqReview).toBeNull();
    expect(first.reviewNote).toContain('setelah Anda lulus');
    expect(JSON.stringify(first)).not.toContain('Penjelasan soal');

    const last = await attempt(l, 0);
    expect(last.mcqReview).toHaveLength(3);
    for (const q of last.mcqReview) {
      expect(q.explanation).toMatch(/^Penjelasan soal \d/);
      expect(q.options.filter((o: any) => o.correct)).toHaveLength(1);
      expect(q.options.find((o: any) => o.correct).body).toMatch(/^Benar/);
      expect(q.options.find((o: any) => o.chosen).body).toMatch(/^Keliru/);
    }
  });

  it('lulus → pembahasan tampil; kebijakan bawaan (none) → tidak pernah tampil', async () => {
    const l = await new Client(h).login('lulus@contoh.test', 'Lulus');
    await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
    await l.json('POST', `/api/v1/lessons/${quizLessonId}/session`);
    const pass = await attempt(l, 3);
    expect(pass.resultStatus).toBe('passed');
    expect(pass.mcqReview?.every((q: any) => q.options.find((o: any) => o.chosen)?.correct)).toBe(true);

    // Salin ke draf baru: kebijakan & penjelasan ikut; ubah kebijakan ke 'none' lalu terbitkan.
    await admin.json('POST', `/api/v1/admin/courses/${courseId}/draft`);
    const draft = await admin.json('GET', `/api/v1/admin/courses/${courseId}`);
    const quizLesson = draft.body.lessons.find((x: any) => x.lesson_key === 'post-test');
    expect(quizLesson.assessment.review_policy).toBe('after_done');
    expect(quizLesson.assessment.questions[0].explanation).toMatch(/^Penjelasan soal/);
  });

  it('kuis disimpan tanpa reviewPolicy (bawaan none) → kunci tidak tampil walau kesempatan habis', async () => {
    const draft = await admin.json('GET', `/api/v1/admin/courses/${courseId}`);
    const quizLesson = draft.body.lessons.find((x: any) => x.lesson_key === 'post-test');
    const saved = await admin.json('PUT', `/api/v1/admin/lessons/${quizLesson.id}/assessment`, {
      title: 'Post-test Uji',
      timeLimitSeconds: 600,
      passingScorePct: 70,
      maxAttempts: 2,
      cooldownSeconds: 0,
      mcqCount: 3,
      essayCount: 0,
    });
    expect(saved.status).toBe(200);
    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);
    assessmentId = saved.body.id;
    quizLessonId = quizLesson.id;

    const l = await new Client(h).login('tanpa-bahas@contoh.test', 'Tanpa Bahas');
    await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
    await l.json('POST', `/api/v1/lessons/${quizLessonId}/session`);
    await attempt(l, 0);
    const last = await attempt(l, 0);
    expect(last.mcqReview).toBeNull();
    expect(last.reviewNote).toBeNull();
    expect(JSON.stringify(last)).not.toContain('Penjelasan soal');
  });
});
