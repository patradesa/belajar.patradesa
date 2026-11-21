import { Hono, type Context } from 'hono';
import { ERROR_CODES, aiPromptSchema } from '@patradesa/shared';
import type { AppEnv, Deps } from '../env';
import type { AiRequest } from '../ai/provider';
import { HttpError, param, readJson } from '../lib/http';
import { newId } from '../lib/crypto';
import { currentUser } from '../middleware/auth';
import { requireLessonAccess } from '../services/access';
import { assertNoActiveExam } from '../services/examLock';

/**
 * Endpoint AI learner. Penjagaan exam lock dilakukan oleh middleware GLOBAL `examLockGuard`
 * (dipasang di app sebelum router ini) berdasarkan pola path `/ai/` — sehingga route AI baru
 * otomatis terlindungi. Di sini lock DIPERIKSA ULANG setelah provider merespons: bila ujian
 * dimulai selama inference, jawaban dibuang dan 423 dikembalikan.
 *
 * Phase 1: provider dinonaktifkan → respons fallback non-AI, kuota tidak didebit.
 */
const FALLBACK =
  'Pendamping AI belum diaktifkan pada tahap ini. Silakan baca kembali ringkasan dan catatan materi, atau tanyakan kepada mentor.';

export function aiRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  const quota = (c: Context<AppEnv>) => Number(c.env.AI_DAILY_QUOTA ?? '10');

  async function run(c: Context<AppEnv>, purpose: AiRequest['purpose'], lessonId: string | null, message: string) {
    const u = currentUser(c);
    const now = deps.now();
    if (lessonId) await requireLessonAccess(c.env.DB, u.id, lessonId, now);
    if (!deps.ai.enabled) return c.json({ mode: 'fallback', message: FALLBACK });

    const dateKey = new Date(now).toISOString().slice(0, 10);
    const used = await c.env.DB.prepare('SELECT COALESCE(SUM(request_count), 0) AS n FROM ai_usage WHERE user_id = ? AND date_key = ?')
      .bind(u.id, dateKey)
      .first<{ n: number }>();
    if ((used?.n ?? 0) >= quota(c)) throw new HttpError(429, ERROR_CODES.RATE_LIMITED, 'Kuota pertanyaan AI hari ini sudah habis.');

    const sources = lessonId
      ? (
          await c.env.DB.prepare('SELECT section_key, approved_text FROM lesson_sources WHERE lesson_id = ? AND approved_at IS NOT NULL LIMIT 8')
            .bind(lessonId)
            .all<{ section_key: string; approved_text: string }>()
        ).results.map((s) => ({ sectionKey: s.section_key, text: s.approved_text }))
      : [];

    // Lock sudah diperiksa oleh examLockGuard sebelum titik ini; provider baru dipanggil sekarang.
    const out = await deps.ai.generate({ purpose, userId: u.id, lessonId, message, sources });
    await c.env.DB.prepare(
      `INSERT INTO ai_usage (id, user_id, lesson_id, date_key, purpose, request_count, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT (user_id, date_key, purpose) DO UPDATE SET request_count = request_count + 1,
         input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`,
    )
      .bind(newId(), u.id, lessonId, dateKey, purpose, out.inputTokens, out.outputTokens)
      .run();
    // Pemeriksaan ulang pasca-inference: ujian yang dimulai di tengah jalan membatalkan jawaban.
    await assertNoActiveExam(c.env.DB, u.id, deps.now());
    return c.json({ mode: 'ai', message: out.text });
  }

  for (const purpose of ['chat', 'summary', 'explain', 'hint'] as const) {
    r.post(`/lessons/:id/ai/${purpose}`, async (c) => {
      const id = param(c, 'id');
      const body = await readJson(c, aiPromptSchema);
      return run(c, purpose, id, body.message);
    });
  }
  r.get('/ai/recommendations', async (c) => run(c, 'recommend', null, 'rekomendasi'));

  return r;
}
