import {
  ERROR_CODES,
  VILLAGE_ROLES,
  summarize,
  type AssessmentSummary,
  type CatalogCourse,
  type CourseDetail,
  type CourseRating,
  type LessonSummary,
  type MyCourse,
  type VillageRole,
} from '@patradesa/shared';
import { HttpError, notFound } from '../lib/http';
import { newId } from '../lib/crypto';
import { assessmentEligibility, loadAssessment } from './attempts';

interface CourseRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  visibility: string;
  status: string;
  current_version_id: string | null;
  enrollment_open_at: number | null;
  enrollment_close_at: number | null;
  access_starts_at: number | null;
  access_expires_at: number | null;
  access_duration_days: number | null;
}

export function coverUrl(slug: string, version: number | null): string | null {
  return version === null ? null : `/api/v1/courses/${encodeURIComponent(slug)}/cover?v=${version}`;
}

export async function courseRating(db: D1Database, courseId: string): Promise<CourseRating> {
  const r = await db
    .prepare('SELECT ROUND(AVG(stars), 1) AS avg, COUNT(*) AS n FROM course_ratings WHERE course_id = ?')
    .bind(courseId)
    .first<{ avg: number | null; n: number }>();
  return { average: r?.n ? r.avg : null, count: r?.n ?? 0 };
}

