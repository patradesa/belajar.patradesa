import { expireOverdueAttempts } from './services/finalize';

const DAY = 86_400_000;

/** Dijalankan Cron Trigger tiap menit: finalisasi attempt kedaluwarsa + pembersihan data sementara. */
export async function runMaintenance(db: D1Database, now: number): Promise<{ expired: number }> {
  const expired = await expireOverdueAttempts(db, now);
  await db.batch([
    db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - DAY),
    db.prepare('DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)').bind(now - 30 * DAY, now - 30 * DAY),
    db.prepare(`UPDATE learning_sessions SET status = 'expired' WHERE status = 'active' AND expires_at < ?`).bind(now),
    // Retensi event keamanan: 90 hari (docs/PRIVACY.md).
    db.prepare('DELETE FROM security_events WHERE created_at < ?').bind(now - 90 * DAY),
  ]);
  return { expired };
}
