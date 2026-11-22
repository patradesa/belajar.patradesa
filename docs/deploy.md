# Deploy, konfigurasi & rollback

> **Belum ada yang di-deploy.** Semua langkah di bawah membutuhkan persetujuan eksplisit pemilik proyek. Produksi membutuhkan persetujuan terpisah setelah staging diverifikasi. Jangan ubah patradesa.id (WordPress), OpenSID, atau repo lain.

## 1. Checklist lingkungan (sekali per environment)
| # | Item | Perintah / tempat | Catatan |
|---|---|---|---|
| 1 | Akun Cloudflare + zona `patradesa.id` | dashboard | subdomain `belajar` / `belajar-staging` terpisah dari server WordPress |
| 2 | API token **scoped** untuk CI/deploy | Dashboard → API Tokens | izin: Workers Scripts:Edit, D1:Edit, R2:Edit, Workers Routes:Edit pada zona terkait saja |
| 3 | D1 database | `npx wrangler d1 create patradesa-belajar-staging --location apac` | salin `database_id` ke `wrangler.toml` `[env.staging]` |
| 4 | R2 bucket privat | `npx wrangler r2 bucket create patradesa-belajar-staging-files` | **jangan** aktifkan public access / r2.dev |
| 5 | Google OAuth client (Web) | Google Cloud Console | redirect URI: `https://belajar-staging.patradesa.id/api/v1/auth/google/callback` (persis) |
| 6 | Turnstile widget | Dashboard → Turnstile | hostname staging/prod; salin site key ke `wrangler.toml`, secret key ke secret |
| 7 | Secrets | `npx wrangler secret put SESSION_SECRET --env staging` (≥64 char acak), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET_KEY` | jangan pernah di repo / `.dev.vars` commit |
| 8 | Migrasi | `npx wrangler d1 migrations apply DB --env staging --remote` | ekspor dulu sebelum migrasi produksi |
| 9 | Bootstrap super_admin | login sekali dengan Google, lalu: `npx wrangler d1 execute DB --env staging --remote --command "INSERT INTO system_roles (user_id, role, assigned_by, assigned_at) SELECT id, 'super_admin', 'bootstrap', unixepoch()*1000 FROM users WHERE email_normalized = '<email-admin>'"` | catat di audit manual |
| 10 | Wajibkan 2-Step Verification Google untuk akun admin; pertimbangkan Cloudflare Access untuk `/admin*` | | |

`DEV_LOGIN_ENABLED` sudah `"false"` untuk staging & production di `wrangler.toml` dan diuji.

## 1b. Workers Builds (Git → Cloudflare) untuk staging di workers.dev
Worker `belajar-patradesa` (akun Patradesa.id). Settings → Build:
- **Production branch: `main`** (wajib). Jika diisi branch lain, merge ke `main` hanya menjadi build *preview* yang gagal seketika dan staging tidak berubah. Ini sempat terjadi pada 21–22 Nov 2026 karena branch masih `feat/phase0-1-foundation`.
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy --env staging`
- Build untuk branch non-produksi: matikan, atau isi deploy command non-produksi `npx wrangler versions upload --env staging`. Tanpa `--env staging`, wrangler memakai konfigurasi pengembangan lokal dan build gagal; check "Workers Builds" merah pada PR berasal dari sini, bukan dari kode.
- Variables and Secrets (bagian runtime, tipe **Secret**, bukan di bagian Build): `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET_KEY`
- Tanda gagal karena konfigurasi (bukan kode): check Workers Builds selesai dalam 0 detik. GitHub tidak mengizinkan menjalankan ulang check Cloudflare memakai token pengguna; picu build dengan push baru ke `main` atau *Retry* di dashboard.

`APP_ORIGIN` di `[env.staging.vars]` harus sama persis dengan URL workers.dev Worker. Migrasi D1 dijalankan terpisah (wrangler yang login ke akun Patradesa.id): `npx wrangler d1 migrations apply DB --env staging --remote`.

Tanpa wrangler: tempel `db/console/<migrasi>.console.sql` ke D1 → Console (dibuat dengan `node scripts/make-console-sql.mjs <file>`). Console menggabungkan baris, sehingga file migrasi asli yang berisi komentar `--` tidak bisa dipakai langsung. Versi console idempoten dan mencatat dirinya di `d1_migrations`.

