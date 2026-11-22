/**
 * Kelas demo penilaian (staging/dev saja): 3 materi, kuis di materi 3 (5 PG + 2 esai), dan satu
 * peserta FIKTIF (tanpa akun login) yang sudah menyelesaikan materi dan mengumpulkan kuis.
 * Admin lalu menilai esai di "Review esai" → hasil final → sertifikat (lewat Sertifikat Studio).
 *
 * Semua baris dibuat dalam SATU batch D1 (hemat batas query per request di paket gratis), lalu
 * attempt difinalisasi dengan logika penilaian yang sama persis dengan submit peserta sungguhan.
 */
import { parseContent } from '@patradesa/shared';
import { newId, randomToken, secureShuffle } from '../lib/crypto';
import { auditStmt } from '../lib/audit';
import { finalizeAttempt } from './finalize';

const LESSONS = [
  {
    title: 'Alur Belajar di PatraDesa Belajar',
    summary: 'Daftar kelas, belajar materi, lalu kuis.',
    source:
      '## Alur singkat\n\n1. Daftar kelas.\n2. Pelajari setiap materi sampai waktu belajar minimum terpenuhi.\n3. Kerjakan kuis di materi terakhir.\n\n> Kelas ini contoh untuk menguji penilaian. Semua nama dan data fiktif.',
  },
  {
    title: 'Cara Kuis Dinilai',
    summary: 'Pilihan ganda dinilai server, esai dinilai manusia.',
    source:
      '## Penilaian\n\n- **Pilihan ganda** dikoreksi otomatis oleh server saat kuis dikumpulkan.\n- **Esai** dinilai mentor/admin memakai rubrik. Sebelum semua esai dinilai, hasil berstatus *menunggu penilaian*.\n- Nilai akhir = total poin dibagi poin maksimum. Lulus bila mencapai nilai lulus kuis.',
  },
  {
    title: 'Dari Kelulusan ke Sertifikat',
    summary: 'Sertifikat terbit otomatis setelah semua syarat lulus terpenuhi.',
    source:
      '## Sertifikat\n\nSetelah semua materi wajib selesai dan kuis wajib **lulus**, sertifikat diterbitkan oleh Sertifikat Studio Patra Desa: nomor resmi, kode verifikasi 16 karakter, dan QR untuk cek keaslian.',
  },
] as const;

type DemoMcq = {
  stem: string;
  topic: string;
  options: [string, boolean][];
  answer: number;
};
const MCQS: DemoMcq[] = [
  {
    stem: 'Kapan kuis di sebuah materi bisa mulai dikerjakan?',
    topic: 'alur',
    options: [
      ['Setelah waktu belajar minimum materi itu terpenuhi', true],
      ['Kapan saja, bahkan sebelum mendaftar kelas', false],
      ['Hanya pada hari Senin', false],
      ['Setelah sertifikat terbit', false],
    ],
    answer: 0,
  },
  {
    stem: 'Siapa yang menilai jawaban esai?',
    topic: 'penilaian',
    options: [
      ['Mentor atau admin (manusia) memakai rubrik', true],
      ['Dinilai otomatis penuh oleh AI', false],
      ['Peserta menilai jawabannya sendiri', false],
      ['Esai tidak dinilai', false],
    ],
    answer: 0,
  },
  {
    stem: 'Apa yang terjadi pada Pendamping AI selama kuis berlangsung?',
    topic: 'penilaian',
    options: [
      ['Dikunci sampai kuis selesai', true],
      ['Bisa dipakai untuk menjawab soal', false],
      ['Otomatis memberi kunci jawaban', false],
      ['Tidak berpengaruh apa pun', false],
    ],
    answer: 0,
  },
  {
    stem: 'Di mana keaslian sertifikat diperiksa?',
    topic: 'sertifikat',
    options: [
      ['Di halaman verifikasi Sertifikat Studio lewat QR atau kode', true],
      ['Dengan menelepon peserta', false],
      ['Tidak bisa diperiksa', false],
      ['Di media sosial desa', false],
    ],
    answer: 0,
  },
  {
    stem: 'Berapa nilai lulus kuis demo ini?',
    topic: 'sertifikat',
    options: [
      ['70%', true],
      ['60%', false],
      ['50%', false],
      ['100%', false],
    ],
    answer: 1, // jawaban peserta demo SALAH di soal ini (4 dari 5 benar)
  },
];

