/**
 * Pindahkan pendaftaran peserta ke versi kelas terbaru tanpa menghapus riwayat (melengkapi ADR-0002).
 *
 * - Progres materi disalin ke materi versi baru yang memiliki KODE MATERI (lesson_key) sama;
 *   "selesai" dihitung ulang terhadap waktu minimum materi versi baru.
 * - Hasil skenario tetap berlaku bila versi blok skenario yang dipasang sama (dikunci per blok, bukan per materi).
 * - Percobaan skenario yang sedang berjalan dipindah ke materi baru bila blok yang sama dipasang di sana; selain itu ditutup.
 * - Kuis versi baru adalah objek baru: percobaan dimulai dari nol.
 * - Ditolak bila ada kuis yang sedang dikerjakan atau sertifikat kelas sudah ada (agar sertifikat tetap sesuai versi yang ditempuh).
 * Riwayat versi lama tidak dihapus.
 */
import { ERROR_CODES } from '@patradesa/shared';
import { HttpError, notFound } from '../lib/http';
import { auditStmt } from '../lib/audit';

export interface UpgradeInfo {
  fromVersion: number;
  toVersion: number;
  /** null = boleh diperbarui. */
  blockedReason: string | null;
  /** Materi versi baru yang progresnya akan ikut terbawa (kode materi cocok). */
  carriedLessons: number;
}

interface EnrollmentRow {
  id: string;
  status: string;
  course_version_id: string;
  from_no: number;
  current_version_id: string | null;
  to_no: number | null;
}

async function loadState(db: D1Database, userId: string, courseId: string): Promise<EnrollmentRow | null> {
  return db
    .prepare(
      `SELECT e.id, e.status, e.course_version_id, ov.version_no AS from_no, c.current_version_id, nv.version_no AS to_no
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       JOIN course_versions ov ON ov.id = e.course_version_id
       LEFT JOIN course_versions nv ON nv.id = c.current_version_id
       WHERE e.user_id = ? AND e.course_id = ?`,
    )
    .bind(userId, courseId)
    .first<EnrollmentRow>();
}

