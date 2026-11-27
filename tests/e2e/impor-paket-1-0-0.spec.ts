/** Impor berkas format paket kelas 1.0.0 (Daya Desa) lewat UI admin di ponsel: diubah otomatis, catatan tampil, impor selesai; lolos axe. */
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const ORIGIN = 'http://localhost:8787';

test('admin mengimpor berkas format 1.0.0 yang diubah otomatis', async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'daya-desa-literasi-digital-bali-paket-lengkap.json'), 'utf8'));
  pkg.course.slug = `daya-desa-${stamp}`;
  for (const m of pkg.modules) for (const b of m.interactive_blocks) b.id = `${b.id}-${stamp}`;

  expect((await page.request.post('/api/v1/auth/dev-login', { headers: { origin: ORIGIN }, data: { email: `admin-100-${stamp}@contoh.test`, name: 'Admin 100', roles: ['admin'] } })).status()).toBe(200);
  await page.goto('/admin/impor-paket');
  await page.getByLabel('Berkas paket').setInputFiles({ name: 'daya-desa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pkg)) });
  await expect(page.getByRole('heading', { name: 'Hasil pemeriksaan: daya-desa.json' })).toBeVisible();
  await expect(page.getByText(/sudah diubah otomatis ke format LMS/)).toBeVisible();
  await expect(page.getByText('14 materi · 1 kuis · 17 soal · 13 skenario')).toBeVisible();
  await expect(page.getByText('Catatan pengubahan dan perhatian:')).toBeVisible();
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(res.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Impor sebagai draf' }).click();
  await expect(page.getByText('Impor selesai.')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.import-step.is-fail')).toHaveCount(0);
});
