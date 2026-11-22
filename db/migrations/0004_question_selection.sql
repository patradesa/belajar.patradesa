-- 0004: pilihan soal kuis dari bank soal.
-- in_quiz = 1: soal ikut diundi untuk kuis; 0: tetap di bank (tidak dihapus) tetapi tidak dipakai.
-- is_active tetap berarti "soal tidak dihapus". Soal lama otomatis dipakai (default 1).
ALTER TABLE questions ADD COLUMN in_quiz INTEGER NOT NULL DEFAULT 1 CHECK (in_quiz IN (0, 1));
