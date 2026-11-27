import { Hono, type Context } from 'hono';
import {
  ERROR_CODES,
  accommodationSchema,
  appealResolveSchema,
  assessmentUpsertSchema,
  certificateRevokeSchema,
  courseCreateSchema,
  coursePatchSchema,
  extractYoutubeId,
  lessonUpsertSchema,
  mentorAssignSchema,
  parseContent,
  questionCreateSchema,
  questionImportSchema,
  questionSelectionSchema,
  reviewDecisionSchema,
  roleAssignSchema,
  type QuestionCreate,
} from '@patradesa/shared';
import { z } from 'zod';
import type { AppEnv, Deps } from '../env';
import { HttpError, forbidden, notFound, param, readJson } from '../lib/http';
import { newId, randomToken } from '../lib/crypto';
import { auditStmt } from '../lib/audit';
import { currentUser, hasRole, requireRole } from '../middleware/auth';
import { recomputeAfterReviewStatement, resultFromScoreStatement } from '../services/finalize';
import { createGradingDemo } from '../services/demoGrading';
import { assertScenarioKeysExist, pinScenarioStatements } from '../services/scenarios';
import { upgradeEnrollment } from '../services/enrollmentUpgrade';
import { adminImportBundleRoutes } from './admin/importBundle';
import { LESSON_FIELDS, QUIZ_FIELDS, courseLog, diffFields, draftChanges, publishProblems } from '../services/courseChanges';
import { checkStudio, integrationConfigured, integrationProblem, issueAfterAttempt, pushToStudio, revokeCertificate, type CertificateRow } from '../services/certificates';

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_COVER_BYTES = 2 * 1024 * 1024;

