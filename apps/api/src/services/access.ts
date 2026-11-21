import { ERROR_CODES } from '@patradesa/shared';
import { HttpError, notFound } from '../lib/http';

export interface LessonAccess {
  lesson_id: string;
  lesson_title: string;
  content_type: 'html' | 'slides' | 'pdf' | 'youtube';
  content_json: string;
  file_key: string | null;
  youtube_id: string | null;
  required_active_seconds: number;
  course_version_id: string;
  course_id: string;
  enrollment_id: string;
  learning_session_ttl_seconds: number;
}

/**
 * Periksa hak akses user ke lesson: enrollment aktif pada VERSI course yang memuat lesson,
 * belum kedaluwarsa, dan masih dalam jendela akses course. Semua dicek di server.
 * Pesan 404 untuk lesson yang tidak diikuti (tidak membocorkan keberadaan).
 */
export async function requireLessonAccess(db: D1Database, userId: string, lessonId: string, now: number): Promise<LessonAccess> {
  const row = await db
    .prepare(
      `SELECT l.id AS lesson_id, l.title AS lesson_title, l.content_type, l.content_json, l.file_key, l.youtube_id,
              l.required_active_seconds, l.course_version_id, c.id AS course_id, e.id AS enrollment_id,
              c.learning_session_ttl_seconds, e.status AS enrollment_status, e.expires_at AS enrollment_expires_at,
              c.access_starts_at, c.access_expires_at, c.status AS course_status
       FROM lessons l
       JOIN course_versions cv ON cv.id = l.course_version_id
       JOIN courses c ON c.id = cv.course_id
       JOIN enrollments e ON e.course_version_id = cv.id AND e.user_id = ?
       WHERE l.id = ?`,
    )
    .bind(userId, lessonId)
    .first<
      LessonAccess & {
        enrollment_status: string;
        enrollment_expires_at: number | null;
        access_starts_at: number | null;
        access_expires_at: number | null;
        course_status: string;
      }
    >();
  if (!row) throw notFound('Materi');
  if (!['active', 'completed'].includes(row.enrollment_status) || row.course_status === 'archived') {
    throw new HttpError(403, ERROR_CODES.ACCESS_EXPIRED, 'Akses kelas tidak aktif.');
  }
  if (row.access_starts_at !== null && now < row.access_starts_at) {
    throw new HttpError(403, ERROR_CODES.ACCESS_EXPIRED, 'Kelas belum dibuka.');
  }
  if ((row.enrollment_expires_at !== null && now >= row.enrollment_expires_at) || (row.access_expires_at !== null && now >= row.access_expires_at)) {
    throw new HttpError(403, ERROR_CODES.ACCESS_EXPIRED, 'Masa akses kelas sudah berakhir.');
  }
  return row;
}

/** Apakah lesson sudah memenuhi syarat aktivitas minimum (dikonfirmasi server)? */
export async function isLessonCompleted(db: D1Database, userId: string, lessonId: string): Promise<boolean> {
  const p = await db
    .prepare('SELECT completed_at FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
    .bind(userId, lessonId)
    .first<{ completed_at: number | null }>();
  return !!p?.completed_at;
}
