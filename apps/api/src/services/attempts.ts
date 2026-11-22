import { ERROR_CODES, type AttemptResult, type AttemptView } from '@patradesa/shared';
import { HttpError, notFound } from '../lib/http';
import { newId, randomToken, secureShuffle } from '../lib/crypto';
import { isLessonCompleted, requireLessonAccess } from './access';
import { finalizeAttempt } from './finalize';
import { getActiveAttempt } from './examLock';

interface AssessmentRow {
  id: string;
  lesson_id: string;
  title: string;
  time_limit_seconds: number;
  passing_score_pct: number;
  max_attempts: number;
  cooldown_seconds: number;
  mcq_count: number;
  essay_count: number;
  grace_seconds: number;
  is_required: number;
  version: number;
  exam_copy_deterrence_enabled: number | null;
  accessibility_exemption_policy: string | null;
  hide_lesson_links_during_exam: number | null;
}

interface PoolQuestion {
  id: string;
  type: 'mcq' | 'essay';
  stem: string;
  topic: string;
  difficulty: number;
  points: number;
  version: number;
}

interface AttemptRow {
  id: string;
  assessment_id: string;
  user_id: string;
  status: 'in_progress' | 'submitted' | 'expired' | 'voided';
  started_at: number;
  deadline_at: number;
  grace_seconds: number;
  copy_deterrence_active: number;
}

export async function loadAssessment(db: D1Database, assessmentId: string): Promise<AssessmentRow> {
  const a = await db
    .prepare(
      `SELECT a.*, p.exam_copy_deterrence_enabled, p.accessibility_exemption_policy, p.hide_lesson_links_during_exam
       FROM assessments a LEFT JOIN assessment_policies p ON p.assessment_id = a.id WHERE a.id = ?`,
    )
    .bind(assessmentId)
    .first<AssessmentRow>();
  if (!a) throw notFound('Kuis');
  return a;
}

/**
 * Pilih soal secara acak kriptografis, seimbang lintas topik & tingkat kesulitan:
 * kelompokkan per (topik, kesulitan), acak tiap kelompok dan urutan kelompok, lalu ambil round-robin.
 */
export function pickBalanced<T extends { topic: string; difficulty: number }>(pool: T[], count: number): T[] {
  const groups = new Map<string, T[]>();
  for (const q of pool) {
    const k = `${q.topic}|${q.difficulty}`;
    const g = groups.get(k) ?? [];
    g.push(q);
    groups.set(k, g);
  }
  const queues = secureShuffle([...groups.values()].map((g) => secureShuffle(g)));
  const out: T[] = [];
  while (out.length < count && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const item = q.shift();
      if (item) out.push(item);
      if (out.length >= count) break;
    }
  }
  return secureShuffle(out);
}

export async function attemptCopyDeterrence(db: D1Database, a: AssessmentRow, userId: string): Promise<boolean> {
  if ((a.exam_copy_deterrence_enabled ?? 1) !== 1) return false;
  if ((a.accessibility_exemption_policy ?? 'per_user') === 'per_user') {
    const acc = await db
      .prepare('SELECT copy_deterrence_exempt FROM user_accommodations WHERE user_id = ?')
      .bind(userId)
      .first<{ copy_deterrence_exempt: number }>();
    if (acc?.copy_deterrence_exempt === 1) return false;
  }
  return true;
}

export async function assessmentEligibility(
  db: D1Database,
  userId: string,
  a: AssessmentRow,
  now: number,
): Promise<{ eligible: boolean; code?: (typeof ERROR_CODES)[keyof typeof ERROR_CODES]; reason?: string; attemptsUsed: number }> {
  const used = await db
    .prepare(`SELECT COUNT(*) AS n, MAX(finalized_at) AS last_final FROM attempts WHERE user_id = ? AND assessment_id = ? AND status <> 'voided'`)
    .bind(userId, a.id)
    .first<{ n: number; last_final: number | null }>();
  const attemptsUsed = used?.n ?? 0;
  if (!(await isLessonCompleted(db, userId, a.lesson_id))) {
    return { eligible: false, code: ERROR_CODES.NOT_ELIGIBLE, reason: 'Selesaikan waktu belajar minimum materi ini terlebih dahulu.', attemptsUsed };
  }
  if (attemptsUsed >= a.max_attempts) {
    return { eligible: false, code: ERROR_CODES.MAX_ATTEMPTS, reason: 'Batas jumlah percobaan sudah tercapai.', attemptsUsed };
  }
  if (a.cooldown_seconds > 0 && used?.last_final && now < used.last_final + a.cooldown_seconds * 1000) {
    return { eligible: false, code: ERROR_CODES.COOLDOWN, reason: 'Tunggu masa jeda sebelum mencoba lagi.', attemptsUsed };
  }
  return { eligible: true, attemptsUsed };
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(e.message);
}

