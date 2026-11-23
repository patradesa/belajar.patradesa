/**
 * Isi panduan penggunaan PatraDesa Belajar (peserta & pengelola).
 * SATU sumber untuk halaman /panduan di aplikasi DAN berkas PDF (scripts: `npm run guides`).
 * Berkas ini harus tetap data murni tanpa import (dibaca langsung oleh Node saat membuat PDF).
 * Gambar: apps/web/public/panduan/img/<file> (diambil otomatis oleh tests/guide/capture.spec.ts).
 */

export interface GuideImage {
  file: string;
  alt: string;
  caption: string;
}

export interface GuideSection {
  id: string;
  title: string;
  intro?: string;
  steps?: string[];
  points?: string[];
  tips?: string[];
  warning?: string;
  image?: GuideImage;
  faq?: { q: string; a: string }[];
}

export interface Guide {
  slug: 'peserta' | 'admin';
  title: string;
  subtitle: string;
  audience: string;
  pdf: string;
  sections: GuideSection[];
}

export const GUIDE_VERSION = 'Versi 1.0 · November 2026';
export const APP_URL = 'https://belajar.patradesa.id';

/**
 * Kontak resmi: SATU-SATUNYA tempat alamat email/WA ditulis (halaman Panduan, PDF, tes e2e membaca dari sini).
 * Saat alamat @patradesa.id siap, ganti `email` di sini lalu jalankan `npm run guides` untuk memperbarui PDF.
 */
export const CONTACT = {
  org: 'Patra Desa',
  tagline: 'Daya Bersama, Sama Berdaya',
  email: 'patradesa.id@gmail.com',
  whatsapp: '+62 813-5370-4004',
  whatsappUrl: 'https://wa.me/6281353704004',
  location: 'Bali, Indonesia',
  website: 'patradesa.id',
  websiteUrl: 'https://patradesa.id/',
  instagram: '@patradesa.id',
  instagramUrl: 'https://www.instagram.com/patradesa.id/',
};

