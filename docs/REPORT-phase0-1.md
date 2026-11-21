# Laporan Phase 0 + Phase 1 — PatraDesa Belajar

Tanggal: 21 November 2026 · Repo lokal: `C:\Users\Gustulang\Projects\belajar.patradesa` (clone `patradesa/belajar.patradesa`, branch `main`)
Status: **belum di-commit, belum di-push, belum di-deploy.** Tidak ada resource Cloudflare/Google yang dibuat. WordPress, OpenSID, GTOS, Drive tidak disentuh (spec hanya disalin dari Drive sebagai `SPEC.md`).

## 1. Ringkasan perubahan (semua file baru kecuali README)
| Area | File | Baris | Isi |
|---|---|---|---|
| `apps/api` | 23 | ~2.470 | Hono Worker: auth (OIDC PKCE, Turnstile, dev-login lokal), sesi/CSRF, RBAC, katalog/enroll, sesi belajar + heartbeat, attempt (acak, snapshot, autosave, submit, expiry), exam lock global, AI stub, admin (versi, materi, PDF R2, kuis, bank soal, review, banding, pengguna, akomodasi, laporan, audit), Cron |
| `apps/web` | 37 | ~3.460 | React SPA: katalog, masuk, profil, kelas, reader (bacaan/slide/PDF/YouTube lazy), ExamLayout (timer server, autosave, anti-copy terbatas, font control), hasil & banding, admin lazy; token warna & CSS |
| `packages/shared` | 7 | ~490 | Zod schema strict, tipe API, parser konten aman, konstanta |
| `db` | 3 | ~490 | migrasi 0001 (FK, CHECK, index unik parsial exam lock), rollback dev, data demo fiktif |
| `tests` | 12 | ~1.410 | unit, integrasi, keamanan, komponen, e2e, a11y, harness Miniflare |
| docs & config | ~25 | — | ADR 0001–0006, SECURITY, PRIVACY, deploy/rollback, test-cases + QA manual, TASKS, CI, Dependabot, wrangler (dev/staging/prod), skrip budget/Lighthouse/seed/e2e |

Penyimpangan sengaja dari SPEC (dicatat di ADR): `POST /auth/google/start` (agar token Turnstile terkirim); kebijakan course digabung ke tabel `courses`; tabel `certificates`/`ai_evaluations` ditunda; seed demo lewat JSON + API (bukan `seed.dev.sql`).

## 2. Bukti uji (dijalankan 21-11-2026, Windows 11, Node 26.13, Edge untuk e2e)
| Perintah | Hasil |
|---|---|
| `npm run typecheck` | ✅ 0 galat (shared, api, web, tests) |
| `npm run lint` | ✅ 0 galat (termasuk jsx-a11y, larangan innerHTML) |
| `npm test` | ✅ **106/106** lulus, 8 file: unit 46 (incl. 27 pasangan kontras), integrasi 31 (exam-lock 13, quiz 11, learning 7), keamanan 18, komponen 11 |
| `npm run build` + `npm run budget` | ✅ JS awal **75,8 KiB** gzip (≤150), CSS awal **2,3 KiB** (≤35), tanpa font/skrip eksternal |
| `npx playwright test` (`wrangler dev` + D1 lokal) | ✅ **9/9**: alur peserta 360px, AI 423 di tab sama/tab baru/konteks browser kedua, AI kembali setelah submit, font ×1,25 di kuis bertahan setelah reload, anti-copy soal vs esai, 320px+200% tanpa scroll horizontal, target sentuh ≥44px, axe WCAG 2.2 AA **0 pelanggaran** (100% & 200%, mobile & desktop) |
| `npm run lighthouse` (emulasi mobile, slow 4G, localhost) | ✅ Performance 1,00 · Accessibility 1,00 · LCP 0,85–1,71 s · CLS 0 · TBT ≤6 ms · ~83 KiB transfer (`reports/lighthouse/summary.json`) |

