/**
 * Alur pengelola end-to-end: kelas demo penilaian → review esai → lulus → sertifikat (Studio tiruan)
 * → halaman cetak dengan QR → pencabutan. Juga dialog "Selengkapnya" di katalog dan pilihan soal kuis.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function axe(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node — ${v.help}`);
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

async function loginAdmin(page: Page, tag: string) {
  await page.goto('/admin/masuk');
  await page.getByLabel('Email (fiktif)').fill(`admin-${tag}-${Date.now()}@contoh.test`);
  await page.getByRole('button', { name: 'Masuk (dev)' }).click();
  await page.getByLabel(/menyetujui/).check();
  await page.getByRole('button', { name: 'Simpan profil' }).click();
  await page.getByRole('heading', { name: 'Katalog kelas' }).waitFor();
}

test('katalog: "Selengkapnya" membuka dialog Tentang kelas (lolos axe), Esc menutup', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: /^Selengkapnya tentang kelas/ }).first();
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Tentang kelas')).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 2 })).toBeVisible();
  await expect(dialog.getByText('Memuat deskripsi kelas…')).toHaveCount(0);
  await axe(page, 'dialog selengkapnya');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('demo penilaian → review esai → sertifikat terbit → halaman cetak → dicabut', async ({ page }) => {
  await loginAdmin(page, 'sertifikat');
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Buat kelas demo penilaian' }).click();
  await expect(page.getByText(/Kelas demo dibuat/)).toBeVisible();

  // Nilai semua esai demo yang menunggu (review buta) dengan skor tinggi.
  await page.getByRole('link', { name: 'Review esai' }).click();
  const demoForm = () => page.locator('form', { has: page.getByRole('heading', { name: 'Kuis Demo Penilaian' }) }).first();
  await expect(demoForm()).toBeVisible();
  await axe(page, 'review esai');
  const demoForms = page.locator('form', { has: page.getByRole('heading', { name: 'Kuis Demo Penilaian' }) });
  for (let n = await demoForms.count(); n > 0; n--) {
    const f = demoForm();
    await f.getByLabel('Ketepatan isi (0–50)').fill('45');
    await f.getByLabel('Contoh konkret (0–30)').fill('25');
    await f.getByLabel('Kejelasan (0–20)').fill('18');
    await f.getByRole('button', { name: 'Simpan nilai' }).click();
    // Tunggu antrean dimuat ulang (satu esai berkurang) sebelum menilai berikutnya.
    await expect(demoForms).toHaveCount(n - 1);
  }

  // Tab Sertifikat: terbit lewat Studio tiruan dengan nomor PD/BELAJAR.
  await page.getByRole('link', { name: 'Sertifikat' }).click();
  await expect(page.getByRole('heading', { name: 'Sertifikat', level: 2 })).toBeVisible();
  const row = page.locator('tr', { hasText: 'Peserta Demo' }).first();
  await expect(row.getByText('Terbit')).toBeVisible();
  await expect(row.locator('td').nth(3)).toContainText(/\d{4}\/PD\/BELAJAR\/2026/);
  await axe(page, 'tab sertifikat');
  const code = (await row.locator('.mono').innerText()).trim();
  expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // Halaman cetak sertifikat (publik dengan kode): nama, kelas, nomor, QR verifikasi.
  await page.goto(`/sertifikat/${code}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Sertifikat Kelulusan' })).toBeVisible();
  await expect(page.getByText(/Ni Made Contoh \(Peserta Demo/)).toBeVisible();
  await expect(page.getByRole('img', { name: /Kode QR verifikasi: http:\/\/127\.0\.0\.1:8799\/v\// })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cetak / simpan PDF' })).toBeEnabled();
  await axe(page, 'halaman sertifikat');

  // Cabut dari tab Sertifikat → halaman cetak menandai dicabut.
  await page.goto('/admin/sertifikat');
  const row2 = page.locator('tr', { hasText: code }).first();
  await row2.getByRole('button', { name: 'Cabut' }).click();
  await row2.getByLabel('Alasan pencabutan').fill('Uji pencabutan e2e');
  await row2.getByRole('button', { name: 'Cabut sertifikat' }).click();
  await expect(page.getByText(/Sertifikat dicabut/)).toBeVisible();
  await expect(page.locator('tr', { hasText: code }).getByText('Dicabut')).toBeVisible();
  await page.goto(`/sertifikat/${code}`);
  await expect(page.getByRole('alert')).toContainText('sudah dicabut');
  await expect(page.getByRole('button', { name: 'Cetak / simpan PDF' })).toBeDisabled();
});

test('pilihan soal kuis: centang/keluarkan soal di draft lalu simpan', async ({ page }) => {
  await loginAdmin(page, 'pilihan');
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Buat kelas demo penilaian' }).click();
  await expect(page.getByText(/Kelas demo dibuat/)).toBeVisible();
  await page.locator('tr', { hasText: 'Demo Penilaian & Sertifikat' }).first().getByRole('link', { name: 'Kelola' }).click();
  // Editor sederhana: ikon pensil pada versi terbit membuat draf otomatis lalu membuka editor materi itu.
  await page.getByRole('button', { name: /^Edit materi Dari Kelulusan ke Sertifikat/ }).click();
  await expect(page.getByText(/Draf dibuat otomatis/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tinjau & terbitkan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bank soal: 5 pilihan ganda, 2 esai' })).toBeVisible();
  // Regresi: materi lama berkode acak (huruf besar) tetap bisa disimpan tanpa mengubah kodenya.
  await page.getByRole('button', { name: 'Simpan sebagai draf' }).first().click();
  await expect(page.getByText('Materi disimpan sebagai draf.')).toBeVisible();
  // Daftar pilihan terbuka otomatis untuk bank kecil (≤ 20 soal).
  await expect(page.getByText(/^Pilih soal yang dipakai kuis/)).toBeVisible();
  await page.getByRole('checkbox', { name: /Berapa nilai lulus kuis demo ini/ }).uncheck();
  await expect(page.getByText('Ada perubahan yang belum disimpan.')).toBeVisible();
  await expect(page.getByText(/Soal yang dipakai belum cukup/)).toBeVisible();
  await axe(page, 'pilihan soal kuis');
  await page.getByRole('button', { name: 'Simpan pilihan soal kuis' }).click();
  await expect(page.getByText('Pilihan soal kuis tersimpan: 4 pilihan ganda, 2 esai.')).toBeVisible();
  await page.getByRole('button', { name: 'Pakai semua PG' }).click();
  await page.getByRole('button', { name: 'Simpan pilihan soal kuis' }).click();
  await expect(page.getByText('Pilihan soal kuis tersimpan: 5 pilihan ganda, 2 esai.')).toBeVisible();
  // Log perubahan mencatat draf & pilihan soal.
  await page.getByRole('tab', { name: 'Log perubahan' }).click();
  await expect(page.getByRole('cell', { name: 'Pilihan soal kuis diubah' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Draf dibuat' })).toBeVisible();
  await axe(page, 'log perubahan kelas');
});

test('profil: daftar kelas + progres dan bagian Sertifikat saya (lolos axe)', async ({ page }) => {
  await page.goto('/masuk');
  await page.getByLabel('Email (fiktif)').fill(`profil-${Date.now()}@contoh.test`);
  await page.getByLabel('Nama').fill('Peserta Profil');
  await page.getByRole('button', { name: 'Masuk (dev)' }).click();
  await page.getByLabel(/menyetujui/).check();
  await page.getByRole('button', { name: 'Simpan profil' }).click();
  await page.getByRole('heading', { name: 'Katalog kelas' }).waitFor();
  await page.goto('/kelas/dasar-transparansi-desa');
  await page.getByRole('button', { name: /Daftar kelas ini/ }).click();
  await expect(page.getByRole('link', { name: 'Mengapa Keterbukaan Penting' })).toBeVisible();
  await page.goto('/profil');
  await expect(page.getByRole('heading', { level: 2, name: 'Kelas yang diikuti' })).toBeVisible();
  const item = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: /Dasar Transparansi/ }) });
  await expect(item.getByText('Sedang belajar')).toBeVisible();
  await expect(item.getByText(/0\/2 materi wajib/)).toBeVisible();
  await expect(item.getByText(/0\/1 kuis lulus/)).toBeVisible();
  await expect(item.getByRole('img', { name: /Progres kelas .*: 0 persen/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Sertifikat saya' })).toBeVisible();
  await expect(page.getByText(/^Belum ada sertifikat/)).toBeVisible();
  await axe(page, 'profil dengan kelas');
});
