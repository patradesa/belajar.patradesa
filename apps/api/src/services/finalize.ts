/**
 * Finalisasi attempt (submit/expiry) — idempoten dan race-safe.
 *
 * Seluruh skor dihitung DI DALAM SQL pada satu D1 batch (transaksi), sehingga autosave yang
 * datang bersamaan tidak bisa menyelip di antara "baca jawaban" dan "tulis skor":
 *  1. transisi status in_progress -> submitted|expired (bersyarat; hanya satu pemenang)
 *  2. tandai jawaban final + koreksi MCQ terhadap answer_key_snapshot
 *  3. hitung skor attempt; jika ada esai -> pending_review (tanpa nilai otomatis lulus/nol)
 * Setelah batch commit, baris in_progress hilang sehingga exam lock otomatis terlepas.
 */
export function finalizeStatements(db: D1Database, attemptId: string, status: 'submitted' | 'expired', now: number): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE attempts SET status = ?, submitted_at = CASE WHEN ? = 'submitted' THEN ? ELSE NULL END, finalized_at = ?
         WHERE id = ? AND status = 'in_progress'`,
      )
      .bind(status, status, now, now, attemptId),
    // Esai yang tidak dijawab tetap masuk antrean review (dinilai manusia, bukan otomatis nol/lulus).
    db
      .prepare(
        `INSERT INTO answers (id, attempt_id, attempt_question_id, selected_option_key, essay_text, saved_at, finalized_at)
         SELECT lower(hex(randomblob(16))), aq.attempt_id, aq.id, NULL, NULL, ?, ?
         FROM attempt_questions aq
         WHERE aq.attempt_id = ? AND aq.type = 'essay'
           AND NOT EXISTS (SELECT 1 FROM answers a WHERE a.attempt_question_id = aq.id)
           AND EXISTS (SELECT 1 FROM attempts WHERE id = ? AND finalized_at = ?)`,
      )
      .bind(now, now, attemptId, attemptId, now),
    db
      .prepare(
        `UPDATE answers SET finalized_at = ?,
           mcq_correct = (SELECT CASE WHEN aq.type = 'mcq' THEN (answers.selected_option_key IS NOT NULL AND answers.selected_option_key = aq.answer_key_snapshot) ELSE NULL END
                          FROM attempt_questions aq WHERE aq.id = answers.attempt_question_id)
         WHERE attempt_id = ? AND finalized_at IS NULL
           AND EXISTS (SELECT 1 FROM attempts WHERE id = ? AND finalized_at = ?)`,
      )
      .bind(now, attemptId, attemptId, now),
    db
      .prepare(
        `UPDATE attempts SET
           mcq_max = (SELECT COALESCE(SUM(points), 0) FROM attempt_questions WHERE attempt_id = attempts.id AND type = 'mcq'),
           mcq_score = (SELECT COALESCE(SUM(aq.points), 0) FROM attempt_questions aq JOIN answers a ON a.attempt_question_id = aq.id
                        WHERE aq.attempt_id = attempts.id AND aq.type = 'mcq' AND a.mcq_correct = 1),
           essay_max = (SELECT COALESCE(SUM(points), 0) FROM attempt_questions WHERE attempt_id = attempts.id AND type = 'essay')
         WHERE id = ? AND finalized_at = ?`,
      )
      .bind(attemptId, now),
    db
      .prepare(
        `UPDATE attempts SET
           review_required = CASE WHEN essay_max > 0 THEN 1 ELSE 0 END,
           final_score_pct = CASE WHEN essay_max > 0 OR mcq_max = 0 THEN NULL ELSE ROUND(mcq_score * 100.0 / mcq_max, 2) END,
           result_status = CASE
             WHEN essay_max > 0 THEN 'pending_review'
             WHEN mcq_max > 0 AND mcq_score * 100.0 / mcq_max >= passing_score_pct THEN 'passed'
             ELSE 'failed' END
         WHERE id = ? AND finalized_at = ?`,
      )
      .bind(attemptId, now),
  ];
}

export async function finalizeAttempt(db: D1Database, attemptId: string, status: 'submitted' | 'expired', now: number): Promise<boolean> {
  const results = await db.batch(finalizeStatements(db, attemptId, status, now));
  return (results[0]?.meta.changes ?? 0) === 1;
}

/**
 * Finalisasi attempt yang melewati deadline + grace. Dipanggil SEBELUM setiap pemeriksaan
 * exam lock / start attempt (lazy) dan oleh Cron Trigger tiap menit, agar lock tidak menggantung.
 */
export async function expireOverdueAttempts(db: D1Database, now: number, userId?: string): Promise<number> {
  const sql = `SELECT id FROM attempts WHERE status = 'in_progress' AND deadline_at + grace_seconds * 1000 < ?${userId ? ' AND user_id = ?' : ''} LIMIT 200`;
  const stmt = userId ? db.prepare(sql).bind(now, userId) : db.prepare(sql).bind(now);
  const { results } = await stmt.all<{ id: string }>();
  let n = 0;
  for (const r of results) if (await finalizeAttempt(db, r.id, 'expired', now)) n++;
  return n;
}

/** Hitung ulang skor akhir setelah semua esai dinilai manusia. */
export function recomputeAfterReviewStatement(db: D1Database, attemptId: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE attempts SET
         essay_score = (SELECT COALESCE(SUM(a.essay_score), 0) FROM answers a JOIN attempt_questions aq ON aq.id = a.attempt_question_id
                        WHERE aq.attempt_id = attempts.id AND aq.type = 'essay'),
         final_score_pct = ROUND(
           (COALESCE(mcq_score, 0) + (SELECT COALESCE(SUM(a.essay_score), 0) FROM answers a JOIN attempt_questions aq ON aq.id = a.attempt_question_id
                                      WHERE aq.attempt_id = attempts.id AND aq.type = 'essay')) * 100.0
           / NULLIF(COALESCE(mcq_max, 0) + COALESCE(essay_max, 0), 0), 2),
         review_required = 0
       WHERE id = ? AND status IN ('submitted', 'expired')
         AND NOT EXISTS (
           SELECT 1 FROM attempt_questions aq LEFT JOIN answers a ON a.attempt_question_id = aq.id
           WHERE aq.attempt_id = attempts.id AND aq.type = 'essay' AND a.graded_at IS NULL AND a.id IS NOT NULL)`,
    )
    .bind(attemptId);
}

export function resultFromScoreStatement(db: D1Database, attemptId: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE attempts SET result_status = CASE WHEN final_score_pct >= passing_score_pct THEN 'passed' ELSE 'failed' END
       WHERE id = ? AND review_required = 0 AND final_score_pct IS NOT NULL AND result_status = 'pending_review'`,
    )
    .bind(attemptId);
}
