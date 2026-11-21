# Keamanan — PatraDesa Belajar

## Melaporkan kerentanan
Kirim laporan privat ke pengelola repositori (jangan buka issue publik). Sertakan langkah reproduksi. Jangan menguji terhadap data peserta nyata.

## Kontrol yang diterapkan (Phase 0/1)
| Area | Kontrol | Lokasi / bukti |
|---|---|---|
| Identitas | Google OIDC Code + PKCE S256, state sekali pakai, nonce, verifikasi JWKS/iss/aud/exp, `email_verified` | `apps/api/src/routes/auth.ts`, `tests/security` |
| Bot | Turnstile Siteverify server-side sebelum OAuth; rate limit login per IP (dipseudonimkan) | idem |
| Sesi | Token 256-bit, hanya SHA-256 di D1, `__Host-` Secure HttpOnly SameSite=Lax, rotasi saat login, logout mencabut, role berubah → sesi dicabut | `middleware/auth.ts` |
| CSRF | Origin/Sec-Fetch-Site same-origin + `X-CSRF-Token` HMAC terikat sesi | `middleware/security.ts` |
| Otorisasi | RBAC per route; cek kepemilikan objek (attempt, enrollment, lesson) → 404 untuk IDOR; eskalasi admin hanya oleh super_admin | `routes/*`, `services/access.ts` |
| Ujian | Exam lock AI (423), satu attempt aktif (unique index parsial), skor/timer/acak/kunci di server, kunci jawaban tidak pernah dikirim | ADR-0004 |
| Input | Zod strict (field asing ditolak), batas ukuran body, prepared statements | `packages/shared/src/schemas.ts` |
| XSS | Konten terstruktur tanpa HTML; tanpa `innerHTML` (ESLint); CSP ketat (`_headers`) | ADR-0006 |
| Berkas | Upload admin saja, `application/pdf` + magic bytes + ≤20 MB; R2 privat lewat Worker; `no-store` | `routes/admin.ts`, `routes/learner.ts` |
| Header | CSP, HSTS (staging/prod), nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, `no-store` API | `middleware/security.ts`, `apps/web/public/_headers` |
| Audit | `admin_audit_logs` tanpa teks esai/token; `security_events` minimal (retensi 90 hari) | `lib/audit.ts` |
| Dev login | Hanya `ENVIRONMENT=development` + flag + host localhost; diuji 404 di staging/prod | `tests/security` |
| Supply chain | Dependabot, `npm audit` di CI, versi dependensi dipin | `.github/` |

## Batasan yang disadari
- Anti-copy hanyalah penghalang; screenshot/OCR/DevTools/perangkat lain tetap mungkin. Kontrol utama: bank soal, acak, timer server, review.
- MVP tidak memverifikasi identitas pengerja ujian (tanpa proctoring).
- Rate limit berbasis D1 cocok untuk pilot; skala besar → binding Rate Limiting Cloudflare.
- MFA admin bergantung pada akun Google; disarankan Cloudflare Access untuk `/admin` sebelum produksi.

## Threat model (SPEC §11) → mitigasi
Account takeover (OIDC, sesi hash, rotasi) · role spoofing (role sistem terpisah, uji eskalasi) · IDOR (cek kepemilikan, uji) · SQLi (prepared, uji) · XSS materi (format terstruktur, uji) · grade tampering & answer-key leakage (skor SQL di server, kunci tidak dikirim, uji) · clock tampering (jam server, uji) · concurrent submit (finalisasi bersyarat, uji) · re-login question fishing (snapshot attempt, idempoten, uji) · AI prompt injection/hallucination/quota (Phase 2; lock & kuota sudah diuji) · scraping PDF (auth + enrollment) · kebocoran kredensial (secret via `wrangler secret`, `.dev.vars` di-ignore).
