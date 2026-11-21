import { ERROR_CODES } from '@patradesa/shared';
import { HttpError } from './http';

/**
 * Rate limit fixed-window di D1. Cukup untuk pilot 10–20 peserta.
 * Untuk skala lebih besar ganti dengan binding Rate Limiting Cloudflare (lihat ADR-0006).
 */
export async function enforceRateLimit(db: D1Database, key: string, limit: number, windowMs: number, now: number): Promise<void> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  if ((row?.count ?? 0) > limit) {
    throw new HttpError(429, ERROR_CODES.RATE_LIMITED, 'Terlalu banyak permintaan. Coba lagi sebentar lagi.');
  }
}
