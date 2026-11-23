/**
 * Sertifikat kelulusan kelas. Nomor dan kode verifikasi diterbitkan oleh Sertifikat Studio
 * (sertifikat.patradesa.id) lewat endpoint integrasi bertanda tangan HMAC-SHA256.
 *
 * Alur: syarat lulus terpenuhi → baris 'pending' (idempoten, UNIQUE user+kelas) → panggil Studio
 * dengan kunci idempotensi `belajar-<id>` → 'issued'. Gagal = tetap 'pending' dengan backoff;
 * Cron mencoba ulang. Studio menjamin permintaan ulang tidak membuat nomor baru.
 */
import { ERROR_CODES, type CertificateView, type PublicCertificate } from '@patradesa/shared';
import type { Env } from '../env';
import { HttpError } from '../lib/http';
import { newId } from '../lib/crypto';

type FetchFn = typeof fetch;
type StudioReply = {
  serial?: unknown;
  code?: unknown;
  issuedAt?: unknown;
  error?: unknown;
};

export interface CertificateRow {
  id: string;
  user_id: string;
  course_id: string;
  course_version_id: string;
  status: 'pending' | 'issued' | 'revoked';
  recipient_name: string;
  course_title: string;
  final_score_pct: number | null;
  completed_at: number;
  certificate_no: string | null;
  verification_code: string | null;
  verify_url: string | null;
  issued_at: number | null;
  sync_attempts: number;
  next_retry_at: number | null;
  last_error: string | null;
  revoked_at: number | null;
  revoked_reason: string | null;
}

const MAX_BACKOFF_MS = 6 * 3600_000;
const STUDIO_TIMEOUT_MS = 8000;

/** Alasan integrasi belum siap (untuk admin), atau null bila siap. Tidak pernah memuat nilai rahasia. */
export function integrationProblem(env: Env): string | null {
  if (!env.SERTIFIKAT_BASE_URL) return 'Variabel SERTIFIKAT_BASE_URL belum ada di Worker.';
  const secret = env.SERTIFIKAT_INTEGRATION_SECRET;
  if (!secret) return 'Secret SERTIFIKAT_INTEGRATION_SECRET belum dipasang di Worker.';
  if (secret.length < 32) return `Secret SERTIFIKAT_INTEGRATION_SECRET terlalu pendek (${secret.length} karakter; minimal 32).`;
  return null;
}

export function integrationConfigured(env: Env): boolean {
  return integrationProblem(env) === null;
}

function studioBase(env: Env): string {
  return (env.SERTIFIKAT_BASE_URL ?? '').replace(/\/+$/, '');
}

export function toView(r: CertificateRow & { slug?: string }): CertificateView {
  return {
    id: r.id,
    status: r.status,
    recipientName: r.recipient_name,
    courseTitle: r.course_title,
    courseSlug: r.slug ?? '',
    finalScorePct: r.final_score_pct,
    completedAt: r.completed_at,
    certificateNo: r.certificate_no,
    code: r.verification_code,
    verifyUrl: r.verify_url,
    issuedAt: r.issued_at,
    revokedAt: r.revoked_at,
  };
}

