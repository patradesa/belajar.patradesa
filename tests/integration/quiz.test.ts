/** Kuis: acak server, kunci jawaban tidak bocor, batas attempt, deadline, idempotensi, esai → review manusia. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, readyLearner, seedDemoCourse, type Harness } from '../helpers/harness';

let h: Harness;
let admin: Client;
let mentor: Client;
let courseId: string;
let quizLessonId: string;
let assessmentId: string;

beforeAll(async () => {
  h = await createHarness();
  admin = await new Client(h).login('admin@contoh.test', 'Admin Uji', ['admin']);
  ({ courseId, assessmentId } = await seedDemoCourse(admin).then((s) => ({ ...s, quizLessonId: (quizLessonId = s.lessonIds[1]!) })));
  mentor = await new Client(h).login('mentor@contoh.test', 'Mentor Uji', ['mentor']);
  const mentorId = (await mentor.json('GET', '/api/v1/me')).body.user.id;
  await admin.json('POST', `/api/v1/admin/courses/${courseId}/mentors`, { mentorId, assign: true });
});
afterAll(() => h.dispose());

async function newLearner(n: string): Promise<Client> {
  const c = await new Client(h).login(`${n}@contoh.test`, n);
  await readyLearner(c, courseId, quizLessonId);
  return c;
}

/** Ambil kunci benar dari DB (hanya mungkin di sisi server/tes). */
async function correctKeys(attemptId: string): Promise<Map<string, string>> {
  const { results } = await h.env.DB.prepare('SELECT id, answer_key_snapshot FROM attempt_questions WHERE attempt_id = ? AND type = ?')
    .bind(attemptId, 'mcq')
    .all<{ id: string; answer_key_snapshot: string }>();
  return new Map(results.map((r) => [r.id, r.answer_key_snapshot]));
}

