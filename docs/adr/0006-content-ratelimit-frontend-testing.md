# ADR-0006 — Format konten, rate limit, arsitektur frontend, strategi uji

Status: diterima · Tanggal: 2026-11-21

## Format konten terpercaya (anti-XSS)
Admin menulis "Markdown-lite" (`##`, `-`, `1.`, `>`, `---`, `**tebal**`, `[teks](https://…)`). Server mem-parse menjadi blok JSON (`packages/shared/src/content.ts`). Renderer React hanya membuat elemen dari tipe blok yang dikenal dengan text node — **tanpa** `innerHTML`/`dangerouslySetInnerHTML` (dilarang lewat aturan ESLint). Tautan hanya `https://`. HTML mentah tampil sebagai teks.

## Rate limit
Fixed-window di D1 (`rate_limits`) untuk login, heartbeat, autosave, start attempt. Cukup untuk pilot; untuk skala lebih besar pindah ke binding Rate Limiting Cloudflare. IP dipseudonimkan (hash dengan secret).

## Frontend
React 19 + Vite, **tanpa** router/UI library: router mini (History API) + CSS variables. Rute ujian, admin, PDF, YouTube, dan panel AI di-*lazy load*. Skala teks via `--font-scale` pada `html { font-size: calc(100% * var(--font-scale)) }` sehingga semua ukuran `rem` ikut membesar tanpa mengunci zoom browser. Preferensi disimpan di `localStorage` dengan fallback bila diblokir.

## Anti-copy
`QuizQuestionRegion` hanya membungkus stem & opsi: `user-select: none`, `contextmenu` dicegah, `copy/cut` ditolak bila seleksi berasal dari area itu. Textarea esai berada di luar region. Kebijakan per kuis (`exam_copy_deterrence_enabled`) + pengecualian per peserta (`user_accommodations.copy_deterrence_exempt`) dihitung server saat attempt dibuat (`attempts.copy_deterrence_active`). Ini penghalang ringan, bukan jaminan.

## Strategi uji
- Unit (Vitest/node): parser, skema, kripto, pola path AI, **kontras token dibaca dari tokens.css**.
- Integrasi & keamanan (Vitest + Miniflare): app Hono asli + **D1/R2 asli di workerd lokal**, jam terkendali, AI spy. Tanpa mock database.
- Komponen (Vitest + jsdom + Testing Library): ExamLayout, anti-copy, font control.
- E2E (Playwright) terhadap `wrangler dev` + D1 lokal: alur peserta, 423 lintas tab/perangkat, 320px/200%, axe-core WCAG 2.2 AA.
- Anggaran: `scripts/check-budget.mjs` (gzip aset awal), `scripts/lighthouse.mjs` (Lighthouse mobile).
