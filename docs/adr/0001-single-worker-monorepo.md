# ADR-0001 — Satu Worker (API + static assets) dalam monorepo npm workspaces

Status: diterima (Phase 0) · Tanggal: 2026-11-21

## Konteks
SPEC §14 mengizinkan satu Worker berisi frontend + Hono API bila pemisahan rapi. Pilot 10–20 peserta; tim kecil; biaya harus minimal.

## Keputusan
- Satu Worker `patradesa-belajar` melayani `/api/v1/*` (Hono, `run_worker_first`) dan static assets React (Workers Static Assets, SPA fallback).
- Monorepo **npm workspaces** (pnpm tidak tersedia di mesin pengembang): `packages/shared` (Zod schema, tipe, parser konten), `apps/api`, `apps/web`.
- Header keamanan HTML lewat `apps/web/public/_headers`; header API lewat middleware Hono.
- API same-origin: tidak ada CORS sama sekali.

## Konsekuensi
+ Satu deploy, satu domain, cookie `__Host-` sederhana, tanpa CORS.
− Skala/isolasi terbatas; bila admin dipisah kelak, buat Worker kedua dengan binding D1 yang sama.
