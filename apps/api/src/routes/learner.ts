import { Hono } from 'hono';
import {
  ERROR_CODES,
  answersPatchSchema,
  appealSchema,
  heartbeatSchema,
  normalizeCertificateCode,
  profilePatchSchema,
  ratingSchema,
  scenarioChoiceSchema,
  scenarioStartSchema,
  type Block,
  type LessonContent,
  type MeResponse,
} from '@patradesa/shared';
import type { AppEnv, Deps } from '../env';
import { HttpError, notFound, param, readJson } from '../lib/http';
import { enforceRateLimit } from '../lib/rateLimit';
import { newId } from '../lib/crypto';
import { csrfTokenFor, currentUser, hasRole, requireAuth } from '../middleware/auth';
import { getActiveAttempt } from '../services/examLock';
import { catalog, courseDetail, enroll, myCourses, rateCourse } from '../services/courses';
import { requireLessonAccess } from '../services/access';
import { heartbeat, startLearningSession, touchProgressStatement } from '../services/learning';
import { attemptResult, attemptView, loadOwnedAttempt, saveAnswers, startAttempt, submitAttempt } from '../services/attempts';
import { ensureCertificate, issueAfterAttempt, myCertificates, publicCertificate, toView } from '../services/certificates';
import { lessonScenarioSummaries, scenarioDelivery, startScenarioAttempt, submitScenarioChoice } from '../services/scenarios';

