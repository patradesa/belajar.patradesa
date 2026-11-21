/**
 * E2E (runtime Workers asli + D1 lokal, viewport ponsel 360px):
 * alur peserta → kuis; AI 423 lintas tab/perangkat; font scaling di kuis; anti-copy hanya di soal;
 * esai tetap bisa diedit; AI kembali setelah submit; tanpa scroll horizontal pada 320px + teks 200%.
 */
import { expect, test, type Page } from '@playwright/test';
import demo from '../../db/seed/demo-course.json' with { type: 'json' };

const SLUG = demo.course.slug;

async function uiLogin(page: Page, email: string, name: string) {
  await page.goto('/masuk');
  await page.getByLabel('Email (fiktif)').fill(email);
  await page.getByLabel('Nama').fill(name);
  await page.getByRole('button', { name: 'Masuk (dev)' }).click();
}

async function csrf(page: Page): Promise<string> {
  return (await (await page.request.get('/api/v1/me')).json()).csrfToken;
}

async function aiStatus(page: Page, lessonId: string): Promise<number> {
  const r = await page.request.post(`/api/v1/lessons/${lessonId}/ai/chat`, {
    headers: { origin: 'http://localhost:8787', 'x-csrf-token': await csrf(page) },
    data: { message: 'halo' },
  });
  return r.status();
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'lebar konten melebihi viewport').toBeLessThanOrEqual(1);
}

