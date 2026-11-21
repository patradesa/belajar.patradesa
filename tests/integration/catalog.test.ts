/** Katalog kaya-data, rating kelas (hanya peserta terdaftar), dan foto sampul (validasi + akses). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, seedDemoCourse, type Harness } from '../helpers/harness';

let h: Harness;
let admin: Client;
let courseId: string;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1]);

const catalogItem = async (c: Client) => (await c.json('GET', '/api/v1/catalog')).body.courses.find((x: any) => x.id === courseId);

beforeAll(async () => {
  h = await createHarness();
  admin = await new Client(h).login('admin@contoh.test', 'Admin', ['admin']);
  ({ courseId } = await seedDemoCourse(admin));
});
afterAll(() => h.dispose());

describe('katalog', () => {
  it('memuat jumlah materi, waktu belajar, jumlah soal kuis, jabatan sasaran, rating, sampul, status daftar', async () => {
    const anon = new Client(h);
    const res = await anon.raw('GET', '/api/v1/catalog');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    const c = ((await res.json()) as { courses: any[] }).courses.find((x: any) => x.id === courseId);
    expect(c).toMatchObject({
      lessonCount: 2,
      studyMinutes: 1, // 60 dtk + 0 dtk
      quizQuestionCount: 6, // 5 PG + 1 esai ditampilkan
      recommendedRoles: ['perbekel', 'sekdes', 'operator_sid', 'bpd'],
      rating: { average: null, count: 0 },
      coverUrl: null,
      enrolled: false,
      recommended: false,
    });
  });

  it('status terdaftar & rekomendasi per pengguna', async () => {
    const l = await new Client(h).login('kat@contoh.test', 'Kat');
    await l.json('PATCH', '/api/v1/me', { villageRole: 'sekdes' });
    expect(await catalogItem(l)).toMatchObject({ enrolled: false, recommended: true });
    await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
    expect(await catalogItem(l)).toMatchObject({ enrolled: true });
    expect(await catalogItem(new Client(h))).toMatchObject({ enrolled: false });
  });
});

describe('rating kelas', () => {
  it('anonim 401, belum terdaftar 403, nilai di luar 1–5 ditolak', async () => {
    expect((await new Client(h).json('POST', `/api/v1/courses/${courseId}/rating`, { stars: 5 })).status).toBe(401);
    const l = await new Client(h).login('belum@contoh.test', 'Belum');
    const r = await l.json('POST', `/api/v1/courses/${courseId}/rating`, { stars: 5 });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NOT_ELIGIBLE');
    await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
    for (const stars of [0, 6, 2.5, '5']) expect((await l.json('POST', `/api/v1/courses/${courseId}/rating`, { stars })).status, String(stars)).toBe(400);
  });

  it('rata-rata & jumlah dihitung server; satu rating per peserta (bisa diubah)', async () => {
    const a = await new Client(h).login('r1@contoh.test', 'R1');
    const b = await new Client(h).login('r2@contoh.test', 'R2');
    for (const c of [a, b]) await c.json('POST', `/api/v1/courses/${courseId}/enroll`);
    expect((await a.json('POST', `/api/v1/courses/${courseId}/rating`, { stars: 5 })).body).toEqual({ rating: { average: 5, count: 1 }, myRating: 5 });
    expect((await b.json('POST', `/api/v1/courses/${courseId}/rating`, { stars: 4 })).body.rating).toEqual({ average: 4.5, count: 2 });
    expect((await a.json('POST', `/api/v1/courses/${courseId}/rating`, { stars: 3 })).body.rating).toEqual({ average: 3.5, count: 2 });
    expect((await catalogItem(new Client(h))).rating).toEqual({ average: 3.5, count: 2 });
    const d = await a.json('GET', `/api/v1/courses/${courseId}`);
    expect(d.body.myRating).toBe(3);
    expect(d.body.rating).toEqual({ average: 3.5, count: 2 });
  });
});

describe('foto sampul', () => {
  const put = (c: Client, body: Uint8Array, type: string, id = courseId) => c.raw('PUT', `/api/v1/admin/courses/${id}/cover`, body, { 'content-type': type });

  it('hanya editor/admin; jenis & isi berkas divalidasi; ukuran dibatasi', async () => {
    const learner = await new Client(h).login('cov@contoh.test', 'Cov');
    expect((await put(learner, PNG, 'image/png')).status).toBe(403);
    expect((await put(admin, PNG, 'text/html')).status).toBe(415);
    expect((await put(admin, JPG, 'image/png')).status).toBe(415); // isi JPG diklaim PNG
    expect((await put(admin, new TextEncoder().encode('<svg onload=alert(1)>xxxxxxxx'), 'image/webp')).status).toBe(415);
    const big = new Uint8Array(2 * 1024 * 1024 + 10);
    big.set(PNG);
    expect((await put(admin, big, 'image/png')).status).toBe(413);
  });

  it('sampul tersimpan di R2, tampil di katalog & disajikan publik dengan cache; ganti menghapus berkas lama', async () => {
    expect((await put(admin, PNG, 'image/png')).status).toBe(200);
    const url = (await catalogItem(new Client(h))).coverUrl as string;
    expect(url).toMatch(/^\/api\/v1\/courses\/dasar-transparansi-desa\/cover\?v=\d+$/);
    const img = await new Client(h).raw('GET', url);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
    const oldKey = (await h.env.DB.prepare('SELECT file_key FROM course_covers WHERE course_id = ?').bind(courseId).first<{ file_key: string }>())!.file_key;
    expect((await put(admin, JPG, 'image/jpeg')).status).toBe(200);
    expect(await h.env.FILES.get(oldKey)).toBeNull();
    const audit = await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action = 'course.cover'`).first<{ n: number }>();
    expect(audit?.n).toBe(2);
  });

  it('sampul kelas draft tidak publik (anonim 404), editor/admin dapat melihat tanpa cache', async () => {
    const draft = (await admin.json('POST', '/api/v1/admin/courses', { slug: 'kelas-draft-sampul', title: 'Kelas Draft' })).body.id;
    expect((await put(admin, PNG, 'image/png', draft)).status).toBe(200);
    expect((await new Client(h).raw('GET', `/api/v1/courses/${draft}/cover`)).status).toBe(404);
    const r = await admin.raw('GET', `/api/v1/courses/${draft}/cover`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });

  it('hapus sampul → katalog kembali tanpa sampul', async () => {
    expect((await admin.json('DELETE', `/api/v1/admin/courses/${courseId}/cover`)).status).toBe(200);
    expect((await catalogItem(new Client(h))).coverUrl).toBeNull();
    expect((await new Client(h).raw('GET', `/api/v1/courses/${courseId}/cover`)).status).toBe(404);
  });
});