/** Cocokkan tanda tangan berkas (magic bytes) dengan jenis gambar yang diklaim. */
export function imageMagicMatches(head: Uint8Array, contentType: string): boolean {
  const b = (i: number) => head[i] ?? -1;
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (contentType === 'image/jpeg') return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
  if (contentType === 'image/png') return b(0) === 0x89 && ascii(1, 4) === 'PNG';
  if (contentType === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  return false;
}

async function draftLesson(db: D1Database, lessonId: string) {
  const l = await db
    .prepare(
      `SELECT l.id, l.course_version_id, cv.course_id, cv.status FROM lessons l JOIN course_versions cv ON cv.id = l.course_version_id WHERE l.id = ?`,
    )
    .bind(lessonId)
    .first<{ id: string; course_version_id: string; course_id: string; status: string }>();
  if (!l) throw notFound('Materi');
  if (l.status !== 'draft') throw new HttpError(409, ERROR_CODES.CONFLICT, 'Versi terbit tidak dapat diubah. Buat draft baru.');
  return l;
}

/** lesson_key unik per versi kelas (UNIQUE(course_version_id, lesson_key)). */
function lessonKeyConflict(err: unknown): unknown {
  if (err instanceof Error && /UNIQUE constraint failed: lessons\.course_version_id, lessons\.lesson_key/.test(err.message)) {
    return new HttpError(409, ERROR_CODES.CONFLICT, 'Kode materi sudah dipakai materi lain di versi kelas ini.');
  }
  return err;
}

async function draftAssessment(db: D1Database, assessmentId: string) {
  const a = await db.prepare('SELECT id, lesson_id FROM assessments WHERE id = ?').bind(assessmentId).first<{ id: string; lesson_id: string }>();
  if (!a) throw notFound('Kuis');
  return { ...a, lesson: await draftLesson(db, a.lesson_id) };
}

async function lessonContentFields(db: D1Database, b: z.infer<typeof lessonUpsertSchema>) {
  let youtubeId: string | null = null;
  if (b.contentType === 'youtube') {
    youtubeId = b.youtube ? extractYoutubeId(b.youtube) : null;
    if (!youtubeId) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Tautan/ID YouTube tidak valid.');
  }
  const blocks = parseContent(b.contentSource);
  await assertScenarioKeysExist(db, blocks);
  return { youtubeId, contentJson: JSON.stringify(blocks) };
}

/** Salin versi course (lesson, kuis, kebijakan, bank soal aktif + pilihan soal kuis) ke versi draft baru. */
async function cloneVersionStatements(db: D1Database, fromVersionId: string, toVersionId: string, now: number) {
  const stmts: D1PreparedStatement[] = [];
  const { results: lessons } = await db.prepare('SELECT * FROM lessons WHERE course_version_id = ?').bind(fromVersionId).all<Record<string, unknown>>();
  for (const l of lessons) {
    const lid = newId();
    stmts.push(
      db
        .prepare(
          `INSERT INTO lessons (id, course_version_id, lesson_key, seq, title, summary, content_type, content_source, content_json, file_key, youtube_id, required_active_seconds, is_required)
           SELECT ?, ?, lesson_key, seq, title, summary, content_type, content_source, content_json, file_key, youtube_id, required_active_seconds, is_required FROM lessons WHERE id = ?`,
        )
        .bind(lid, toVersionId, l.id as string),
    );
    const a = await db.prepare('SELECT id FROM assessments WHERE lesson_id = ?').bind(l.id as string).first<{ id: string }>();
    if (!a) continue;
    const aid = newId();
    stmts.push(
      db
        .prepare(
          `INSERT INTO assessments (id, lesson_id, title, instructions, time_limit_seconds, passing_score_pct, max_attempts, cooldown_seconds, mcq_count, essay_count, grace_seconds, is_required, review_policy, version, created_at)
           SELECT ?, ?, title, instructions, time_limit_seconds, passing_score_pct, max_attempts, cooldown_seconds, mcq_count, essay_count, grace_seconds, is_required, review_policy, version + 1, ? FROM assessments WHERE id = ?`,
        )
        .bind(aid, lid, now, a.id),
      db
        .prepare(
          `INSERT INTO assessment_policies (assessment_id, version, exam_copy_deterrence_enabled, ai_lock_enabled, accessibility_exemption_policy, hide_lesson_links_during_exam, updated_at)
           SELECT ?, version + 1, exam_copy_deterrence_enabled, 1, accessibility_exemption_policy, hide_lesson_links_during_exam, ? FROM assessment_policies WHERE assessment_id = ?`,
        )
        .bind(aid, now, a.id),
    );
    const { results: qs } = await db.prepare('SELECT id FROM questions WHERE assessment_id = ? AND is_active = 1').bind(a.id).all<{ id: string }>();
    for (const q of qs) {
      const qid = newId();
      stmts.push(
        db
          .prepare(
            `INSERT INTO questions (id, assessment_id, type, stem, difficulty, topic, points, version, rubric_json, model_answer, explanation, is_active, in_quiz, created_at)
             SELECT ?, ?, type, stem, difficulty, topic, points, version, rubric_json, model_answer, explanation, 1, in_quiz, ? FROM questions WHERE id = ?`,
          )
          .bind(qid, aid, now, q.id),
        db
          .prepare(
            `INSERT INTO question_options (id, question_id, body, is_correct, version)
             SELECT lower(hex(randomblob(16))), ?, body, is_correct, version FROM question_options WHERE question_id = ?`,
          )
          .bind(qid, q.id),
      );
    }
  }
  return stmts;
}

async function canReviewCourse(c: Context<AppEnv>, courseId: string): Promise<boolean> {
  if (hasRole(c, 'admin')) return true;
  const u = currentUser(c);
  const m = await c.env.DB.prepare('SELECT 1 AS x FROM mentor_assignments WHERE mentor_id = ? AND course_id = ?').bind(u.id, courseId).first();
  return !!m;
}

export function adminRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  const editors = requireRole('content_editor', 'admin');
  const admins = requireRole('admin');
  const reviewers = requireRole('mentor', 'admin');

  // ---------------------------------------------------------------- course
  r.get('/courses', editors, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT c.id, c.slug, c.title, c.status, c.visibility, c.current_version_id,
              (SELECT id FROM course_versions WHERE course_id = c.id AND status = 'draft') AS draft_version_id,
              (SELECT MAX(version_no) FROM course_versions WHERE course_id = c.id) AS latest_version
       FROM courses c ORDER BY c.updated_at DESC`,
    ).all();
    return c.json({ courses: results, demoAvailable: c.env.ENVIRONMENT !== 'production' });
  });

  // Kelas demo penilaian (bukan untuk produksi): peserta fiktif sudah mengumpulkan kuis, esai menunggu review admin.
  r.post('/demo/grading', admins, async (c) => {
    if (c.env.ENVIRONMENT === 'production') throw notFound('Fitur demo');
    const u = currentUser(c);
    return c.json(await createGradingDemo(c.env.DB, u.id, deps.now()), 201);
  });

  r.post('/courses', admins, async (c) => {
    const u = currentUser(c);
    const b = await readJson(c, courseCreateSchema);
    const now = deps.now();
    const id = newId();
    const vid = newId();
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO courses (id, slug, title, description, visibility, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
        ).bind(id, b.slug, b.title, b.description, b.visibility, u.id, now, now),
        c.env.DB.prepare(`INSERT INTO course_versions (id, course_id, version_no, status, created_by, created_at) VALUES (?, ?, 1, 'draft', ?, ?)`).bind(
          vid,
          id,
          u.id,
          now,
        ),
        auditStmt(c.env.DB, now, u.id, 'course.create', 'course', id, { slug: b.slug }),
      ]);
    } catch {
      throw new HttpError(409, ERROR_CODES.CONFLICT, 'Slug sudah dipakai.');
    }
    return c.json({ id, draftVersionId: vid }, 201);
  });

  r.get('/courses/:id', editors, async (c) => {
    const db = c.env.DB;
    const id = param(c, 'id');
    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').bind(id).first<Record<string, unknown>>();
    if (!course) throw notFound('Kelas');
    const { results: versions } = await db
      .prepare('SELECT id, version_no, status, published_at FROM course_versions WHERE course_id = ? ORDER BY version_no DESC')
      .bind(id)
      .all<{ id: string; version_no: number; status: string }>();
    const editing = versions.find((v) => v.status === 'draft') ?? versions.find((v) => v.id === course.current_version_id) ?? null;
    const { results: lessons } = editing
      ? await db.prepare('SELECT * FROM lessons WHERE course_version_id = ? ORDER BY seq').bind(editing.id).all<Record<string, unknown>>()
      : { results: [] as Record<string, unknown>[] };
    const outLessons = [];
    for (const l of lessons) {
      const a = await db
        .prepare(
          `SELECT a.*, p.exam_copy_deterrence_enabled, p.accessibility_exemption_policy, p.hide_lesson_links_during_exam
           FROM assessments a LEFT JOIN assessment_policies p ON p.assessment_id = a.id WHERE a.lesson_id = ?`,
        )
        .bind(l.id as string)
        .first<Record<string, unknown>>();
      let questions: unknown[] = [];
      if (a) {
        const { results: qs } = await db
          // rowid = urutan penyisipan (stabil untuk impor bertahap, walau created_at sama).
          .prepare('SELECT * FROM questions WHERE assessment_id = ? AND is_active = 1 ORDER BY rowid')
          .bind(a.id as string)
          .all<Record<string, unknown>>();
        // Satu query untuk semua opsi (hindari N+1: bank 65 soal = 65 query → melewati batas D1 per request).
        const { results: opts } = await db
          .prepare(
            `SELECT o.id, o.question_id, o.body, o.is_correct FROM question_options o
             JOIN questions q ON q.id = o.question_id WHERE q.assessment_id = ? AND q.is_active = 1`,
          )
          .bind(a.id as string)
          .all<{ id: string; question_id: string; body: string; is_correct: number }>();
        const byQ = new Map<string, { id: string; body: string; is_correct: number }[]>();
        for (const o of opts) {
          const list = byQ.get(o.question_id) ?? [];
          list.push({ id: o.id, body: o.body, is_correct: o.is_correct });
          byQ.set(o.question_id, list);
        }
        questions = qs.map((q) => ({ ...q, options: byQ.get(q.id as string) ?? [] }));
      }
      outLessons.push({ ...l, content_json: undefined, assessment: a ? { ...a, questions } : null });
    }
    const { results: recs } = await db.prepare('SELECT village_role FROM role_recommendations WHERE course_id = ?').bind(id).all<{ village_role: string }>();
    const { results: mentors } = await db
      .prepare('SELECT m.mentor_id, u.display_name FROM mentor_assignments m JOIN users u ON u.id = m.mentor_id WHERE m.course_id = ?')
      .bind(id)
      .all();
    const cover = await db.prepare('SELECT updated_at FROM course_covers WHERE course_id = ?').bind(id).first<{ updated_at: number }>();
    const usage = await db
      .prepare('SELECT (SELECT COUNT(*) FROM enrollments WHERE course_id = ?1) AS enrollments, (SELECT COUNT(*) FROM certificates WHERE course_id = ?1) AS certificates')
      .bind(id)
      .first<{ enrollments: number; certificates: number }>();
    return c.json({
      course,
      enrollmentCount: usage?.enrollments ?? 0,
      certificateCount: usage?.certificates ?? 0,
      versions,
      editingVersion: editing,
      lessons: outLessons,
      recommendedFor: recs.map((x) => x.village_role),
      mentors,
      coverUrl: cover ? `/api/v1/courses/${id}/cover?v=${cover.updated_at}` : null,
    });
  });

  r.patch('/courses/:id', admins, async (c) => {
    const u = currentUser(c);
    const id = param(c, 'id');
    const b = await readJson(c, coursePatchSchema);
    const now = deps.now();
    const map: Record<string, string> = {
      title: 'title',
      description: 'description',
      visibility: 'visibility',
      status: 'status',
      enrollmentOpenAt: 'enrollment_open_at',
      enrollmentCloseAt: 'enrollment_close_at',
      accessStartsAt: 'access_starts_at',
      accessExpiresAt: 'access_expires_at',
      accessDurationDays: 'access_duration_days',
      learningSessionTtlSeconds: 'learning_session_ttl_seconds',
    };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, col] of Object.entries(map)) {
      const v = (b as Record<string, unknown>)[k];
      if (v !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(v);
      }
    }
    if (b.status === 'published') {
      const cur = await c.env.DB.prepare('SELECT current_version_id FROM courses WHERE id = ?').bind(id).first<{ current_version_id: string | null }>();
      if (!cur?.current_version_id) throw new HttpError(409, ERROR_CODES.CONFLICT, 'Terbitkan versi terlebih dahulu.');
    }
    const stmts: D1PreparedStatement[] = [];
    if (sets.length) {
      stmts.push(c.env.DB.prepare(`UPDATE courses SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...vals, now, id));
    }
    if (b.recommendedFor) {
      stmts.push(c.env.DB.prepare('DELETE FROM role_recommendations WHERE course_id = ?').bind(id));
      b.recommendedFor.forEach((role, i) =>
        stmts.push(c.env.DB.prepare('INSERT INTO role_recommendations (village_role, course_id, priority) VALUES (?, ?, ?)').bind(role, id, i + 1)),
      );
    }
    stmts.push(auditStmt(c.env.DB, now, u.id, 'course.update', 'course', id, { fields: Object.keys(b).join(',') }));
    await c.env.DB.batch(stmts);
    return c.json({ ok: true });
  });

  // Arsip: kelas hilang dari katalog dan peserta tidak bisa membukanya; pendaftaran, nilai, dan sertifikat tetap tersimpan.
  r.post('/courses/:id/archive', admins, async (c) => {
    const u = currentUser(c);
    const id = param(c, 'id');
    const row = await c.env.DB.prepare('SELECT status FROM courses WHERE id = ?').bind(id).first<{ status: string }>();
    if (!row) throw notFound('Kelas');
    if (row.status === 'archived') return c.json({ ok: true, status: 'archived' });
    const now = deps.now();
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE courses SET status = 'archived', updated_at = ? WHERE id = ?`).bind(now, id),
      auditStmt(c.env.DB, now, u.id, 'course.archive', 'course', id, { from: row.status }),
    ]);
    return c.json({ ok: true, status: 'archived' });
  });

  // Pulihkan dari arsip: kembali terbit bila pernah punya versi terbit, selain itu kembali draf.
  r.post('/courses/:id/unarchive', admins, async (c) => {
    const u = currentUser(c);
    const id = param(c, 'id');
    const row = await c.env.DB.prepare('SELECT status, current_version_id FROM courses WHERE id = ?').bind(id).first<{ status: string; current_version_id: string | null }>();
    if (!row) throw notFound('Kelas');
    const to = row.current_version_id ? 'published' : 'draft';
    if (row.status !== 'archived') return c.json({ ok: true, status: row.status });
    const now = deps.now();
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE courses SET status = ?, updated_at = ? WHERE id = ?').bind(to, now, id),
      auditStmt(c.env.DB, now, u.id, 'course.unarchive', 'course', id, { to }),
    ]);
    return c.json({ ok: true, status: to });
  });

  // Hapus permanen hanya untuk kelas tanpa peserta dan tanpa sertifikat (mis. salah impor). Materi, kuis, dan soal
  // ikut terhapus lewat ON DELETE CASCADE; blok skenario tidak terikat kelas sehingga tetap ada di tab Skenario.
  r.delete('/courses/:id', admins, async (c) => {
    const u = currentUser(c);
    const id = param(c, 'id');
    const db = c.env.DB;
    const course = await db.prepare('SELECT title, slug FROM courses WHERE id = ?').bind(id).first<{ title: string; slug: string }>();
    if (!course) throw notFound('Kelas');
    const usage = await db
      .prepare('SELECT (SELECT COUNT(*) FROM enrollments WHERE course_id = ?1) AS enrollments, (SELECT COUNT(*) FROM certificates WHERE course_id = ?1) AS certificates')
      .bind(id)
      .first<{ enrollments: number; certificates: number }>();
    if ((usage?.enrollments ?? 0) > 0 || (usage?.certificates ?? 0) > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.CONFLICT,
        `Kelas ini punya ${usage?.enrollments ?? 0} peserta terdaftar dan ${usage?.certificates ?? 0} sertifikat. Arsipkan saja agar data belajar dan sertifikat tetap tersimpan.`,
      );
    }
    const { results: files } = await db
      .prepare(
        `SELECT file_key FROM course_covers WHERE course_id = ?1
         UNION ALL SELECT l.file_key FROM lessons l JOIN course_versions cv ON cv.id = l.course_version_id WHERE cv.course_id = ?1 AND l.file_key IS NOT NULL`,
      )
      .bind(id)
      .all<{ file_key: string }>();
    const now = deps.now();
    await db.batch([
      db.prepare('DELETE FROM courses WHERE id = ?').bind(id),
      auditStmt(db, now, u.id, 'course.delete', 'course', id, { title: course.title.slice(0, 160), slug: course.slug }),
    ]);
    for (const f of files) await c.env.FILES.delete(f.file_key).catch(() => {});
    return c.json({ ok: true });
  });

  // Foto sampul kelas: JPG/PNG/WebP ≤ 2 MB, diverifikasi lewat magic bytes, disimpan di R2 privat.
  r.put('/courses/:id/cover', editors, async (c) => {
    const u = currentUser(c);
    const id = param(c, 'id');
    const course = await c.env.DB.prepare('SELECT id FROM courses WHERE id = ?').bind(id).first<{ id: string }>();
    if (!course) throw notFound('Kelas');
    const ct = (c.req.header('content-type') ?? '').split(';')[0]!.trim();
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[ct];
    if (!ext) throw new HttpError(415, ERROR_CODES.VALIDATION, 'Gunakan gambar JPG, PNG, atau WebP.');
    if (Number(c.req.header('content-length') ?? '0') > MAX_COVER_BYTES) throw new HttpError(413, ERROR_CODES.VALIDATION, 'Gambar melebihi 2 MB.');
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength > MAX_COVER_BYTES || buf.byteLength < 12) throw new HttpError(413, ERROR_CODES.VALIDATION, 'Ukuran gambar tidak valid.');
    if (!imageMagicMatches(new Uint8Array(buf, 0, 12), ct)) throw new HttpError(415, ERROR_CODES.VALIDATION, 'Isi berkas tidak sesuai jenis gambar.');
    const now = deps.now();
    const old = await c.env.DB.prepare('SELECT file_key FROM course_covers WHERE course_id = ?').bind(id).first<{ file_key: string }>();
    const key = `covers/${id}/${randomToken(16)}.${ext}`;
    await c.env.FILES.put(key, buf, { httpMetadata: { contentType: ct } });
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO course_covers (course_id, file_key, content_type, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (course_id) DO UPDATE SET file_key = excluded.file_key, content_type = excluded.content_type,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      ).bind(id, key, ct, u.id, now),
      auditStmt(c.env.DB, now, u.id, 'course.cover', 'course', id, { bytes: buf.byteLength }),
    ]);
    if (old) await c.env.FILES.delete(old.file_key).catch(() => {});
    return c.json({ ok: true, coverUrl: `/api/v1/courses/${id}/cover?v=${now}` });
  });

  r.delete('/courses/:id/cover', editors, async (c) => {
    const u = currentUser(c);
    const id = param(c, 'id');
    const old = await c.env.DB.prepare('SELECT file_key FROM course_covers WHERE course_id = ?').bind(id).first<{ file_key: string }>();
    if (!old) return c.json({ ok: true });
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM course_covers WHERE course_id = ?').bind(id),
      auditStmt(c.env.DB, deps.now(), u.id, 'course.cover_delete', 'course', id),
    ]);
    await c.env.FILES.delete(old.file_key).catch(() => {});
    return c.json({ ok: true });
  });

  r.post('/courses/:id/draft', editors, async (c) => {
    const u = currentUser(c);
    const id = param(c, 'id');
    const now = deps.now();
    const course = await c.env.DB.prepare('SELECT current_version_id FROM courses WHERE id = ?').bind(id).first<{ current_version_id: string | null }>();
    if (!course) throw notFound('Kelas');
    const existing = await c.env.DB.prepare(`SELECT id FROM course_versions WHERE course_id = ? AND status = 'draft'`).bind(id).first<{ id: string }>();
    if (existing) return c.json({ draftVersionId: existing.id });
    const max = await c.env.DB.prepare('SELECT MAX(version_no) AS v FROM course_versions WHERE course_id = ?').bind(id).first<{ v: number }>();
    const vid = newId();
    const stmts = [
      c.env.DB.prepare(`INSERT INTO course_versions (id, course_id, version_no, status, created_by, created_at) VALUES (?, ?, ?, 'draft', ?, ?)`).bind(
        vid,
        id,
        (max?.v ?? 0) + 1,
        u.id,
        now,
      ),
    ];
    if (course.current_version_id) stmts.push(...(await cloneVersionStatements(c.env.DB, course.current_version_id, vid, now)));
    stmts.push(auditStmt(c.env.DB, now, u.id, 'course.draft', 'course', id, { versionId: vid, versionNo: (max?.v ?? 0) + 1 }));
    await c.env.DB.batch(stmts);
    return c.json({ draftVersionId: vid }, 201);
  });

  // Publish: hanya admin. Versi terbit immutable; peserta lama tetap terikat ke versinya.
  r.post('/courses/:id/publish', admins, async (c) => {
    const u = currentUser(c);
    const id = param(c, 'id');
    const now = deps.now();
    const draft = await c.env.DB.prepare(`SELECT id FROM course_versions WHERE course_id = ? AND status = 'draft'`).bind(id).first<{ id: string }>();
    if (!draft) throw new HttpError(409, ERROR_CODES.CONFLICT, 'Tidak ada draft untuk diterbitkan.');
    const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM lessons WHERE course_version_id = ?').bind(draft.id).first<{ n: number }>();
    if (!n?.n) throw new HttpError(409, ERROR_CODES.CONFLICT, 'Draft belum memiliki materi.');
    const problems = await publishProblems(c.env.DB, draft.id);
    if (problems.length) throw new HttpError(409, ERROR_CODES.CONFLICT, problems[0]!, problems);
    const vno = await c.env.DB.prepare('SELECT version_no FROM course_versions WHERE id = ?').bind(draft.id).first<{ version_no: number }>();
    // Blok skenario dipin ke versi published terbarunya (ADR-0008); gagal bila ada yang belum terbit.
    const pins = await pinScenarioStatements(c.env.DB, draft.id);
    await c.env.DB.batch([
      ...pins,
      c.env.DB.prepare(`UPDATE course_versions SET status = 'superseded' WHERE course_id = ? AND status = 'published'`).bind(id),
      c.env.DB.prepare(`UPDATE course_versions SET status = 'published', published_at = ?, published_by = ? WHERE id = ?`).bind(now, u.id, draft.id),
      c.env.DB.prepare(`UPDATE courses SET current_version_id = ?, status = 'published', updated_at = ? WHERE id = ?`).bind(draft.id, now, id),
      auditStmt(c.env.DB, now, u.id, 'course.publish', 'course', id, { versionId: draft.id, versionNo: vno?.version_no ?? null }),
    ]);
    return c.json({ ok: true, versionId: draft.id });
  });

  r.post('/courses/:id/mentors', admins, async (c) => {
    const u = currentUser(c);
    const id = param(c, 'id');
    const b = await readJson(c, mentorAssignSchema);
    const now = deps.now();
    const stmt = b.assign
      ? c.env.DB.prepare('INSERT OR IGNORE INTO mentor_assignments (mentor_id, course_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)').bind(
          b.mentorId,
          id,
          u.id,
          now,
        )
      : c.env.DB.prepare('DELETE FROM mentor_assignments WHERE mentor_id = ? AND course_id = ?').bind(b.mentorId, id);
    await c.env.DB.batch([stmt, auditStmt(c.env.DB, now, u.id, b.assign ? 'mentor.assign' : 'mentor.unassign', 'course', id, { mentorId: b.mentorId })]);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- lesson
  r.post('/courses/:id/lessons', editors, async (c) => {
    const u = currentUser(c);
    const id = param(c, 'id');
    const b = await readJson(c, lessonUpsertSchema);
    const now = deps.now();
    const draft = await c.env.DB.prepare(`SELECT id FROM course_versions WHERE course_id = ? AND status = 'draft'`).bind(id).first<{ id: string }>();
    if (!draft) throw new HttpError(409, ERROR_CODES.CONFLICT, 'Buat draft terlebih dahulu.');
    const { youtubeId, contentJson } = await lessonContentFields(c.env.DB, b);
    const seq = await c.env.DB.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM lessons WHERE course_version_id = ?').bind(draft.id).first<{ s: number }>();
    const lid = newId();
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO lessons (id, course_version_id, lesson_key, seq, title, summary, content_type, content_source, content_json, youtube_id, required_active_seconds, is_required)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(lid, draft.id, b.lessonKey ?? randomToken(8), seq?.s ?? 1, b.title, b.summary, b.contentType, b.contentSource, contentJson, youtubeId, b.requiredActiveSeconds, b.isRequired ? 1 : 0),
        auditStmt(c.env.DB, now, u.id, 'lesson.create', 'lesson', lid, { courseId: id, lessonTitle: b.title }),
      ]);
    } catch (err) {
      throw lessonKeyConflict(err);
    }
    return c.json({ id: lid }, 201);
  });

  r.put('/lessons/:id', editors, async (c) => {
    const u = currentUser(c);
    const l = await draftLesson(c.env.DB, param(c, 'id'));
    const b = await readJson(c, lessonUpsertSchema);
    const { youtubeId, contentJson } = await lessonContentFields(c.env.DB, b);
    const now = deps.now();
    const before = await c.env.DB.prepare('SELECT * FROM lessons WHERE id = ?').bind(l.id).first<Record<string, unknown>>();
    const changed = diffFields(before ?? {}, {
      title: b.title,
      summary: b.summary,
      content_type: b.contentType,
      content_source: b.contentSource,
      youtube_id: youtubeId,
      file_key: before?.file_key ?? null,
      required_active_seconds: b.requiredActiveSeconds,
      is_required: b.isRequired ? 1 : 0,
    }, LESSON_FIELDS).join('; ');
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE lessons SET title = ?, summary = ?, content_type = ?, content_source = ?, content_json = ?, youtube_id = ?, required_active_seconds = ?, is_required = ?,
             lesson_key = COALESCE(?, lesson_key) WHERE id = ?`,
        ).bind(b.title, b.summary, b.contentType, b.contentSource, contentJson, youtubeId, b.requiredActiveSeconds, b.isRequired ? 1 : 0, b.lessonKey ?? null, l.id),
        auditStmt(c.env.DB, now, u.id, 'lesson.update', 'lesson', l.id, { courseId: l.course_id, lessonTitle: b.title, changed: changed || 'tanpa perubahan' }),
      ]);
    } catch (err) {
      throw lessonKeyConflict(err);
    }
    return c.json({ ok: true });
  });

  r.delete('/lessons/:id', editors, async (c) => {
    const u = currentUser(c);
    const l = await draftLesson(c.env.DB, param(c, 'id'));
    const gone = await c.env.DB.prepare('SELECT title FROM lessons WHERE id = ?').bind(l.id).first<{ title: string }>();
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM lessons WHERE id = ?').bind(l.id),
      auditStmt(c.env.DB, deps.now(), u.id, 'lesson.delete', 'lesson', l.id, { courseId: l.course_id, lessonTitle: gone?.title ?? null }),
    ]);
    return c.json({ ok: true });
  });

  // Unggah PDF: admin/editor saja, allowlist MIME + magic bytes + batas ukuran; R2 privat.
  r.put('/lessons/:id/file', editors, async (c) => {
    const u = currentUser(c);
    const l = await draftLesson(c.env.DB, param(c, 'id'));
    if ((c.req.header('content-type') ?? '') !== 'application/pdf') throw new HttpError(415, ERROR_CODES.VALIDATION, 'Hanya berkas PDF.');
    const len = Number(c.req.header('content-length') ?? '0');
    if (len > MAX_PDF_BYTES) throw new HttpError(413, ERROR_CODES.VALIDATION, 'Berkas melebihi 20 MB.');
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength > MAX_PDF_BYTES || buf.byteLength < 8) throw new HttpError(413, ERROR_CODES.VALIDATION, 'Ukuran berkas tidak valid.');
    const head = new TextDecoder().decode(new Uint8Array(buf, 0, 5));
    if (head !== '%PDF-') throw new HttpError(415, ERROR_CODES.VALIDATION, 'Berkas bukan PDF yang valid.');
    const key = `lessons/${l.id}/${randomToken(16)}.pdf`;
    await c.env.FILES.put(key, buf, { httpMetadata: { contentType: 'application/pdf' } });
    const now = deps.now();
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE lessons SET file_key = ?, content_type = 'pdf' WHERE id = ?`).bind(key, l.id),
      auditStmt(c.env.DB, now, u.id, 'lesson.file_upload', 'lesson', l.id, { bytes: buf.byteLength }),
    ]);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- kuis & bank soal
  r.put('/lessons/:id/assessment', editors, async (c) => {
    const u = currentUser(c);
    const l = await draftLesson(c.env.DB, param(c, 'id'));
    const b = await readJson(c, assessmentUpsertSchema);
    const now = deps.now();
    const existing = await c.env.DB.prepare('SELECT * FROM assessments WHERE lesson_id = ?').bind(l.id).first<Record<string, unknown> & { id: string }>();
    const aid = existing?.id ?? newId();
    const lessonRow = await c.env.DB.prepare('SELECT title FROM lessons WHERE id = ?').bind(l.id).first<{ title: string }>();
    const quizChanged = existing
      ? diffFields(existing, {
          title: b.title,
          passing_score_pct: b.passingScorePct,
          max_attempts: b.maxAttempts,
          cooldown_seconds: b.cooldownSeconds,
          time_limit_seconds: b.timeLimitSeconds,
          mcq_count: b.mcqCount,
          essay_count: b.essayCount,
          is_required: b.isRequired ? 1 : 0,
          review_policy: b.reviewPolicy,
        }, QUIZ_FIELDS).join('; ')
      : 'kuis baru';
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO assessments (id, lesson_id, title, instructions, time_limit_seconds, passing_score_pct, max_attempts, cooldown_seconds, mcq_count, essay_count, grace_seconds, is_required, review_policy, version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT (lesson_id) DO UPDATE SET title = excluded.title, instructions = excluded.instructions,
           time_limit_seconds = excluded.time_limit_seconds, passing_score_pct = excluded.passing_score_pct, max_attempts = excluded.max_attempts,
           cooldown_seconds = excluded.cooldown_seconds, mcq_count = excluded.mcq_count, essay_count = excluded.essay_count,
           grace_seconds = excluded.grace_seconds, is_required = excluded.is_required, review_policy = excluded.review_policy, version = assessments.version + 1`,
      ).bind(aid, l.id, b.title, b.instructions, b.timeLimitSeconds, b.passingScorePct, b.maxAttempts, b.cooldownSeconds, b.mcqCount, b.essayCount, b.graceSeconds, b.isRequired ? 1 : 0, b.reviewPolicy, now),
      c.env.DB.prepare(
        `INSERT INTO assessment_policies (assessment_id, version, exam_copy_deterrence_enabled, ai_lock_enabled, accessibility_exemption_policy, hide_lesson_links_during_exam, updated_at)
         VALUES (?, 1, ?, 1, ?, ?, ?)
         ON CONFLICT (assessment_id) DO UPDATE SET version = assessment_policies.version + 1,
           exam_copy_deterrence_enabled = excluded.exam_copy_deterrence_enabled, accessibility_exemption_policy = excluded.accessibility_exemption_policy,
           hide_lesson_links_during_exam = excluded.hide_lesson_links_during_exam, updated_at = excluded.updated_at`,
      ).bind(aid, b.examCopyDeterrenceEnabled ? 1 : 0, b.accessibilityExemptionPolicy, b.hideLessonLinksDuringExam ? 1 : 0, now),
      auditStmt(c.env.DB, now, u.id, 'assessment.upsert', 'assessment', aid, { courseId: l.course_id, lessonTitle: lessonRow?.title ?? null, changed: quizChanged || 'tanpa perubahan' }),
    ]);
    return c.json({ id: aid });
  });

  /**
   * Hapus kuis dari materi di DRAFT (mis. kuis kosong yang tidak sengaja dibuat). Soal, opsi, dan kebijakan
   * ikut terhapus (ON DELETE CASCADE). Versi terbit tidak dapat diubah; kuis yang sudah punya percobaan ditolak.
   */
  r.delete('/lessons/:id/assessment', editors, async (c) => {
    const u = currentUser(c);
    const l = await draftLesson(c.env.DB, param(c, 'id'));
    const a = await c.env.DB.prepare('SELECT id FROM assessments WHERE lesson_id = ?').bind(l.id).first<{ id: string }>();
    if (!a) throw notFound('Kuis');
    const used = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM attempts WHERE assessment_id = ?').bind(a.id).first<{ n: number }>();
    if (used?.n) throw new HttpError(409, ERROR_CODES.CONFLICT, 'Kuis ini sudah pernah dikerjakan peserta sehingga tidak dapat dihapus.');
    const q = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM questions WHERE assessment_id = ?').bind(a.id).first<{ n: number }>();
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM assessments WHERE id = ?').bind(a.id),
      auditStmt(c.env.DB, deps.now(), u.id, 'assessment.delete', 'assessment', a.id, { courseId: l.course_id, lessonId: l.id, questions: q?.n ?? 0 }),
    ]);
    return c.json({ ok: true });
  });

  /** Statement INSERT untuk satu soal (+ opsi). `createdAt` dibedakan per soal agar urutan impor terjaga. */
  function questionInsertStatements(db: D1Database, assessmentId: string, b: QuestionCreate, createdAt: number) {
    const qid = newId();
    const stmts = [
      db
        .prepare(
          `INSERT INTO questions (id, assessment_id, type, stem, difficulty, topic, points, version, rubric_json, model_answer, explanation, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1, ?)`,
        )
        .bind(
          qid,
          assessmentId,
          b.type,
          b.stem,
          b.difficulty,
          b.topic,
          b.points,
          b.type === 'essay' ? JSON.stringify(b.rubric) : null,
          b.type === 'essay' ? b.modelAnswer : null,
          b.type === 'mcq' ? (b.explanation ?? null) : null,
          createdAt,
        ),
    ];
    if (b.type === 'mcq') {
      for (const o of b.options) {
        stmts.push(
          db.prepare('INSERT INTO question_options (id, question_id, body, is_correct, version) VALUES (?, ?, ?, ?, 1)').bind(newId(), qid, o.body, o.isCorrect ? 1 : 0),
        );
      }
    }
    return { qid, stmts };
  }

  r.post('/assessments/:id/questions', editors, async (c) => {
    const u = currentUser(c);
    const a = await draftAssessment(c.env.DB, param(c, 'id'));
    const b = await readJson(c, questionCreateSchema);
    const now = deps.now();
    const { qid, stmts } = questionInsertStatements(c.env.DB, a.id, b, now);
    stmts.push(auditStmt(c.env.DB, now, u.id, 'question.create', 'question', qid, { type: b.type }));
    await c.env.DB.batch(stmts);
    return c.json({ id: qid }, 201);
  });

  // Impor bank soal per potongan kecil (lihat QUESTION_IMPORT_CHUNK). Semua soal divalidasi
  // dulu oleh skema; satu potongan disimpan dalam satu batch (atomik: semua atau tidak sama sekali).
  r.post('/assessments/:id/questions/import', editors, async (c) => {
    const u = currentUser(c);
    const a = await draftAssessment(c.env.DB, param(c, 'id'));
    const b = await readJson(c, questionImportSchema);
    const now = deps.now();
    const stmts: D1PreparedStatement[] = [];
    b.questions.forEach((q, i) => stmts.push(...questionInsertStatements(c.env.DB, a.id, q, now + i).stmts));
    const mcq = b.questions.filter((q) => q.type === 'mcq').length;
    stmts.push(
      auditStmt(c.env.DB, now, u.id, 'question.import', 'assessment', a.id, { count: b.questions.length, mcq, essay: b.questions.length - mcq }),
    );
    await c.env.DB.batch(stmts);
    return c.json({ imported: b.questions.length }, 201);
  });

  // Pilih soal bank yang dipakai kuis (daftar lengkap). Hanya di draft; versi terbit tetap.
  r.post('/assessments/:id/questions/selection', editors, async (c) => {
    const u = currentUser(c);
    const a = await draftAssessment(c.env.DB, param(c, 'id'));
    const b = await readJson(c, questionSelectionSchema);
    const now = deps.now();
    const ids = JSON.stringify([...new Set(b.ids)]);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE questions SET in_quiz = CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END WHERE assessment_id = ? AND is_active = 1`,
      ).bind(ids, a.id),
      auditStmt(c.env.DB, now, u.id, 'question.select', 'assessment', a.id, { selected: b.ids.length }),
    ]);
    const counts = await c.env.DB.prepare(
      `SELECT SUM(type = 'mcq' AND in_quiz = 1) AS mcq, SUM(type = 'essay' AND in_quiz = 1) AS essay FROM questions WHERE assessment_id = ? AND is_active = 1`,
    )
      .bind(a.id)
      .first<{ mcq: number | null; essay: number | null }>();
    return c.json({ mcq: counts?.mcq ?? 0, essay: counts?.essay ?? 0 });
  });

  r.delete('/questions/:id', editors, async (c) => {
    const u = currentUser(c);
    const q = await c.env.DB.prepare('SELECT id, assessment_id FROM questions WHERE id = ?').bind(param(c, 'id')).first<{ id: string; assessment_id: string }>();
    if (!q) throw notFound('Soal');
    await draftAssessment(c.env.DB, q.assessment_id);
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE questions SET is_active = 0 WHERE id = ?').bind(q.id),
      auditStmt(c.env.DB, deps.now(), u.id, 'question.deactivate', 'question', q.id),
    ]);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- review esai (manusia)
  r.get('/reviews', reviewers, async (c) => {
    const u = currentUser(c);
    const all = hasRole(c, 'admin');
    // Review buta: nama peserta tidak ditampilkan untuk mengurangi bias.
    const { results } = await c.env.DB.prepare(
      `SELECT ans.id AS answer_id, ans.essay_text, ans.graded_at, aq.stem_snapshot, aq.points, q.rubric_json, q.model_answer,
              at.id AS attempt_id, at.finalized_at, cv.course_id, a.title AS assessment_title
       FROM answers ans
       JOIN attempt_questions aq ON aq.id = ans.attempt_question_id AND aq.type = 'essay'
       JOIN questions q ON q.id = aq.question_id
       JOIN attempts at ON at.id = ans.attempt_id AND at.status IN ('submitted','expired')
       JOIN assessments a ON a.id = at.assessment_id
       JOIN lessons l ON l.id = a.lesson_id
       JOIN course_versions cv ON cv.id = l.course_version_id
       WHERE ans.graded_at IS NULL
         AND (? = 1 OR cv.course_id IN (SELECT course_id FROM mentor_assignments WHERE mentor_id = ?))
       ORDER BY at.finalized_at LIMIT 100`,
    )
      .bind(all ? 1 : 0, u.id)
      .all();
    return c.json({ reviews: results });
  });

  r.post('/reviews/:answerId/decision', reviewers, async (c) => {
    const u = currentUser(c);
    const answerId = param(c, 'answerId');
    const b = await readJson(c, reviewDecisionSchema);
    const row = await c.env.DB.prepare(
      `SELECT ans.id, ans.attempt_id, ans.graded_at, aq.points, q.rubric_json, cv.course_id, at.status
       FROM answers ans JOIN attempt_questions aq ON aq.id = ans.attempt_question_id AND aq.type = 'essay'
       JOIN questions q ON q.id = aq.question_id JOIN attempts at ON at.id = ans.attempt_id
       JOIN assessments a ON a.id = at.assessment_id JOIN lessons l ON l.id = a.lesson_id JOIN course_versions cv ON cv.id = l.course_version_id
       WHERE ans.id = ?`,
    )
      .bind(answerId)
      .first<{ id: string; attempt_id: string; graded_at: number | null; points: number; rubric_json: string | null; course_id: string; status: string }>();
    if (!row) throw notFound('Jawaban');
    if (!(await canReviewCourse(c, row.course_id))) throw forbidden();
    if (row.status !== 'submitted' && row.status !== 'expired') throw new HttpError(409, ERROR_CODES.CONFLICT, 'Kuis belum final.');
    if (row.graded_at && b.reason.length < 5) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Override nilai wajib menyertakan alasan.');
    const rubric = JSON.parse(row.rubric_json ?? '[]') as { criterion: string; maxScore: number }[];
    let total = 0;
    let max = 0;
    for (const crit of rubric) {
      const s = b.rubricScores.find((x) => x.criterion === crit.criterion);
      if (!s || s.score > crit.maxScore) throw new HttpError(400, ERROR_CODES.VALIDATION, `Skor kriteria "${crit.criterion}" tidak valid.`);
      total += s.score;
      max += crit.maxScore;
    }
    const score = max > 0 ? Math.round((total / max) * row.points) : 0;
    const now = deps.now();
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE answers SET essay_score = ?, essay_feedback = ?, graded_by = ?, graded_at = ? WHERE id = ?').bind(score, b.feedback, u.id, now, row.id),
      c.env.DB.prepare(
        'INSERT INTO essay_reviews (id, answer_id, reviewer_id, rubric_scores_json, score, feedback, reason, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(newId(), row.id, u.id, JSON.stringify(b.rubricScores), score, b.feedback, b.reason, now),
      // Override setelah hasil final: kembalikan ke pending_review agar dihitung ulang.
      c.env.DB.prepare(`UPDATE attempts SET result_status = 'pending_review' WHERE id = ? AND ? = 1`).bind(row.attempt_id, row.graded_at ? 1 : 0),
      recomputeAfterReviewStatement(c.env.DB, row.attempt_id),
      resultFromScoreStatement(c.env.DB, row.attempt_id),
      auditStmt(c.env.DB, now, u.id, row.graded_at ? 'essay.override' : 'essay.grade', 'answer', row.id, { score, attemptId: row.attempt_id }),
    ]);
    // Semua esai sudah dinilai dan hasil LULUS → sertifikat diterbitkan (idempoten).
    await issueAfterAttempt(c.env, deps.fetch, row.attempt_id, now);
    return c.json({ ok: true, score });
  });

  // ---------------------------------------------------------------- banding
  r.get('/appeals', reviewers, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT ap.id, ap.attempt_id, ap.reason, ap.status, ap.created_at, at.result_status, at.final_score_pct
       FROM appeals ap JOIN attempts at ON at.id = ap.attempt_id ORDER BY ap.status = 'open' DESC, ap.created_at DESC LIMIT 100`,
    ).all();
    return c.json({ appeals: results });
  });

  r.post('/appeals/:id', reviewers, async (c) => {
    const u = currentUser(c);
    const id = param(c, 'id');
    const b = await readJson(c, appealResolveSchema);
    const now = deps.now();
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE appeals SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'open'`).bind(
        b.status,
        b.resolution,
        u.id,
        now,
        id,
      ),
      auditStmt(c.env.DB, now, u.id, 'appeal.resolve', 'appeal', id, { status: b.status }),
    ]);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- attempt admin
  r.post('/attempts/:id/void', admins, async (c) => {
    const u = currentUser(c);
    const id = param(c, 'id');
    const b = await readJson(c, z.object({ reason: z.string().trim().min(5).max(500) }).strict());
    const now = deps.now();
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE attempts SET status = 'voided', finalized_at = COALESCE(finalized_at, ?) WHERE id = ?`).bind(now, id),
      auditStmt(c.env.DB, now, u.id, 'attempt.void', 'attempt', id, { reasonLength: b.reason.length }),
    ]);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- user & akomodasi
  r.get('/users', reviewers, async (c) => {
    const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 100);
    const isAdmin = hasRole(c, 'admin');
    const { results } = await c.env.DB.prepare(
      `SELECT u.id, u.display_name, CASE WHEN ? = 1 THEN u.email_normalized ELSE NULL END AS email, u.status,
              (SELECT group_concat(role) FROM system_roles r WHERE r.user_id = u.id) AS roles,
              COALESCE(acc.copy_deterrence_exempt, 0) AS copy_deterrence_exempt
       FROM users u LEFT JOIN user_accommodations acc ON acc.user_id = u.id
       WHERE ? = '' OR u.email_normalized LIKE ? OR lower(u.display_name) LIKE ?
       ORDER BY u.created_at DESC LIMIT 200`,
    )
      .bind(isAdmin ? 1 : 0, q, `%${q}%`, `%${q}%`)
      .all();
    return c.json({ users: results });
  });

  // Eskalasi dibatasi: hanya super_admin yang dapat memberi/mencabut admin & super_admin.
  r.post('/users/:id/roles', admins, async (c) => {
    const u = currentUser(c);
    const id = param(c, 'id');
    const b = await readJson(c, roleAssignSchema);
    if ((b.role === 'admin' || b.role === 'super_admin') && !u.roles.includes('super_admin')) throw forbidden('Hanya super admin.');
    if (id === u.id && !b.grant) throw new HttpError(409, ERROR_CODES.CONFLICT, 'Tidak dapat mencabut role sendiri.');
    const now = deps.now();
    await c.env.DB.batch([
      b.grant
        ? c.env.DB.prepare('INSERT OR IGNORE INTO system_roles (user_id, role, assigned_by, assigned_at) VALUES (?, ?, ?, ?)').bind(id, b.role, u.id, now)
        : c.env.DB.prepare('DELETE FROM system_roles WHERE user_id = ? AND role = ?').bind(id, b.role),
      // Perubahan role: cabut sesi target agar hak baru berlaku segera.
      c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, id),
      auditStmt(c.env.DB, now, u.id, b.grant ? 'role.grant' : 'role.revoke', 'user', id, { role: b.role }),
    ]);
    return c.json({ ok: true });
  });

  r.put('/users/:id/accommodation', reviewers, async (c) => {
    const u = currentUser(c);
    const id = param(c, 'id');
    const b = await readJson(c, accommodationSchema);
    const now = deps.now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO user_accommodations (user_id, copy_deterrence_exempt, note, set_by, set_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET copy_deterrence_exempt = excluded.copy_deterrence_exempt, note = excluded.note, set_by = excluded.set_by, set_at = excluded.set_at`,
      ).bind(id, b.copyDeterrenceExempt ? 1 : 0, b.note, u.id, now),
      auditStmt(c.env.DB, now, u.id, 'accommodation.set', 'user', id, { copyDeterrenceExempt: b.copyDeterrenceExempt }),
    ]);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- laporan & audit
  r.get('/reports/:courseId', admins, async (c) => {
    const id = param(c, 'courseId');
    const { results } = await c.env.DB.prepare(
      `SELECT u.id AS user_id, u.display_name, e.status AS enrollment_status, e.started_at,
              (SELECT version_no FROM course_versions WHERE id = e.course_version_id) AS version_no,
              (SELECT cv.version_no FROM courses c JOIN course_versions cv ON cv.id = c.current_version_id WHERE c.id = e.course_id) AS current_version_no,
              (SELECT COUNT(*) FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id
                WHERE p.user_id = e.user_id AND l.course_version_id = e.course_version_id AND p.completed_at IS NOT NULL) AS lessons_completed,
              (SELECT COUNT(*) FROM lessons l WHERE l.course_version_id = e.course_version_id) AS lessons_total,
              (SELECT COUNT(*) FROM attempts at WHERE at.enrollment_id = e.id AND at.status <> 'voided') AS attempts,
              (SELECT MAX(final_score_pct) FROM attempts at WHERE at.enrollment_id = e.id) AS best_score,
              (SELECT COUNT(*) FROM attempts at WHERE at.enrollment_id = e.id AND at.result_status = 'passed') AS passed_attempts
       FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = ? ORDER BY u.display_name LIMIT 500`,
    )
      .bind(id)
      .all();
    return c.json({ learners: results });
  });

  /** Admin memindahkan satu peserta ke versi kelas terbaru (aturan sama dengan tombol peserta). */
  r.post('/courses/:id/enrollments/:userId/upgrade', admins, async (c) => {
    const u = currentUser(c);
    return c.json(await upgradeEnrollment(c.env.DB, param(c, 'userId'), param(c, 'id'), u.id, deps.now()));
  });

  /** Ringkasan perubahan draf terhadap versi terbit (untuk konfirmasi terbit). */
  r.get('/courses/:id/changes', editors, async (c) => {
    const id = param(c, 'id');
    const course = await c.env.DB.prepare('SELECT id FROM courses WHERE id = ?').bind(id).first();
    if (!course) throw notFound('Kelas');
    const ch = await draftChanges(c.env.DB, id);
    return c.json({ ...ch, problems: ch.draftVersionId ? await publishProblems(c.env.DB, ch.draftVersionId) : [] });
  });

  /** Log perubahan satu kelas (siapa, kapan, apa). */
  r.get('/courses/:id/log', editors, async (c) => {
    const id = param(c, 'id');
    const course = await c.env.DB.prepare('SELECT id FROM courses WHERE id = ?').bind(id).first();
    if (!course) throw notFound('Kelas');
    return c.json({ log: await courseLog(c.env.DB, id) });
  });

  r.get('/audit', admins, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT l.id, l.action, l.target_type, l.target_id, l.created_at, l.metadata_redacted, u.display_name AS actor
       FROM admin_audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id ORDER BY l.created_at DESC LIMIT 200`,
    ).all();
    return c.json({ logs: results });
  });

  // ---------------------------------------------------------------- sertifikat (via Sertifikat Studio)
  r.get('/certificates', admins, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT ce.id, ce.status, ce.recipient_name, ce.course_title, ce.final_score_pct, ce.completed_at, ce.certificate_no,
              ce.verification_code, ce.verify_url, ce.issued_at, ce.sync_attempts, ce.next_retry_at, ce.last_error,
              ce.revoked_at, ce.revoked_reason, u.email_normalized AS email
       FROM certificates ce JOIN users u ON u.id = ce.user_id ORDER BY ce.completed_at DESC LIMIT 200`,
    ).all();
    return c.json({ certificates: results, integrationConfigured: integrationConfigured(c.env), integrationProblem: integrationProblem(c.env), studioUrl: c.env.SERTIFIKAT_BASE_URL ?? null });
  });

  r.post('/certificates/:id/retry', admins, async (c) => {
    const u = currentUser(c);
    const now = deps.now();
    const row = await c.env.DB.prepare('SELECT * FROM certificates WHERE id = ?').bind(param(c, 'id')).first<CertificateRow>();
    if (!row) throw notFound('Sertifikat');
    if (row.status !== 'pending') throw new HttpError(409, ERROR_CODES.CONFLICT, 'Sertifikat ini tidak sedang menunggu penerbitan.');
    const out = await pushToStudio(c.env, deps.fetch, row, now);
    await auditStmt(c.env.DB, now, u.id, 'certificate.retry', 'certificate', row.id, { issued: out.status === 'issued' }).run();
    return c.json({ status: out.status, lastError: out.last_error, certificateNo: out.certificate_no });
  });

  // Uji koneksi LMS → Sertifikat Studio (tanpa mengubah data di Studio).
  r.post('/certificates/studio-check', admins, async (c) => c.json(await checkStudio(c.env, deps.fetch, deps.now())));

  r.post('/certificates/:id/revoke', admins, async (c) => {
    const u = currentUser(c);
    const now = deps.now();
    const b = await readJson(c, certificateRevokeSchema);
    const out = await revokeCertificate(c.env, deps.fetch, param(c, 'id'), u.id, b.reason, now);
    await auditStmt(c.env.DB, now, u.id, 'certificate.revoke', 'certificate', out.id).run();
    return c.json({ status: out.status });
  });

  // Impor paket kelas: validasi + rencana (impor bertahap dijalankan halaman admin).
  r.route('/', adminImportBundleRoutes());

  return r;
}
