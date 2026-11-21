# Privasi — inventaris data & retensi (draf untuk dikonfirmasi pengelola)

Prinsip: data minimal, tanpa NIK/KK/alamat lengkap/tanggal lahir, tanpa data warga nyata di latihan, staging terpisah dari produksi. Perlu ditinjau terhadap ketentuan pelindungan data pribadi yang berlaku di Indonesia sebelum go-live.

| Data | Tabel | Tujuan | Retensi usulan |
|---|---|---|---|
| Email, nama tampilan | `users`, `identities` | login, identitas peserta | selama akun aktif; anonimisasi saat penghapusan |
| Jabatan desa, nama desa/kec/kab (opsional), nama sertifikat | `user_profiles` | rekomendasi materi, laporan kohort | idem |
| Persetujuan privasi (waktu) | `user_profiles.privacy_consent_at` | bukti persetujuan | idem |
| Hash token sesi | `sessions` | autentikasi | kedaluwarsa 7 hari (12 jam role istimewa); dihapus 30 hari setelah kedaluwarsa |
| Progres & waktu aktif belajar | `lesson_progress`, `learning_sessions` | syarat kuis & kelulusan | 24 bulan setelah kelas selesai (usulan) |
| Jawaban, nilai, umpan balik, banding | `answers`, `attempts`, `essay_reviews`, `appeals` | penilaian & sertifikasi | 24 bulan setelah kelas selesai (usulan) |
| Log audit admin | `admin_audit_logs` | akuntabilitas | sesuai kebijakan organisasi (usulan 24 bulan); metadata tanpa teks esai |
| Event keamanan | `security_events` | deteksi penyalahgunaan | 90 hari (otomatis oleh Cron) |
| Penghitung rate limit (IP di-hash) | `rate_limits` | anti-abuse | 1 hari (otomatis) |
| Penggunaan AI (jumlah/token, tanpa isi) | `ai_usage` | kuota & biaya (Phase 2) | 12 bulan |
| Preferensi ukuran teks | `localStorage` browser | aksesibilitas | di perangkat peserta |

Pihak ketiga: Google (login), Cloudflare (hosting, D1, R2, Turnstile), YouTube (hanya bila peserta menekan "Tonton video"). Chat AI tidak disimpan penuh secara default (Phase 2).

Prosedur penghapusan/ekspor dan restore drill: lihat docs/deploy.md.
