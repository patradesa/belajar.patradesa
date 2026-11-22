-- 0003: sertifikat kelulusan kelas, diterbitkan lewat Sertifikat Studio (sertifikat.patradesa.id).
-- Alur: saat semua syarat lulus terpenuhi (materi wajib selesai, kuis wajib LULUS dengan hasil final,
-- esai sudah dinilai manusia) LMS membuat baris 'pending', lalu meminta Studio menerbitkan nomor dan
-- kode verifikasi (HMAC, idempoten). Bila Studio belum bisa dihubungi, Cron mencoba ulang (backoff).
-- Halaman verifikasi publik ada di Studio: /v/KODE. LMS hanya menyimpan salinan nomor dan kode.
CREATE TABLE certificates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  course_version_id TEXT NOT NULL REFERENCES course_versions(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued', 'revoked')),
  recipient_name TEXT NOT NULL CHECK (length(recipient_name) BETWEEN 1 AND 120),
  course_title TEXT NOT NULL,
  final_score_pct REAL,
  completed_at INTEGER NOT NULL,
  certificate_no TEXT UNIQUE CHECK (certificate_no IS NULL OR length(certificate_no) <= 80),
  verification_code TEXT UNIQUE CHECK (verification_code IS NULL OR length(verification_code) = 16),
  verify_url TEXT,
  issued_at INTEGER,
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 300),
  revoked_at INTEGER,
  revoked_by TEXT,
  revoked_reason TEXT CHECK (revoked_reason IS NULL OR length(revoked_reason) <= 300),
  UNIQUE (user_id, course_id),
  CHECK (status <> 'issued' OR (certificate_no IS NOT NULL AND verification_code IS NOT NULL))
);
CREATE INDEX ix_certificates_course ON certificates(course_id);
CREATE INDEX ix_certificates_sync ON certificates(status, next_retry_at);
