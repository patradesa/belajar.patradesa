import { PageTitle } from '../components/common';

export function PrivacyPage() {
  return (
    <div className="prose stack">
      <PageTitle>Kebijakan privasi (ringkas)</PageTitle>
      <p>
        <strong>Draf untuk ditinjau pengelola.</strong> Ringkasan ini perlu dikonfirmasi terhadap ketentuan pelindungan data pribadi yang
        berlaku sebelum peluncuran.
      </p>
      <h2>Data yang kami simpan</h2>
      <ul>
        <li>Nama, email (dari Google), jabatan desa yang Anda pilih, nama desa/kecamatan/kabupaten bila diisi.</li>
        <li>Progres belajar, jawaban kuis, dan nilai.</li>
        <li>Catatan keamanan minimal (tanpa alamat IP mentah).</li>
      </ul>
      <h2>Data yang tidak kami minta</h2>
      <p>NIK, nomor KK, alamat lengkap, tanggal lahir, atau data warga.</p>
      <h2>Pihak ketiga</h2>
      <p>
        Masuk dengan Google diproses oleh Google. Verifikasi keamanan memakai Cloudflare Turnstile. Video YouTube hanya dimuat setelah Anda
        menekan tombol “Tonton video” dan dapat menyetel cookie YouTube.
      </p>
      <h2>Penyimpanan di perangkat</h2>
      <p>Pilihan ukuran teks disimpan di browser Anda (localStorage). Tidak ada data pribadi di sana.</p>
      <h2>Hak Anda</h2>
      <p>Anda dapat meminta salinan atau penghapusan data melalui pengelola program. Nilai yang sudah dinilai dapat diajukan banding.</p>
    </div>
  );
}
