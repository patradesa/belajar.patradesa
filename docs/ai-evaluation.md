# Rencana evaluasi AI (Phase 2 — belum diimplementasikan)

Phase 0/1 tidak memanggil model AI apa pun. Dokumen ini adalah syarat sebelum AI diaktifkan.

## Tutor materi
- Konteks hanya `lesson_sources` yang disetujui admin; retrieval SQL/FTS5; tanpa browsing/tool.
- Uji: pertanyaan di luar topik ditolak; tidak dapat mengakses kelas lain; prompt injection dalam pertanyaan & dalam sumber; tidak membocorkan soal/kunci/prompt sistem; kuota keras per user/hari + cap global.
- Exam lock sudah ditegakkan dan diuji (ADR-0004); WorkersAiProvider wajib lolos `tests/integration/exam-lock.test.ts` tanpa perubahan.

## Penilaian esai AI
- Job internal (`/api/internal/*` atau Queue) hanya untuk attempt `submitted|expired`; tanpa endpoint learner.
- Input: teks esai, soal, rubrik, ringkasan sumber — tanpa email/nama/jabatan.
- Output JSON tervalidasi (Zod): skor per kriteria, alasan berbasis bukti, confidence, `requires_human_review`.
- Simpan `model_id`, `prompt_version`, `rubric_version`, `source_version`.
- Wajib review manusia untuk nilai yang memengaruhi kelulusan (MVP).
- Uji keselarasan AI–manusia secara buta (sampel ≥30 esai, toleransi disepakati) sebelum dipakai; set uji: esai baik/lemah/off-topic/kosong/prompt-injection.