/** Info pembaruan untuk halaman kelas; null bila tidak terdaftar atau sudah di versi terbaru. */
export async function upgradeInfo(db: D1Database, userId: string, courseId: string): Promise<UpgradeInfo | null> {
  const e = await loadState(db, userId, courseId);
  if (!e || !e.current_version_id || e.course_version_id === e.current_version_id) return null;
  const block = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM attempts WHERE enrollment_id = ? AND status = 'in_progress') AS active_quiz,
         EXISTS (SELECT 1 FROM certificates WHERE user_id = ? AND course_id = ? AND status IN ('pending', 'issued')) AS has_cert,
         (SELECT COUNT(DISTINCT nl.id) FROM lesson_progress p JOIN lessons ol ON ol.id = p.lesson_id AND ol.course_version_id = ?
            JOIN lessons nl ON nl.course_version_id = ? AND nl.lesson_key = ol.lesson_key
          WHERE p.user_id = ? AND p.enrollment_id = ?) AS carried`,
    )
    .bind(e.id, userId, courseId, e.course_version_id, e.current_version_id, userId, e.id)
    .first<{ active_quiz: number; has_cert: number; carried: number }>();
  let blockedReason: string | null = null;
  if (!['active', 'completed'].includes(e.status)) blockedReason = 'Pendaftaran Anda di kelas ini tidak aktif.';
  else if (block?.active_quiz) blockedReason = 'Selesaikan kuis yang sedang berjalan terlebih dahulu.';
  else if (block?.has_cert) blockedReason = 'Sertifikat kelas ini sudah terbit untuk versi yang Anda tempuh.';
  return { fromVersion: e.from_no, toVersion: e.to_no ?? e.from_no, blockedReason, carriedLessons: block?.carried ?? 0 };
}

export async function upgradeEnrollment(
  db: D1Database,
  userId: string,
  courseId: string,
  actorId: string,
  now: number,
): Promise<{ fromVersion: number; toVersion: number; carriedLessons: number }> {
  const e = await loadState(db, userId, courseId);
  if (!e) throw notFound('Pendaftaran');
  const info = await upgradeInfo(db, userId, courseId);
  if (!info) throw new HttpError(409, ERROR_CODES.CONFLICT, 'Anda sudah memakai versi terbaru kelas ini.');
  if (info.blockedReason) throw new HttpError(409, ERROR_CODES.CONFLICT, info.blockedReason);
  const oldV = e.course_version_id;
  const newV = e.current_version_id!;
  // Semua statement dijaga "pendaftaran masih di versi lama" sehingga permintaan ganda tidak berefek dua kali.
  const still = `EXISTS (SELECT 1 FROM enrollments WHERE id = ? AND course_version_id = ?)`;
  const out = await db.batch([
    db
      .prepare(
        `INSERT INTO lesson_progress (user_id, lesson_id, enrollment_id, active_seconds, content_accessed_at, completed_at, last_accessed_at)
         SELECT p.user_id, nl.id, p.enrollment_id, p.active_seconds, p.content_accessed_at,
                CASE WHEN p.active_seconds >= nl.required_active_seconds THEN COALESCE(p.completed_at, ?) ELSE NULL END,
                p.last_accessed_at
         FROM lesson_progress p
         JOIN lessons ol ON ol.id = p.lesson_id AND ol.course_version_id = ?
         JOIN lessons nl ON nl.course_version_id = ? AND nl.lesson_key = ol.lesson_key
         WHERE p.user_id = ? AND p.enrollment_id = ? AND ${still}
         ON CONFLICT (user_id, lesson_id) DO NOTHING`,
      )
      .bind(now, oldV, newV, userId, e.id, e.id, oldV),
    db
      .prepare(
        `UPDATE scenario_attempts SET updated_at = ?, lesson_id = (
           SELECT nl.id FROM lessons ol JOIN lessons nl ON nl.course_version_id = ? AND nl.lesson_key = ol.lesson_key
           JOIN lesson_scenarios ls ON ls.lesson_id = nl.id AND ls.scenario_block_id = scenario_attempts.scenario_block_id
           WHERE ol.id = scenario_attempts.lesson_id)
         WHERE user_id = ? AND enrollment_id = ? AND status = 'in_progress'
           AND lesson_id IN (SELECT id FROM lessons WHERE course_version_id = ?)
           AND EXISTS (
             SELECT 1 FROM lessons ol JOIN lessons nl ON nl.course_version_id = ? AND nl.lesson_key = ol.lesson_key
             JOIN lesson_scenarios ls ON ls.lesson_id = nl.id AND ls.scenario_block_id = scenario_attempts.scenario_block_id
             WHERE ol.id = scenario_attempts.lesson_id)
           AND ${still}`,
      )
      .bind(now, newV, userId, e.id, oldV, newV, e.id, oldV),
    db
      .prepare(
        `UPDATE scenario_attempts SET status = 'abandoned', updated_at = ?
         WHERE user_id = ? AND enrollment_id = ? AND status = 'in_progress'
           AND lesson_id IN (SELECT id FROM lessons WHERE course_version_id = ?) AND ${still}`,
      )
      .bind(now, userId, e.id, oldV, e.id, oldV),
    db.prepare(`UPDATE learning_sessions SET status = 'closed' WHERE enrollment_id = ? AND status = 'active' AND ${still}`).bind(e.id, e.id, oldV),
    db.prepare(`UPDATE enrollments SET course_version_id = ?, status = 'active', completed_at = NULL WHERE id = ? AND course_version_id = ?`).bind(newV, e.id, oldV),
    auditStmt(db, now, actorId, 'enrollment.upgrade', 'enrollment', e.id, {
      fromVersion: info.fromVersion,
      toVersion: info.toVersion,
      carriedLessons: info.carriedLessons,
      self: actorId === userId,
    }),
  ]);
  if (!out[4]?.meta.changes) throw new HttpError(409, ERROR_CODES.CONFLICT, 'Pendaftaran sudah diperbarui. Muat ulang halaman.');
  return { fromVersion: info.fromVersion, toVersion: info.toVersion, carriedLessons: info.carriedLessons };
}
