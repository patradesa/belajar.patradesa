# ADR-0002 — Model data D1, versi konten immutable, waktu server

Status: diterima · Tanggal: 2026-11-21

## Keputusan
- Waktu disimpan sebagai `INTEGER` epoch **milidetik UTC**; ID `TEXT` acak (UUID tanpa tanda minus / token base64url).
- Konten berversi: `courses → course_versions(draft|published|superseded) → lessons → assessments → questions/options`.
  Maksimal satu draft per course (unique index parsial). Edit hanya pada versi **draft**; publish mengubah draft → published dan menandai versi lama superseded. Draft baru = clone versi terbit (lesson, kuis, kebijakan, bank soal aktif).
- `enrollments.course_version_id` mengikat peserta ke versi saat mendaftar; peserta lama tidak terpengaruh publish baru.
- `attempt_questions` menyimpan snapshot soal + urutan opsi + `answer_key_snapshot` (server-only). Skor dihitung terhadap snapshot, bukan bank soal terkini.
- Kebijakan kuis di `assessment_policies`; `ai_lock_enabled` dikunci `CHECK (ai_lock_enabled = 1)` sehingga tidak bisa dimatikan bahkan oleh admin/SQL biasa.
- Kebijakan course (jendela pendaftaran/akses, TTL sesi) disimpan di `courses` (bukan tabel `course_policies` terpisah seperti SPEC §9) — perubahan dicatat di audit log. Dapat dipisah bila perlu riwayat kebijakan per versi.
- Tabel `certificates` dan `ai_evaluations` belum dibuat (Phase 2/4). `lesson_sources` & `ai_usage` dibuat sekarang agar skema AI stabil.

## Atomisitas
D1 `batch()` dijalankan sebagai transaksi: diuji di `tests/integration/quiz.test.ts` ("D1 batch bersifat atomik"). Finalisasi attempt menghitung skor **di dalam SQL** pada satu batch (lihat ADR-0004).

## Rollback migrasi
`db/rollback/*.down.sql` hanya untuk dev/staging. Produksi: D1 Time Travel / restore ekspor (docs/deploy.md).
