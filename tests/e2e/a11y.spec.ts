/** Pemindaian aksesibilitas otomatis (axe-core, aturan WCAG 2.0/2.1/2.2 A & AA) pada halaman utama. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import demo from '../../db/seed/demo-course.json' with { type: 'json' };

async function scan(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node — ${v.help}`);
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

async function login(page: Page) {
  await page.goto('/masuk');
  await scan(page, 'halaman masuk');
  await page.getByLabel('Email (fiktif)').fill(`a11y-${Date.now()}@contoh.test`);
  await page.getByLabel('Nama').fill('Peserta A11y');
  await page.getByRole('button', { name: 'Masuk (dev)' }).click();
  await page.getByRole('heading', { level: 1, name: 'Profil' }).waitFor();
}

for (const scale of ['100%', '200%']) {
  test(`axe: katalog, profil, kelas, materi, kuis — teks ${scale}`, async ({ page }) => {
    await login(page);
    if (scale === '200%') for (let i = 0; i < 5; i++) await page.getByRole('button', { name: /perbesar teks/i }).click();
    await scan(page, 'profil');
    await page.getByLabel(/menyetujui/).check();
    await page.getByRole('button', { name: 'Simpan profil' }).click();
    await page.getByRole('heading', { name: 'Katalog kelas' }).waitFor();
    await scan(page, 'katalog');
    await page.goto(`/kelas/${demo.course.slug}`);
    await page.getByRole('button', { name: 'Daftar kelas ini' }).click();
    await page.getByRole('button', { name: 'Mulai Kuis' }).waitFor();
    await scan(page, 'kelas');
    await page.getByRole('link', { name: demo.lessons[0]!.title }).click();
    await page.getByRole('heading', { name: 'Progres belajar' }).waitFor();
    await scan(page, 'materi bacaan');
    // Kuis melekat pada materi ke-2 (slide); buka dulu agar syarat belajar terpenuhi di server.
    await page.goto(`/kelas/${demo.course.slug}`);
    await page.getByRole('link', { name: demo.lessons[1]!.title }).click();
    await page.getByText('Slide 1 dari 3').waitFor();
    await scan(page, 'materi slide');
    await page.goto(`/kelas/${demo.course.slug}`);
    await page.getByRole('button', { name: 'Mulai Kuis' }).click();
    await page.getByTestId('ai-locked-notice').waitFor();
    await scan(page, 'kuis');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Kumpulkan jawaban' }).click();
    await page.getByRole('heading', { name: 'Hasil kuis' }).waitFor();
    await scan(page, 'hasil');
  });
}

test('navigasi keyboard: skip link & fokus terlihat', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Lewati ke konten utama' });
  await expect(skip).toBeFocused();
  const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
});