test('alur peserta: profil → kelas → materi → kuis terkunci AI → submit → AI kembali', async ({ page, browser }) => {
  const email = `peserta-${Date.now()}@contoh.test`;
  await uiLogin(page, email, 'Peserta E2E');

  // Profil wajib persetujuan privasi; jabatan hanya rekomendasi.
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible();
  await page.getByRole('button', { name: 'Simpan profil' }).click();
  await expect(page.getByText('Persetujuan kebijakan privasi wajib dicentang.')).toBeVisible();
  await page.getByLabel('Jabatan di desa').selectOption('sekdes');
  await page.getByLabel(/menyetujui/).check();
  await page.getByRole('button', { name: 'Simpan profil' }).click();
  await expect(page.getByText('Disarankan untuk jabatan Anda')).toBeVisible();

  await page.getByRole('link', { name: demo.course.title }).click();
  await page.getByRole('button', { name: 'Daftar kelas ini' }).click();
  await page.getByRole('link', { name: demo.lessons[1]!.title }).click();
  await expect(page.getByText('Slide 1 dari 3')).toBeVisible();
  const lessonId = page.url().split('/').pop()!;
  await expect(page.getByTestId('ai-open')).toBeVisible();
  expect(await aiStatus(page, lessonId)).toBe(200); // Phase 1: fallback non-AI, bukan 423

  await page.getByRole('link', { name: '← Kembali ke kelas' }).click();
  await page.getByRole('button', { name: 'Mulai Kuis' }).click();
  await expect(page.getByTestId('ai-locked-notice')).toContainText('Pendamping AI tidak tersedia selama kuis.');
  await expect(page.getByTestId('ai-open')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toHaveCount(0);

  // --- AI 423: tab yang sama, tab baru, perangkat lain (konteks browser terpisah, login ulang)
  expect(await aiStatus(page, lessonId)).toBe(423);
  const tab2 = await page.context().newPage();
  await tab2.goto(`/materi/${lessonId}`);
  await expect(tab2.getByText('Pendamping AI tidak tersedia selama kuis.').first()).toBeVisible();
  await expect(tab2.getByTestId('ai-open')).toHaveCount(0);
  expect(await aiStatus(tab2, lessonId)).toBe(423);
  await tab2.close();
  const device2 = await browser.newContext({ baseURL: 'http://localhost:8787' });
  const phone = await device2.newPage();
  await uiLogin(phone, email, 'Peserta E2E');
  await phone.waitForURL((u) => !u.pathname.startsWith('/masuk'));
  expect(await aiStatus(phone, lessonId)).toBe(423);
  const rec = await phone.request.get('/api/v1/ai/recommendations');
  expect(rec.status()).toBe(423);

  // --- Font scaling di layar kuis
  const before = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await page.getByRole('button', { name: /perbesar teks/i }).click();
  await page.getByRole('button', { name: /perbesar teks/i }).click();
  const after = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  expect(after).toBeCloseTo(before * 1.25, 1);
  await page.reload();
  expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeCloseTo(before * 1.25, 1);

  // --- Anti-copy HANYA pada soal; esai bebas
  const stem = page.locator('[data-testid="mcq-question"] .question-stem').first();
  const essay = page.getByLabel('Jawaban Anda');
  expect(await stem.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
  expect(await essay.evaluate((el) => getComputedStyle(el).userSelect)).not.toBe('none');
  const ctx = (sel: string) =>
    page.evaluate((s) => {
      const el = document.querySelector(s)!;
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, sel);
  expect(await ctx('[data-testid="mcq-question"] .question-stem')).toBe(true);
  expect(await ctx('textarea.essay-answer')).toBe(false);
  await essay.click();
  await essay.pressSequentially('Draf pertama');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Pengumuman ditulis sederhana tanpa data pribadi.');
  await expect(essay).toHaveValue('Pengumuman ditulis sederhana tanpa data pribadi.');
  await expect(page.getByText('✓ Tersimpan')).toBeVisible({ timeout: 10_000 });

  // Pilih jawaban PG dengan keyboard
  const firstRadio = page.locator('[data-testid="mcq-question"] input[type=radio]').first();
  await firstRadio.focus();
  await page.keyboard.press('Space');
  await expect(firstRadio).toBeChecked();

  // Tanpa scroll horizontal pada 320px dengan teks 200%
  await page.setViewportSize({ width: 320, height: 700 });
  for (let i = 0; i < 4; i++) {
    const plus = page.getByRole('button', { name: /perbesar teks/i });
    if (await plus.isEnabled()) await plus.click();
  }
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: /Reset\s+ukuran teks/ }).click();
  await page.setViewportSize({ width: 360, height: 780 });

  // Refresh di perangkat lain → soal & urutan sama
  const order = async (p: Page) => (await (await p.request.get(`/api/v1/attempts/${page.url().split('/').pop()}`)).json()).questions.map((q: { id: string }) => q.id);
  expect(await order(phone)).toEqual(await order(page));

  // --- Submit → hasil → AI kembali (di kedua perangkat)
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Kumpulkan jawaban' }).click();
  await expect(page.getByRole('heading', { name: 'Hasil kuis' })).toBeVisible();
  await expect(page.getByText('Menunggu penilaian mentor')).toBeVisible();
  expect(await aiStatus(page, lessonId)).toBe(200);
  expect(await aiStatus(phone, lessonId)).toBe(200);
  await device2.close();
});

test('tanpa scroll horizontal pada 320px dan teks 200% (katalog, kelas, materi)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await uiLogin(page, `lebar-${Date.now()}@contoh.test`, 'Peserta Lebar');
  await page.goto('/');
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: /perbesar teks/i }).click();
  await expect(page.getByRole('group', { name: 'Ukuran teks' }).locator('output')).toHaveText('200%');
  await noHorizontalScroll(page);
  await page.goto(`/kelas/${SLUG}`);
  await page.getByRole('button', { name: 'Daftar kelas ini' }).click();
  await noHorizontalScroll(page);
  await page.getByRole('link', { name: demo.lessons[0]!.title }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Progres belajar' })).toBeVisible();
  await noHorizontalScroll(page);
  // Target sentuh minimal 44×44 CSS px pada tombol utama
  const box = await page.getByRole('button', { name: /perbesar teks/i }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
});

test('dev-login & admin: peserta tidak dapat membuka admin', async ({ page }) => {
  await uiLogin(page, `bukan-admin-${Date.now()}@contoh.test`, 'Bukan Admin');
  await page.waitForURL((u) => !u.pathname.startsWith('/masuk'));
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Masuk Admin' })).toBeVisible();
  await expect(page.getByText('tidak memiliki akses pengelola')).toBeVisible();
  const r = await page.request.get('/api/v1/admin/courses');
  expect(r.status()).toBe(403);
});