/**
 * Mulai attempt. Idempoten: jika attempt aktif untuk kuis yang sama sudah ada, kembalikan itu
 * (refresh / tab lain / perangkat lain tidak menghasilkan soal baru). Race antar-request
 * diselesaikan oleh unique index parsial `ux_attempts_one_active_per_user`.
 */
export async function startAttempt(db: D1Database, userId: string, assessmentId: string, now: number): Promise<{ attemptId: string; created: boolean }> {
  const a = await loadAssessment(db, assessmentId);
  await requireLessonAccess(db, userId, a.lesson_id, now);

  const active = await getActiveAttempt(db, userId, now);
  if (active) {
    if (active.assessment_id === assessmentId) return { attemptId: active.id, created: false };
    throw new HttpError(409, ERROR_CODES.ACTIVE_ATTEMPT_ELSEWHERE, 'Anda masih memiliki kuis lain yang sedang berjalan.', { attemptId: active.id });
  }

  const elig = await assessmentEligibility(db, userId, a, now);
  if (!elig.eligible) throw new HttpError(403, elig.code ?? ERROR_CODES.NOT_ELIGIBLE, elig.reason ?? 'Belum memenuhi syarat.');

  const { results: pool } = await db
    .prepare('SELECT id, type, stem, topic, difficulty, points, version FROM questions WHERE assessment_id = ? AND is_active = 1 AND in_quiz = 1')
    .bind(a.id)
    .all<PoolQuestion>();
  const chosen = [
    ...pickBalanced(pool.filter((q) => q.type === 'mcq'), a.mcq_count),
    ...pickBalanced(pool.filter((q) => q.type === 'essay'), a.essay_count),
  ];
  if (chosen.length === 0) throw new HttpError(409, ERROR_CODES.CONFLICT, 'Bank soal belum tersedia.');

  const mcqIds = chosen.filter((q) => q.type === 'mcq').map((q) => q.id);
  const optionsByQ = new Map<string, { id: string; body: string; is_correct: number }[]>();
  if (mcqIds.length) {
    const { results: opts } = await db
      .prepare(`SELECT id, question_id, body, is_correct FROM question_options WHERE question_id IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(mcqIds))
      .all<{ id: string; question_id: string; body: string; is_correct: number }>();
    for (const o of opts) {
      const list = optionsByQ.get(o.question_id) ?? [];
      list.push(o);
      optionsByQ.set(o.question_id, list);
    }
  }

  const attemptId = newId();
  const copyDeterrence = await attemptCopyDeterrence(db, a, userId);
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO attempts (id, assessment_id, user_id, enrollment_id, assessment_version, attempt_no, started_at, deadline_at,
           grace_seconds, status, passing_score_pct, copy_deterrence_active)
         SELECT ?, ?, ?, e.id, ?, ?, ?, ?, ?, 'in_progress', ?, ?
         FROM enrollments e JOIN course_versions cv ON cv.id = e.course_version_id JOIN lessons l ON l.course_version_id = cv.id
         WHERE e.user_id = ? AND l.id = ?`,
      )
      .bind(
        attemptId,
        a.id,
        userId,
        a.version,
        elig.attemptsUsed + 1,
        now,
        now + a.time_limit_seconds * 1000,
        a.grace_seconds,
        a.passing_score_pct,
        copyDeterrence ? 1 : 0,
        userId,
        a.lesson_id,
      ),
  ];
  chosen.forEach((q, i) => {
    let options: { k: string; body: string }[] = [];
    let key: string | null = null;
    if (q.type === 'mcq') {
      const shuffled = secureShuffle(optionsByQ.get(q.id) ?? []);
      options = shuffled.map((o) => {
        const k = randomToken(6);
        if (o.is_correct === 1) key = k;
        return { k, body: o.body };
      });
    }
    stmts.push(
      db
        .prepare(
          `INSERT INTO attempt_questions (id, attempt_id, question_id, question_version, sequence, type, stem_snapshot, points, options_snapshot_json, answer_key_snapshot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(randomToken(12), attemptId, q.id, q.version, i + 1, q.type, q.stem, q.points, JSON.stringify(options), key),
    );
  });

  try {
    await db.batch(stmts);
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Request lain menang balapan: kembalikan attempt aktif yang sama bila untuk kuis ini.
    const winner = await getActiveAttempt(db, userId, now);
    if (winner?.assessment_id === assessmentId) return { attemptId: winner.id, created: false };
    throw new HttpError(409, ERROR_CODES.ACTIVE_ATTEMPT_ELSEWHERE, 'Anda masih memiliki kuis lain yang sedang berjalan.');
  }
  return { attemptId, created: true };
}

export async function loadOwnedAttempt(db: D1Database, attemptId: string, userId: string): Promise<AttemptRow> {
  const at = await db
    .prepare('SELECT id, assessment_id, user_id, status, started_at, deadline_at, grace_seconds, copy_deterrence_active FROM attempts WHERE id = ?')
    .bind(attemptId)
    .first<AttemptRow>();
  // IDOR: attempt milik orang lain diperlakukan sama dengan tidak ada.
  if (!at || at.user_id !== userId) throw notFound('Kuis');
  return at;
}

export async function attemptView(db: D1Database, attemptId: string, userId: string, now: number): Promise<AttemptView> {
  await getActiveAttempt(db, userId, now); // finalisasi lazy bila sudah lewat batas
  const at = await loadOwnedAttempt(db, attemptId, userId);
  const meta = await db
    .prepare(
      `SELECT a.title, cv.course_id, p.hide_lesson_links_during_exam FROM assessments a
       JOIN lessons l ON l.id = a.lesson_id JOIN course_versions cv ON cv.id = l.course_version_id
       LEFT JOIN assessment_policies p ON p.assessment_id = a.id WHERE a.id = ?`,
    )
    .bind(at.assessment_id)
    .first<{ title: string; course_id: string; hide_lesson_links_during_exam: number | null }>();
  let questions: AttemptView['questions'] = [];
  if (at.status === 'in_progress') {
    // Kolom answer_key_snapshot SENGAJA tidak dipilih.
    const { results } = await db
      .prepare(
        `SELECT aq.id, aq.sequence, aq.type, aq.stem_snapshot, aq.points, aq.options_snapshot_json,
                ans.selected_option_key, ans.essay_text
         FROM attempt_questions aq LEFT JOIN answers ans ON ans.attempt_question_id = aq.id
         WHERE aq.attempt_id = ? ORDER BY aq.sequence`,
      )
      .bind(at.id)
      .all<{
        id: string;
        sequence: number;
        type: 'mcq' | 'essay';
        stem_snapshot: string;
        points: number;
        options_snapshot_json: string;
        selected_option_key: string | null;
        essay_text: string | null;
      }>();
    questions = results.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      type: r.type,
      stem: r.stem_snapshot,
      points: r.points,
      options: (JSON.parse(r.options_snapshot_json) as { k: string; body: string }[]).map((o) => ({ key: o.k, body: o.body })),
      answer:
        r.selected_option_key !== null || r.essay_text !== null ? { optionKey: r.selected_option_key, essayText: r.essay_text } : null,
    }));
  }
  return {
    id: at.id,
    assessmentId: at.assessment_id,
    assessmentTitle: meta?.title ?? 'Kuis',
    courseId: meta?.course_id ?? '',
    status: at.status,
    startedAt: at.started_at,
    deadlineAt: at.deadline_at,
    serverNow: now,
    copyDeterrence: at.copy_deterrence_active === 1,
    hideLessonLinks: (meta?.hide_lesson_links_during_exam ?? 1) === 1,
    questions,
  };
}

export async function saveAnswers(
  db: D1Database,
  attemptId: string,
  userId: string,
  answers: { questionId: string; optionKey?: string | null | undefined; essayText?: string | undefined }[],
  now: number,
): Promise<{ savedAt: number }> {
  const at = await loadOwnedAttempt(db, attemptId, userId);
  if (at.status !== 'in_progress' || now > at.deadline_at + at.grace_seconds * 1000) {
    if (at.status === 'in_progress') await finalizeAttempt(db, at.id, 'expired', now);
    throw new HttpError(409, ERROR_CODES.ATTEMPT_CLOSED, 'Waktu kuis sudah habis atau kuis sudah dikumpulkan.');
  }
  const { results: qs } = await db
    .prepare('SELECT id, type, options_snapshot_json FROM attempt_questions WHERE attempt_id = ?')
    .bind(at.id)
    .all<{ id: string; type: 'mcq' | 'essay'; options_snapshot_json: string }>();
  const byId = new Map(qs.map((q) => [q.id, q]));
  const stmts: D1PreparedStatement[] = [];
  for (const ans of answers) {
    const q = byId.get(ans.questionId);
    if (!q) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Soal tidak dikenal pada kuis ini.');
    let optionKey: string | null = null;
    let essay: string | null = null;
    if (q.type === 'mcq') {
      if (ans.essayText !== undefined) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Jawaban tidak sesuai tipe soal.');
      optionKey = ans.optionKey ?? null;
      const keys = (JSON.parse(q.options_snapshot_json) as { k: string }[]).map((o) => o.k);
      if (optionKey !== null && !keys.includes(optionKey)) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Pilihan jawaban tidak valid.');
    } else {
      if (ans.optionKey !== undefined) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Jawaban tidak sesuai tipe soal.');
      essay = ans.essayText ?? '';
    }
    // Tulisan bersyarat: hanya jika attempt masih in_progress dan belum lewat deadline+grace (dicek atomik di SQL).
    stmts.push(
      db
        .prepare(
          `INSERT INTO answers (id, attempt_id, attempt_question_id, selected_option_key, essay_text, saved_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
             SELECT 1 FROM attempts WHERE id = ? AND user_id = ? AND status = 'in_progress' AND ? <= deadline_at + grace_seconds * 1000)
           ON CONFLICT (attempt_question_id) DO UPDATE SET
             selected_option_key = excluded.selected_option_key, essay_text = excluded.essay_text, saved_at = excluded.saved_at
           WHERE answers.finalized_at IS NULL`,
        )
        .bind(newId(), at.id, q.id, optionKey, essay, now, at.id, userId, now),
    );
  }
  const res = await db.batch(stmts);
  if (res.some((r) => (r.meta.changes ?? 0) === 0)) {
    throw new HttpError(409, ERROR_CODES.ATTEMPT_CLOSED, 'Kuis sudah ditutup; jawaban tidak tersimpan.');
  }
  return { savedAt: now };
}

export async function submitAttempt(db: D1Database, attemptId: string, userId: string, now: number): Promise<void> {
  const at = await loadOwnedAttempt(db, attemptId, userId);
  if (at.status !== 'in_progress') return; // idempoten
  const status = now <= at.deadline_at + at.grace_seconds * 1000 ? 'submitted' : 'expired';
  await finalizeAttempt(db, at.id, status, now);
}

export async function attemptResult(db: D1Database, attemptId: string, userId: string, now: number): Promise<AttemptResult> {
  await getActiveAttempt(db, userId, now);
  await loadOwnedAttempt(db, attemptId, userId);
  const a = await db
    .prepare(
      `SELECT id, status, result_status, mcq_score, mcq_max, essay_score, essay_max, final_score_pct, passing_score_pct, finalized_at
       FROM attempts WHERE id = ?`,
    )
    .bind(attemptId)
    .first<{
      id: string;
      status: string;
      result_status: AttemptResult['resultStatus'];
      mcq_score: number | null;
      mcq_max: number | null;
      essay_score: number | null;
      essay_max: number | null;
      final_score_pct: number | null;
      passing_score_pct: number;
      finalized_at: number | null;
    }>();
  if (!a) throw notFound('Kuis');
  if (a.status === 'in_progress') throw new HttpError(409, ERROR_CODES.CONFLICT, 'Kuis masih berlangsung.');
  const { results: essays } = await db
    .prepare(
      `SELECT aq.id, aq.stem_snapshot, aq.points, ans.essay_score, ans.essay_feedback, ans.graded_at
       FROM attempt_questions aq LEFT JOIN answers ans ON ans.attempt_question_id = aq.id
       WHERE aq.attempt_id = ? AND aq.type = 'essay' ORDER BY aq.sequence`,
    )
    .bind(attemptId)
    .all<{ id: string; stem_snapshot: string; points: number; essay_score: number | null; essay_feedback: string | null; graded_at: number | null }>();
  const openAppeal = await db
    .prepare(`SELECT 1 AS x FROM appeals WHERE attempt_id = ? AND status = 'open'`)
    .bind(attemptId)
    .first();
  // Kunci jawaban MCQ TIDAK ditampilkan (retake mungkin diizinkan).
  return {
    id: a.id,
    status: a.status,
    resultStatus: a.result_status,
    mcqScore: a.mcq_score,
    mcqMax: a.mcq_max,
    essayScore: a.essay_score,
    essayMax: a.essay_max,
    finalScorePct: a.final_score_pct,
    passingScorePct: a.passing_score_pct,
    essays: essays.map((e) => ({
      questionId: e.id,
      stem: e.stem_snapshot,
      score: e.graded_at ? e.essay_score : null,
      maxScore: e.points,
      feedback: e.graded_at ? e.essay_feedback : null,
    })),
    canAppeal: a.status !== 'voided' && a.result_status !== 'pending_review' && !openAppeal,
  };
}