/** Status kelulusan kelas untuk satu peserta (satu query). Sama dengan aturan di courseDetail. */
export async function completionState(
  db: D1Database,
  userId: string,
  courseId: string,
): Promise<{
  complete: boolean;
  versionId: string;
  enrollmentId: string;
  scorePct: number | null;
} | null> {
  const r = await db
    .prepare(
      `SELECT e.id AS enrollment_id, e.course_version_id AS version_id,
         (SELECT COUNT(*) FROM lessons l WHERE l.course_version_id = e.course_version_id) AS lesson_count,
         (SELECT COUNT(*) FROM lessons l LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.user_id = e.user_id
            WHERE l.course_version_id = e.course_version_id AND l.is_required = 1 AND p.completed_at IS NULL) AS lessons_left,
         (SELECT COUNT(*) FROM assessments a JOIN lessons l ON l.id = a.lesson_id
            WHERE l.course_version_id = e.course_version_id AND a.is_required = 1
              AND NOT EXISTS (SELECT 1 FROM attempts t WHERE t.assessment_id = a.id AND t.user_id = e.user_id AND t.result_status = 'passed')) AS quizzes_left,
         (SELECT COUNT(*) FROM lesson_scenarios ls JOIN lessons l ON l.id = ls.lesson_id JOIN scenario_blocks sb ON sb.id = ls.scenario_block_id
            WHERE l.course_version_id = e.course_version_id AND l.is_required = 1 AND sb.mode = 'graded'
              AND NOT EXISTS (SELECT 1 FROM scenario_attempts sa WHERE sa.scenario_block_id = sb.id AND sa.user_id = e.user_id AND sa.passed = 1)) AS scenarios_left,
         (SELECT ROUND(AVG(best), 1) FROM (SELECT MAX(t.final_score_pct) AS best FROM attempts t
            JOIN assessments a ON a.id = t.assessment_id JOIN lessons l ON l.id = a.lesson_id
            WHERE l.course_version_id = e.course_version_id AND t.user_id = e.user_id AND t.result_status = 'passed'
            GROUP BY t.assessment_id)) AS score
       FROM enrollments e WHERE e.user_id = ? AND e.course_id = ?`,
    )
    .bind(userId, courseId)
    .first<{
      enrollment_id: string;
      version_id: string;
      lesson_count: number;
      lessons_left: number;
      quizzes_left: number;
      scenarios_left: number;
      score: number | null;
    }>();
  if (!r) return null;
  return {
    complete: r.lesson_count > 0 && r.lessons_left === 0 && r.quizzes_left === 0 && r.scenarios_left === 0,
    versionId: r.version_id,
    enrollmentId: r.enrollment_id,
    scorePct: r.score,
  };
}

async function loadRow(db: D1Database, userId: string, courseId: string): Promise<CertificateRow | null> {
  return db.prepare('SELECT * FROM certificates WHERE user_id = ? AND course_id = ?').bind(userId, courseId).first<CertificateRow>();
}

/**
 * Pastikan sertifikat ada bila peserta sudah lulus, lalu coba terbitkan di Studio bila masih pending.
 * Aman dipanggil berulang (dari submit kuis, keputusan review esai, halaman kelas, Cron).
 */
export async function ensureCertificate(env: Env, fetchFn: FetchFn, userId: string, courseId: string, now: number): Promise<CertificateRow | null> {
  const db = env.DB;
  let row = await loadRow(db, userId, courseId);
  if (!row) {
    const st = await completionState(db, userId, courseId);
    if (!st?.complete) return null;
    const info = await db
      .prepare(
        `SELECT c.title, COALESCE(NULLIF(TRIM(p.certificate_name), ''), u.display_name) AS name
         FROM courses c, users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE c.id = ? AND u.id = ?`,
      )
      .bind(courseId, userId)
      .first<{ title: string; name: string }>();
    if (!info) return null;
    await db.batch([
      db
        .prepare(
          `INSERT INTO certificates (id, user_id, course_id, course_version_id, status, recipient_name, course_title, final_score_pct, completed_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?) ON CONFLICT (user_id, course_id) DO NOTHING`,
        )
        .bind(newId(), userId, courseId, st.versionId, info.name.slice(0, 120), info.title, st.scorePct, now),
      db.prepare(`UPDATE enrollments SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'active'`).bind(now, st.enrollmentId),
    ]);
    row = await loadRow(db, userId, courseId);
    if (!row) return null;
  }
  if (row.status === 'pending' && (row.next_retry_at ?? 0) <= now) row = await pushToStudio(env, fetchFn, row, now);
  return row;
}

