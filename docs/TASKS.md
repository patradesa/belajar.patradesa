# Checklist tugas & dependensi

Legenda: ✅ selesai di repo · ⏳ butuh persetujuan/akses · ⬜ belum

## Phase 0 — Fondasi
| # | Tugas | Bergantung pada | Status |
|---|---|---|---|
| 0.1 | Repo, workspaces, TS strict, ESLint, Vitest, Playwright | — | ✅ |
| 0.2 | ADR 0001–0006 | — | ✅ |
| 0.3 | Migrasi D1 0001 + rollback dev | 0.1 | ✅ |
| 0.4 | Auth Google OIDC PKCE + Turnstile + sesi + CSRF | 0.3 | ✅ (kode & uji); ⏳ client ID/secret nyata |
| 0.5 | RBAC learner/mentor/editor/admin/super_admin | 0.4 | ✅ |
| 0.6 | Katalog & rekomendasi jabatan | 0.3 | ✅ |
| 0.7 | Data demo fiktif (`db/seed`, `scripts/seed-dev.mjs`) | 0.6 | ✅ |
| 0.8 | CI GitHub Actions (typecheck, lint, test, build, budget, e2e, audit) | 0.1 | ✅ (belum di-push) |
| 0.9 | Cloudflare dev/staging (D1, R2, secrets, domain) | 0.8 | ⏳ |

## Phase 1 — MVP fungsional tanpa AI
| # | Tugas | Bergantung pada | Status |
|---|---|---|---|
| 1.1 | Admin course/versi/lesson/PDF/kuis/bank soal/publish | 0.5 | ✅ |
| 1.2 | Reader HTML/slide/PDF/YouTube + sesi belajar + heartbeat | 1.1 | ✅ |
| 1.3 | Gating kuis, acak server, snapshot, timer, autosave, submit/expiry | 1.2 | ✅ |
| 1.4 | Exam lock AI + anti-copy terbatas + akomodasi | 1.3 | ✅ |
| 1.5 | Esai → review manual, hasil, banding | 1.3 | ✅ |
| 1.6 | Laporan & log audit | 1.1 | ✅ (dasar) |
| 1.7 | Aksesibilitas & performa (axe, kontras, 320/200%, Lighthouse, budget) | 1.2 | ✅ lokal; ⏳ perangkat fisik |
| 1.8 | Deploy staging + smoke test | 0.9 | ⏳ |
| 1.9 | Dataset pilot (materi nyata yang disetujui) | 1.1 | ⬜ |

## Phase 2+ (tidak dikerjakan)
AI tutor, penilaian esai AI, kuota/biaya, sertifikat, magic link email, Cloudflare Access admin, ekspor data.