Temuan nyata yang diperbaiki selama pengujian: body >256 KB mengembalikan 400 bukan 413; overflow horizontal 8–34 px pada 320px/200% (merek `&nbsp;`, kata panjang di flex); nama aksesibel tombol A−/A+/Reset tidak memuat teks terlihat (WCAG 2.5.3); fokus judul saat muat awal melewati skip link; CLS 0,107 di halaman kelas; autosave tertunda tidak di-flush saat keluar dari kuis.

## 3. Risk register
| # | Risiko | Dampak | Kemungkinan | Mitigasi / status |
|---|---|---|---|---|
| R1 | Alur Google OAuth & Turnstile nyata belum diuji (verifier & Siteverify ditiru di tes) | Tinggi | Sedang | Uji di staging sebelum pilot; CSP `style-src 'self'` mungkin perlu penyesuaian untuk widget Turnstile |
| R2 | Anti-copy hanya penghalang; MVP tidak memverifikasi siapa yang mengerjakan | Sedang | Tinggi | Bank soal > tampilan, acak, timer server, review; jangan dipakai untuk sertifikasi berisiko tinggi tanpa proctoring |
| R3 | UI admin belum dicakup e2e/axe (API admin dicakup uji integrasi) | Sedang | Sedang | Tambah e2e + axe admin sebelum editor non-teknis memakai |
| R4 | Heartbeat ≠ bukti membaca | Rendah | Tinggi | Dinyatakan di UI & SPEC; gunakan checkpoint pemahaman (Phase 2) |
| R5 | D1 tidak tersedia → AI ditolak (fail closed), kuis bisa gagal simpan | Sedang | Rendah | Autosave retry + grace; status "Gagal tersimpan" terlihat |
| R6 | Lokasi primer D1 jauh dari Indonesia → latensi | Sedang | Sedang | Buat D1 dengan `--location apac`; ukur di staging |
| R7 | Rate limit berbasis D1 menambah tulis | Rendah | Rendah | Cukup untuk 10–20 peserta; ganti binding Rate Limiting saat skala |
| R8 | Teks privasi & retensi masih draf | Tinggi (hukum) | — | Tinjauan pengelola/hukum sebelum go-live |
| R9 | MFA admin hanya via Google | Sedang | Rendah | Wajib 2SV; Cloudflare Access untuk `/admin` |
| R10 | Tes integrasi memakai compat date 2026-08-01 (Miniflare) vs 2026-11-01 (wrangler) | Rendah | Rendah | E2E memakai runtime wrangler asli; selaraskan saat versi Miniflare diperbarui |
| R11 | ESLint 9 sudah EOL (dipilih karena jsx-a11y belum mendukung v10) | Rendah | — | Naikkan saat plugin mendukung |
| R12 | PDF di Android: perilaku buka/unduh berbeda per perangkat | Rendah | Sedang | QA manual #15 |

## 4. Deploy & rollback
Lihat [docs/deploy.md](deploy.md): checklist environment (token scoped, D1, R2 privat, OAuth client, Turnstile, secrets, migrasi, bootstrap super_admin via SQL), urutan staging → verifikasi → produksi (persetujuan terpisah), rollback kode (`wrangler rollback`), rollback data (D1 Time Travel), rotasi secret, backup mingguan & restore drill bulanan.

## 5. Biaya & kuota
Pilot 10–20 peserta diperkirakan masuk kuota gratis Workers/D1/R2; Cron tiap menit ≈43 rb invokasi/bulan. AI belum aktif (biaya AI = 0). Periksa ulang plan aktif sebelum deploy.

## 6. Pekerjaan tersisa
1. (Persetujuan) Buat resource Cloudflare staging, OAuth client, Turnstile; deploy staging; smoke test termasuk login Google nyata.
2. QA manual perangkat Android fisik + TalkBack (docs/test-cases.md §B); uji usability anti-copy dengan pengguna disabilitas.
3. E2E + axe untuk area admin; uji Lighthouse di staging/WebPageTest.
4. Konten pilot nyata yang disetujui; tinjauan teks privasi.
5. Cloudflare Access untuk admin; prosedur ekspor/hapus data peserta.
6. Phase 2 (AI tutor, penilaian esai AI dengan review manusia) mengikuti docs/ai-evaluation.md; Phase 4 sertifikat.
