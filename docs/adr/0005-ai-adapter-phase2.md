# ADR-0005 — Adapter AI terpisah; AI dinonaktifkan di Phase 0/1

Status: diterima · Tanggal: 2026-11-21

- Interface `AiProvider` (`apps/api/src/ai/provider.ts`). Produksi Phase 1 memakai `DisabledAiProvider`: endpoint AI mengembalikan fallback non-AI (status 200, `mode: "fallback"`) dan **tidak** mendebit kuota.
- Endpoint AI learner sudah ada (chat/summary/explain/hint/recommendations) agar exam lock, kuota, dan pemeriksaan akses dapat diuji sekarang dengan provider spy.
- Konteks AI hanya dari `lesson_sources` yang disetujui (`approved_at` tidak null). Tidak ada browsing/tool/DB write untuk model.
- Phase 2: `WorkersAiProvider` (model dipilih sesuai plan aktif), kuota per user/hari + cap global, log token tanpa isi prompt, retrieval FTS5. Penilaian esai AI sebagai job internal pasca-final dengan output JSON tervalidasi dan review manusia wajib.
