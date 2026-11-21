# ADR-0004 — Exam lock AI yang race-safe (SECURITY CRITICAL)

Status: diterima · Tanggal: 2026-11-21

## Masalah
Selama attempt `in_progress`, semua fitur AI learner harus mati — lintas tab, perangkat, API langsung, route lama/baru — tanpa memanggil provider atau mendebit kuota.

## Keputusan
1. **Lock = baris `attempts` berstatus `in_progress`.** Tidak ada flag terpisah yang bisa tidak sinkron. Unique index parsial `ux_attempts_one_active_per_user ON attempts(user_id) WHERE status='in_progress'` menjamin paling banyak satu ujian aktif per user lintas kelas, di level database (race start bersamaan → satu menang, yang lain mendapat attempt yang sama secara idempoten).
2. **Guard global berbasis path** (`examLockGuard`, dipasang di `app.use('/api/*')` SEBELUM router): setiap path yang memuat segmen `/ai` (kecuali `/api/v1/admin/` dan `/api/internal/`) wajib login dan lolos `assertNoActiveExam(userId)` → `423 EXAM_LOCKED`. Route AI baru otomatis terlindungi; tes menginventaris `app.routes` dan juga memanggil path AI fiktif.
3. **Expiry dahulu**: `getActiveAttempt` memfinalisasi attempt yang lewat `deadline + grace` sebelum memeriksa lock, plus Cron tiap menit → lock tidak menggantung.
4. **Pemeriksaan ulang pasca-inference**: jika ujian dimulai saat provider sedang menjawab, jawaban dibuang dan 423 dikembalikan.
5. **Fail closed**: bila D1 gagal saat cek lock → `503 EXAM_LOCK_UNVERIFIED`, provider tidak dipanggil; kuis tidak dibatalkan.
6. **Finalisasi atomik & idempoten**: transisi status bersyarat (`WHERE status='in_progress'`) + koreksi MCQ + skor dihitung di SQL dalam satu `batch`. Autosave bersyarat pada status & deadline dalam statement yang sama, sehingga tidak ada jawaban yang menyelip setelah skor dihitung.
7. **Penilaian AI esai** (Phase 2) hanya lewat job internal setelah attempt final; tidak ada endpoint learner. Phase 1: penilaian manusia (mentor/admin) dengan rubrik.
8. **UI**: ExamLayout tanpa navigasi situs dan tanpa komponen AI; banner global dan panel reader menyembunyikan AI bila `me.activeAttempt` ada. UI hanyalah kenyamanan — server adalah penegak.

## Bukti
`tests/integration/exam-lock.test.ts` (13 kasus), `tests/e2e/learner.spec.ts` (tab baru + konteks browser kedua), `tests/unit/shared.test.ts` (pola path).
