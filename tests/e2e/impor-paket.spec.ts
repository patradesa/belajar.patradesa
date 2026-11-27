/** Impor paket kelas lewat UI admin (ponsel 360px): pilih berkas → hasil pemeriksaan → impor bertahap → tautan editor; lolos axe. */
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const ORIGIN = 'http://localhost:8787';

async function axe(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node — ${v.help}`);
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

test('admin mengimpor paket kelas sebagai draf', async ({ page }) => {
  const stamp = Date.now();
  const bundle = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'course-bundle', 'contoh-paket-kelas.json'), 'utf8'));
  bundle.course.slug = `contoh-paket-${stamp}`;
  bundle.scenarios[0].id = `contoh-paket-${stamp}`;
  for (const l of bundle.lessons) l.contentSource = l.contentSource.replace('[[skenario:contoh-paket-beda-nama]]', `[[skenario:contoh-paket-${stamp}]]`);

  expect((await page.request.post('/api/v1/auth/dev-login', { headers: { origin: ORIGIN }, data: { email: `admin-paket-${stamp}@contoh.test`, name: 'Admin Paket', roles: ['admin'] } })).status()).toBe(200);
  await page.goto('/admin/impor-paket');
  await expect(page.getByRole('heading', { name: 'Impor paket kelas (JSON)' })).toBeVisible();
  await page.getByLabel('Berkas paket').setInputFiles({ name: 'paket.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await expect(page.getByRole('heading', { name: 'Hasil pemeriksaan: paket.json' })).toBeVisible();
  await expect(page.getByText('2 materi · 1 kuis · 3 soal · 1 skenario')).toBeVisible();
  await axe(page, 'hasil pemeriksaan paket');

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Impor sebagai draf' }).click();
  await expect(page.getByText('Impor selesai.')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.import-step.is-fail')).toHaveCount(0);
  await axe(page, 'progres impor selesai');

  await page.getByRole('link', { name: 'editor kelas' }).click();
  await expect(page.getByRole('button', { name: /^Edit materi Lima Langkah Layanan/ })).toBeVisible();
  await expect(page.getByText(/Belum pernah terbit · Privat/)).toBeVisible();
});
