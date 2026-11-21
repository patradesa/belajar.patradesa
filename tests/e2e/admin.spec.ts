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

test('footer menautkan ke halaman masuk pengelola', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Masuk pengelola/ }).click();
  await expect(page).toHaveURL(/\/admin\/masuk$/);
});
