/**
 * Editor sederhana: ringkasan perubahan draf terhadap versi terbit, pemeriksaan sebelum terbit,
 * dan log perubahan per kelas (dari admin_audit_logs).
 */

type Row = Record<string, unknown>;

const LESSON_FIELDS: [string, string][] = [
  ['title', 'judul'],
  ['summary', 'ringkasan'],
  ['content_type', 'jenis'],
  ['content_source', 'isi'],
  ['youtube_id', 'video'],
  ['file_key', 'berkas PDF'],
  ['required_active_seconds', 'waktu minimum'],
  ['is_required', 'wajib'],
];
const QUIZ_FIELDS: [string, string][] = [
  ['title', 'judul kuis'],
  ['passing_score_pct', 'nilai lulus'],
  ['max_attempts', 'kesempatan'],
  ['cooldown_seconds', 'jeda'],
  ['time_limit_seconds', 'batas waktu'],
  ['mcq_count', 'jumlah soal PG'],
  ['essay_count', 'jumlah soal esai'],
  ['is_required', 'kuis wajib'],
  ['review_policy', 'pembahasan'],
];

function fmt(field: string, v: unknown): string {
  if (v === null || v === undefined) return '–';
  if (field === 'required_active_seconds' || field === 'cooldown_seconds' || field === 'time_limit_seconds') return `${Math.round(Number(v) / 60)} menit`;
  if (field === 'passing_score_pct') return `${String(v)}%`;
  if (field === 'is_required') return Number(v) === 1 ? 'ya' : 'tidak';
  if (field === 'review_policy') return v === 'after_done' ? 'tampil setelah selesai' : 'tidak tampil';
  return String(v);
}

/** Bandingkan dua baris; field angka/pilihan ditulis "sebelum → sesudah", field teks cukup "diubah". */
/** Akhir baris Windows (CRLF) dan spasi di ujung baris tidak dihitung sebagai perubahan isi. */
const norm = (v: unknown): unknown =>
  typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trimEnd() : (v ?? null);

function diff(before: Row, after: Row, fields: [string, string][]): string[] {
  const out: string[] = [];
  for (const [f, label] of fields) {
    if (norm(before[f]) === norm(after[f])) continue;
    const textual = ['content_source', 'summary', 'title', 'youtube_id', 'file_key'].includes(f);
    out.push(textual ? `${label} diubah` : `${label} ${fmt(f, before[f])} → ${fmt(f, after[f])}`);
  }
  return out;
}

async function versionSnapshot(db: D1Database, versionId: string) {
  const { results: lessons } = await db.prepare('SELECT * FROM lessons WHERE course_version_id = ? ORDER BY seq').bind(versionId).all<Row>();
  const { results: quizzes } = await db
    .prepare(
      `SELECT a.*, l.lesson_key,
              (SELECT group_concat(x, '|') FROM (SELECT q.stem || ':' || q.in_quiz || ':' || COALESCE(q.explanation, '') AS x FROM questions q
                 WHERE q.assessment_id = a.id AND q.is_active = 1 ORDER BY q.stem)) AS bank,
              (SELECT COUNT(*) FROM questions q WHERE q.assessment_id = a.id AND q.is_active = 1) AS n_questions
       FROM assessments a JOIN lessons l ON l.id = a.lesson_id WHERE l.course_version_id = ?`,
    )
    .bind(versionId)
    .all<Row>();
  return { lessons, quizzes: new Map(quizzes.map((q) => [String(q.lesson_key), q])) };
}

/** Daftar perubahan draf dibanding versi terbit (dibaca manusia), per materi. */
export async function draftChanges(db: D1Database, courseId: string): Promise<{ draftVersionId: string | null; changes: string[] }> {
  const draft = await db.prepare(`SELECT id FROM course_versions WHERE course_id = ? AND status = 'draft'`).bind(courseId).first<{ id: string }>();
  if (!draft) return { draftVersionId: null, changes: [] };
  const cur = await db.prepare('SELECT current_version_id FROM courses WHERE id = ?').bind(courseId).first<{ current_version_id: string | null }>();
  const after = await versionSnapshot(db, draft.id);
  if (!cur?.current_version_id) {
    return { draftVersionId: draft.id, changes: after.lessons.map((l) => `Materi baru: ${String(l.title)}`) };
  }
  const before = await versionSnapshot(db, cur.current_version_id);
  const changes: string[] = [];
  const beforeByKey = new Map(before.lessons.map((l) => [String(l.lesson_key), l]));
  const afterKeys = new Set(after.lessons.map((l) => String(l.lesson_key)));
  for (const l of after.lessons) {
    const k = String(l.lesson_key);
    const old = beforeByKey.get(k);
    const name = String(l.title);
    if (!old) {
      changes.push(`Materi baru: ${name}`);
      continue;
    }
    const parts = diff(old, l, LESSON_FIELDS);
    if (Number(old.seq) !== Number(l.seq)) parts.push(`urutan ${String(old.seq)} → ${String(l.seq)}`);
    const qa = after.quizzes.get(k);
    const qb = before.quizzes.get(k);
    if (qa && !qb) parts.push(`kuis baru (${String(qa.n_questions)} soal)`);
    else if (!qa && qb) parts.push('kuis dihapus');
    else if (qa && qb) {
      parts.push(...diff(qb, qa, QUIZ_FIELDS));
      if (qa.bank !== qb.bank) {
        parts.push(Number(qa.n_questions) !== Number(qb.n_questions) ? `soal ${String(qb.n_questions)} → ${String(qa.n_questions)}` : 'isi/pilihan soal diubah');
      }
    }
    if (parts.length) changes.push(`${name}: ${parts.join('; ')}`);
  }
  for (const l of before.lessons) if (!afterKeys.has(String(l.lesson_key))) changes.push(`Materi dihapus: ${String(l.title)}`);
  return { draftVersionId: draft.id, changes };
}

