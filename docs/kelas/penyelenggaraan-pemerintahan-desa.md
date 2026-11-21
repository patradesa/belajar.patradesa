# Kelas: Penyelenggaraan Pemerintahan Desa

Dokumen ini berisi teks siap tempel untuk menyiapkan kelas di menu **Admin**. Bank soal berisi kunci jawaban, jadi **tidak** disimpan di repo. Letaknya di `content-private/bank-soal/penyelenggaraan-pemerintahan-desa.json` (di-*gitignore*); versi tinjauannya ada di `…​.md` di folder yang sama.

## 1. Data kelas (Admin → Kelas → Buat kelas baru)

| Kolom | Isi |
|---|---|
| Judul | Penyelenggaraan Pemerintahan Desa |
| Slug URL | `penyelenggaraan-pemerintahan-desa` |
| Visibilitas | Publik |
| Disarankan untuk jabatan | Perbekel/Kepala Desa, Sekretaris Desa, Kaur, Kasi, Kepala Kewilayahan, Anggota BPD, Operator SID |

**Deskripsi (tempel ke kolom Deskripsi):**

> Kelas ini membekali kepala desa, perangkat desa, anggota BPD, dan pegiat desa dengan pemahaman dasar tentang cara pemerintahan desa dijalankan menurut UU No. 6 Tahun 2014 tentang Desa. Peserta mempelajari kedudukan desa berdasarkan asas rekognisi dan subsidiaritas, prinsip tata kelola pemerintahan yang baik, sebelas asas penyelenggaraan pemerintahan desa, kewenangan lokal berskala desa di bidang pemerintahan, susunan dan tata kerja pemerintah desa (kepala desa, perangkat desa, BPD), tata cara pengisian jabatan, kewajiban pelaporan dan evaluasi, serta peran masyarakat, termasuk kelompok marginal. Setelah membaca modul, peserta mengerjakan kuis 20 soal pilihan ganda dan 5 soal esai yang dinilai mentor dengan rubrik.
>
> Materi: buku saku "Penyelenggaraan Pemerintahan Desa" (Joko Purnomo & Tim Infest, 2016, Seri Buku Saku UU Desa), dipakai untuk tujuan nonkomersial dengan menyebut sumber. Catatan: modul terbit 2016. Beberapa ketentuan, antara lain masa jabatan kepala desa dan BPD, telah berubah melalui UU No. 3 Tahun 2024, jadi selalu rujuk peraturan terbaru untuk keputusan resmi.

**Tujuan belajar** (opsional, bisa ditaruh di ringkasan materi):
1. Menjelaskan kedudukan desa sebagai subjek pembangunan berdasarkan asas rekognisi dan subsidiaritas.
2. Menerapkan asas penyelenggaraan pemerintahan desa dan prinsip tata kelola yang baik pada kasus nyata.
3. Mengidentifikasi kewenangan lokal berskala desa di bidang pemerintahan dan cara mengelolanya secara partisipatif, transparan, dan akuntabel.
4. Menguraikan tugas, wewenang, hak, kewajiban, dan larangan kepala desa, serta peran perangkat desa dan BPD.
5. Menjelaskan tata cara pengisian jabatan dan kewajiban pelaporan pemerintah desa.
6. Merancang pelibatan masyarakat, terutama kelompok marginal, dalam penyelenggaraan pemerintahan desa.

## 2. Materi (Kelola → Tambah materi)

| Kolom | Isi |
|---|---|
| Judul materi | Modul: Penyelenggaraan Pemerintahan Desa |
| Jenis | PDF (unggah setelah disimpan; berkas 17 MB, batas 20 MB) |
| Waktu belajar minimum | 45 menit (sesuaikan) |
| Materi wajib | Ya |

Isi pengantar (tempel ke "Isi materi / pengantar"):

```
## Tentang modul ini
Buku saku ini menjelaskan bagaimana pemerintahan desa dijalankan setelah UU No. 6 Tahun 2014.
Bacalah seluruh modul sebelum mengerjakan kuis.

### Yang akan dipelajari
- Kedudukan desa: asas rekognisi dan subsidiaritas
- Tata kelola yang baik dan asas penyelenggaraan pemerintahan desa
- Kewenangan desa di bidang pemerintahan (21 kewenangan)
- Kepala desa, perangkat desa, dan BPD
- Pengisian jabatan, pelaporan, dan evaluasi
- Peran masyarakat dan kelompok marginal

> Sumber: Joko Purnomo & Tim Infest (2016), Seri Buku Saku UU Desa. Modul terbit 2016; cek peraturan terbaru untuk ketentuan yang sudah berubah.
```

