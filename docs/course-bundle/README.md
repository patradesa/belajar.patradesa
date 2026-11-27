# Paket kelas (course bundle) v1

Satu berkas JSON berisi kelas, materi, kuis + soal, dan skenario, diimpor lewat **Admin → Impor paket**.
Definisi runtime: `packages/shared/src/schemas/courseBundle.ts`. Contoh lengkap: `contoh-paket-kelas.json`.

## Alur
1. Admin/editor memilih berkas. Server memvalidasi (`POST /api/v1/admin/courses/import-bundle/validate`) dan mengembalikan ringkasan, **masalah** (menghalangi impor), **peringatan**, dan rencana skenario.
2. Admin menekan **Impor sebagai draf**. Halaman menjalankan impor **bertahap** lewat endpoint yang sudah ada, dengan progres per langkah:
   skenario (`POST /admin/scenarios`, draf) → kelas (`POST /admin/courses` + jabatan) → tiap materi (`POST /admin/courses/:id/lessons`) → kuis (`PUT /admin/lessons/:id/assessment`) → soal per 5 (`POST /admin/assessments/:id/questions/import`).
3. Hasil: kelas **draf** (privat bila tidak diatur), skenario **draf**. Penelaah menerbitkan skenario di tab Skenario, lalu admin menerbitkan kelas di editor.

**Mengapa bertahap, bukan satu permintaan?** D1 paket Free membatasi ±50 query per permintaan Worker. Satu kelas utuh (mis. 16 skenario, 10 materi, 20 soal beserta opsinya) butuh ratusan statement. Endpoint validasi hanya memakai ≤ 3 query.

Bila impor berhenti di tengah, langkah yang sudah selesai tetap tersimpan sebagai draf; pesan menyebut langkah yang gagal. Lanjutkan atau perbaiki lewat editor kelas.

## Format
```jsonc
{
  "schemaVersion": "patradesa-course-bundle-v1",
  "course": {
    "slug": "kelola-dana-desa-2026",        // unik; huruf kecil, angka, tanda minus
    "title": "…", "description": "…",
    "visibility": "private",                 // bawaan private
    "targetRoles": ["sekdes", "kaur"]        // kode jabatan LMS (opsional)
  },
  "scenarios": [ { …definisi skenario lengkap, format docs/scenario-block… } ],
  "lessons": [
    {
      "lessonKey": "dd26-u01-pilih-dasar-aturan",   // wajib; dipakai remedial & pindah versi
      "title": "…", "summary": "…",
      "contentType": "html",                          // html | slides | pdf | youtube
      "contentSource": "## 1. AMATI\n…\n[[skenario:dd26-u01-cek]]",
      "requiredActiveSeconds": 300, "isRequired": true,
      "quiz": {                                       // opsional; sama dengan formulir kuis
        "title": "…", "timeLimitSeconds": 900, "passingScorePct": 70, "maxAttempts": 3,
        "cooldownSeconds": 0, "mcqCount": 10, "essayCount": 0, "isRequired": true, "reviewPolicy": "after_done",
        "questions": [ { "type": "mcq", "stem": "…", "options": [ … ], "explanation": "…" } ]
      }
    }
  ]
}
```
Setiap bagian memakai skema endpoint yang sama dengan editor (materi, kuis, soal, skenario), jadi paket yang lolos validasi diterima saat impor.

## Aturan validasi
| Masalah (menghalangi) | Peringatan |
|---|---|
| `schemaVersion` salah, field tak dikenal, tipe salah | Tabel Markdown `| … |` di isi materi (tampil sebagai teks) |
| Slug kelas sudah dipakai | Tag HTML di isi materi (tampil sebagai teks) |
| Skenario tidak lolos validator (aturan alur F1–F9) | Skenario sudah terbit → dibuat versi baru (draf) |
| Skenario masih punya draf/ditelaah di LMS (agar tidak tertimpa) | |
| `[[skenario:kode]]` tidak ada di paket maupun di LMS | |
| `lessonKey` atau ID skenario ganda | |
| Kuis menampilkan lebih banyak soal daripada isi bank | |

## Format 1.0.0 (diubah otomatis)
Berkas dari alur produksi materi berbantuan AI memakai bentuk lain: `"schema_version": "1.0.0"`, `course`, `modules[]` dengan `content_html`, `interactive_blocks`, dan `questions`. Halaman Impor paket dan endpoint validasi **mengenali bentuk ini dan mengubahnya** ke paket v1 di atas dengan pengubah yang sama (`packages/shared/src/schemas/coursePackageV1.ts`), lalu memeriksa hasilnya seperti biasa. Semua keputusan pengubahan tampil sebagai *Catatan pengubahan* sebelum impor.

| Sumber 1.0.0 | Hasil di LMS |
|---|---|
| `course.slug/title/summary` | kelas privat, slug sama; `upsert_by_slug` **tidak** memperbarui kelas lama — impor selalu membuat kelas baru |
| `course.target_roles` (teks bebas) | kode jabatan LMS lewat kata kunci (perbekel, sekretaris, kaur, kasi, kelian → kawil, operator/SID, BPD, kader/PKK/BUMDes); yang tak cocok dilewati + catatan |
| `modules[]` | satu materi per modul; `lessonKey` = `slug`; waktu aktif minimum = ½ `duration_minutes`; `is_mandatory` → wajib |
| `content_html` | Markdown-lite: h2/h3 → `##`/`###`, p, li, blockquote, **tebal**, tautan https. Tag lain dibuang (teks tetap) + catatan. Bila tidak ada h2, diberi bagian `## Bacaan` |
| `interactive_blocks` | tiap blok jadi skenario draf (ID = `id` blok) dan bagian `## Latihan: <judul>` berisi `[[skenario:id]]` |
| · `branching_scenario` | node keputusan; penilaian pilihan dari `verdict` bila ada, atau kata pembuka umpan balik: *Tepat* → terbaik 10, *Bisa diterima/Cukup* → 6, *Berisiko* → 3, *Kurang tepat/Tidak tepat/Salah* → 0. **Tidak bisa ditentukan → masalah**, bukan tebakan. `next_node_id: null` → node akhir |
| · `drag_and_drop` | satu pertanyaan "pilih kategori" per butir (2–4 kategori) |
| · `hotspot_checklist` | latihan langkah demi langkah tanpa skor (situasi → langkah yang disarankan) |
| `questions` semua modul | satu kuis **Evaluasi Akhir** di materi terakhir; lulus = `completion_rules.min_quiz_score` (bawaan 70), 3 kesempatan, pembahasan setelah selesai |
| · `multiple_choice` | `correct_answer` harus sama persis dengan tepat satu opsi (bila tidak → masalah); `feedback` → pembahasan |
| · `essay` | rubrik dibagi rata total 100 (tinjau di editor kuis) |

Skenario hasil pengubahan berstatus **draf**, mode formatif, 3 kesempatan, berlaku sejak tanggal impor. Telaah penilaian pilihan sebelum menerbitkan. Aturan remedial dan metadata lain (`low_bandwidth_mode`, dsb.) belum dipakai dan disebut di catatan.

## Batas
Berkas ≤ 2 MB · ≤ 30 materi · ≤ 40 skenario · ≤ 500 soal per kuis. Materi PDF perlu diunggah berkasnya lewat editor setelah impor.
