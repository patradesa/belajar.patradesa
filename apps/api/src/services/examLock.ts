import type { MiddlewareHandler } from 'hono';
import { AI_LOCKED_MESSAGE, ERROR_CODES } from '@patradesa/shared';
import type { AppEnv, Deps } from '../env';
import { currentUser } from '../middleware/auth';
import { HttpError } from '../lib/http';
import { securityEvent } from '../lib/audit';
import { expireOverdueAttempts } from './finalize';

export interface ActiveAttempt {
  id: string;
  assessment_id: string;
  deadline_at: number;
}

/**
 * Exam lock = ada attempt `in_progress` milik user (lintas seluruh kelas, tab, perangkat).
 * Attempt kedaluwarsa difinalisasi lebih dulu agar lock tidak menggantung.
 */
export async function getActiveAttempt(db: D1Database, userId: string, now: number): Promise<ActiveAttempt | null> {
  await expireOverdueAttempts(db, now, userId);
  return db
    .prepare(`SELECT id, assessment_id, deadline_at FROM attempts WHERE user_id = ? AND status = 'in_progress' LIMIT 1`)
    .bind(userId)
    .first<ActiveAttempt>();
}

/**
 * Lempar 423 EXAM_LOCKED jika user punya ujian aktif. Fail closed: bila status DB tidak dapat
 * diverifikasi, AI ditolak sementara (503) — kuis TIDAK dibatalkan.
 */
export async function assertNoActiveExam(db: D1Database, userId: string, now: number): Promise<void> {
  let active: ActiveAttempt | null;
  try {
    active = await getActiveAttempt(db, userId, now);
  } catch {
    await securityEvent(db, now, 'exam_lock_check_failed', userId);
    throw new HttpError(503, ERROR_CODES.EXAM_LOCK_UNVERIFIED, 'Pendamping AI sementara tidak tersedia. Coba lagi nanti.');
  }
  if (active) {
    throw new HttpError(423, ERROR_CODES.EXAM_LOCKED, AI_LOCKED_MESSAGE, { attemptId: active.id });
  }
}

/**
 * Pola path AI learner. SEMUA path API yang memuat segmen `ai` (kecuali area admin/internal)
 * dianggap AI learner dan otomatis dijaga — termasuk route baru di masa depan.
 */
export function isLearnerAiPath(path: string): boolean {
  if (!path.startsWith('/api/')) return false;
  if (path.startsWith('/api/v1/admin/') || path.startsWith('/api/internal/')) return false;
  return /\/ai(\/|$)/.test(path);
}

/**
 * Middleware global (dipasang di level app, sebelum router mana pun): setiap request ke path AI
 * learner wajib terautentikasi dan lolos assertNoActiveExam SEBELUM handler/provider dipanggil.
 */
export function examLockGuard(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (isLearnerAiPath(c.req.path)) {
      const user = currentUser(c);
      await assertNoActiveExam(c.env.DB, user.id, deps.now());
    }
    await next();
  };
}