## 3. Pengaturan kuis (bagian "Kuis materi ini")

| Kolom | Nilai | Alasan |
|---|---|---|
| Judul kuis | Kuis Penyelenggaraan Pemerintahan Desa | |
| Batas waktu | 60 menit | ±1 menit per PG + ±7 menit per esai |
| Jumlah soal PG ditampilkan | **20** | diacak dari 50 di bank, seimbang per topik |
| Jumlah soal esai ditampilkan | **5** | diacak dari 15 di bank |
| Nilai lulus | 70% | |
| Maks. percobaan | 2 | |
| Jeda antar percobaan | 1440 menit (1 hari) | memberi waktu membaca ulang |
| Toleransi jaringan | 30 detik | |
| Penghalang salin pada soal | Aktif | kuis resmi |
| Akomodasi aksesibilitas per peserta | Aktif | |

Skor: PG 2 poin × 20 = 40, esai 8 poin × 5 = 40. Total 80, sehingga PG dan esai berbobot seimbang. Hasil akhir baru keluar setelah mentor menilai esai.

## 4. Cara memasukkan bank soal

Kelas harus dalam status **draft** (versi terbit tidak dapat diubah).

1. Masuk di `/admin/masuk` dengan akun admin atau editor konten.
2. **Admin → Kelas → Kelola** pada kelas ini.
3. Buka materi yang memiliki kuis, gulir ke **Bank soal**, lalu klik **Impor bank soal dari berkas JSON**.
4. **Pilih berkas .json** → `content-private/bank-soal/penyelenggaraan-pemerintahan-desa.json`.
   - Sistem langsung memeriksa seluruh berkas. Kalau valid, muncul *"Berkas valid: 65 soal (50 pilihan ganda, 15 esai)"*.
   - Kalau ada kesalahan, muncul daftar *"Soal ke-N: …"*. Perbaiki berkasnya lalu pilih ulang.
5. Klik **Impor 65 soal**. Soal dikirim 5 per 5 dengan indikator kemajuan, sampai muncul *"Selesai: 65 soal ditambahkan ke bank."*
6. Pastikan judul menjadi **"Bank soal: 50 pilihan ganda, 15 esai"**, lalu tinjau isinya lewat **Lihat daftar soal**.
7. Atur mentor (Admin → Pengguna → beri role mentor; lalu tugaskan ke kelas), lalu **Terbitkan draft**.

**Penting:**
- Impor **menambah** soal ke bank, bukan mengganti. Jangan mengimpor berkas yang sama dua kali. Kalau impor terhenti di tengah, pesan akan menyebut berapa soal yang sudah tersimpan; impor ulang hanya sisanya.
- Soal yang keliru bisa dinonaktifkan dari daftar soal (selama masih draft).

### Format berkas (untuk membuat bank lain)

```json
{
  "judul": "opsional",
  "questions": [
    { "type": "mcq", "topic": "asas", "difficulty": 2, "points": 2,
      "stem": "Pertanyaan …?",
      "options": [ { "body": "Jawaban benar", "isCorrect": true },
                   { "body": "Pengecoh", "isCorrect": false } ] },
    { "type": "essay", "topic": "kasus", "difficulty": 3, "points": 8,
      "stem": "Pertanyaan esai …",
      "rubric": [ { "criterion": "Ketepatan konsep", "maxScore": 40 },
                  { "criterion": "Penerapan pada konteks desa", "maxScore": 30 },
                  { "criterion": "Tata kelola & etika", "maxScore": 20 },
                  { "criterion": "Kejelasan & runtut", "maxScore": 10 } ],
      "modelAnswer": "Contoh jawaban untuk penilai (tidak terlihat peserta)." }
  ]
}
```

Aturan: pilihan ganda berisi 2–6 opsi dengan **tepat satu** yang benar; tingkat kesulitan 1–3; esai berisi 1–8 kriteria rubrik. `topic` dipakai untuk mengacak soal secara seimbang, jadi usahakan setiap topik punya beberapa soal. Untuk meninjau berkas sebagai teks biasa, jalankan `node scripts/bank-to-md.mjs <berkas.json>`.

## 5. Sebelum dipakai peserta (wajib)

- **Tinjau oleh ahli/mentor.** Soal disusun dari isi modul dan diuji otomatis untuk format, duplikat, dan sebaran topik, tetapi isi dan kunci jawabannya tetap perlu diperiksa manusia, terutama butir yang memuat angka atau tenggat waktu.
- Butir berawalan "menurut modul" menguji pemahaman isi modul 2016, bukan ketentuan terbaru.
