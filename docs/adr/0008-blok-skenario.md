# ADR-0008 — Blok Skenario Bercabang

Status: diterima · Tanggal: 2026-11-23 · Spesifikasi: `docs/scenario-block/README.md` · Rencana: LMS 2.0 Fase 1

## Masalah
Perangkat desa perlu berlatih mengambil keputusan di situasi nyata (pelayanan adminduk, pengaduan, musyawarah), bukan hanya membaca materi lalu mengerjakan kuis. Masukan eksternal menyarankan H5P; itu bertentangan dengan CSP ketat, anggaran bundle, dan prinsip "kunci jawaban di server" (ADR-0006).

## Keputusan
1. **Blok native, bukan H5P.** Skenario adalah JSON terversi (`scenario_blocks`) yang divalidasi server (`packages/shared/src/scenario.ts`, setara `validate_scenario.py`). Tanpa dependensi baru.
2. **Disisipkan di materi** dengan baris `[[skenario:kunci]]` → blok `{type:'scenario', key}`. Renderer lama mengabaikan tipe tak dikenal.
3. **Pin saat terbit.** `POST /admin/courses/:id/publish` mem-pin versi published terbaru setiap kunci ke `lesson_scenarios`, dalam batch yang sama dengan penerbitan. Kunci yang belum terbit → 409. Enrollment yang dipin ke versi kelas (ADR-0002) otomatis memakai versi skenario yang sama.
4. **Server memegang kunci.** Delivery hanya berisi node aktif; opsi dikirim sebagai `p1..p4` hasil acak CSPRNG per attempt. `verdict`/`score`/`feedback`/`nextNodeId` baru dikirim setelah peserta memilih; `scoring`, `review`, `authors`, id opsi asli tidak pernah dikirim.
5. **Transisi aman konkuren.** Pilihan = INSERT bersyarat + UPDATE bersyarat (`status='in_progress' AND current_node_id=?`) dalam satu batch; `UNIQUE(attempt_id,node_id)` mencegah jawaban ganda. Kirim ulang pilihan yang sama mengembalikan hasil yang sama (aman untuk sinyal putus); pilihan berbeda → 409. Satu attempt aktif per (user, blok) lewat unique index parsial.
6. **Kelulusan.** Blok `graded` pada materi wajib harus `passed=1` (attempt terbaik) agar `completionState` lengkap; dihitung sebagai "kuis" di progres. Blok `formative` tidak memengaruhi kelulusan.
7. **Tidak ikut exam lock (keputusan K-01).** Attempt skenario bukan baris `attempts`, jadi tidak mengunci AI dan tidak terkunci oleh kuis aktif. Skenario adalah latihan bertahap dengan umpan balik langsung, bukan ujian. Tinjau ulang bila AI tutor diaktifkan.
8. **Statistik privat.** `GET /admin/scenarios/:id/stats`: admin, atau mentor yang ditugaskan ke kelas yang memasang blok (selain itu 404). Tanpa nama/email; sel 1–4 disamarkan (`null`); setiap akses diaudit. Profil jabatan/wilayah disalin ke attempt saat mulai (snapshot) agar laporan MEAL stabil.
9. **Penerbitan skenario hanya admin**, wajib data penelaah; penerbitan oleh pembuatnya sendiri dicatat `selfReviewed: true` di audit (tidak diblokir karena tim pilot kecil).

## Konsekuensi
- Rute peserta memakai `/scenario-attempts/:id` karena `/attempts/:id` sudah dipakai kuis.
- Menambah 4 tabel (migrasi 0005) dan 1 chunk frontend yang di-lazy-load.
- Editor visual dan pratinjau-sebagai-peserta tanpa enrollment belum ada (pratinjau = pohon read-only di admin).

## Bukti
`tests/unit/scenario.test.ts` (validator, skor, parser), `tests/integration/scenario.test.ts` (authoring, pin, kebocoran kunci, 404/409, batas attempt, kelulusan, statistik), `apps/web/src/components/scenario.test.tsx` (UI).
