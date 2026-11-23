# Laporan Fase 0 — LMS 2.0 (perbaikan cepat & verifikasi keamanan)
Tanggal: 23 November 2026 · Branch: `feat/scenario-block` (dari `main` f76dd91) · Acuan: `Road Map 2.0/00-LMS-2.0-RENCANA-PENGEMBANGAN.md` §10, backlog R2-00–R2-04.

## Perubahan
| Butir | Perubahan | Bukti |
|---|---|---|
| R2-00 robots.txt & sitemap.xml | Rute Worker `apps/api/src/routes/seo.ts`, dipasang di `app.ts` sebelum SPA fallback. robots: izinkan halaman publik, tolak `/api/`, `/admin`, `/masuk`, `/profil`, `/kelas-saya`, `/materi/`, `/kuis/`, `/hasil/`, `/sertifikat/`; `Disallow: /` bila host bukan APP_ORIGIN https. sitemap: `/`, `/panduan`, `/panduan/{peserta,admin}`, `/kelas/{slug}` untuk kelas `published` + `public` (lastmod = tanggal terbit). Cache 1 jam. | `tests/integration/seo.test.ts` (5 tes): content-type `text/plain` / `application/xml`, kelas draf tidak masuk, HEAD dilayani, slug panduan sinkron dengan `GUIDES` |
| R2-04 email kontak | Sudah satu konstanta `CONTACT.email` di `apps/web/src/guide/content.ts`; ditambah komentar cara menggantinya. Tes e2e panduan kini membaca `CONTACT.email` (bukan alamat tertulis). | `tests/e2e/guide.spec.ts` |
| R2-02 tes IDOR tambahan | Tes baru: pengguna tanpa enrollment → 404 untuk materi, berkas PDF, sesi belajar, heartbeat, mulai kuis; tidak ada attempt/progres tercipta. Tidak ada perubahan kode aplikasi (perilaku sudah benar). | `tests/security/security.test.ts` |

## Temuan verifikasi keamanan
| Butir | Status | Bukti |
|---|---|---|
| Berkas sensitif di produksi (`/package.json`, `/.env`, `/.dev.vars`, `/wrangler.toml`, `/.git/config`, `/apps/web/vite.config.ts`) | **Aman** | GET ke https://belajar.patradesa.id mengembalikan HTML SPA (200), bukan isi berkas; hanya `apps/web/dist` yang diunggah sebagai aset |
| Source map | **Aman** | `sourcemap: false` di Vite; bundle `/assets/index-*.js` tanpa `sourceMappingURL`; `*.js.map` → HTML SPA |
| Materi & jawaban kuis butuh login + enrollment | **Aman** | Anonim 401 (tes "endpoint privat"), non-peserta 404 (tes baru + `learning.test.ts`), attempt orang lain 404 untuk baca/jawab/submit/hasil |
| Cookie sesi | **Aman** | `__Host-pd_session`, HttpOnly, Secure, SameSite=Lax, Path=/, tanpa Domain (tes "cookie sesi") |
| Logout menginvalidasi sesi server | **Aman** | Token lama → 401 setelah logout; login merotasi sesi; hanya hash token di D1 (tes "sesi") |
| Rate limit kuis & rating | **Aman** (sudah ada) | `enforceRateLimit` di mulai attempt, jawaban, rating, heartbeat, login, cek sertifikat |
| Soft-404 | **Catatan** | Jalur tak dikenal mengembalikan 200 + HTML SPA (perilaku `single-page-application`). Tidak membocorkan data; berdampak kecil ke SEO. Tidak diubah. |
| robots/sitemap di produksi | **Bermasalah sampai dideploy** | Saat ini live mengembalikan `text/html`; perbaikan ada di branch ini |

## Belum dikerjakan / butuh keputusan Gus
- Alamat email @patradesa.id: ganti `CONTACT.email`, lalu `npm run guides` untuk memperbarui PDF panduan.
- Kebijakan privasi final (R2-05) — di luar kode.
- Deploy ke staging/domain resmi — menunggu izin Gus.
