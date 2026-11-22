/** Menu Panduan: daftar panduan, halaman baca (lolos axe), dan berkas PDF A4 yang dapat diunduh. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function axe(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node — ${v.help}`);
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

test('menu Panduan → panduan peserta & pengelola, unduh PDF', async ({ page }) => {
  await page.goto('/');
  // Di ponsel menu utama tersembunyi di balik tombol Menu.
  const menu = page.getByRole('button', { name: 'Menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Panduan' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Panduan penggunaan' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Panduan Peserta' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Panduan Pengelola' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'patradesa.id@gmail.com' })).toBeVisible();
  await axe(page, 'daftar panduan');

  for (const [slug, name] of [
    ['peserta', 'Panduan Peserta'],
    ['admin', 'Panduan Pengelola'],
  ] as const) {
    await page.goto('/panduan');
    const pdf = page.getByRole('link', { name: `Unduh PDF ${name}` }).first();
    const href = (await pdf.getAttribute('href'))!;
    expect(await pdf.getAttribute('download')).toMatch(/\.pdf$/);
    const res = await page.request.get(href);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
    await page.goto(`/panduan/${slug}`);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByRole('navigation', { name: `Daftar isi ${name}` })).toBeVisible();
    await expect(page.locator('.guide-section').first()).toBeVisible();
  }
  await page.goto('/panduan/peserta');
  await page.getByRole('navigation', { name: 'Daftar isi Panduan Peserta' }).getByRole('link', { name: 'Sertifikat kelulusan' }).click();
  await expect(page).toHaveURL(/#sertifikat$/);
  await expect(page.getByRole('img', { name: /Halaman cetak sertifikat/ })).toBeVisible();
  await axe(page, 'panduan peserta');
  await page.goto('/panduan/tidak-ada');
  await expect(page.getByRole('heading', { level: 1, name: 'Panduan tidak ditemukan' })).toBeVisible();
});
