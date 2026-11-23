-- 0006: penjelasan soal PG (ditampilkan di pembahasan hasil kuis) dan kebijakan pembahasan per kuis.
-- review_policy 'none' (bawaan): kunci & pembahasan tidak pernah ditampilkan (perilaku lama).
-- 'after_done': pembahasan tampil setelah peserta lulus ATAU kesempatan habis (tidak membantu percobaan ulang).
ALTER TABLE questions ADD COLUMN explanation TEXT CHECK (explanation IS NULL OR length(explanation) <= 2000);
ALTER TABLE assessments ADD COLUMN review_policy TEXT NOT NULL DEFAULT 'none' CHECK (review_policy IN ('none', 'after_done'));
