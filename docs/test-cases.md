# Kasus uji & QA manual

## A. Pemetaan kriteria penerimaan (SPEC §13) → uji otomatis
| Kriteria | Uji |
|---|---|
| AI 423 `EXAM_LOCKED` selama attempt aktif, lintas tab/perangkat, API langsung, route baru | `tests/integration/exam-lock.test.ts`, `tests/e2e/learner.spec.ts` |
| Model tidak dipanggil & kuota tidak didebit saat terkunci | `exam-lock.test.ts` (spy provider + `ai_usage`) |
| AI kembali setelah submit / expiry (lazy & Cron) | `exam-lock.test.ts`, `learner.spec.ts` |
| Ujian dimulai saat inference → jawaban dibuang; fail closed bila D1 gagal | `exam-lock.test.ts` |
| Jabatan desa tidak membuka lock/admin | `exam-lock.test.ts`, `security.test.ts` |
| Urutan acak persisten, refresh sama, kunci tidak di frontend | `quiz.test.ts`, `exam-lock.test.ts`, `learner.spec.ts` |
| Max attempts, cooldown, submit ganda, ID palsu, submit terlambat | `quiz.test.ts` |
| Esai → pending_review, review manusia, override beralasan, banding | `quiz.test.ts` |
| Jam klien tidak membuka materi/memperpanjang kuis; tab dijeda tidak dapat kredit | `learning.test.ts`, `quiz.test.ts` |
| Sesi belajar kedaluwarsa harus restart; akses/pendaftaran kedaluwarsa | `learning.test.ts` |
| Versi terbit immutable; peserta tetap pada versinya | `learning.test.ts` |
| PDF privat tidak dapat ditebak URL-nya | `security.test.ts` |
| Admin tanpa auth ditolak; IDOR; CSRF; XSS; SQLi; rate limit; Turnstile; fixation; dev-login off | `security.test.ts` |
| D1 batch atomik | `quiz.test.ts` |
| Kontras token WCAG 2.2 AA | `tests/unit/contrast.test.ts` |
| Font A−/A+/Reset di kuis, fallback storage diblokir | `apps/web/src/exam/exam.test.tsx`, `learner.spec.ts` |
| Anti-copy hanya soal; esai bisa pilih/salin/tempel/edit; pengecualian | `exam.test.tsx`, `learner.spec.ts` |
| ExamLayout tanpa AI; reader sembunyikan AI saat ujian | `exam.test.tsx`, `lesson.test.tsx` |
| 320px tanpa scroll horizontal pada teks 200%; target sentuh ≥44px | `learner.spec.ts` |
| axe-core WCAG 2.2 AA (100% & 200%), skip link & fokus | `tests/e2e/a11y.spec.ts` |
| Anggaran JS/CSS, tanpa font eksternal | `scripts/check-budget.mjs` |
| Lighthouse mobile (LCP, CLS, TBT, skor) | `scripts/lighthouse.mjs` |

## B. QA manual di perangkat Android (wajib sebelum pilot)
Catat: merek/model, versi Android, browser & versi, jaringan (4G lemah / Wi-Fi), tanggal, penguji.

| # | Langkah | Hasil yang diharapkan |
|---|---|---|
| 1 | Buka `/` di Chrome Android kelas bawah (RAM ≤3 GB) dengan data seluler | tampil < 3 detik; tidak ada scroll horizontal |
| 2 | Pengaturan Android → ukuran font sistem terbesar | teks tetap terbaca, tombol tidak terpotong |
| 3 | Zoom cubit 200% di materi | konten reflow, tidak ada teks terpotong |
| 4 | A+ sampai 200% di materi lalu buka kuis | ukuran terbawa; A−/A+/Reset ada di bar kuis |
| 5 | TalkBack: navigasi katalog → kelas → materi → kuis | judul diumumkan, tombol berlabel ("A+ perbesar teks"), radio grup soal terbaca |
| 6 | Kuis: tekan lama pada teks soal | menu salin/pilih tidak muncul; TalkBack tetap membaca soal |
| 7 | Kuis: tekan lama di kotak esai, pilih semua, salin, tempel | berfungsi normal |
| 8 | Keyboard Gboard: ketik esai panjang, autokoreksi | "✓ Tersimpan" muncul; tidak ada lag berat |
| 9 | Mode pesawat saat mengetik esai, lalu online | "Gagal tersimpan — mencoba lagi" lalu "Tersimpan" |
| 10 | Buka tab kedua (materi) saat kuis aktif | banner kuis aktif; Pendamping AI tidak tampil |
| 11 | Login di HP kedua dengan akun sama saat kuis aktif | lanjutkan kuis yang sama; AI tidak tersedia |
| 12 | Biarkan timer habis | otomatis dikumpulkan; hasil "waktu habis" |
| 13 | Putar layar (landscape) di kuis | tata letak tetap rapi |
| 14 | Video YouTube: tidak termuat sebelum "Tonton video" | tidak ada request ke youtube sebelum klik |
| 15 | PDF di Android | "Buka PDF di tab baru" berfungsi; iframe disembunyikan di layar kecil |
| 16 | Mode gelap sistem / kontras tinggi | tetap terbaca (tema terang paksa; forced-colors didukung dasar) |

## C. Uji yang BELUM otomatis
- Uji usability anti-copy dengan peserta penyandang disabilitas (pembaca layar, switch access).
- Google OAuth nyata (butuh client ID staging) — callback diuji dengan verifier tiruan.
- Turnstile widget nyata di browser (CSP sudah mengizinkan `challenges.cloudflare.com`).
- Lighthouse di staging melalui jaringan nyata & WebPageTest perangkat fisik.
