/**
 * Membuat aset panduan: tangkapan layar (data FIKTIF di server lokal) + PDF A4 potret peserta & pengelola.
 * Jalankan lewat `npm run guides`. Bukan bagian dari suite e2e biasa.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { APP_URL, CONTACT, GUIDE_VERSION, GUIDES } from '../../apps/web/src/guide/content';
import { headerFooter, renderGuideHtml } from '../../scripts/guide/render.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = join(ROOT, 'apps', 'web', 'public', 'panduan');
const IMG = join(OUT, 'img');
const BASE = 'http://localhost:8787';

// Tombol "Ukuran teks" mengambang disembunyikan agar tidak menutupi isi gambar (punya gambar sendiri).
// CSP aplikasi memblokir <style> sisipan, jadi elemen disembunyikan lewat CSSOM (diizinkan CSP) lalu dipulihkan.
async function withoutFloat<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  const toggle = (hide: boolean) =>
    page.evaluate((h) => {
      const el = document.querySelector<HTMLElement>('.font-float');
      if (el) el.style.display = h ? 'none' : '';
    }, hide);
  await toggle(true);
  try {
    return await fn();
  } finally {
    await toggle(false);
  }
}
const shot = (page: Page, name: string) => withoutFloat(page, () => page.screenshot({ path: join(IMG, name), type: 'jpeg', quality: 82 }));

/** Tampilkan halaman Masuk seperti di produksi (tombol Google, tanpa formulir uji pengembangan). */
async function productionLoginConfig(page: Page) {
  await page.route('**/api/v1/auth/config', (r) =>
    r.fulfill({ json: { turnstileSiteKey: '1x00000000000000000000AA', googleEnabled: true, devLoginEnabled: false } }),
  );
}