export function learnerRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  // ---------------------------------------------------------------- publik
  r.get('/catalog', async (c) => {
    const u = c.get('user');
    let role: string | null = null;
    if (u) {
      const p = await c.env.DB.prepare('SELECT village_role FROM user_profiles WHERE user_id = ?').bind(u.id).first<{ village_role: string | null }>();
      role = p?.village_role ?? null;
    }
    const courses = await catalog(c.env.DB, role, u?.id ?? null);
    if (!u) c.header('Cache-Control', 'public, max-age=60');
    return c.json({ courses });
  });

  r.get('/courses/:id', async (c) => {
    const u = c.get('user');
    const now = deps.now();
    const detail = await courseDetail(c.env.DB, param(c, 'id'), u?.id ?? null, now);
    if (u && detail.enrolled) {
      // Penerbitan "malas": peserta yang sudah lulus selalu mendapat sertifikat saat membuka halaman kelas.
      try {
        const row = await ensureCertificate(c.env, deps.fetch, u.id, detail.id, now);
        detail.certificate = row ? toView({ ...row, slug: detail.slug }) : null;
      } catch (err) {
        console.error('certificate', err instanceof Error ? err.message : 'unknown');
      }
    }
    return c.json(detail);
  });

  /** Data sertifikat untuk halaman cetak. Publik: kode verifikasi 80-bit acak berfungsi sebagai kunci akses. */
  r.get('/certificates/:code', async (c) => {
    const code = normalizeCertificateCode(c.req.param('code'));
    if (!code) throw notFound('Sertifikat');
    await enforceRateLimit(c.env.DB, `cert:${c.req.header('cf-connecting-ip') ?? 'local'}`, 60, 60_000, deps.now());
    const cert = await publicCertificate(c.env.DB, code);
    if (!cert) throw notFound('Sertifikat');
    c.header('X-Robots-Tag', 'noindex');
    return c.json(cert);
  });

  /**
   * Foto sampul kelas. Publik (boleh di-cache) untuk kelas terbit & publik; editor/admin dapat
   * melihat sampul kelas draft (tanpa cache). URL memuat ?v=<updated_at> sehingga cache aman.
   */
  r.get('/courses/:id/cover', async (c) => {
    const id = param(c, 'id');
    const row = await c.env.DB.prepare(
      `SELECT c.status, c.visibility, cc.file_key, cc.content_type FROM courses c JOIN course_covers cc ON cc.course_id = c.id
       WHERE c.id = ? OR c.slug = ?`,
    )
      .bind(id, id)
      .first<{ status: string; visibility: string; file_key: string; content_type: string }>();
    if (!row) throw notFound('Sampul');
    const isPublic = row.status === 'published' && row.visibility === 'public';
    if (!isPublic && !hasRole(c, 'content_editor', 'admin')) throw notFound('Sampul');
    const obj = await c.env.FILES.get(row.file_key);
    if (!obj) throw notFound('Sampul');
    return new Response(obj.body, {
      headers: {
        'Content-Type': row.content_type,
        'Cache-Control': isPublic ? 'public, max-age=86400' : 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      },
    });
  });

  r.post('/courses/:id/rating', requireAuth, async (c) => {
    const u = currentUser(c);
    const now = deps.now();
    await enforceRateLimit(c.env.DB, `rating:${u.id}`, 20, 60_000, now);
    const body = await readJson(c, ratingSchema);
    return c.json(await rateCourse(c.env.DB, u.id, param(c, 'id'), body.stars, now));
  });

  // ---------------------------------------------------------------- profil
  r.get('/me', requireAuth, async (c) => {
    const u = currentUser(c);
    const p = await c.env.DB.prepare(
      'SELECT certificate_name, village_role, village_name, district, regency, privacy_consent_at FROM user_profiles WHERE user_id = ?',
    )
      .bind(u.id)
      .first<{
        certificate_name: string | null;
        village_role: MeResponse['profile']['villageRole'];
        village_name: string | null;
        district: string | null;
        regency: string | null;
        privacy_consent_at: number | null;
      }>();
    const active = await getActiveAttempt(c.env.DB, u.id, deps.now());
    const body: MeResponse = {
      user: { id: u.id, email: u.email, displayName: u.displayName },
      roles: u.roles,
      profile: {
        certificateName: p?.certificate_name ?? null,
        villageRole: p?.village_role ?? null,
        villageName: p?.village_name ?? null,
        district: p?.district ?? null,
        regency: p?.regency ?? null,
        privacyConsentAt: p?.privacy_consent_at ?? null,
      },
      csrfToken: await csrfTokenFor(c.env.SESSION_SECRET, c.get('sessionId')!),
      activeAttempt: active ? { id: active.id, assessmentId: active.assessment_id, deadlineAt: active.deadline_at } : null,
    };
    return c.json(body);
  });

  // Jabatan desa hanya metadata profil: TIDAK mengubah system_roles (tidak ada jalur dari sini ke role).
  r.patch('/me', requireAuth, async (c) => {
    const u = currentUser(c);
    const b = await readJson(c, profilePatchSchema);
    const now = deps.now();
    const stmts = [];
    if (b.displayName) stmts.push(c.env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(b.displayName, u.id));
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO user_profiles (user_id, certificate_name, village_role, village_name, district, regency, privacy_consent_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           certificate_name = CASE WHEN ? THEN excluded.certificate_name ELSE user_profiles.certificate_name END,
           village_role = CASE WHEN ? THEN excluded.village_role ELSE user_profiles.village_role END,
           village_name = CASE WHEN ? THEN excluded.village_name ELSE user_profiles.village_name END,
           district = CASE WHEN ? THEN excluded.district ELSE user_profiles.district END,
           regency = CASE WHEN ? THEN excluded.regency ELSE user_profiles.regency END,
           privacy_consent_at = COALESCE(user_profiles.privacy_consent_at, excluded.privacy_consent_at),
           updated_at = excluded.updated_at`,
      ).bind(
        u.id,
        b.certificateName ?? null,
        b.villageRole ?? null,
        b.villageName ?? null,
        b.district ?? null,
        b.regency ?? null,
        b.privacyConsent ? now : null,
        now,
        b.certificateName !== undefined ? 1 : 0,
        b.villageRole !== undefined ? 1 : 0,
        b.villageName !== undefined ? 1 : 0,
        b.district !== undefined ? 1 : 0,
        b.regency !== undefined ? 1 : 0,
      ),
    );
    // Sertifikat yang belum terbit (masih menunggu Studio) ikut memakai nama terbaru. Yang sudah terbit tetap.
    stmts.push(
      c.env.DB.prepare(
        `UPDATE certificates SET recipient_name = (
           SELECT substr(COALESCE(NULLIF(TRIM(p.certificate_name), ''), u.display_name), 1, 120)
           FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = certificates.user_id)
         WHERE user_id = ? AND status = 'pending'`,
      ).bind(u.id),
    );
    await c.env.DB.batch(stmts);
    return c.json({ ok: true });
  });

  r.get('/me/courses', requireAuth, async (c) => c.json({ courses: await myCourses(c.env.DB, currentUser(c).id) }));
  r.get('/me/certificates', requireAuth, async (c) => c.json({ certificates: await myCertificates(c.env.DB, currentUser(c).id) }));

  r.post('/courses/:id/enroll', requireAuth, async (c) => {
    const res = await enroll(c.env.DB, currentUser(c).id, param(c, 'id'), deps.now());
    return c.json(res, res.created ? 201 : 200);
  });

  // ---------------------------------------------------------------- belajar
  r.get('/lessons/:id/content', requireAuth, async (c) => {
    const u = currentUser(c);
    const now = deps.now();
    const acc = await requireLessonAccess(c.env.DB, u.id, param(c, 'id'), now);
    await touchProgressStatement(c.env.DB, u.id, acc.lesson_id, acc.enrollment_id, now, acc.required_active_seconds).run();
    const p = await c.env.DB.prepare('SELECT active_seconds, completed_at FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
      .bind(u.id, acc.lesson_id)
      .first<{ active_seconds: number; completed_at: number | null }>();
    const body: LessonContent = {
      id: acc.lesson_id,
      title: acc.lesson_title,
      contentType: acc.content_type,
      blocks: JSON.parse(acc.content_json) as Block[],
      youtubeId: acc.content_type === 'youtube' ? acc.youtube_id : null,
      fileUrl: acc.content_type === 'pdf' && acc.file_key ? `/api/v1/lessons/${acc.lesson_id}/file` : null,
      courseId: acc.course_id,
      requiredActiveSeconds: acc.required_active_seconds,
      activeSeconds: p?.active_seconds ?? 0,
      completed: !!p?.completed_at,
      scenarios: await lessonScenarioSummaries(c.env.DB, u.id, acc.lesson_id),
    };
    return c.json(body);
  });

  // ---------------------------------------------------------------- blok skenario (docs/scenario-block/README.md §4)
  r.post('/scenarios/:id/attempts', requireAuth, async (c) => {
    const u = currentUser(c);
    const now = deps.now();
    await enforceRateLimit(c.env.DB, `scn-start:${u.id}`, 10, 60_000, now);
    const b = await readJson(c, scenarioStartSchema);
    const { attemptId, created } = await startScenarioAttempt(c.env.DB, u.id, param(c, 'id'), b.lessonId, now);
    return c.json(await scenarioDelivery(c.env.DB, attemptId, u.id), created ? 201 : 200);
  });

  r.get('/scenario-attempts/:id', requireAuth, async (c) => {
    const u = currentUser(c);
    return c.json(await scenarioDelivery(c.env.DB, param(c, 'id'), u.id));
  });

  r.post('/scenario-attempts/:id/choices', requireAuth, async (c) => {
    const u = currentUser(c);
    const now = deps.now();
    await enforceRateLimit(c.env.DB, `scn-choice:${u.id}`, 60, 60_000, now);
    const b = await readJson(c, scenarioChoiceSchema);
    return c.json(await submitScenarioChoice(c.env.DB, u.id, param(c, 'id'), b, now));
  });

  // PDF privat: R2 bucket tidak publik; hanya lewat Worker setelah cek enrollment.
  r.get('/lessons/:id/file', requireAuth, async (c) => {
    const u = currentUser(c);
    const acc = await requireLessonAccess(c.env.DB, u.id, param(c, 'id'), deps.now());
    if (!acc.file_key) throw notFound('Berkas');
    const obj = await c.env.FILES.get(acc.file_key);
    if (!obj) throw notFound('Berkas');
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="materi.pdf"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'",
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  });

  r.post('/lessons/:id/session', requireAuth, async (c) => {
    const u = currentUser(c);
    return c.json(await startLearningSession(c.env.DB, u.id, param(c, 'id'), deps.now()), 201);
  });

  r.post('/lessons/:id/heartbeat', requireAuth, async (c) => {
    const u = currentUser(c);
    const now = deps.now();
    await enforceRateLimit(c.env.DB, `hb:${u.id}`, 12, 60_000, now);
    const body = await readJson(c, heartbeatSchema);
    return c.json(await heartbeat(c.env.DB, u.id, param(c, 'id'), body, now));
  });

  // ---------------------------------------------------------------- asesmen
  r.post('/assessments/:id/attempts', requireAuth, async (c) => {
    const u = currentUser(c);
    const now = deps.now();
    await enforceRateLimit(c.env.DB, `attempt-start:${u.id}`, 10, 60_000, now);
    const { attemptId, created } = await startAttempt(c.env.DB, u.id, param(c, 'id'), now);
    return c.json(await attemptView(c.env.DB, attemptId, u.id, now), created ? 201 : 200);
  });

  r.get('/attempts/:id', requireAuth, async (c) => {
    const u = currentUser(c);
    return c.json(await attemptView(c.env.DB, param(c, 'id'), u.id, deps.now()));
  });

  r.patch('/attempts/:id/answers', requireAuth, async (c) => {
    const u = currentUser(c);
    const now = deps.now();
    await enforceRateLimit(c.env.DB, `answers:${u.id}`, 60, 60_000, now);
    const body = await readJson(c, answersPatchSchema);
    return c.json(await saveAnswers(c.env.DB, param(c, 'id'), u.id, body.answers, now));
  });

  r.post('/attempts/:id/submit', requireAuth, async (c) => {
    const u = currentUser(c);
    const now = deps.now();
    const id = param(c, 'id');
    await submitAttempt(c.env.DB, id, u.id, now);
    const result = await attemptResult(c.env.DB, id, u.id, now);
    if (result.resultStatus === 'passed') await issueAfterAttempt(c.env, deps.fetch, id, now);
    return c.json(result);
  });

  r.get('/attempts/:id/result', requireAuth, async (c) => {
    const u = currentUser(c);
    return c.json(await attemptResult(c.env.DB, param(c, 'id'), u.id, deps.now()));
  });

  r.post('/attempts/:id/appeal', requireAuth, async (c) => {
    const u = currentUser(c);
    const now = deps.now();
    const id = param(c, 'id');
    const at = await loadOwnedAttempt(c.env.DB, id, u.id);
    if (at.status === 'in_progress' || at.status === 'voided') throw new HttpError(409, ERROR_CODES.CONFLICT, 'Banding belum dapat diajukan.');
    const body = await readJson(c, appealSchema);
    try {
      await c.env.DB.prepare('INSERT INTO appeals (id, attempt_id, user_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(newId(), id, u.id, body.reason, 'open', now)
        .run();
    } catch {
      throw new HttpError(409, ERROR_CODES.CONFLICT, 'Banding untuk kuis ini sedang diproses.');
    }
    return c.json({ ok: true }, 201);
  });

  return r;
}
