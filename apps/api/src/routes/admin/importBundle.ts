import { Hono } from 'hono';
import { CourseBundleSchema } from '@patradesa/shared';
// Sesuaikan import di bawah dengan nama fungsi parser konten yang ada di packages/shared/src/content.ts:
// import { parseContent } from '@patradesa/shared';

export const adminImportBundleRoute = new Hono<{ Bindings: Env; Variables: AppVariables }>();

adminImportBundleRoute.post('/courses/import-bundle', async (c) => {
  const user = c.get('user');
  if (!user || !['admin', 'super_admin', 'content_editor'].includes(user.role)) {
    return c.json({ error: 'FORBIDDEN', message: 'Hak akses tidak mencukupi.' }, 403);
  }

  const rawBody = await c.req.json().catch(() => null);
  const parsed = CourseBundleSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: 'VALIDATION_ERROR',
        message: 'Format paket-kelas.json tidak valid.',
        issues: parsed.error.issues,
      },
      400
    );
  }

  const bundle = parsed.data;
  const db = c.env.DB;
  const now = Date.now(); // INTEGER epoch milidetik sesuai konvensi D1

  // 1. Cek slug kelas belum terpakai
  const existingCourse = await db
    .prepare('SELECT id FROM courses WHERE slug = ?1')
    .bind(bundle.course.slug)
    .first();

  if (existingCourse) {
    return c.json(
      {
        error: 'SLUG_EXISTS',
        message: `Slug kelas "${bundle.course.slug}" sudah ada. Gunakan pembaruan versi kelas.`,
      },
      409
    );
  }

  // 2. Cek tidak ada block_key skenario yang sedang berstatus draft/in_review (ux_scenario_blocks_one_editable)
  for (const scen of bundle.scenarios) {
    const conflictScen = await db
      .prepare(
        `SELECT id FROM scenario_blocks WHERE block_key = ?1 AND status IN ('draft', 'in_review')`
      )
      .bind(scen.id)
      .first();

    if (conflictScen) {
      return c.json(
        {
          error: 'SCENARIO_DRAFT_EXISTS',
          message: `Skenario "${scen.id}" masih memiliki draf aktif di sistem.`,
        },
        409
      );
    }
  }

  const courseId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];

  // 3. Insert courses & course_versions (status selalu 'draft')
  statements.push(
    db
      .prepare(
        `INSERT INTO courses (id, slug, title, description, visibility, status, current_version_id, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'draft', ?6, ?7, ?8, ?8)`
      )
      .bind(
        courseId,
        bundle.course.slug,
        bundle.course.title,
        bundle.course.description,
        bundle.course.visibility,
        versionId,
        user.id,
        now
      )
  );

  statements.push(
    db
      .prepare(
        `INSERT INTO course_versions (id, course_id, version_no, status, created_by, created_at)
         VALUES (?1, ?2, 1, 'draft', ?3, ?4)`
      )
      .bind(versionId, courseId, user.id, now)
  );

  // 4. Insert role_recommendations (jika targetRoles diisi)
  bundle.course.targetRoles.forEach((role, idx) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO role_recommendations (village_role, course_id, priority)
           VALUES (?1, ?2, ?3)`
        )
        .bind(role, courseId, idx + 1)
    );
  });

  // 5. Insert scenario_blocks (status 'draft', menunggu penelaah substansi)
  for (const scen of bundle.scenarios) {
    // Cek versi tertinggi sebelumnya jika block_key pernah terbit
    const prev = await db
      .prepare('SELECT COALESCE(MAX(version), 0) AS max_ver FROM scenario_blocks WHERE block_key = ?1')
      .bind(scen.id)
      .first<{ max_ver: number }>();

    const nextVersion = (prev?.max_ver ?? 0) + 1;
    const scenarioBlockId = crypto.randomUUID();

    statements.push(
      db
        .prepare(
          `INSERT INTO scenario_blocks (
            id, block_key, version, status, mode, title, max_attempts, pass_percent, max_score,
            definition_json, valid_from, created_by, created_at, updated_at
          ) VALUES (?1, ?2, ?3, 'draft', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)`
        )
        .bind(
          scenarioBlockId,
          scen.id,
          nextVersion,
          scen.mode,
          scen.title,
          scen.maxAttempts,
          scen.passPercent,
          scen.maxScore,
          JSON.stringify(scen),
          scen.validFrom,
          user.id,
          now
        )
    );
  }

  // 6. Insert lessons, assessments, assessment_policies, questions, dan question_options
  bundle.lessons.forEach((lesson, lessonIdx) => {
    const lessonId = crypto.randomUUID();
    // Jika ingin langsung mengurai content_json di server, panggil parser dari @patradesa/shared:
    // const contentJson = JSON.stringify(parseContent(lesson.contentSource));
    const contentJson = '[]';

    statements.push(
      db
        .prepare(
          `INSERT INTO lessons (
            id, course_version_id, lesson_key, seq, title, summary, content_type,
            content_source, content_json, required_active_seconds, is_required
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
        )
        .bind(
          lessonId,
          versionId,
          lesson.lessonKey,
          lessonIdx + 1,
          lesson.title,
          lesson.summary,
          lesson.contentType,
          lesson.contentSource,
          contentJson,
          lesson.requiredActiveSeconds,
          lesson.isRequired ? 1 : 0
        )
    );

    if (lesson.quiz) {
      const assessmentId = crypto.randomUUID();

      statements.push(
        db
          .prepare(
            `INSERT INTO assessments (
              id, lesson_id, title, instructions, time_limit_seconds, passing_score_pct,
              max_attempts, cooldown_seconds, mcq_count, essay_count, is_required, review_policy, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
          )
          .bind(
            assessmentId,
            lessonId,
            lesson.quiz.title,
            lesson.quiz.instructions,
            lesson.quiz.timeLimitSeconds,
            lesson.quiz.passingScorePct,
            lesson.quiz.maxAttempts,
            lesson.quiz.cooldownSeconds,
            lesson.quiz.mcqCount,
            lesson.quiz.essayCount,
            lesson.quiz.isRequired ? 1 : 0,
            lesson.quiz.reviewPolicy,
            now
          )
      );

      // Wajib buat baris assessment_policies sesuai skema 0001
      statements.push(
        db
          .prepare(
            `INSERT INTO assessment_policies (assessment_id, updated_at)
             VALUES (?1, ?2)`
          )
          .bind(assessmentId, now)
      );

      for (const q of lesson.quiz.questions) {
        const questionId = crypto.randomUUID();

        if (q.type === 'mcq') {
          statements.push(
            db
              .prepare(
                `INSERT INTO questions (
                  id, assessment_id, type, stem, difficulty, topic, points, explanation, in_quiz, is_active, created_at
                ) VALUES (?1, ?2, 'mcq', ?3, ?4, ?5, ?6, ?7, 1, 1, ?8)`
              )
              .bind(
                questionId,
                assessmentId,
                q.stem,
                q.difficulty,
                q.topic,
                q.points,
                q.explanation ?? null,
                now
              )
          );

          for (const opt of q.options) {
            statements.push(
              db
                .prepare(
                  `INSERT INTO question_options (id, question_id, body, is_correct)
                   VALUES (?1, ?2, ?3, ?4)`
                )
                .bind(crypto.randomUUID(), questionId, opt.body, opt.isCorrect ? 1 : 0)
            );
          }
        } else {
          // Soal esai lengkap dengan rubric_json & model_answer
          statements.push(
            db
              .prepare(
                `INSERT INTO questions (
                  id, assessment_id, type, stem, difficulty, topic, points, rubric_json, model_answer, in_quiz, is_active, created_at
                ) VALUES (?1, ?2, 'essay', ?3, 2, ?4, ?5, ?6, ?7, 1, 1, ?8)`
              )
              .bind(
                questionId,
                assessmentId,
                q.stem,
                q.topic,
                q.points,
                JSON.stringify(q.rubric),
                q.modelAnswer,
                now
              )
          );
        }
      }
    }
  });

  // 7. Catat audit log dengan nama kolom persis: metadata_redacted
  statements.push(
    db
      .prepare(
        `INSERT INTO admin_audit_logs (id, actor_user_id, action, target_type, target_id, created_at, metadata_redacted)
         VALUES (?1, ?2, 'course.import_bundle', 'course', ?3, ?4, ?5)`
      )
      .bind(
        crypto.randomUUID(),
        user.id,
        courseId,
        now,
        JSON.stringify({
          slug: bundle.course.slug,
          lessonsCount: bundle.lessons.length,
          scenariosCount: bundle.scenarios.length,
        })
      )
  );

  // Eksekusi seluruh transaksi D1 secara atomik
  await db.batch(statements);

  return c.json(
    {
      ok: true,
      courseId,
      versionId,
      status: 'draft',
      summary: {
        lessonsImported: bundle.lessons.length,
        scenariosImported: bundle.scenarios.length,
      },
    },
    201
  );
});

