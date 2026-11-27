# PatraDesa Belajar

LMS ringan, mobile-first untuk perangkat desa — Cloudflare Workers (Hono) + D1 + R2 privat + React/Vite/TypeScript.
Spesifikasi lengkap: [SPEC.md](SPEC.md). Status: **Phase 0 + Phase 1 (tanpa AI)**, belum pernah di-deploy.

## Isi
- Login Google OIDC (PKCE + state + nonce) dengan Turnstile; sesi cookie `__Host-` HttpOnly (hash token di D1); CSRF.
- Role sistem (learner, mentor, content_editor, admin, super_admin) terpisah dari jabatan desa (hanya rekomendasi).
- Katalog, pendaftaran dengan jendela waktu, materi bacaan/slide/PDF privat (R2)/YouTube (lazy, nocookie).
- Waktu belajar server-authoritative (heartbeat terbatas), kuis terbuka setelah syarat terpenuhi.
- Kuis: acak kriptografis per attempt + snapshot, timer server, autosave, batas attempt/cooldown, idempoten, esai → review manusia dengan rubrik, banding.
- **Exam lock AI**: semua endpoint AI learner → `423 EXAM_LOCKED` selama ada attempt aktif (lintas tab/perangkat/API). Lihat [ADR-0004](docs/adr/0004-exam-lock.md).
- Anti-copy ringan HANYA pada soal/opsi; esai bebas; pengecualian aksesibilitas per peserta.
- Aksesibilitas: token warna brand teruji WCAG 2.2 AA, font sistem, kontrol A−/A+/Reset (100–200%) di materi & kuis, 320px tanpa scroll horizontal, axe-core tanpa pelanggaran.
- Admin: kelas berversi (draft → terbit, immutable), materi, kuis & bank soal, review esai buta, pengguna/role/akomodasi, laporan, log audit.

## Mulai (lokal)
Prasyarat: Node ≥ 22.

```bash
npm install
cp .dev.vars.example .dev.vars      # isi SESSION_SECRET acak; placeholder Google boleh dibiarkan (pakai dev-login)
npm run dev                          # build web + migrasi D1 lokal + wrangler dev → http://localhost:8787
npm run seed:dev                     # terminal lain: kelas demo fiktif lewat API admin
```
Masuk di `/masuk` dengan **Login pengembangan** (hanya aktif di localhost saat `ENVIRONMENT=development`).

**Cara cepat sehari-hari: `npm run lokal`** (satu perintah, satu terminal). Membangun tampilan, migrasi D1 lokal, menjalankan server, dan
mengisi kelas demo sekali. Data disimpan di `.wrangler/lokal` (tetap ada setelah server dimatikan); tampilan dibangun ulang otomatis ±1 detik
setelah kode diubah, cukup muat ulang halaman. Admin: `/admin/masuk` → **Masuk (dev)**. Mulai dari kosong: `npm run lokal -- --reset`.
Di Claude desktop, panel Browser menjalankannya lewat `.claude/launch.json` (nama `lms-lokal`).

Alur kerja yang disarankan: selama mengubah kode jalankan tes yang terkait saja (mis. `npx vitest run tests/unit/x.test.ts`,
`npx tsc -p apps/web`), lalu `npm run check` + `npm run test:e2e` sekali sebelum commit.

## Perintah
| Perintah | Fungsi |
|---|---|
| `npm run typecheck` | TypeScript strict (shared, api, web, tests) |
| `npm run lint` | ESLint (+ jsx-a11y, react-hooks, larangan `innerHTML`) |
| `npm test` | Unit + integrasi/keamanan (D1 asli via Miniflare) + komponen (jsdom) |
| `npm run build` / `npm run budget` | Build web, cek anggaran JS ≤150 KiB & CSS ≤35 KiB gzip, tanpa font eksternal |
| `npm run test:e2e` | Playwright terhadap `wrangler dev` (lokal Windows: `PW_CHANNEL=msedge`) |
| `npm run lighthouse` | Lighthouse mobile (server lokal harus berjalan; set `CHROME_PATH`) |
| `npm run check` | typecheck + lint + test + build + budget |
| `npm run guides` | Buat ulang tangkapan layar & PDF panduan A4 (`apps/web/public/panduan/`) dari `apps/web/src/guide/content.ts`; jalankan setelah isi panduan atau tampilan berubah, lalu commit hasilnya |

## Struktur
```
apps/api         Hono Worker (routes, middleware, services, ai adapter)
apps/web         React SPA (pages, exam [lazy], admin [lazy], styles/tokens.css)
packages/shared  Zod schema, tipe API, parser konten aman
db/migrations    migrasi D1 berurutan;  db/rollback (dev/staging);  db/seed data demo FIKTIF
tests/           unit | integration | security | e2e | helpers
docs/            adr, deploy.md, test-cases.md, ai-evaluation.md, TASKS.md, REPORT-phase0-1.md
```
Lihat juga [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md), [docs/deploy.md](docs/deploy.md).