/** Masalah yang membuat kelas tidak bisa dijalankan peserta; terbit ditolak bila ada. */
export async function publishProblems(db: D1Database, versionId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT l.title AS lesson_title, a.title, a.mcq_count, a.essay_count,
              (SELECT COUNT(*) FROM questions q WHERE q.assessment_id = a.id AND q.is_active = 1 AND q.in_quiz = 1 AND q.type = 'mcq') AS mcq,
              (SELECT COUNT(*) FROM questions q WHERE q.assessment_id = a.id AND q.is_active = 1 AND q.in_quiz = 1 AND q.type = 'essay') AS essay
       FROM assessments a JOIN lessons l ON l.id = a.lesson_id WHERE l.course_version_id = ? ORDER BY l.seq`,
    )
    .bind(versionId)
    .all<{ lesson_title: string; title: string; mcq_count: number; essay_count: number; mcq: number; essay: number }>();
  const out: string[] = [];
  for (const r of results) {
    if (r.mcq < r.mcq_count || r.essay < r.essay_count) {
      out.push(
        `Kuis "${r.title}" di materi "${r.lesson_title}" butuh ${r.mcq_count} soal PG dan ${r.essay_count} esai yang dipakai, tetapi baru ada ${r.mcq} PG dan ${r.essay} esai. Tambahkan soal atau hapus kuisnya.`,
      );
    }
  }
  return out;
}

const ACTION_LABEL: Record<string, string> = {
  'course.create': 'Kelas dibuat',
  'course.update': 'Pengaturan kelas diubah',
  'course.draft': 'Draf dibuat',
  'course.publish': 'Versi diterbitkan',
  'course.cover': 'Foto sampul diubah',
  'course.cover_delete': 'Foto sampul dihapus',
  'lesson.create': 'Materi ditambahkan',
  'lesson.update': 'Materi disimpan',
  'lesson.delete': 'Materi dihapus',
  'lesson.file_upload': 'Berkas PDF diunggah',
  'assessment.upsert': 'Pengaturan kuis disimpan',
  'assessment.delete': 'Kuis dihapus',
  'question.create': 'Soal ditambahkan',
  'question.import': 'Bank soal diimpor',
  'question.deactivate': 'Soal dihapus',
  'question.select': 'Pilihan soal kuis diubah',
  'mentor.assign': 'Mentor ditugaskan',
  'mentor.unassign': 'Penugasan mentor dicabut',
  'enrollment.upgrade': 'Peserta pindah ke versi terbaru',
};

/** Log perubahan satu kelas: aksi pada kelas, materi, kuis, soal, dan pendaftarannya. */
export async function courseLog(db: D1Database, courseId: string) {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.action, g.target_type, g.created_at, g.metadata_redacted, u.display_name AS actor
       FROM admin_audit_logs g LEFT JOIN users u ON u.id = g.actor_user_id
       WHERE (g.target_type = 'course' AND g.target_id = ?1)
          OR json_extract(g.metadata_redacted, '$.courseId') = ?1
          OR (g.target_type = 'lesson' AND g.target_id IN (SELECT l.id FROM lessons l JOIN course_versions cv ON cv.id = l.course_version_id WHERE cv.course_id = ?1))
          OR (g.target_type = 'assessment' AND g.target_id IN (SELECT a.id FROM assessments a JOIN lessons l ON l.id = a.lesson_id JOIN course_versions cv ON cv.id = l.course_version_id WHERE cv.course_id = ?1))
          OR (g.target_type = 'question' AND g.target_id IN (SELECT q.id FROM questions q JOIN assessments a ON a.id = q.assessment_id JOIN lessons l ON l.id = a.lesson_id JOIN course_versions cv ON cv.id = l.course_version_id WHERE cv.course_id = ?1))
          OR (g.target_type = 'enrollment' AND g.target_id IN (SELECT e.id FROM enrollments e WHERE e.course_id = ?1))
       ORDER BY g.created_at DESC, g.rowid DESC LIMIT 300`,
    )
    .bind(courseId)
    .all<{ id: string; action: string; target_type: string; created_at: number; metadata_redacted: string | null; actor: string | null }>();
  return results.map((r) => {
    let meta: Record<string, unknown> = {};
    try {
      meta = r.metadata_redacted ? (JSON.parse(r.metadata_redacted) as Record<string, unknown>) : {};
    } catch {
      meta = {};
    }
    const detail: string[] = [];
    if (typeof meta.lessonTitle === 'string') detail.push(meta.lessonTitle);
    if (typeof meta.changed === 'string' && meta.changed) detail.push(meta.changed);
    if (typeof meta.fromVersion === 'number') detail.push(`v${meta.fromVersion} → v${String(meta.toVersion)}`);
    if (typeof meta.count === 'number') detail.push(`${meta.count} soal`);
    if (typeof meta.versionNo === 'number') detail.push(`versi ${meta.versionNo}`);
    if (typeof meta.movedLearners === 'number') detail.push(`${meta.movedLearners} peserta dipindahkan`);
    return { id: r.id, at: r.created_at, actor: r.actor ?? '—', action: r.action, label: ACTION_LABEL[r.action] ?? r.action, detail: detail.join(' · ') };
  });
}

export { diff as diffFields, LESSON_FIELDS, QUIZ_FIELDS };