/** Katalog publik dalam SATU query (aman untuk batas query D1 per request). */
export async function catalog(db: D1Database, villageRole: string | null, userId: string | null): Promise<CatalogCourse[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.slug, c.title, c.description,
              (SELECT COUNT(*) FROM lessons l WHERE l.course_version_id = c.current_version_id) AS lesson_count,
              (SELECT COALESCE(SUM(l.required_active_seconds), 0) FROM lessons l WHERE l.course_version_id = c.current_version_id) AS study_seconds,
              (SELECT COALESCE(SUM(a.mcq_count + a.essay_count), 0) FROM assessments a JOIN lessons l ON l.id = a.lesson_id
                WHERE l.course_version_id = c.current_version_id) AS quiz_count,
              (SELECT group_concat(village_role) FROM (SELECT village_role FROM role_recommendations r WHERE r.course_id = c.id ORDER BY priority)) AS roles,
              (SELECT MIN(priority) FROM role_recommendations r WHERE r.course_id = c.id AND r.village_role = ?) AS rec,
              (SELECT ROUND(AVG(stars), 1) FROM course_ratings cr WHERE cr.course_id = c.id) AS rating_avg,
              (SELECT COUNT(*) FROM course_ratings cr WHERE cr.course_id = c.id) AS rating_count,
              cc.updated_at AS cover_v,
              EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.user_id = ?) AS enrolled
       FROM courses c LEFT JOIN course_covers cc ON cc.course_id = c.id
       WHERE c.status = 'published' AND c.visibility = 'public' AND c.current_version_id IS NOT NULL
       ORDER BY (rec IS NULL), rec, c.title`,
    )
    .bind(villageRole, userId)
    .all<{
      id: string;
      slug: string;
      title: string;
      description: string;
      lesson_count: number;
      study_seconds: number;
      quiz_count: number;
      roles: string | null;
      rec: number | null;
      rating_avg: number | null;
      rating_count: number;
      cover_v: number | null;
      enrolled: number;
    }>();
  return results.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: summarize(r.description),
    lessonCount: r.lesson_count,
    studyMinutes: Math.ceil(r.study_seconds / 60),
    quizQuestionCount: r.quiz_count,
    recommendedRoles: (r.roles ? r.roles.split(',') : []).filter((x): x is VillageRole => (VILLAGE_ROLES as readonly string[]).includes(x)),
    rating: { average: r.rating_count ? r.rating_avg : null, count: r.rating_count },
    coverUrl: coverUrl(r.slug, r.cover_v),
    enrolled: r.enrolled === 1,
    recommended: r.rec !== null,
  }));
}

/** Simpan/ubah rating (1–5). Hanya peserta yang terdaftar di kelas. */
export async function rateCourse(db: D1Database, userId: string, idOrSlug: string, stars: number, now: number) {
  const c = await findPublishedCourse(db, idOrSlug);
  const enr = await db.prepare('SELECT 1 AS x FROM enrollments WHERE user_id = ? AND course_id = ?').bind(userId, c.id).first();
  if (!enr) throw new HttpError(403, ERROR_CODES.NOT_ELIGIBLE, 'Daftar kelas terlebih dahulu sebelum memberi rating.');
  await db
    .prepare(
      `INSERT INTO course_ratings (user_id, course_id, stars, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, course_id) DO UPDATE SET stars = excluded.stars, updated_at = excluded.updated_at`,
    )
    .bind(userId, c.id, stars, now, now)
    .run();
  return { rating: await courseRating(db, c.id), myRating: stars };
}

export async function findPublishedCourse(db: D1Database, idOrSlug: string): Promise<CourseRow> {
  const c = await db
    .prepare(`SELECT * FROM courses WHERE (id = ? OR slug = ?) AND status = 'published' AND current_version_id IS NOT NULL`)
    .bind(idOrSlug, idOrSlug)
    .first<CourseRow>();
  if (!c) throw notFound('Kelas');
  return c;
}

export async function courseDetail(db: D1Database, idOrSlug: string, userId: string | null, now: number): Promise<CourseDetail> {
  const c = await findPublishedCourse(db, idOrSlug);
  const enr = userId
    ? await db
        .prepare('SELECT id, status, expires_at, course_version_id FROM enrollments WHERE user_id = ? AND course_id = ?')
        .bind(userId, c.id)
        .first<{ id: string; status: string; expires_at: number | null; course_version_id: string }>()
    : null;
  if (c.visibility === 'private' && !enr) throw notFound('Kelas');
  const versionId = enr?.course_version_id ?? c.current_version_id!;
  const { results: lessons } = await db
    .prepare(
      `SELECT l.id, l.seq, l.title, l.summary, l.content_type, l.required_active_seconds, l.is_required,
              p.active_seconds, p.completed_at, a.id AS assessment_id
       FROM lessons l
       LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.user_id = ?
       LEFT JOIN assessments a ON a.lesson_id = l.id
       WHERE l.course_version_id = ? ORDER BY l.seq`,
    )
    .bind(userId, versionId)
    .all<{
      id: string;
      seq: number;
      title: string;
      summary: string;
      content_type: LessonSummary['contentType'];
      required_active_seconds: number;
      is_required: number;
      active_seconds: number | null;
      completed_at: number | null;
      assessment_id: string | null;
    }>();

  const out: LessonSummary[] = [];
  const reasons: string[] = [];
  for (const l of lessons) {
    let assessment: AssessmentSummary | null = null;
    if (l.assessment_id) {
      const a = await loadAssessment(db, l.assessment_id);
      let eligible = false;
      let attemptsUsed = 0;
      let best: AssessmentSummary['bestResult'] = null;
      if (userId && enr) {
        const el = await assessmentEligibility(db, userId, a, now);
        eligible = el.eligible;
        attemptsUsed = el.attemptsUsed;
        const r = await db
          .prepare(
            `SELECT result_status FROM attempts WHERE user_id = ? AND assessment_id = ? AND status IN ('submitted','expired')
             ORDER BY CASE result_status WHEN 'passed' THEN 0 WHEN 'pending_review' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END LIMIT 1`,
          )
          .bind(userId, a.id)
          .first<{ result_status: AssessmentSummary['bestResult'] }>();
        best = r?.result_status ?? null;
        if (a.is_required === 1 && best !== 'passed') reasons.push(`Kuis "${a.title}" belum lulus.`);
      }
      assessment = {
        id: a.id,
        title: a.title,
        timeLimitSeconds: a.time_limit_seconds,
        passingScorePct: a.passing_score_pct,
        maxAttempts: a.max_attempts,
        attemptsUsed,
        eligible,
        bestResult: best,
      };
    }
    if (enr && l.is_required === 1 && !l.completed_at) reasons.push(`Materi "${l.title}" belum selesai.`);
    out.push({
      id: l.id,
      seq: l.seq,
      title: l.title,
      summary: l.summary,
      contentType: l.content_type,
      requiredActiveSeconds: l.required_active_seconds,
      isRequired: l.is_required === 1,
      activeSeconds: l.active_seconds ?? 0,
      completed: !!l.completed_at,
      assessment,
    });
  }
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    description: c.description,
    enrolled: !!enr,
    enrollment: enr ? { id: enr.id, status: enr.status, expiresAt: enr.expires_at } : null,
    lessons: out,
    completion: enr ? { passed: reasons.length === 0, reasons } : null,
    rating: await courseRating(db, c.id),
    myRating: userId
      ? ((await db.prepare('SELECT stars FROM course_ratings WHERE user_id = ? AND course_id = ?').bind(userId, c.id).first<{ stars: number }>())?.stars ?? null)
      : null,
    coverUrl: coverUrl(
      c.slug,
      (await db.prepare('SELECT updated_at FROM course_covers WHERE course_id = ?').bind(c.id).first<{ updated_at: number }>())?.updated_at ?? null,
    ),
    certificate: null,
  };
}

/** Daftar kelas. Idempoten: pendaftaran ulang mengembalikan enrollment yang sama. */
export async function enroll(db: D1Database, userId: string, idOrSlug: string, now: number): Promise<{ enrollmentId: string; created: boolean }> {
  const c = await findPublishedCourse(db, idOrSlug);
  const existing = await db
    .prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?')
    .bind(userId, c.id)
    .first<{ id: string }>();
  if (existing) return { enrollmentId: existing.id, created: false };
  if (c.visibility !== 'public') throw notFound('Kelas');
  if ((c.enrollment_open_at !== null && now < c.enrollment_open_at) || (c.enrollment_close_at !== null && now >= c.enrollment_close_at)) {
    throw new HttpError(403, ERROR_CODES.ENROLLMENT_CLOSED, 'Pendaftaran kelas sedang tidak dibuka.');
  }
  if (c.access_expires_at !== null && now >= c.access_expires_at) {
    throw new HttpError(403, ERROR_CODES.ACCESS_EXPIRED, 'Masa akses kelas sudah berakhir.');
  }
  const candidates = [c.access_expires_at, c.access_duration_days ? now + c.access_duration_days * 86_400_000 : null].filter(
    (x): x is number => x !== null,
  );
  const expiresAt = candidates.length ? Math.min(...candidates) : null;
  const id = newId();
  await db
    .prepare(
      `INSERT INTO enrollments (id, user_id, course_id, course_version_id, status, started_at, expires_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?) ON CONFLICT (user_id, course_id) DO NOTHING`,
    )
    .bind(id, userId, c.id, c.current_version_id, now, expiresAt)
    .run();
  const row = await db.prepare('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?').bind(userId, c.id).first<{ id: string }>();
  return { enrollmentId: row!.id, created: row!.id === id };
}

export async function myCourses(db: D1Database, userId: string) {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.slug, c.title, e.status, e.expires_at, e.started_at,
              (SELECT COUNT(*) FROM lessons l WHERE l.course_version_id = e.course_version_id AND l.is_required = 1) AS required_lessons,
              (SELECT COUNT(*) FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id
                WHERE p.user_id = e.user_id AND l.course_version_id = e.course_version_id AND l.is_required = 1 AND p.completed_at IS NOT NULL) AS completed_lessons,
              (SELECT COUNT(*) FROM assessments a JOIN lessons l ON l.id = a.lesson_id
                WHERE l.course_version_id = e.course_version_id AND a.is_required = 1) AS required_quizzes,
              (SELECT COUNT(*) FROM assessments a JOIN lessons l ON l.id = a.lesson_id
                WHERE l.course_version_id = e.course_version_id AND a.is_required = 1
                  AND EXISTS (SELECT 1 FROM attempts t WHERE t.assessment_id = a.id AND t.user_id = e.user_id AND t.result_status = 'passed')) AS passed_quizzes,
              (SELECT COUNT(*) FROM assessments a JOIN lessons l ON l.id = a.lesson_id
                WHERE l.course_version_id = e.course_version_id AND a.is_required = 1
                  AND NOT EXISTS (SELECT 1 FROM attempts t WHERE t.assessment_id = a.id AND t.user_id = e.user_id AND t.result_status = 'passed')
                  AND EXISTS (SELECT 1 FROM attempts t WHERE t.assessment_id = a.id AND t.user_id = e.user_id AND t.result_status = 'pending_review')) AS reviewing_quizzes,
              (SELECT status FROM certificates ce WHERE ce.user_id = e.user_id AND ce.course_id = c.id) AS certificate_status
       FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = ? ORDER BY e.started_at DESC`,
    )
    .bind(userId)
    .all<{
      id: string;
      slug: string;
      title: string;
      status: string;
      expires_at: number | null;
      started_at: number;
      required_lessons: number;
      completed_lessons: number;
      required_quizzes: number;
      passed_quizzes: number;
      reviewing_quizzes: number;
      certificate_status: MyCourse['certificateStatus'];
    }>();
  return results.map(
    (r): MyCourse => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      status: r.status,
      expiresAt: r.expires_at,
      startedAt: r.started_at,
      requiredLessons: r.required_lessons,
      completedLessons: r.completed_lessons,
      requiredQuizzes: r.required_quizzes,
      passedQuizzes: r.passed_quizzes,
      reviewingQuizzes: r.reviewing_quizzes,
      certificateStatus: r.certificate_status ?? null,
    }),
  );
}