describe('kuis', () => {
  it('payload soal tidak memuat kunci, flag benar, rubrik, atau model answer; jumlah sesuai konfigurasi', async () => {
    const l = await newLearner('p-leak');
    const r = await l.raw('POST', `/api/v1/assessments/${assessmentId}/attempts`);
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const text = await r.text();
    for (const banned of ['is_correct', 'isCorrect', 'answer_key', 'rubric', 'model_answer', 'modelAnswer', 'question_id', 'Ketepatan konsep']) {
      expect(text).not.toContain(banned);
    }
    const body = JSON.parse(text);
    expect(body.questions.filter((q: any) => q.type === 'mcq')).toHaveLength(5);
    expect(body.questions.filter((q: any) => q.type === 'essay')).toHaveLength(1);
    // Bank soal (10 MCQ) tidak pernah dikirim seluruhnya.
    expect(body.questions.length).toBeLessThan(12);
  });

  it('acak per attempt: urutan opsi/soal berbeda antar peserta (probabilistik) dan ID opaque', async () => {
    const seqs = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const l = await newLearner(`p-rand-${i}`);
      const r = await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`);
      seqs.add(r.body.questions.map((q: any) => q.stem + q.options.map((o: any) => o.body).join('|')).join('#'));
      for (const q of r.body.questions) expect(q.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    }
    expect(seqs.size).toBeGreaterThan(1);
  });

  it('autosave, refresh memuat jawaban; ID jawaban palsu & soal asing ditolak', async () => {
    const l = await newLearner('p-forge');
    const a = (await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`)).body;
    const mcq = a.questions.find((q: any) => q.type === 'mcq');
    const essay = a.questions.find((q: any) => q.type === 'essay');
    const ok = await l.json('PATCH', `/api/v1/attempts/${a.id}/answers`, {
      answers: [{ questionId: mcq.id, optionKey: mcq.options[0].key }, { questionId: essay.id, essayText: 'Draf esai saya.' }],
    });
    expect(ok.status).toBe(200);
    const again = (await l.json('GET', `/api/v1/attempts/${a.id}`)).body;
    expect(again.questions.find((q: any) => q.id === mcq.id).answer.optionKey).toBe(mcq.options[0].key);
    expect(again.questions.find((q: any) => q.id === essay.id).answer.essayText).toBe('Draf esai saya.');

    expect((await l.json('PATCH', `/api/v1/attempts/${a.id}/answers`, { answers: [{ questionId: mcq.id, optionKey: 'PALSU123' }] })).status).toBe(400);
    expect((await l.json('PATCH', `/api/v1/attempts/${a.id}/answers`, { answers: [{ questionId: 'soal-asing-123456', optionKey: null }] })).status).toBe(400);
    expect((await l.json('PATCH', `/api/v1/attempts/${a.id}/answers`, { answers: [{ questionId: mcq.id, essayText: 'x' }] })).status).toBe(400);
    // Field tambahan (mis. klaim skor dari klien) ditolak oleh skema strict.
    expect((await l.json('PATCH', `/api/v1/attempts/${a.id}/answers`, { answers: [{ questionId: mcq.id, optionKey: null, score: 100 }] })).status).toBe(400);
  });

  it('skor MCQ dihitung server; esai → pending_review; submit ganda tidak menilai dua kali', async () => {
    const l = await newLearner('p-score');
    const a = (await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`)).body;
    const keys = await correctKeys(a.id);
    const answers = a.questions.map((q: any) => (q.type === 'mcq' ? { questionId: q.id, optionKey: keys.get(q.id) } : { questionId: q.id, essayText: 'Jawaban esai lengkap.' }));
    expect((await l.json('PATCH', `/api/v1/attempts/${a.id}/answers`, { answers })).status).toBe(200);
    const s1 = await l.json('POST', `/api/v1/attempts/${a.id}/submit`);
    const s2 = await l.json('POST', `/api/v1/attempts/${a.id}/submit`);
    expect(s1.body.mcqScore).toBe(5);
    expect(s1.body.mcqMax).toBe(5);
    expect(s1.body.resultStatus).toBe('pending_review');
    expect(s1.body.finalScorePct).toBeNull();
    expect(s2.body).toEqual(s1.body);
    // Setelah submit, jawaban tidak dapat diubah.
    expect((await l.json('PATCH', `/api/v1/attempts/${a.id}/answers`, { answers: [answers[0]] })).status).toBe(409);
    const n = await h.env.DB.prepare('SELECT COUNT(*) AS n FROM essay_reviews').first<{ n: number }>();
    expect(n?.n).toBe(0);

    // Mentor menilai esai (rubrik) → hasil final dihitung ulang server.
    const queue = await mentor.json('GET', '/api/v1/admin/reviews');
    const item = queue.body.reviews.find((r: any) => r.attempt_id === a.id);
    expect(item).toBeTruthy();
    expect(JSON.stringify(item)).not.toContain('p-score'); // review buta
    const bad = await mentor.json('POST', `/api/v1/admin/reviews/${item.answer_id}/decision`, {
      rubricScores: [{ criterion: 'Ketepatan konsep', score: 99 }],
    });
    expect(bad.status).toBe(400);
    const dec = await mentor.json('POST', `/api/v1/admin/reviews/${item.answer_id}/decision`, {
      rubricScores: [
        { criterion: 'Ketepatan konsep', score: 30 },
        { criterion: 'Penerapan konteks', score: 20 },
        { criterion: 'Keamanan/etika data', score: 15 },
        { criterion: 'Kejelasan', score: 5 },
      ],
      feedback: 'Cukup baik, tambahkan contoh saluran informasi.',
    });
    expect(dec.status).toBe(200);
    expect(dec.body.score).toBe(7);
    const res = (await l.json('GET', `/api/v1/attempts/${a.id}/result`)).body;
    expect(res.resultStatus).toBe('passed');
    expect(res.finalScorePct).toBe(80);
    expect(res.essays[0].feedback).toContain('Cukup baik');
    // Override tanpa alasan ditolak; dengan alasan tercatat di audit.
    const ov = await mentor.json('POST', `/api/v1/admin/reviews/${item.answer_id}/decision`, {
      rubricScores: [
        { criterion: 'Ketepatan konsep', score: 0 },
        { criterion: 'Penerapan konteks', score: 0 },
        { criterion: 'Keamanan/etika data', score: 0 },
        { criterion: 'Kejelasan', score: 0 },
      ],
    });
    expect(ov.status).toBe(400);
    const audit = await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action = 'essay.grade'`).first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it('mentor yang tidak ditugaskan tidak dapat menilai', async () => {
    const other = await new Client(h).login('mentor2@contoh.test', 'Mentor Lain', ['mentor']);
    const l = await newLearner('p-mentor');
    const a = (await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`)).body;
    await l.json('POST', `/api/v1/attempts/${a.id}/submit`);
    const q = await other.json('GET', '/api/v1/admin/reviews');
    expect(q.body.reviews.find((r: any) => r.attempt_id === a.id)).toBeUndefined();
    const answer = await h.env.DB.prepare('SELECT id FROM answers WHERE attempt_id = ?').bind(a.id).first<{ id: string }>();
    const d = await other.json('POST', `/api/v1/admin/reviews/${answer!.id}/decision`, {
      rubricScores: [{ criterion: 'Ketepatan konsep', score: 1 }],
    });
    expect(d.status).toBe(403);
  });

  it('esai kosong tetap masuk antrean review (tidak otomatis nol/lulus)', async () => {
    const l = await newLearner('p-blank');
    const a = (await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`)).body;
    const s = await l.json('POST', `/api/v1/attempts/${a.id}/submit`);
    expect(s.body.resultStatus).toBe('pending_review');
    const q = await admin.json('GET', '/api/v1/admin/reviews');
    expect(q.body.reviews.some((r: any) => r.attempt_id === a.id && r.essay_text === null)).toBe(true);
  });

  it('batas attempt & cooldown ditegakkan server; jam klien tidak berpengaruh', async () => {
    await h.env.DB.prepare('UPDATE assessments SET max_attempts = 2, cooldown_seconds = 300').run();
    const l = await newLearner('p-limit');
    const a1 = (await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`)).body;
    await l.json('POST', `/api/v1/attempts/${a1.id}/submit`);
    const early = await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`, undefined, { date: 'Wed, 01 Jan 2031 00:00:00 GMT' });
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('COOLDOWN');
    h.clock.t += 301_000;
    const a2 = await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`);
    expect(a2.status).toBe(201);
    await l.json('POST', `/api/v1/attempts/${a2.body.id}/submit`);
    h.clock.t += 301_000;
    const a3 = await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`);
    expect(a3.status).toBe(403);
    expect(a3.body.error.code).toBe('MAX_ATTEMPTS');
    await h.env.DB.prepare('UPDATE assessments SET max_attempts = 3, cooldown_seconds = 0').run();
  });

  it('jawaban setelah deadline+grace ditolak dan attempt difinalisasi expired dengan jawaban tersimpan', async () => {
    const l = await newLearner('p-late');
    const a = (await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`)).body;
    const keys = await correctKeys(a.id);
    const mcq = a.questions.filter((q: any) => q.type === 'mcq');
    await l.json('PATCH', `/api/v1/attempts/${a.id}/answers`, { answers: [{ questionId: mcq[0].id, optionKey: keys.get(mcq[0].id) }] });
    h.clock.t = a.deadlineAt + 10_000; // dalam grace: masih boleh
    expect((await l.json('PATCH', `/api/v1/attempts/${a.id}/answers`, { answers: [{ questionId: mcq[1].id, optionKey: keys.get(mcq[1].id) }] })).status).toBe(200);
    h.clock.t = a.deadlineAt + 25_000; // lewat grace
    const late = await l.json('PATCH', `/api/v1/attempts/${a.id}/answers`, { answers: [{ questionId: mcq[2].id, optionKey: keys.get(mcq[2].id) }] });
    expect(late.status).toBe(409);
    const s = await l.json('POST', `/api/v1/attempts/${a.id}/submit`);
    expect(s.body.status).toBe('expired');
    expect(s.body.mcqScore).toBe(2);
  });

  it('tidak bisa mulai kuis kedua saat kuis lain aktif (satu attempt aktif lintas kelas)', async () => {
    const l = await newLearner('p-two');
    const a = await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`);
    expect(a.status).toBe(201);
    await expect(
      h.env.DB.prepare(
        `INSERT INTO attempts (id, assessment_id, user_id, enrollment_id, assessment_version, attempt_no, started_at, deadline_at, grace_seconds, status, passing_score_pct)
         SELECT 'manual-dup', assessment_id, user_id, enrollment_id, 1, 99, started_at, deadline_at, 0, 'in_progress', 60 FROM attempts WHERE id = ?`,
      )
        .bind(a.body.id)
        .run(),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('D1 batch bersifat atomik: kegagalan di tengah batch membatalkan seluruh batch', async () => {
    const db = h.env.DB;
    await expect(
      db.batch([
        db.prepare(`INSERT INTO security_events (id, type, created_at) VALUES ('batch-test-1', 'x', 1)`),
        db.prepare(`INSERT INTO security_events (id, type, created_at) VALUES ('batch-test-1', 'dup', 1)`),
      ]),
    ).rejects.toThrow();
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM security_events WHERE id = 'batch-test-1'`).first<{ n: number }>();
    expect(r?.n).toBe(0);
  });

  it('banding nilai dapat diajukan sekali dan diselesaikan admin', async () => {
    const l = await newLearner('p-appeal');
    const a = (await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`)).body;
    await l.json('POST', `/api/v1/attempts/${a.id}/submit`);
    await h.env.DB.prepare(`UPDATE attempts SET result_status = 'failed', review_required = 0 WHERE id = ?`).bind(a.id).run();
    const ap = await l.json('POST', `/api/v1/attempts/${a.id}/appeal`, { reason: 'Mohon ditinjau ulang esai saya.' });
    expect(ap.status).toBe(201);
    expect((await l.json('POST', `/api/v1/attempts/${a.id}/appeal`, { reason: 'Mohon ditinjau ulang lagi.' })).status).toBe(409);
    const list = await admin.json('GET', '/api/v1/admin/appeals');
    const item = list.body.appeals.find((x: any) => x.attempt_id === a.id);
    expect((await admin.json('POST', `/api/v1/admin/appeals/${item.id}`, { status: 'resolved', resolution: 'Sudah ditinjau.' })).status).toBe(200);
  });
});
