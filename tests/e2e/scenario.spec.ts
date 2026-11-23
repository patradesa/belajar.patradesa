/**
 * Blok Skenario (runtime Workers asli + D1 lokal, ponsel 360px): admin menerbitkan skenario & kelas lewat API,
 * peserta mengerjakan skenario dengan KEYBOARD di halaman materi, umpan balik & hasil tampil, lolos axe,
 * tanpa scroll horizontal; kunci tidak ada di respons jaringan sebelum memilih.
 */
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const ORIGIN = 'http://localhost:8787';
const scenario = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'scenario-block', 'contoh-adm01-beda-nama-bali.json'), 'utf8'));

async function axe(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node — ${v.help}`);
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

async function devLogin(page: Page, email: string, roles: string[] = []) {
  const r = await page.request.post('/api/v1/auth/dev-login', { headers: { origin: ORIGIN }, data: { email, name: email.split('@')[0], roles } });
  expect(r.status()).toBe(200);
  const me = await (await page.request.get('/api/v1/me')).json();
  return { origin: ORIGIN, 'x-csrf-token': me.csrfToken as string };
}

test('peserta mengerjakan skenario dengan keyboard di 360px; umpan balik & hasil; lolos axe', async ({ browser, page }) => {
  const stamp = Date.now();
  // ---- Admin: unggah & terbitkan skenario (kunci unik per run), buat kelas dengan [[skenario:…]], terbitkan.
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const ah = await devLogin(admin, `admin-scn-${stamp}@contoh.test`, ['admin']);
  const key = `adm01-e2e-${stamp}`;
  const saved = await (await admin.request.post('/api/v1/admin/scenarios', { headers: ah, data: { definition: { ...scenario, id: key } } })).json();
  expect(saved.maxScore).toBe(30);
  const pub = await admin.request.post(`/api/v1/admin/scenarios/${saved.id}/status`, {
    headers: ah,
    data: { status: 'published', review: { reviewedBy: 'Penelaah E2E', reviewedAt: '2026-11-20', nextReviewDue: '2027-11-20' } },
  });
  expect(pub.status()).toBe(200);
  const course = await (await admin.request.post('/api/v1/admin/courses', { headers: ah, data: { slug: `skenario-${stamp}`, title: 'Kelas Skenario E2E', visibility: 'public' } })).json();
  const lesson = await (
    await admin.request.post(`/api/v1/admin/courses/${course.id}/lessons`, {
      headers: ah,
      data: { title: 'Layanan beda nama', contentType: 'html', contentSource: `## Pengantar\n\nBaca situasinya, lalu putuskan.\n\n[[skenario:${key}]]`, requiredActiveSeconds: 0 },
    })
  ).json();
  expect((await admin.request.post(`/api/v1/admin/courses/${course.id}/publish`, { headers: ah })).status()).toBe(200);
  await adminCtx.close();

  // ---- Peserta.
  // Proyek 'mobile' di playwright.config.ts memakai viewport 360×780.
  const lh = await devLogin(page, `peserta-scn-${stamp}@contoh.test`);
  expect((await page.request.post(`/api/v1/courses/${course.id}/enroll`, { headers: lh })).status()).toBeLessThan(300);

  const leaks: string[] = [];
  page.on('response', async (r) => {
    if (/\/api\/v1\/(scenarios|scenario-attempts)\//.test(r.url()) && r.request().method() === 'POST' && r.url().endsWith('/attempts')) {
      const t = await r.text();
      if (/"(verdict|feedback|nextNodeId|scoring|review)"/.test(t)) leaks.push(r.url());
    }
  });

  await page.goto(`/materi/${lesson.id}`);
  const card = page.getByRole('region', { name: scenario.title });
  await expect(card).toBeVisible();
  // Teks banner dari localValidationNote skenario contoh.
  await expect(card.getByText(/Cek SOP desa dan Disdukcapil setempat/)).toBeVisible();
  await expect(card.getByText(/Berlaku per 2026-11-01/)).toBeVisible();
  await axe(page, 'kartu skenario');

  // Mulai dengan keyboard.
  await card.getByRole('button', { name: 'Mulai skenario' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Pagi di meja pelayanan' })).toBeFocused();
  await page.getByRole('button', { name: 'Lanjut' }).focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Nama yang tidak sama' })).toBeFocused();
  await expect(page.getByText('Keputusan 1 dari 3')).toBeVisible();
  await axe(page, 'node keputusan');
  const best = page.getByRole('button', { name: /memeriksa dokumen asli \(KK dan akta\)/ });
  await best.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Tepat', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/Verifikasi dokumen asli dan pencatatan/)).toBeVisible();
  await axe(page, 'umpan balik');

  // Selesaikan dua keputusan berikutnya dengan pilihan terbaik.
  await page.getByRole('button', { name: 'Lanjut' }).click();
  await page.getByRole('button', { name: /Berkonsultasi dengan Kasi Pemerintahan/ }).click();
  await page.getByRole('button', { name: 'Lanjut' }).click();
  await page.getByRole('button', { name: /Menolak dengan sopan/ }).click();
  await page.getByRole('button', { name: 'Lihat hasil' }).click();

  const result = page.getByRole('region', { name: 'Hasil skenario' });
  await expect(result).toBeVisible();
  await expect(result.getByText('100%', { exact: true })).toBeVisible();
  await expect(result.getByText('Sangat baik')).toBeVisible();
  await expect(result.getByText('Poin bawa pulang')).toBeVisible();
  await axe(page, 'hasil skenario');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'lebar konten melebihi viewport').toBeLessThanOrEqual(1);
  expect(leaks).toEqual([]);

  // Kelas lulus: alasan skenario tidak lagi muncul.
  const detail = await (await page.request.get(`/api/v1/courses/${course.id}`)).json();
  expect(detail.completion.reasons.some((r: string) => r.startsWith('Skenario'))).toBe(false);
});