const RUBRIC = [
  { criterion: 'Ketepatan isi', maxScore: 50 },
  { criterion: 'Contoh konkret', maxScore: 30 },
  { criterion: 'Kejelasan', maxScore: 20 },
];
const ESSAYS = [
  {
    stem: 'Jelaskan mengapa jawaban esai dinilai oleh manusia, bukan otomatis.',
    model: 'Esai menilai pemahaman dan penerapan; manusia dapat menimbang konteks desa dan memberi umpan balik.',
    answer:
      'Karena esai berisi pendapat dan contoh dari pengalaman di desa, jadi perlu dibaca orang yang paham konteksnya. Penilai juga bisa memberi masukan supaya jawaban saya lebih baik. Kalau otomatis, bisa salah menilai jawaban yang benar tapi kalimatnya berbeda.',
  },
  {
    stem: 'Sebutkan dua cara peserta atau warga memeriksa keaslian sertifikat.',
    model: 'Memindai QR pada sertifikat, atau membuka halaman verifikasi dan mengetik kode 16 karakter.',
    answer: 'Pertama, memindai QR di sertifikat dengan kamera HP. Kedua, membuka halaman cek sertifikat lalu mengetik kode verifikasinya.',
  },
];

export async function createGradingDemo(db: D1Database, adminId: string, now: number) {
  const courseId = newId();
  const versionId = newId();
  const suffix = newId().slice(0, 6);
  const slug = `demo-penilaian-${suffix}`;
  const learnerId = newId();
  const enrollmentId = newId();
  const attemptId = newId();
  const assessmentId = newId();
  const learnerName = `Ni Made Contoh (Peserta Demo ${suffix.toUpperCase()})`;
  const lessonIds = LESSONS.map(() => newId());
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO courses (id, slug, title, description, visibility, status, current_version_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'private', 'published', ?, ?, ?, ?)`,
      )
      .bind(
        courseId,
        slug,
        `Demo Penilaian & Sertifikat ${suffix.toUpperCase()} (Fiktif)`,
        'Kelas privat untuk menguji alur penilaian esai sampai penerbitan sertifikat. Peserta dan jawabannya fiktif.',
        versionId,
        adminId,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO course_versions (id, course_id, version_no, status, published_at, published_by, created_by, created_at) VALUES (?, ?, 1, 'published', ?, ?, ?, ?)`,
      )
      .bind(versionId, courseId, now, adminId, adminId, now),
  ];
  LESSONS.forEach((l, i) =>
    stmts.push(
      db
        .prepare(
          `INSERT INTO lessons (id, course_version_id, lesson_key, seq, title, summary, content_type, content_source, content_json, required_active_seconds, is_required)
           VALUES (?, ?, ?, ?, ?, ?, 'html', ?, ?, 0, 1)`,
        )
        .bind(lessonIds[i], versionId, randomToken(8), i + 1, l.title, l.summary, l.source, JSON.stringify(parseContent(l.source))),
    ),
  );
  stmts.push(
    db
      .prepare(
        `INSERT INTO assessments (id, lesson_id, title, instructions, time_limit_seconds, passing_score_pct, max_attempts, cooldown_seconds, mcq_count, essay_count, grace_seconds, is_required, version, created_at)
         VALUES (?, ?, 'Kuis Demo Penilaian', 'Kuis contoh: 5 pilihan ganda (2 poin) dan 2 esai (10 poin).', 900, 70, 3, 0, 5, 2, 20, 1, 1, ?)`,
      )
      .bind(assessmentId, lessonIds[2], now),
    db
      .prepare(
        `INSERT INTO assessment_policies (assessment_id, version, exam_copy_deterrence_enabled, ai_lock_enabled, accessibility_exemption_policy, hide_lesson_links_during_exam, updated_at)
         VALUES (?, 1, 1, 1, 'per_user', 1, ?)`,
      )
      .bind(assessmentId, now),
  );

  // Bank soal + snapshot attempt + jawaban peserta demo.
  const startedAt = now - 8 * 60_000;
  stmts.push(
    db
      .prepare(`INSERT INTO users (id, email_normalized, display_name, status, created_at) VALUES (?, ?, ?, 'active', ?)`)
      .bind(learnerId, `demo-${suffix}-${newId().slice(0, 8)}@contoh.invalid`, `Peserta Demo ${suffix.toUpperCase()}`, now),
    db.prepare('INSERT INTO user_profiles (user_id, certificate_name, updated_at) VALUES (?, ?, ?)').bind(learnerId, learnerName, now),
    db.prepare(`INSERT INTO system_roles (user_id, role, assigned_by, assigned_at) VALUES (?, 'learner', ?, ?)`).bind(learnerId, adminId, now),
    db
      .prepare(`INSERT INTO enrollments (id, user_id, course_id, course_version_id, status, started_at) VALUES (?, ?, ?, ?, 'active', ?)`)
      .bind(enrollmentId, learnerId, courseId, versionId, now - 3600_000),
    db
      .prepare(
        `INSERT INTO lesson_progress (user_id, lesson_id, enrollment_id, active_seconds, content_accessed_at, completed_at, last_accessed_at)
         SELECT ?, value, ?, 120, ?, ?, ? FROM json_each(?)`,
      )
      .bind(learnerId, enrollmentId, now - 3000_000, now - 1800_000, now - 1800_000, JSON.stringify(lessonIds)),
    db
      .prepare(
        `INSERT INTO attempts (id, assessment_id, user_id, enrollment_id, assessment_version, attempt_no, started_at, deadline_at, grace_seconds, status, passing_score_pct, copy_deterrence_active)
         VALUES (?, ?, ?, ?, 1, 1, ?, ?, 20, 'in_progress', 70, 1)`,
      )
      .bind(attemptId, assessmentId, learnerId, enrollmentId, startedAt, startedAt + 900_000),
  );
  let seq = 0;
  for (const q of MCQS) {
    const qid = newId();
    stmts.push(
      db
        .prepare(
          `INSERT INTO questions (id, assessment_id, type, stem, difficulty, topic, points, version, is_active, in_quiz, created_at)
           VALUES (?, ?, 'mcq', ?, 2, ?, 2, 1, 1, 1, ?)`,
        )
        .bind(qid, assessmentId, q.stem, q.topic, now + seq),
      db
        .prepare(
          `INSERT INTO question_options (id, question_id, body, is_correct, version)
           SELECT lower(hex(randomblob(16))), ?, json_extract(value, '$[0]'), json_extract(value, '$[1]'), 1 FROM json_each(?)`,
        )
        .bind(qid, JSON.stringify(q.options.map(([body, ok]) => [body, ok ? 1 : 0]))),
    );
    const opts = secureShuffle(q.options.map(([body, ok], i) => ({ k: randomToken(6), body, ok, i })));
    const key = opts.find((o) => o.ok)!.k;
    const chosen = opts.find((o) => o.i === q.answer)!.k;
    const aqId = randomToken(12);
    seq++;
    stmts.push(
      db
        .prepare(
          `INSERT INTO attempt_questions (id, attempt_id, question_id, question_version, sequence, type, stem_snapshot, points, options_snapshot_json, answer_key_snapshot)
           VALUES (?, ?, ?, 1, ?, 'mcq', ?, 2, ?, ?)`,
        )
        .bind(aqId, attemptId, qid, seq, q.stem, JSON.stringify(opts.map((o) => ({ k: o.k, body: o.body }))), key),
      db
        .prepare('INSERT INTO answers (id, attempt_id, attempt_question_id, selected_option_key, saved_at) VALUES (?, ?, ?, ?, ?)')
        .bind(newId(), attemptId, aqId, chosen, now - 60_000),
    );
  }
  for (const e of ESSAYS) {
    const qid = newId();
    const aqId = randomToken(12);
    seq++;
    stmts.push(
      db
        .prepare(
          `INSERT INTO questions (id, assessment_id, type, stem, difficulty, topic, points, version, rubric_json, model_answer, is_active, in_quiz, created_at)
           VALUES (?, ?, 'essay', ?, 2, 'esai', 10, 1, ?, ?, 1, 1, ?)`,
        )
        .bind(qid, assessmentId, e.stem, JSON.stringify(RUBRIC), e.model, now + seq),
      db
        .prepare(
          `INSERT INTO attempt_questions (id, attempt_id, question_id, question_version, sequence, type, stem_snapshot, points, options_snapshot_json, answer_key_snapshot)
           VALUES (?, ?, ?, 1, ?, 'essay', ?, 10, '[]', NULL)`,
        )
        .bind(aqId, attemptId, qid, seq, e.stem),
      db
        .prepare('INSERT INTO answers (id, attempt_id, attempt_question_id, essay_text, saved_at) VALUES (?, ?, ?, ?, ?)')
        .bind(newId(), attemptId, aqId, e.answer, now - 60_000),
    );
  }
  stmts.push(
    auditStmt(db, now, adminId, 'demo.grading.create', 'course', courseId, {
      slug,
    }),
  );
  await db.batch(stmts);
  // Kumpulkan kuis dengan logika finalisasi yang sama dengan peserta sungguhan → PG dinilai, esai menunggu review.
  await finalizeAttempt(db, attemptId, 'submitted', now);
  return {
    courseId,
    slug,
    attemptId,
    learnerName,
    mcqCorrect: 4,
    mcqTotal: MCQS.length,
    essays: ESSAYS.length,
  };
}
