# ADR-0006 — Format konten, rate limit, arsitektur frontend, strategi uji

Status: diterima · Tanggal: 2026-11-21

## Format konten terpercaya (anti-XSS)
Admin menulis "Markdown-lite" (`##`, `-`, `1.`, `>`, `---`, `**tebal**`, `[teks](https://…)`). Server mem-parse menjadi blok JSON (`packages/shared/src/content.ts`). Renderer React hanya membuat elemen dari tipe blok yang dikenal dengan text node — **tanpa** `innerHTML`/`dangerouslySetInnerHTML` (dilarang lewat aturan ESLint). Tautan hanya `https://`. HTML mentah tampil sebagai teks.

## Rate limit
Fixed-window di D1 (`rate_limits`) untuk login, heartbeat, autosave, start attempt. Cukup untuk pilot; untuk skala lebih besar pindah ke binding Rate Limiting Cloudflare. IP dipseudonimkan (hash dengan secret).

## Frontend
React 19 + Vite, **tanpa** router/UI library: router mini (History API) + CSS variables. Rute ujian, admin, PDF, YouTube, dan panel AI di-*lazy load*. Skala teks via `--font-scale` pada `html { font-size: calc(100% * var(--font-scale)) }` sehingga semua ukuran `rem` ikut membesar tanpa mengunci zoom browser. Preferensi disimpan di `localStorage` dengan fallback bila diblokir.

## Gaya visual (selaras patradesa.id)
Token warna & komponen meniru patradesa.id: hijau hutan `#334E0F` untuk judul/tautan/tombol utama, latar krem `#FBFAF6`, aksen amber `#DD9933` dengan teks gelap `#1B2620` untuk CTA, kartu radius 16px dengan garis `#E7E3D8`, label pil huruf kapital, ikon garis (stroke 1.8), hero & footer hijau gelap. Judul memakai **Plus Jakarta Sans** (font yang dipakai patradesa.id; lisensi OFL) yang di-*self-host* lewat `@fontsource` — hanya subset latin bobot 700/800 (~12 KB woff2 per bobot, `font-display: swap`), tanpa Google Fonts. Teks badan tetap font sistem 16px (SPEC §3A). Header memakai logo resmi Patra Desa (`apps/web/public/logo-patradesa.png`, 394×96, ~16 KB, tampil 40–48 px; berkas dari pengelola), favicon & apple-touch-icon dipotong dari tanda belah ketupat logo tersebut. Logo berisi teks sehingga diberi tinggi px tetap (tidak ikut skala teks) agar header tidak membengkak saat teks 200%. Semua pasangan warna diuji otomatis (WCAG 2.2 AA).

## Halaman masuk admin
`/admin/masuk` adalah UI khusus pengelola dengan autentikasi yang sama (Google OIDC, tanpa kata sandi). Tamu yang membuka `/admin` diarahkan ke halaman ini; akun tanpa role pengelola mendapat pesan "tidak memiliki akses". Penegakan tetap di server (`requireRole` pada setiap `/api/v1/admin/*`).

## Anti-copy
`QuizQuestionRegion` hanya membungkus stem & opsi: `user-select: none`, `contextmenu` dicegah, `copy/cut` ditolak bila seleksi berasal dari area itu. Textarea esai berada di luar region. Kebijakan per kuis (`exam_copy_deterrence_enabled`) + pengecualian per peserta (`user_accommodations.copy_deterrence_exempt`) dihitung server saat attempt dibuat (`attempts.copy_deterrence_active`). Ini penghalang ringan, bukan jaminan.

## Strategi uji
- Unit (Vitest/node): parser, skema, kripto, pola path AI, **kontras token dibaca dari tokens.css**.
- Integrasi & keamanan (Vitest + Miniflare): app Hono asli + **D1/R2 asli di workerd lokal**, jam terkendali, AI spy. Tanpa mock database.
- Komponen (Vitest + jsdom + Testing Library): ExamLayout, anti-copy, font control.
- E2E (Playwright) terhadap `wrangler dev` + D1 lokal: alur peserta, 423 lintas tab/perangkat, 320px/200%, axe-core WCAG 2.2 AA.
- Anggaran: `scripts/check-budget.mjs` (gzip aset awal), `scripts/lighthouse.mjs` (Lighthouse mobile).
