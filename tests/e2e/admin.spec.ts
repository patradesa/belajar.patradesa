/** Halaman masuk admin: tampil untuk tamu, mengarah ke panel setelah login berperan admin, lolos axe. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function axe(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node — ${v.help}`);
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

test('tamu membuka /admin → halaman Masuk Admin; login admin → panel Admin', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Masuk Admin' })).toBeVisible();
  await expect(page.getByText('Khusus pengelola')).toBeVisible();
  await axe(page, 'masuk admin');
  await expect(page.getByLabel('Masuk sebagai admin (uji)')).toBeChecked();
  await page.getByLabel('Email (fiktif)').fill(`admin-ui-${Date.now()}@contoh.test`);
  await page.getByRole('button', { name: 'Masuk (dev)' }).click();
  // Akun baru → profil dulu (persetujuan privasi), lalu ke panel admin.
  await page.getByLabel(/menyetujui/).check();
  await page.getByRole('button', { name: 'Simpan profil' }).click();
  await page.goto('/admin/masuk');
  await page.waitForURL('**/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menu admin' })).toBeVisible();
  await axe(page, 'panel admin');
});

test('impor bank soal JSON lewat UI admin: validasi, impor bertahap, jumlah bank', async ({ page }) => {
  await page.goto('/admin/masuk');
  await page.getByLabel('Email (fiktif)').fill(`admin-impor-${Date.now()}@contoh.test`);
  await page.getByRole('button', { name: 'Masuk (dev)' }).click();
  await page.getByLabel(/menyetujui/).check();
  await page.getByRole('button', { name: 'Simpan profil' }).click();
  await page.getByRole('heading', { name: 'Katalog kelas' }).waitFor();
  const csrf = (await (await page.request.get('/api/v1/me')).json()).csrfToken;
  const h = { origin: 'http://localhost:8787', 'x-csrf-token': csrf };
  const slug = `impor-${Date.now()}`;
  const course = await (await page.request.post('/api/v1/admin/courses', { headers: h, data: { slug, title: 'Kelas Uji Impor' } })).json();
  const lesson = await (
    await page.request.post(`/api/v1/admin/courses/${course.id}/lessons`, { headers: h, data: { title: 'Modul Uji', contentType: 'html', contentSource: '## Isi' } })
  ).json();
  await page.request.put(`/api/v1/admin/lessons/${lesson.id}/assessment`, {
    headers: h,
    data: { title: 'Kuis Uji Impor', timeLimitSeconds: 600, passingScorePct: 70, maxAttempts: 2, cooldownSeconds: 0, mcqCount: 4, essayCount: 1 },
  });
  const bank = {
    judul: 'fiktif',
    questions: [
      ...Array.from({ length: 6 }, (_, i) => ({
        type: 'mcq',
        topic: 't',
        difficulty: 1,
        points: 2,
        stem: `Pertanyaan fiktif ${i + 1}?`,
        options: [
          { body: 'Benar', isCorrect: true },
          { body: 'Salah', isCorrect: false },
        ],
      })),
      { type: 'essay', topic: 'e', difficulty: 2, points: 8, stem: 'Esai fiktif satu?', rubric: [{ criterion: 'Konsep', maxScore: 100 }], modelAnswer: 'x' },
    ],
  };

  await page.goto(`/admin/kelas/${course.id}`);
  await page.getByText('1. Modul Uji').click();
  await expect(page.getByRole('heading', { name: 'Bank soal: 0 pilihan ganda, 0 esai' })).toBeVisible();
  await page.getByText('Impor bank soal dari berkas JSON').click();
  // Berkas rusak → pesan galat per soal.
  await page.getByLabel('Pilih berkas .json').setInputFiles({ name: 'rusak.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ questions: [{ type: 'mcq', stem: 'Pendek?', options: [] }] })) });
  await expect(page.getByText('Berkas belum dapat diimpor')).toBeVisible();
  await expect(page.getByText(/Soal ke-1/).first()).toBeVisible();
  // Berkas valid → ringkasan → impor.
  await page.getByLabel('Pilih berkas .json').setInputFiles({ name: 'bank.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bank)) });
  await expect(page.getByText('Berkas valid:')).toContainText('7 soal');
  await page.getByRole('button', { name: 'Impor 7 soal' }).click();
  await expect(page.getByRole('heading', { name: 'Bank soal: 6 pilihan ganda, 1 esai' })).toBeVisible();
});

test('footer menautkan ke halaman masuk pengelola', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Masuk pengelola/ }).click();
  await expect(page).toHaveURL(/\/admin\/masuk$/);
});