const peserta: Guide = {
  slug: 'peserta',
  title: 'Panduan Peserta',
  subtitle: 'Belajar, mengerjakan kuis, dan mendapatkan sertifikat di PatraDesa Belajar',
  audience: 'Untuk perangkat desa, anggota BPD, kader, dan pegiat desa yang mengikuti kelas.',
  pdf: '/panduan/panduan-peserta-patradesa-belajar.pdf',
  sections: [
    {
      id: 'mengenal',
      title: 'Mengenal PatraDesa Belajar',
      intro:
        'PatraDesa Belajar adalah ruang belajar daring untuk mendukung tugas perangkat desa. Setiap kelas berisi materi singkat (bacaan, slide, PDF, atau video), kuis, dan sertifikat kelulusan yang bisa dicek keasliannya.',
      points: [
        'Alamat: belajar.patradesa.id — bisa dibuka di ponsel, tablet, atau laptop dengan peramban apa saja (Chrome, Edge, Firefox, Safari).',
        'Yang Anda perlukan: akun Google (Gmail) dan koneksi internet. Tidak perlu memasang aplikasi.',
        'Gratis untuk peserta. Kemajuan belajar tersimpan di akun Anda, sehingga bisa dilanjutkan dari perangkat lain.',
      ],
      image: { file: 'peserta-01-beranda.jpg', alt: 'Beranda PatraDesa Belajar berisi sambutan dan katalog kelas', caption: 'Beranda: sambutan dan katalog kelas yang tersedia.' },
    },
    {
      id: 'masuk',
      title: 'Masuk dengan akun Google',
      steps: [
        'Buka belajar.patradesa.id, lalu klik tombol Mulai belajar (pojok kanan atas) atau Masuk.',
        'Tunggu kotak verifikasi keamanan Cloudflare menampilkan tanda centang. Biasanya otomatis dalam beberapa detik.',
        'Klik Masuk dengan Google, lalu pilih akun Google Anda.',
        'Pada login pertama Anda diarahkan ke halaman Profil untuk melengkapi data.',
      ],
      tips: [
        'Kami hanya menerima nama dan email terverifikasi dari Google. Kata sandi Google Anda tidak pernah kami terima.',
        'Di komputer umum (warnet, kantor desa), selalu klik Keluar setelah selesai belajar.',
      ],
      image: { file: 'peserta-02-masuk.jpg', alt: 'Halaman Masuk dengan kotak verifikasi keamanan dan tombol Masuk dengan Google', caption: 'Halaman Masuk: tunggu verifikasi keamanan, lalu klik Masuk dengan Google.' },
    },
    {
      id: 'profil',
      title: 'Melengkapi profil',
      intro: 'Profil dipakai untuk menyarankan kelas yang sesuai dan untuk nama di sertifikat.',
      steps: [
        'Isi Nama panggilan (tampil di aplikasi).',
        'Isi Nama untuk sertifikat dengan lengkap dan benar, termasuk gelar bila ada. Nama ini yang dicetak di sertifikat.',
        'Pilih Jabatan di desa agar katalog menandai kelas yang disarankan untuk Anda.',
        'Nama desa, kecamatan, dan kabupaten boleh diisi (opsional).',
        'Centang persetujuan kebijakan privasi (wajib pada login pertama), lalu klik Simpan profil.',
      ],
      warning: 'Jangan mengisi NIK, nomor KK, alamat lengkap, atau tanggal lahir. Data tersebut tidak diperlukan.',
      tips: ['Nama sertifikat masih bisa diubah selama sertifikat belum terbit. Setelah terbit, hubungi pengelola bila ada kesalahan nama.'],
      image: { file: 'peserta-03-profil.jpg', alt: 'Halaman Profil berisi formulir data profil, daftar kelas yang diikuti, dan sertifikat', caption: 'Profil: data diri (kiri), kelas yang diikuti dan sertifikat (kanan).' },
    },
    {
      id: 'katalog',
      title: 'Memilih kelas di katalog',
      intro: 'Setiap kartu kelas menampilkan informasi penting sebelum Anda mendaftar.',
      points: [
        'Judul dan ringkasan kelas. Klik Selengkapnya untuk membaca penjelasan lengkap "Tentang kelas".',
        'Jumlah materi, perkiraan waktu belajar, jumlah soal kuis, dan jabatan yang disarankan.',
        'Rating bintang 1–5 dari peserta yang sudah mengikuti kelas.',
        'Label "Disarankan untuk jabatan Anda" muncul bila kelas cocok dengan jabatan di profil.',
        'Tombol Ambil Kelas untuk mendaftar, Lanjutkan Belajar bila sudah terdaftar, atau Belajar Ulang bila sudah lulus.',
        'Kelas yang sudah Anda selesaikan diberi tanda oranye "Lulus - Sertifikat Terbit".',
      ],
      image: { file: 'peserta-04-katalog.jpg', alt: 'Kartu kelas di katalog dengan tanda Lulus berwarna oranye dan tombol Belajar Ulang', caption: 'Kartu kelas: informasi kelas, rating, tanda Lulus, dan tombol aksi.' },
    },
    {
      id: 'selengkapnya',
      title: 'Membaca "Tentang kelas"',
      steps: [
        'Klik Selengkapnya pada kartu kelas. Jendela "Tentang kelas" terbuka di atas katalog.',
        'Baca tujuan, isi, dan sasaran kelas.',
        'Klik Ambil Kelas untuk langsung mendaftar, atau Tutup (tombol Esc) untuk kembali.',
      ],
      image: { file: 'peserta-05-tentang-kelas.jpg', alt: 'Jendela Tentang kelas berisi deskripsi lengkap dan tombol Ambil Kelas', caption: 'Jendela "Tentang kelas".' },
    },
    {
      id: 'belajar',
      title: 'Mempelajari materi',
      intro: 'Halaman kelas berisi daftar materi berurutan. Klik judul materi untuk membukanya.',
      points: [
        'Jenis materi: Bacaan, Slide (gunakan tombol berikut/sebelumnya), PDF, atau Video YouTube.',
        'Setiap materi punya waktu belajar minimum. Waktu dihitung server hanya saat halaman materi terbuka dan aktif.',
        'Kotak Progres belajar menunjukkan waktu yang sudah tercatat. Materi berstatus Selesai setelah waktu minimum terpenuhi.',
        'Pendamping AI (bila tersedia) dapat menjawab pertanyaan seputar materi, tetapi dikunci selama Anda mengerjakan kuis.',
      ],
      tips: [
        'Waktu tidak bertambah bila tab ditinggalkan, layar terkunci, atau Anda tidak berinteraksi cukup lama. Kembali ke tab materi agar pencatatan berlanjut.',
        'Koneksi lambat? Bacaan dan slide paling hemat data; video hanya dimuat setelah Anda menekan tombol putar.',
      ],
      image: { file: 'peserta-06-materi.jpg', alt: 'Halaman materi dengan isi bacaan dan kotak Progres belajar', caption: 'Halaman materi dan kotak Progres belajar.' },
    },
    {
      id: 'kuis',
      title: 'Mengerjakan kuis',
      steps: [
        'Selesaikan waktu belajar minimum materi yang memiliki kuis. Tombol Mulai Kuis aktif setelah syarat terpenuhi.',
        'Klik Mulai Kuis. Waktu dihitung server sejak kuis dimulai; sisa waktu tampil di bagian atas.',
        'Jawab soal pilihan ganda dan esai. Jawaban tersimpan otomatis (tanda "✓ Tersimpan").',
        'Klik Kumpulkan jawaban bila sudah selesai. Bila waktu habis, jawaban dikumpulkan otomatis.',
      ],
      points: [
        'Soal dan urutan pilihan diacak untuk setiap peserta dan setiap percobaan.',
        'Batas jumlah percobaan dan masa jeda antar-percobaan ditentukan pengelola dan tampil di halaman kelas.',
        'Selama kuis berlangsung, Pendamping AI dikunci dan menyalin teks soal dinonaktifkan.',
        'Bila koneksi terputus, buka kembali kuis: jawaban yang sudah tersimpan tidak hilang selama waktu masih berjalan.',
      ],
      image: { file: 'peserta-07-kuis.jpg', alt: 'Layar kuis berisi sisa waktu, soal pilihan ganda, dan tombol Kumpulkan jawaban', caption: 'Layar kuis: sisa waktu, soal, status tersimpan, dan tombol Kumpulkan jawaban.' },
    },
    {
      id: 'hasil',
      title: 'Hasil kuis dan penilaian esai',
      points: [
        'Pilihan ganda dinilai otomatis oleh server segera setelah dikumpulkan.',
        'Esai dinilai mentor atau pengelola memakai rubrik. Sebelum dinilai, status hasil adalah "Menunggu penilaian".',
        'Setelah semua esai dinilai, nilai akhir dan umpan balik muncul di halaman hasil kuis.',
        'Bila merasa penilaian keliru, gunakan Ajukan banding nilai di halaman hasil dan tuliskan alasannya dengan jelas.',
      ],
      image: { file: 'peserta-08-hasil.jpg', alt: 'Halaman hasil kuis berisi skor pilihan ganda dan status penilaian esai', caption: 'Halaman hasil kuis.' },
    },
    {
      id: 'sertifikat',
      title: 'Sertifikat kelulusan',
      intro:
        'Sertifikat terbit otomatis setelah semua materi wajib selesai dan kuis wajib lulus. Nomor dan kode verifikasi diterbitkan oleh Sertifikat Studio Patra Desa (sertifikat.patradesa.id).',
      steps: [
        'Buka halaman kelas. Kartu Sertifikat kelulusan menampilkan nama, nomor (contoh 0001/PD/BELAJAR/2026), kode verifikasi, dan tanggal terbit.',
        'Klik Lihat & cetak sertifikat, lalu Cetak / simpan PDF. Pilih "Simpan sebagai PDF" di jendela cetak untuk menyimpan berkas.',
        'Klik Cek keaslian untuk membuka halaman verifikasi resmi. Orang lain juga bisa memindai QR di sertifikat.',
      ],
      tips: [
        'Bila tertulis "Sertifikat sedang diterbitkan", tunggu beberapa saat lalu klik Periksa lagi. Sistem mencoba ulang otomatis.',
        'Semua sertifikat Anda juga tersedia di Profil → Sertifikat saya.',
      ],
      image: { file: 'peserta-09-sertifikat.jpg', alt: 'Halaman cetak sertifikat dengan nama peserta, nama kelas, nomor, dan kode QR', caption: 'Halaman sertifikat siap dicetak, lengkap dengan QR verifikasi.' },
    },
    {
      id: 'kelas-saya',
      title: 'Kelas Saya: memantau kemajuan',
      points: [
        'Menu Kelas Saya menampilkan semua kelas yang Anda ikuti.',
        'Setiap kelas menunjukkan jumlah materi wajib selesai, kuis wajib lulus, dan persentase kemajuan.',
        'Status: Sedang belajar, Menunggu penilaian esai, Akses berakhir, atau tanda oranye "Lulus - Sertifikat Terbit".',
      ],
      image: { file: 'peserta-10-kelas-saya.jpg', alt: 'Halaman Kelas Saya berisi daftar kelas dengan bilah kemajuan dan tanda Lulus', caption: 'Kelas Saya: kemajuan setiap kelas.' },
    },
    {
      id: 'aksesibilitas',
      title: 'Ukuran teks dan kenyamanan membaca',
      points: [
        'Tombol Ukuran teks ada di tengah bawah layar: A− memperkecil, A+ memperbesar (hingga 200%), Reset kembali ke 100%.',
        'Pilihan ukuran tersimpan di perangkat Anda dan juga berlaku di layar kuis.',
        'Semua halaman bisa dipakai dengan keyboard (Tab, Enter, Esc) dan pembaca layar.',
        'Peserta yang memerlukan akomodasi (misalnya pembaca layar yang perlu menyalin teks soal) dapat menghubungi pengelola.',
      ],
      image: { file: 'peserta-11-ukuran-teks.jpg', alt: 'Tombol mengambang Ukuran teks dengan A minus, persentase, A plus, dan Reset', caption: 'Tombol Ukuran teks di tengah bawah layar.' },
    },
    {
      id: 'privasi',
      title: 'Privasi dan keamanan akun',
      points: [
        'Data yang disimpan minimal: nama, email Google, profil yang Anda isi, aktivitas belajar, dan hasil kuis.',
        'Jangan meminjamkan akun atau mengerjakan kuis untuk orang lain. Sertifikat bersifat pribadi.',
        'Kebijakan privasi lengkap ada di tautan Privasi di bagian bawah halaman.',
      ],
    },
    {
      id: 'faq',
      title: 'Pertanyaan umum',
      faq: [
        { q: 'Kotak verifikasi keamanan menampilkan galat dan saya tidak bisa masuk.', a: 'Muat ulang halaman (tekan F5 atau tarik layar ke bawah di ponsel). Pastikan Anda membuka belajar.patradesa.id dan tanggal/jam perangkat benar. Bila masih gagal, coba peramban lain atau hubungi kami.' },
        { q: 'Waktu belajar saya tidak bertambah.', a: 'Pastikan tab materi tetap terbuka dan aktif. Waktu berhenti dicatat bila layar terkunci, tab ditinggalkan, atau tidak ada interaksi cukup lama.' },
        { q: 'Tombol Mulai Kuis tidak bisa diklik.', a: 'Selesaikan dulu waktu belajar minimum materi tersebut. Bila percobaan sudah habis atau sedang masa jeda, informasinya tampil di bawah tombol.' },
        { q: 'Nilai saya "Menunggu penilaian".', a: 'Ada soal esai yang sedang dinilai mentor. Nilai akhir muncul setelah penilaian selesai.' },
        { q: 'Sertifikat belum muncul padahal saya sudah lulus.', a: 'Buka halaman kelas dan klik Periksa lagi. Bila lebih dari satu hari belum terbit, hubungi kami.' },
        { q: 'Nama di sertifikat salah.', a: 'Sebelum terbit: perbaiki Nama untuk sertifikat di Profil. Setelah terbit: hubungi pengelola untuk pencabutan dan penerbitan ulang.' },
      ],
    },
  ],
};

