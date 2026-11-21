-- 0002: foto sampul kelas & rating kelas dari peserta.
-- Tabel terpisah (bukan ALTER courses) agar versi Console D1 tetap idempoten (CREATE … IF NOT EXISTS).

-- Foto sampul kelas (berkas di R2 privat, disajikan lewat Worker).
CREATE TABLE course_covers (
  course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  alt_text TEXT NOT NULL DEFAULT '' CHECK (length(alt_text) <= 200),
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Rating 1–5 bintang; satu rating per peserta per kelas (dapat diubah). Hanya peserta terdaftar.
CREATE TABLE course_ratings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, course_id)
);
CREATE INDEX ix_course_ratings_course ON course_ratings(course_id);
