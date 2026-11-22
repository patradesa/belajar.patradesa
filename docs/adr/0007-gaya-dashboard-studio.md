# ADR-0007 — Gaya antarmuka mengikuti dashboard Sertifikat Studio

Status: diterima (22 Nov 2026, permintaan pemilik produk)

## Konteks
Pemilik produk meminta tampilan LMS disamakan dengan dashboard admin `sertifikat.patradesa.id`: ukuran dan jenis font, gaya hover dan status terpilih, tata letak kartu dua kolom, serta kontrol ukuran teks yang lebih kecil dan mengambang di tengah bawah.

## Keputusan
- Teks dasar 14px (`html { font-size: 87.5% × skala }`), bukan 16px seperti SPEC §UI. Tetap berbasis `rem` sehingga A−/A+ (hingga 200%) dan zoom browser berfungsi. Teks bacaan materi (`.content`) 15px, line-height 1,7.
- Font: Plus Jakarta Sans untuk judul, navigasi, dan label kecil; font sistem untuk teks badan (sama dengan Studio).
- Tombol bersudut 10px, tinggi ±38px; target sentuh minimum `--touch: 38px` (di atas syarat WCAG 2.2 AA 2.5.8 = 24px, di bawah anjuran AAA/SPEC 44px). Kontrol A−/A+ mengambang berukuran 28–32px.
- Hover: latar hijau muda + garis/teks hijau tua; menu dan sub-menu aktif: pil hijau tua teks putih; seleksi teks hijau muda.
- Kontrol ukuran teks berpindah dari header ke tombol mengambang di tengah bawah (ukuran px tetap agar tidak menutupi konten saat teks 200%); footer diberi ruang bawah agar fokus tidak tertutup (WCAG 2.4.11).
- Tata letak dua kolom (≥ 960px) di Admin → Kelas, Profil, dan bagian atas editor kelas; satu kolom di layar sempit.

## Konsekuensi
- Menyimpang dari SPEC (16px, target 44px) atas permintaan eksplisit; tetap memenuhi WCAG 2.2 AA (diuji axe 100%/200%, kontras token di `tests/unit/contrast.test.ts`).
- Uji target sentuh e2e diubah: kontrol mengambang ≥ 24px, tombol utama ≥ 38px.