const admin: Guide = {
  slug: 'admin',
  title: 'Panduan Pengelola',
  subtitle: 'Mengelola kelas, kuis, penilaian, peserta, dan sertifikat di PatraDesa Belajar',
  audience: 'Untuk admin, editor konten, dan mentor (penilai esai).',
  pdf: '/panduan/panduan-pengelola-patradesa-belajar.pdf',
  sections: [
    {
      id: 'peran',
      title: 'Peran dan hak akses',
      points: [
        'Admin: semua menu — membuat dan menerbitkan kelas, mengatur peran pengguna, sertifikat, laporan, dan log audit.',
        'Editor konten: menyusun materi, kuis, dan bank soal pada versi draft. Tidak dapat menerbitkan atau mengatur pengguna.',
        'Mentor: menilai esai dan menanggapi banding pada kelas yang ditugaskan kepadanya.',
        'Peserta: hanya belajar. Peran pengelola diberikan admin lewat menu Pengguna.',
      ],
      tips: ['Berikan peran seminimal mungkin sesuai tugas. Semua perubahan penting tercatat di log audit.'],
    },
    {
      id: 'masuk',
      title: 'Masuk ke panel pengelola',
      steps: [
        'Buka belajar.patradesa.id/admin/masuk, atau klik Masuk pengelola di bagian bawah halaman.',
        'Tunggu verifikasi keamanan, lalu klik Masuk dengan Google memakai akun yang sudah diberi peran.',
        'Panel Admin terbuka. Menu Admin juga muncul di navigasi atas.',
      ],
      image: { file: 'admin-01-masuk.jpg', alt: 'Halaman Masuk Admin khusus pengelola', caption: 'Halaman Masuk Admin.' },
    },
    {
      id: 'panel',
      title: 'Mengenal panel Admin',
      points: [
        'Kelas: buat kelas baru, daftar kelas, tautan Kelola dan Laporan.',
        'Review esai: antrean esai yang menunggu penilaian.',
        'Banding: pengajuan banding nilai dari peserta.',
        'Pengguna: cari pengguna, atur peran, dan akomodasi aksesibilitas.',
        'Sertifikat: status penerbitan sertifikat lewat Sertifikat Studio.',
        'Audit: catatan aktivitas pengelola.',
      ],
      image: { file: 'admin-02-panel.jpg', alt: 'Panel Admin tab Kelas dengan formulir Buat kelas baru dan Daftar kelas', caption: 'Panel Admin, tab Kelas.' },
    },
    {
      id: 'kelas-baru',
      title: 'Membuat kelas baru',
      steps: [
        'Di tab Kelas, isi Judul, Slug URL (huruf kecil, angka, tanda minus; contoh: penyelenggaraan-pemerintahan-desa), dan Deskripsi singkat.',
        'Klik Buat kelas. Editor kelas terbuka pada versi draft.',
        'Lengkapi pengaturan, foto sampul, materi, dan kuis (bagian berikut), lalu terbitkan.',
      ],
      warning: 'Slug menjadi alamat kelas (belajar.patradesa.id/kelas/slug) dan tidak dapat diubah setelah dibuat.',
    },
    {
      id: 'versi',
      title: 'Draft dan versi terbit',
      points: [
        'Versi terbit bersifat tetap. Peserta yang sudah terdaftar tetap memakai versi yang mereka ikuti.',
        'Untuk mengubah materi atau soal kelas yang sudah terbit, klik Buat draft versi baru. Draft menyalin seluruh materi, kuis, bank soal, dan pilihan soal.',
        'Setelah draft siap, admin menekan Terbitkan draft. Peserta baru akan memakai versi baru.',
      ],
      image: { file: 'admin-03-editor.jpg', alt: 'Editor kelas berisi foto sampul, pengaturan kelas, dan daftar materi', caption: 'Editor kelas: foto sampul, pengaturan, dan daftar materi.' },
    },
    {
      id: 'pengaturan',
      title: 'Pengaturan kelas dan foto sampul',
      points: [
        'Judul dan Deskripsi. Deskripsi mendukung format sederhana: "## Judul", "- butir", "1. langkah", "**tebal**". Ringkasan katalog diambil otomatis (maksimal 5 baris).',
        'Visibilitas: Publik tampil di katalog; Privat hanya untuk peserta yang sudah terdaftar.',
        'Jendela waktu: pendaftaran dibuka/ditutup dan masa akses mulai/berakhir (opsional).',
        'Durasi akses per peserta (hari) dan masa aktif sesi belajar (menit).',
        'Disarankan untuk jabatan: centang jabatan sasaran agar kelas ditandai di katalog peserta.',
        'Foto sampul: JPG, PNG, atau WebP, maksimal 2 MB, disarankan lanskap 1200×750 px. Jangan memakai foto warga tanpa izin.',
      ],
    },
    {
      id: 'materi',
      title: 'Menyusun materi',
      steps: [
        'Pada draft, buka bagian Tambah materi.',
        'Isi Judul materi, Ringkasan, dan pilih Jenis: Bacaan, Slide, PDF (unggah setelah disimpan), atau Video YouTube.',
        'Tulis Isi materi. Untuk slide, pisahkan setiap slide dengan baris "---".',
        'Tentukan Waktu belajar minimum (menit) dan centang Materi wajib bila diperlukan untuk kelulusan.',
        'Klik Tambah materi. Materi dapat disunting lagi dengan membuka panelnya.',
      ],
      tips: ['Waktu belajar minimum yang realistis: sekitar 1 menit untuk setiap 150–200 kata bacaan.'],
    },
    {
      id: 'kuis',
      title: 'Mengatur kuis',
      intro: 'Kuis melekat pada satu materi (biasanya materi terakhir). Buka panel materi lalu isi bagian Kuis materi ini.',
      points: [
        'Judul kuis, Batas waktu (menit), Nilai lulus (%), Maks. percobaan, dan Jeda antar percobaan (menit).',
        'Toleransi jaringan (detik): tambahan waktu singkat untuk koneksi lambat saat mengumpulkan.',
        'Jumlah soal PG dan esai ditampilkan: jumlah soal yang diundi dari bank untuk setiap peserta.',
        'Kuis wajib untuk kelulusan, penghalang salin/klik kanan, dan menghormati akomodasi per peserta.',
      ],
      tips: ['Pendamping AI selalu dikunci selama kuis dan tidak dapat diaktifkan.'],
    },
    {
      id: 'bank-soal',
      title: 'Bank soal dan pilihan soal kuis',
      steps: [
        'Tambah soal satu per satu lewat formulir (pilihan ganda: tandai satu jawaban benar; esai: isi rubrik "Kriteria|skor maks" per baris dan contoh jawaban).',
        'Atau impor banyak soal sekaligus dari berkas JSON lewat Impor bank soal dari berkas JSON. Sistem memeriksa berkas lalu menyimpannya bertahap.',
        'Di daftar Pilih soal yang dipakai kuis, centang soal yang ikut diundi. Gunakan Pakai semua atau Keluarkan semua per jenis soal.',
        'Klik Simpan pilihan soal kuis. Pastikan jumlah soal yang dipakai tidak kurang dari jumlah yang ditampilkan.',
      ],
      tips: [
        'Soal yang tidak dicentang tetap tersimpan di bank dan bisa dipakai lagi kapan saja.',
        'Soal dan opsi diacak untuk setiap peserta, seimbang lintas topik dan tingkat kesulitan.',
      ],
      image: { file: 'admin-04-bank-soal.jpg', alt: 'Bank soal dengan kotak centang Pilih soal yang dipakai kuis', caption: 'Bank soal dan pilihan soal kuis.' },
    },
    {
      id: 'terbit',
      title: 'Daftar periksa sebelum menerbitkan',
      points: [
        'Setiap materi berisi konten yang benar dan waktu belajar minimum yang wajar.',
        'Kuis memiliki cukup soal yang dipakai (tidak ada peringatan kuning).',
        'Rubrik esai jelas dan contoh jawaban sudah diisi.',
        'Visibilitas, jendela waktu, foto sampul, dan jabatan sasaran sudah benar.',
        'Klik Terbitkan draft (khusus admin), lalu cek tampilan kelas di katalog.',
      ],
    },
    {
      id: 'review',
      title: 'Menilai esai',
      steps: [
        'Buka tab Review esai. Penilaian bersifat buta: nama peserta tidak ditampilkan.',
        'Baca soal, jawaban peserta, dan contoh jawaban (khusus penilai).',
        'Isi skor setiap kriteria rubrik dan tulis Umpan balik untuk peserta.',
        'Klik Simpan nilai. Nilai akhir dihitung ulang otomatis; bila lulus dan semua syarat terpenuhi, sertifikat terbit.',
      ],
      tips: ['Mengubah nilai yang sudah final (override) wajib disertai alasan dan tercatat di log audit.'],
      image: { file: 'admin-05-review.jpg', alt: 'Formulir review esai berisi soal, jawaban, skor rubrik, dan umpan balik', caption: 'Formulir review esai.' },
    },
    {
      id: 'banding',
      title: 'Menanggapi banding',
      steps: [
        'Buka tab Banding. Banding terbuka tampil paling atas.',
        'Baca alasan peserta, tinjau kembali jawaban di Review esai bila perlu.',
        'Tulis Tanggapan, pilih Keputusan (Diterima / ditinjau ulang atau Ditolak), lalu simpan.',
      ],
    },
    {
      id: 'pengguna',
      title: 'Pengguna, peran, dan akomodasi',
      steps: [
        'Buka tab Pengguna, cari nama atau email.',
        'Centang peran mentor, content_editor (editor konten), atau admin. Perubahan langsung berlaku.',
        'Centang Bebaskan dari pembatasan salin/klik kanan untuk peserta yang memerlukan akomodasi aksesibilitas.',
      ],
      warning: 'Pengguna harus masuk sekali dengan Google sebelum dapat ditemukan dan diberi peran.',
      tips: ['Mentor hanya melihat esai dari kelas yang ditugaskan kepadanya. Penugasan mentor ke kelas saat ini dilakukan oleh tim teknis; admin dapat menilai esai semua kelas.'],
    },
    {
      id: 'sertifikat',
      title: 'Sertifikat',
      points: [
        'Sertifikat terbit otomatis saat peserta lulus semua syarat. Nomor dan kode verifikasi berasal dari Sertifikat Studio (format 0001/PD/BELAJAR/2026).',
        'Status: Menunggu Studio (sedang/akan dicoba ulang), Terbit, atau Dicabut.',
        'Terbitkan sekarang: mencoba penerbitan seketika untuk sertifikat yang menunggu. Pesan galat menjelaskan penyebabnya.',
        'Cek di Studio: membuka halaman verifikasi publik.',
        'Cabut: wajib mengisi alasan; status di halaman verifikasi Studio ikut berubah menjadi dicabut.',
      ],
      image: { file: 'admin-06-sertifikat.jpg', alt: 'Tab Sertifikat berisi daftar peserta, kelas, status Terbit, nomor, dan kode', caption: 'Tab Sertifikat.' },
    },
    {
      id: 'laporan',
      title: 'Laporan kelas dan log audit',
      points: [
        'Laporan (dari Daftar kelas): materi selesai, jumlah percobaan, nilai terbaik, dan status lulus setiap peserta.',
        'Audit: waktu, pelaku, aksi, dan target setiap perubahan penting (membuat kelas, menerbitkan, menilai, mengubah peran, mencabut sertifikat).',
      ],
      warning: 'Laporan berisi data pribadi peserta. Jangan diekspor atau dibagikan kepada pihak yang tidak berwenang.',
    },
    {
      id: 'demo',
      title: 'Kelas demo penilaian (lingkungan uji)',
      points: [
        'Tombol Buat kelas demo penilaian membuat kelas privat berisi 3 materi dan kuis dengan peserta fiktif yang sudah mengumpulkan jawaban.',
        'Gunakan untuk berlatih menilai esai sampai sertifikat terbit.',
        'Sertifikat demo memakai nomor resmi Studio: cabut setelah selesai berlatih.',
      ],
    },
    {
      id: 'masalah',
      title: 'Pemecahan masalah',
      faq: [
        { q: 'Peserta tidak bisa memulai kuis.', a: 'Periksa waktu belajar minimum materi kuis, batas percobaan, dan jeda antar-percobaan di pengaturan kuis.' },
        { q: 'Muncul peringatan "Soal yang dipakai belum cukup".', a: 'Centang lebih banyak soal di daftar pilihan, atau kurangi jumlah soal yang ditampilkan di pengaturan kuis.' },
        { q: 'Sertifikat berstatus "Menunggu Studio".', a: 'Klik Terbitkan sekarang dan baca pesannya. Bila menyebut integrasi belum siap atau HTTP 401, hubungi tim teknis Patra Desa.' },
        { q: 'Tidak bisa mengubah materi.', a: 'Versi terbit tidak dapat diubah. Klik Buat draft versi baru terlebih dahulu.' },
      ],
    },
  ],
};

export const GUIDES: Record<'peserta' | 'admin', Guide> = { peserta, admin };
