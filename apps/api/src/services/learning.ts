import { ERROR_CODES, HEARTBEAT, type LearningSessionResponse } from '@patradesa/shared';
import { HttpError } from '../lib/http';
import { newId } from '../lib/crypto';
import { requireLessonAccess } from './access';

async function progress(db: D1Database, userId: string, lessonId: string) {
  return db
    .prepare('SELECT active_seconds, completed_at FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
    .bind(userId, lessonId)
    .first<{ active_seconds: number; completed_at: number | null }>();
}

export function touchProgressStatement(db: D1Database, userId: string, lessonId: string, enrollmentId: string, now: number, required: number) {
  return db
    .prepare(
      `INSERT INTO lesson_progress (user_id, lesson_id, enrollment_id, active_seconds, content_accessed_at, completed_at, last_accessed_at)
       VALUES (?, ?, ?, 0, ?, CASE WHEN ? <= 0 THEN ? ELSE NULL END, ?)
       ON CONFLICT (user_id, lesson_id) DO UPDATE SET
         content_accessed_at = COALESCE(lesson_progress.content_accessed_at, excluded.content_accessed_at),
         completed_at = COALESCE(lesson_progress.completed_at, excluded.completed_at),
         last_accessed_at = excluded.last_accessed_at`,
    )
    .bind(userId, lessonId, enrollmentId, now, required, now, now);
}

/** Mulai sesi belajar (server menetapkan started_at / expires_at). Sesi aktif lama ditutup. */
export async function startLearningSession(db: D1Database, userId: string, lessonId: string, now: number): Promise<LearningSessionResponse> {
  const acc = await requireLessonAccess(db, userId, lessonId, now);
  const id = newId();
  const expiresAt = now + acc.learning_session_ttl_seconds * 1000;
  await db.batch([
    db
      .prepare(`UPDATE learning_sessions SET status = 'closed' WHERE user_id = ? AND lesson_id = ? AND status = 'active'`)
      .bind(userId, lessonId),
    db
      .prepare(
        `INSERT INTO learning_sessions (id, enrollment_id, user_id, lesson_id, started_at, expires_at, last_heartbeat_at, accumulated_active_seconds, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active')`,
      )
      .bind(id, acc.enrollment_id, userId, lessonId, now, expiresAt, now),
    touchProgressStatement(db, userId, lessonId, acc.enrollment_id, now, acc.required_active_seconds),
  ]);
  const p = await progress(db, userId, lessonId);
  return {
    sessionId: id,
    expiresAt,
    activeSeconds: p?.active_seconds ?? 0,
    requiredActiveSeconds: acc.required_active_seconds,
    completed: !!p?.completed_at,
  };
}

/**
 * Heartbeat: klaim aktivitas TERBATAS. Server mengabaikan durasi dari klien; kredit dihitung dari
 * selisih jam server sejak heartbeat terakhir, dibatasi maxCreditSeconds, nol bila tab tidak tampak,
 * tanpa interaksi, terlalu cepat (spam) atau jeda terlalu lama (idle). Bukan bukti membaca.
 */
export async function heartbeat(
  db: D1Database,
  userId: string,
  lessonId: string,
  input: { sessionId: string; visible: boolean; interacted: boolean },
  now: number,
): Promise<LearningSessionResponse & { credited: number }> {
  const acc = await requireLessonAccess(db, userId, lessonId, now);
  const s = await db
    .prepare('SELECT id, expires_at, last_heartbeat_at, status FROM learning_sessions WHERE id = ? AND user_id = ? AND lesson_id = ?')
    .bind(input.sessionId, userId, lessonId)
    .first<{ id: string; expires_at: number; last_heartbeat_at: number; status: string }>();
  if (!s) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Sesi belajar tidak ditemukan.');
  if (s.status !== 'active' || now >= s.expires_at) {
    if (s.status === 'active') await db.prepare(`UPDATE learning_sessions SET status = 'expired' WHERE id = ?`).bind(s.id).run();
    throw new HttpError(410, ERROR_CODES.SESSION_EXPIRED, 'Sesi belajar berakhir. Mulai sesi baru untuk melanjutkan.');
  }
  const elapsed = now - s.last_heartbeat_at;
  let credited = 0;
  if (elapsed >= HEARTBEAT.minIntervalMs) {
    if (input.visible && input.interacted && elapsed <= HEARTBEAT.idleGapMs) {
      credited = Math.min(Math.floor(elapsed / 1000), HEARTBEAT.maxCreditSeconds);
    }
    // Optimistic concurrency: dua heartbeat paralel tidak bisa sama-sama dikreditkan.
    const upd = await db
      .prepare(
        `UPDATE learning_sessions SET last_heartbeat_at = ?, accumulated_active_seconds = accumulated_active_seconds + ?
         WHERE id = ? AND last_heartbeat_at = ? AND status = 'active'`,
      )
      .bind(now, credited, s.id, s.last_heartbeat_at)
      .run();
    if ((upd.meta.changes ?? 0) !== 1) credited = 0;
    if (credited > 0) {
      await db
        .prepare(
          `UPDATE lesson_progress SET active_seconds = active_seconds + ?, last_accessed_at = ?,
             completed_at = CASE WHEN completed_at IS NULL AND content_accessed_at IS NOT NULL AND active_seconds + ? >= ? THEN ? ELSE completed_at END
           WHERE user_id = ? AND lesson_id = ?`,
        )
        .bind(credited, now, credited, acc.required_active_seconds, now, userId, lessonId)
        .run();
    }
  }
  const p = await progress(db, userId, lessonId);
  return {
    sessionId: s.id,
    expiresAt: s.expires_at,
    activeSeconds: p?.active_seconds ?? 0,
    requiredActiveSeconds: acc.required_active_seconds,
    completed: !!p?.completed_at,
    credited,
  };
}