async function login(browser: Browser, email: string, name: string, roles: string[] = []) {
  const ctx = await browser.newContext({ baseURL: BASE, locale: 'id-ID', viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const r = await ctx.request.post('/api/v1/auth/dev-login', { data: { email, name, roles }, headers: { origin: BASE } });
  expect(r.ok()).toBe(true);
  const csrf = (await (await ctx.request.get('/api/v1/me')).json()).csrfToken as string;
  const h = { origin: BASE, 'x-csrf-token': csrf };
  await ctx.request.patch('/api/v1/me', { headers: h, data: { privacyConsent: true } });
  return { ctx, page, h, req: ctx.request as APIRequestContext };
}

test('tangkapan layar & PDF panduan', async ({ browser }) => {
  mkdirSync(IMG, { recursive: true });
  const stamp = Date.now();

  // ---------------- pengelola menyiapkan kelas contoh (semua materi 0 menit, kuis PG saja) agar peserta bisa lulus
  const admin = await login(browser, `admin-panduan-${stamp}@contoh.test`, 'Admin Panduan', ['admin']);
  const slug = `pelayanan-publik-desa-${stamp}`;
  const course = await (
    await admin.req.post('/api/v1/admin/courses', {
      headers: admin.h,
      data: {
        slug,
        title: 'Dasar Pelayanan Publik Desa (Contoh)',
        description:
          'Kelas contoh tentang standar pelayanan, keterbukaan informasi, dan penanganan pengaduan warga di desa. Semua nama dan data dalam kelas ini fiktif.\n\n## Yang akan dipelajari\n\n- Prinsip pelayanan publik yang ramah dan tepat waktu\n- Menyusun standar pelayanan sederhana\n- Mencatat dan menindaklanjuti pengaduan warga',
        visibility: 'public',
      },
    })
  ).json();
  const titles = ['Prinsip Pelayanan Publik', 'Standar Pelayanan Desa', 'Menangani Pengaduan Warga'];
  const lessonIds: string[] = [];
  for (const t of titles) {
    const l = await (
      await admin.req.post(`/api/v1/admin/courses/${course.id}/lessons`, {
        headers: admin.h,
        data: { title: t, summary: `Materi contoh: ${t.toLowerCase()}.`, contentType: 'html', contentSource: `## ${t}\n\nMateri contoh (fiktif) untuk panduan.`, requiredActiveSeconds: 0, isRequired: true },
      })
    ).json();
    lessonIds.push(l.id);
  }
  const quiz = await (
    await admin.req.put(`/api/v1/admin/lessons/${lessonIds[2]}/assessment`, {
      headers: admin.h,
      data: { title: 'Kuis Pelayanan Publik', timeLimitSeconds: 600, passingScorePct: 70, maxAttempts: 3, cooldownSeconds: 0, mcqCount: 3, essayCount: 0 },
    })
  ).json();
  const mcq = [
    ['Siapa yang berhak mendapat pelayanan dari pemerintah desa?', 'Seluruh warga tanpa membedakan', ['Hanya warga yang dikenal perangkat', 'Hanya pemilik tanah', 'Hanya tokoh masyarakat']],
    ['Apa fungsi standar pelayanan?', 'Memberi kepastian syarat, waktu, dan biaya layanan', ['Mempersulit warga', 'Menggantikan musyawarah desa', 'Hanya formalitas laporan']],
    ['Pengaduan warga sebaiknya…', 'Dicatat dan ditindaklanjuti dengan jelas', ['Diabaikan bila tidak tertulis', 'Diteruskan ke media sosial', 'Dijawab setelah setahun']],
  ] as const;
  for (const [stem, ok, wrong] of mcq) {
    await admin.req.post(`/api/v1/admin/assessments/${quiz.id}/questions`, {
      headers: admin.h,
      data: { type: 'mcq', stem, topic: 'pelayanan', difficulty: 1, points: 2, options: [{ body: ok, isCorrect: true }, ...wrong.map((b) => ({ body: b, isCorrect: false }))] },
    });
  }
  expect((await admin.req.post(`/api/v1/admin/courses/${course.id}/publish`, { headers: admin.h })).ok()).toBe(true);
  await admin.req.patch(`/api/v1/admin/courses/${course.id}`, { headers: admin.h, data: { recommendedFor: ['perbekel', 'sekdes', 'kaur', 'bpd'] } });

  // ---------------- tamu: beranda & halaman masuk
  const guest = await browser.newContext({ baseURL: BASE, locale: 'id-ID', viewport: { width: 1280, height: 800 } });
  const gp = await guest.newPage();
  await gp.goto('/');
  await gp.getByRole('heading', { name: 'Katalog kelas' }).waitFor();
  await shot(gp, 'peserta-01-beranda.jpg');
  await productionLoginConfig(gp);
  await gp.goto('/masuk');
  await gp.getByRole('button', { name: /Masuk dengan Google/ }).waitFor();
  await gp.waitForTimeout(1500);
  await shot(gp, 'peserta-02-masuk.jpg');
  await gp.goto('/admin/masuk');
  await gp.getByRole('button', { name: /Masuk dengan Google/ }).waitFor();
  await gp.waitForTimeout(1500);
  await shot(gp, 'admin-01-masuk.jpg');

  // ---------------- peserta fiktif
  const p = await login(browser, `ni.luh.sari-${stamp}@contoh.test`, 'Ni Luh Sari');
  await p.req.patch('/api/v1/me', {
    headers: p.h,
    data: { certificateName: 'Ni Luh Putu Sari, S.E.', villageRole: 'sekdes', villageName: 'Desa Contoh Sukamaju', district: 'Kecamatan Contoh', regency: 'Kabupaten Contoh' },
  });
  // Lulus kelas contoh lewat API (kuis PG saja → langsung lulus → sertifikat terbit lewat Studio tiruan).
  await p.req.post(`/api/v1/courses/${course.id}/enroll`, { headers: p.h });
  for (const id of lessonIds) await p.req.post(`/api/v1/lessons/${id}/session`, { headers: p.h });
  const att = await (await p.req.post(`/api/v1/assessments/${quiz.id}/attempts`, { headers: p.h })).json();
  const correct = new Set<string>(mcq.map((m) => m[1]));
  const answers = att.questions.map((q: { id: string; options: { key: string; body: string }[] }) => ({ questionId: q.id, optionKey: q.options.find((o) => correct.has(o.body))!.key }));
  await p.req.patch(`/api/v1/attempts/${att.id}/answers`, { headers: p.h, data: { answers } });
  expect((await (await p.req.post(`/api/v1/attempts/${att.id}/submit`, { headers: p.h })).json()).resultStatus).toBe('passed');
  await p.req.get(`/api/v1/courses/${slug}`);

  const pg = p.page;
  // Katalog dengan tanda Lulus
  await pg.goto('/');
  const grid = pg.locator('.course-grid');
  await grid.getByText('Lulus - Sertifikat Terbit').waitFor();
  await withoutFloat(pg, () => grid.screenshot({ path: join(IMG, 'peserta-04-katalog.jpg'), type: 'jpeg', quality: 82 }));
  // Dialog "Tentang kelas"
  await pg.getByRole('button', { name: /Selengkapnya tentang kelas Dasar Pelayanan/ }).click();
  await pg.getByRole('dialog').getByRole('heading', { level: 2 }).waitFor();
  await pg.waitForTimeout(500);
  await shot(pg, 'peserta-05-tentang-kelas.jpg');
  await pg.keyboard.press('Escape');

  // Kelas demo (bacaan + kuis berisi esai)
  await pg.goto('/kelas/dasar-transparansi-desa');
  await pg.getByRole('button', { name: /Daftar kelas ini/ }).click();
  await pg.getByRole('link', { name: 'Mengapa Keterbukaan Penting' }).click();
  await pg.getByRole('heading', { name: 'Progres belajar' }).waitFor();
  await pg.waitForTimeout(1200);
  await shot(pg, 'peserta-06-materi.jpg');
  await pg.goto('/kelas/dasar-transparansi-desa');
  await pg.getByRole('link', { name: 'Dokumentasi Kegiatan yang Rapi' }).click();
  await pg.getByText(/Slide 1 dari/).waitFor();
  await pg.goto('/kelas/dasar-transparansi-desa');
  await pg.getByRole('button', { name: 'Mulai Kuis' }).click();
  await pg.getByTestId('ai-locked-notice').waitFor();
  const mcqs = pg.getByTestId('mcq-question');
  for (let i = 0; i < 2; i++) await mcqs.nth(i).locator('label.option').first().click();
  const essay = pg.getByLabel('Jawaban Anda').first();
  if (await essay.count()) await essay.fill('Catatan kegiatan memuat tanggal, peserta, keputusan, dan penanggung jawab agar mudah ditelusuri warga.');
  await pg.getByText('✓ Tersimpan').first().waitFor();
  await shot(pg, 'peserta-07-kuis.jpg');
  pg.once('dialog', (d) => void d.accept());
  await pg.getByRole('button', { name: 'Kumpulkan jawaban' }).click();
  await pg.getByRole('heading', { name: 'Hasil kuis' }).waitFor();
  await pg.waitForTimeout(500);
  await shot(pg, 'peserta-08-hasil.jpg');

  // Sertifikat, profil, kelas saya, ukuran teks
  const certs = (await (await p.req.get('/api/v1/me/certificates')).json()).certificates as { code: string | null }[];
  const code = certs.find((c) => c.code)!.code!;
  await pg.goto(`/sertifikat/${code}`);
  await pg.getByRole('heading', { name: 'Sertifikat Kelulusan' }).waitFor();
  await pg.waitForTimeout(500);
  await shot(pg, 'peserta-09-sertifikat.jpg');
  await pg.goto('/profil');
  await pg.getByRole('heading', { name: 'Sertifikat saya' }).waitFor();
  await pg.getByText('Lulus - Sertifikat Terbit').first().waitFor();
  await shot(pg, 'peserta-03-profil.jpg');
  await pg.goto('/kelas-saya');
  await pg.getByText('Lulus - Sertifikat Terbit').waitFor();
  await shot(pg, 'peserta-10-kelas-saya.jpg');
  const box = (await pg.locator('.font-float').boundingBox())!;
  await pg.screenshot({
    path: join(IMG, 'peserta-11-ukuran-teks.jpg'),
    type: 'jpeg',
    quality: 82,
    clip: { x: Math.max(0, box.x - 120), y: box.y - 60, width: box.width + 240, height: box.height + 72 },
  });

  // ---------------- pengelola
  const ap = admin.page;
  await ap.goto('/admin');
  await ap.getByRole('heading', { name: 'Daftar kelas' }).waitFor();
  await shot(ap, 'admin-02-panel.jpg');
  await ap.goto(`/admin/kelas/${course.id}`);
  await ap.getByRole('heading', { name: 'Foto sampul kelas' }).waitFor();
  await shot(ap, 'admin-03-editor.jpg');
  await ap.getByRole('button', { name: 'Buat draft versi baru' }).click();
  await ap.getByRole('button', { name: 'Terbitkan draft' }).waitFor();
  await ap.getByText(/^3\. Menangani Pengaduan Warga/).click();
  const bank = ap.getByRole('heading', { name: /^Bank soal:/ });
  await bank.scrollIntoViewIfNeeded();
  await ap.evaluate(() => window.scrollBy(0, -40));
  await ap.waitForTimeout(400);
  await shot(ap, 'admin-04-bank-soal.jpg');
  await ap.goto('/admin/review');
  await ap.getByRole('heading', { name: 'Kuis Dokumentasi & Keterbukaan' }).first().waitFor();
  await shot(ap, 'admin-05-review.jpg');
  await ap.goto('/admin/sertifikat');
  await ap.locator('tr', { hasText: 'Ni Luh Putu Sari' }).getByText('Terbit').waitFor();
  await shot(ap, 'admin-06-sertifikat.jpg');

  // ---------------- PDF A4 potret
  const pdfPage = await guest.newPage();
  for (const guide of Object.values(GUIDES)) {
    await pdfPage.setContent(renderGuideHtml({ guide, contact: CONTACT, version: GUIDE_VERSION, appUrl: APP_URL, imgDir: IMG }), { waitUntil: 'load' });
    await pdfPage.evaluate(() => document.fonts.ready);
    await pdfPage.pdf({
      path: join(OUT, guide.pdf.split('/').pop()!),
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      ...headerFooter({ guide, contact: CONTACT }),
      margin: { top: '22mm', bottom: '20mm', left: '16mm', right: '16mm' },
    });
  }
});
