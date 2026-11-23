# Laporan Fase 1 — Blok Skenario Bercabang (LMS 2.0)
Tanggal: 23 November 2026 · Branch: `feat/scenario-block` · Spesifikasi: `docs/scenario-block/README.md` · Keputusan: `docs/adr/0008-blok-skenario.md`

## Yang selesai
| Bagian | Berkas utama |
|---|---|
| Migrasi `0005` (4 tabel + index, rollback, versi console D1) | `db/migrations/0005_scenario_blocks.sql`, `db/rollback/…`, `db/console/…` |
| Validator TS setara `validate_scenario.py` (Zod + aturan alur F1–F9 + maxScore), sintaks `[[skenario:kunci]]` | `packages/shared/src/scenario.ts`, `content.ts` |
| API peserta: mulai/lanjut attempt, pilih, baca | `apps/api/src/services/scenarios.ts`, `routes/learner.ts` |
| Admin: simpan/versi JSON, status (terbit hanya admin + penelaah), statistik agregat | `apps/api/src/routes/adminScenarios.ts` |
| Pin versi skenario saat kelas terbit; skenario `graded` masuk syarat lulus, progres, dan alasan belum lulus | `routes/admin.ts`, `services/certificates.ts`, `services/courses.ts` |
| Komponen peserta `ScenarioBlock` (lazy + IntersectionObserver), Markdown terbatas tanpa HTML, aria-live, fokus ke judul, kirim ulang saat sinyal putus | `apps/web/src/components/ScenarioBlock.tsx`, `pages/LessonPage.tsx` |
| Admin UI: menu **Skenario** (unggah JSON, galat berlokasi, pratinjau alur, terbit, arsip, statistik dengan filter) | `apps/web/src/admin/ScenarioAdmin.tsx` |
| Seed lokal: skenario contoh sebagai **draf** | `scripts/seed-dev.mjs` |

## Bukti uji
| Perintah | Hasil |
|---|---|
| `npm run check` (typecheck, lint, Vitest unit+integrasi+web, build, budget) | lulus — 210 tes; JS awal 85,0 KiB (sebelum: 84,3; naik 0,7 KiB) |
| `tests/unit/scenario.test.ts` | contoh valid, maxScore 30; 6 kasus rusak ditolak dengan pesan identik validator Python; skor terbaik 100% / terburuk 0% |
| `tests/integration/scenario.test.ts` | tanpa kebocoran kunci; 404 bukan pemilik/tidak terdaftar; 409 node tidak aktif & jawaban berbeda; idempoten; batas attempt; kelulusan; statistik (sel <5 disamarkan, audit, mentor tak ditugaskan 404) |
| `PW_CHANNEL=msedge npx playwright test tests/e2e/scenario.spec.ts` | lulus — keyboard penuh di 360 px, axe di 4 layar, tanpa scroll horizontal |

## Belum dikerjakan / keputusan Gus
- Deploy & migrasi D1 staging/domain resmi — menunggu izin (`npx wrangler d1 migrations apply DB --env staging --remote` lalu deploy).
- Konten pilot: skenario contoh masih **draf**; perlu ditelaah & diterbitkan, lalu disisipkan di kelas pilot.
- Editor skenario berbasis form, pratinjau sebagai peserta tanpa enrollment, dan pemberian tambahan attempt oleh mentor belum ada.
- K-01 (skenario tidak ikut exam lock) diterapkan sesuai usulan; ubah bila Gus memutuskan lain.