Catatan migrasi: `0004_question_selection.console.sql` berisi `ALTER TABLE` yang tidak idempoten. Jalankan sekali; bila muncul galat "duplicate column name: in_quiz", migrasi itu sudah pernah diterapkan.

## 1c. Integrasi Sertifikat Studio (sertifikat.patradesa.id)
Sertifikat kelas diterbitkan oleh Sertifikat Studio lewat `POST /api/integrasi/terbitkan` (HMAC-SHA256, jendela 5 menit, idempoten dengan kunci `belajar-<id sertifikat>`). Nomor berformat `0001/PD/BELAJAR/2026`; verifikasi publik di `https://sertifikat.patradesa.id/v/KODE`.
1. Buat satu rahasia acak ≥ 32 karakter. Pasang di **kedua** aplikasi dengan nilai yang sama:
   - LMS (Worker `belajar-patradesa`) → Variables and Secrets → Secret `SERTIFIKAT_INTEGRATION_SECRET`.
   - Studio → Secret `LMS_INTEGRATION_SECRET` (lihat DEPLOY.md di repo certificate-studio).
2. `SERTIFIKAT_BASE_URL` sudah ada di `wrangler.toml` (staging & produksi). Tanpa secret, penerbitan tidak berjalan: sertifikat tersimpan "Menunggu Studio" dan admin melihat peringatan di tab **Sertifikat**.
3. Jalankan migrasi `0003_certificates` (LMS) dan `0003_integrasi_belajar` (Studio) sebelum deploy kode.
4. Uji: Admin → Kelas → **Buat kelas demo penilaian** → Review esai (nilai 2 esai) → tab Sertifikat menampilkan nomor PD/BELAJAR → cabut sertifikat demo setelah selesai (nomor tetap terpakai di Studio; staging memakai Studio produksi).

Bila Studio tidak bisa dihubungi, LMS mencoba ulang otomatis lewat Cron (backoff 1 menit → maks. 6 jam) dan admin bisa menekan **Terbitkan sekarang**. Bila rahasia bocor, ganti di kedua aplikasi sekaligus.

## 2. Deploy
```bash
npm ci && npm run check && npm run test:e2e        # semua hijau dulu
npx wrangler deploy --env staging                  # HANYA dengan persetujuan
# verifikasi: /api/v1/health, login Google, alur kuis, 423 AI, header (securityheaders), Lighthouse staging
npx wrangler deploy --env production               # persetujuan TERPISAH
```

## 3. Rollback
| Situasi | Langkah |
|---|---|
| Kode bermasalah | `npx wrangler deployments list --env <env>` → `npx wrangler rollback <deployment-id> --env <env>` (aset & kode kembali; D1 tidak berubah) |
| Migrasi bermasalah (staging) | `db/rollback/<n>.down.sql` lalu terapkan ulang |
| Migrasi/data bermasalah (produksi) | D1 Time Travel: `npx wrangler d1 time-travel info DB --env production` → `npx wrangler d1 time-travel restore DB --env production --timestamp <sebelum-insiden>` (uji di staging dulu) |
| Kebocoran secret | rotasi secret (`wrangler secret put`), cabut semua sesi: `UPDATE sessions SET revoked_at = unixepoch()*1000 WHERE revoked_at IS NULL` |

Aturan: migrasi baru harus **aditif** (kolom/tabel baru) agar rollback kode tidak merusak skema.

## 4. Backup & restore drill
- Mingguan: `npx wrangler d1 export DB --env production --remote --output backups/prod-YYYYMMDD.sql` → simpan terenkripsi di lokasi privat (bukan GitHub publik, bukan Drive bersama).
- Bulanan: restore ekspor ke D1 staging terpisah, jalankan smoke test, catat hasil.

## 5. Biaya & kuota (cek ulang plan aktif sebelum go-live)
- Workers Free/Paid (~US$5/bulan Paid), D1 & R2 punya kuota gratis; pilot 10–20 peserta diperkirakan jauh di bawah kuota.
- Cron tiap menit = ~43 rb invokasi/bulan (ringan). Rate limit D1 menambah tulis per request mutasi.
- Workers AI belum dipakai (Phase 2); pasang hard cap + alert sebelum mengaktifkan.