function backoff(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Kirim permintaan bertanda tangan ke Studio. Mengembalikan status + JSON (atau melempar bila jaringan gagal). */
async function callStudio(
  env: Env,
  fetchFn: FetchFn,
  path: string,
  payload: unknown,
  now: number,
): Promise<{ status: number; data: StudioReply | null }> {
  const body = JSON.stringify(payload);
  const ts = String(now);
  const signature = await hmacHex(env.SERTIFIKAT_INTEGRATION_SECRET!, `${ts}.${body}`);
  const res = await fetchFn(`${studioBase(env)}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-pd-timestamp': ts,
      'x-pd-signature': signature,
    },
    body,
    signal: AbortSignal.timeout(STUDIO_TIMEOUT_MS),
  });
  let data: StudioReply | null = null;
  try {
    data = (await res.json()) as StudioReply;
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function dateLabel(ms: number): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Makassar',
  }).format(new Date(ms));
}

async function markFailed(db: D1Database, row: CertificateRow, now: number, error: string): Promise<CertificateRow> {
  const attempts = row.sync_attempts + 1;
  const next = now + backoff(attempts);
  const msg = error.slice(0, 300);
  await db
    .prepare(`UPDATE certificates SET sync_attempts = ?, next_retry_at = ?, last_error = ? WHERE id = ? AND status = 'pending'`)
    .bind(attempts, next, msg, row.id)
    .run();
  return {
    ...row,
    sync_attempts: attempts,
    next_retry_at: next,
    last_error: msg,
  };
}

export async function pushToStudio(env: Env, fetchFn: FetchFn, row: CertificateRow, now: number): Promise<CertificateRow> {
  const problem = integrationProblem(env);
  if (problem) return markFailed(env.DB, row, now, `Integrasi Sertifikat Studio belum siap: ${problem}`);
  let r: { status: number; data: StudioReply | null };
  try {
    r = await callStudio(
      env,
      fetchFn,
      '/api/integrasi/terbitkan',
      {
        idempotencyKey: `belajar-${row.id}`,
        eventTitle: row.course_title,
        eventDate: dateLabel(row.completed_at),
        recipientName: row.recipient_name,
      },
      now,
    );
  } catch (err) {
    return markFailed(env.DB, row, now, `Studio tidak dapat dihubungi (${err instanceof Error ? err.name : 'galat'}).`);
  }
  const d: StudioReply = r.data ?? {};
  const okShape =
    (r.status === 200 || r.status === 201) &&
    typeof d.code === 'string' &&
    /^[0-9A-HJKMNP-TV-Z]{16}$/.test(d.code) &&
    typeof d.serial === 'string' &&
    d.serial.length > 0 &&
    d.serial.length <= 80;
  if (!okShape) {
    const reason = typeof d.error === 'string' ? d.error.slice(0, 200) : 'jawaban tidak dikenali';
    return markFailed(env.DB, row, now, `Studio menolak (HTTP ${r.status}): ${reason}`);
  }
  const parsed = typeof d.issuedAt === 'string' ? Date.parse(d.issuedAt) : NaN;
  const issuedAt = Number.isFinite(parsed) ? parsed : now;
  // URL verifikasi dibangun sendiri dari alamat Studio yang dikonfigurasi (tidak mempercayai URL dari jawaban).
  const verifyUrl = `${studioBase(env)}/v/${d.code}`;
  await env.DB.prepare(
    `UPDATE certificates SET status = 'issued', certificate_no = ?, verification_code = ?, verify_url = ?, issued_at = ?,
       sync_attempts = sync_attempts + 1, next_retry_at = NULL, last_error = NULL WHERE id = ? AND status = 'pending'`,
  )
    .bind(d.serial, d.code, verifyUrl, issuedAt, row.id)
    .run();
  return (await env.DB.prepare('SELECT * FROM certificates WHERE id = ?').bind(row.id).first<CertificateRow>())!;
}

/** Setelah attempt LULUS (submit atau review esai): terbitkan sertifikat bila kelas selesai. Tidak pernah melempar. */
export async function issueAfterAttempt(env: Env, fetchFn: FetchFn, attemptId: string, now: number): Promise<void> {
  try {
    const a = await env.DB.prepare(
      `SELECT at.user_id, at.result_status, cv.course_id FROM attempts at JOIN assessments a ON a.id = at.assessment_id
       JOIN lessons l ON l.id = a.lesson_id JOIN course_versions cv ON cv.id = l.course_version_id WHERE at.id = ?`,
    )
      .bind(attemptId)
      .first<{ user_id: string; result_status: string; course_id: string }>();
    if (a?.result_status === 'passed') await ensureCertificate(env, fetchFn, a.user_id, a.course_id, now);
  } catch (err) {
    console.error('certificate', err instanceof Error ? err.message : 'unknown');
  }
}

/** Dipanggil Cron: coba ulang sertifikat pending yang jatuh tempo (dibatasi agar hemat query). */
export async function retryPendingCertificates(env: Env, fetchFn: FetchFn, now: number, limit = 5): Promise<number> {
  if (!integrationConfigured(env)) return 0;
  const { results } = await env.DB.prepare(
    `SELECT * FROM certificates WHERE status = 'pending' AND COALESCE(next_retry_at, 0) <= ? ORDER BY completed_at LIMIT ?`,
  )
    .bind(now, limit)
    .all<CertificateRow>();
  let issued = 0;
  for (const row of results) {
    const r = await pushToStudio(env, fetchFn, row, now);
    if (r.status === 'issued') issued++;
  }
  return issued;
}

/** Cabut sertifikat: bila sudah terbit, cabut juga di Studio (halaman verifikasi publik ikut berubah). */
export async function revokeCertificate(
  env: Env,
  fetchFn: FetchFn,
  id: string,
  actorId: string,
  reason: string,
  now: number,
): Promise<CertificateRow> {
  const row = await env.DB.prepare('SELECT * FROM certificates WHERE id = ?').bind(id).first<CertificateRow>();
  if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Sertifikat tidak ditemukan.');
  if (row.status === 'revoked') return row;
  if (row.status === 'issued') {
    const problem = integrationProblem(env);
    if (problem) throw new HttpError(503, ERROR_CODES.INTERNAL, `Integrasi Sertifikat Studio belum siap: ${problem}`);
    let r: { status: number; data: StudioReply | null };
    try {
      r = await callStudio(env, fetchFn, '/api/integrasi/cabut', { code: row.verification_code, reason }, now);
    } catch {
      throw new HttpError(502, ERROR_CODES.INTERNAL, 'Sertifikat Studio tidak dapat dihubungi. Coba lagi nanti.');
    }
    if (r.status !== 200) {
      throw new HttpError(502, ERROR_CODES.INTERNAL, `Sertifikat Studio menolak pencabutan (HTTP ${r.status}).`);
    }
  }
  await env.DB.prepare(
    `UPDATE certificates SET status = 'revoked', revoked_at = ?, revoked_by = ?, revoked_reason = ?, next_retry_at = NULL WHERE id = ?`,
  )
    .bind(now, actorId, reason, id)
    .run();
  return (await env.DB.prepare('SELECT * FROM certificates WHERE id = ?').bind(id).first<CertificateRow>())!;
}

export async function myCertificates(db: D1Database, userId: string): Promise<CertificateView[]> {
  const { results } = await db
    .prepare(
      `SELECT ce.*, c.slug FROM certificates ce JOIN courses c ON c.id = ce.course_id
       WHERE ce.user_id = ? ORDER BY ce.completed_at DESC`,
    )
    .bind(userId)
    .all<CertificateRow & { slug: string }>();
  return results.map(toView);
}

export async function publicCertificate(db: D1Database, code: string): Promise<PublicCertificate | null> {
  const r = await db
    .prepare(`SELECT * FROM certificates WHERE verification_code = ? AND status IN ('issued', 'revoked')`)
    .bind(code)
    .first<CertificateRow>();
  if (!r || !r.certificate_no || !r.verification_code || !r.verify_url || !r.issued_at) return null;
  return {
    status: r.status === 'revoked' ? 'revoked' : 'issued',
    recipientName: r.recipient_name,
    courseTitle: r.course_title,
    finalScorePct: r.final_score_pct,
    certificateNo: r.certificate_no,
    code: r.verification_code,
    verifyUrl: r.verify_url,
    issuedAt: r.issued_at,
    revokedAt: r.revoked_at,
  };
}
