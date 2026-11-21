import { newId } from './crypto';

/** Metadata audit: hanya ID, flag, angka. Jangan pernah memasukkan teks esai, email, token. */
type SafeMeta = Record<string, string | number | boolean | null>;

export function auditStmt(
  db: D1Database,
  now: number,
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  meta: SafeMeta = {},
): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO admin_audit_logs (id, actor_user_id, action, target_type, target_id, created_at, metadata_redacted) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(newId(), actorUserId, action, targetType, targetId, now, JSON.stringify(meta));
}

export async function securityEvent(db: D1Database, now: number, type: string, userId: string | null, meta: SafeMeta = {}): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO security_events (id, user_id, type, created_at, metadata_minimal) VALUES (?, ?, ?, ?, ?)')
      .bind(newId(), userId, type, now, JSON.stringify(meta))
      .run();
  } catch {
    // Logging keamanan tidak boleh menggagalkan request.
  }
}
