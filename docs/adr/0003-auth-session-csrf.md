# ADR-0003 — Autentikasi, sesi, CSRF, Turnstile

Status: diterima · Tanggal: 2026-11-21

## Keputusan
- **Google OIDC** Authorization Code + **PKCE S256** + `state` + `nonce`. State disimpan sebagai hash di `oauth_states`, sekali pakai (`DELETE … RETURNING`), TTL 10 menit. ID token diverifikasi dengan `jose` terhadap JWKS Google: tanda tangan RS256, issuer, audience, expiry, nonce; `email_verified` wajib.
- `redirect_uri` dibangun dari `APP_ORIGIN` (allowlist konfigurasi), tidak dari header Host. `returnTo` divalidasi (path relatif, bukan `//`).
- **Turnstile** diverifikasi server-side (Siteverify) sebelum alur OAuth dimulai, sehingga `start` menjadi `POST /auth/google/start` (bukan GET seperti tabel SPEC §10) — perubahan sengaja agar token Turnstile bisa dikirim. Kunci uji resmi Cloudflare dipakai di dev.
- **Sesi**: token acak 256-bit, hanya **SHA-256 hash** disimpan; cookie `__Host-pd_session` (Secure, HttpOnly, SameSite=Lax, Path=/). Rotasi saat login (sesi lama dari cookie dicabut). TTL 7 hari learner, 12 jam untuk role istimewa. Perubahan role mencabut semua sesi target.
- **CSRF**: semua mutasi wajib `Origin` = `APP_ORIGIN` (atau `Sec-Fetch-Site: same-origin`), dan bila ada sesi, header `X-CSRF-Token` = `HMAC(SESSION_SECRET, "csrf:"+session_id)` (dibandingkan waktu-konstan). Token CSRF hanya di memori JS, bukan localStorage.
- **Role sistem** di `system_roles`; jabatan desa (`user_profiles.village_role`) hanya metadata. Tidak ada jalur kode dari profil ke role. Hanya `super_admin` yang dapat memberi/mencabut `admin`/`super_admin`.
- **Bootstrap super_admin pertama**: via SQL terdokumentasi (docs/deploy.md), bukan variabel lingkungan, untuk menghindari jalur eskalasi lewat konfigurasi.
- **Dev login** (`POST /auth/dev-login`) hanya bila `ENVIRONMENT=development` **dan** `DEV_LOGIN_ENABLED=true` **dan** host `localhost/127.0.0.1`; staging/prod memaksa `DEV_LOGIN_ENABLED=false` di wrangler.toml dan diuji 404.
- Magic link email ditunda (butuh penyedia email transaksional).

## Konsekuensi
Admin MFA bergantung pada akun Google (rekomendasi: wajibkan 2-Step Verification untuk akun admin; dapat ditambah Cloudflare Access untuk `/admin` di Phase 3).
