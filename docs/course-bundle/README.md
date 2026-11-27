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

## Batas
Berkas ≤ 2 MB · ≤ 30 materi · ≤ 40 skenario · ≤ 500 soal per kuis. Materi PDF perlu diunggah berkasnya lewat editor setelah impor.
