/**
 * Impor paket kelas: validasi server (skema, slug, skenario, rujukan, jumlah soal) dan impor bertahap
 * lewat endpoint yang ada — urutan yang sama dengan halaman Admin → Impor paket kelas.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseBundleSchema, QUESTION_IMPORT_CHUNK, bundleScenarioDefinitions, convertCoursePackageV1 } from '@patradesa/shared';
import { Client, createHarness, type Harness } from '../helpers/harness';

const ROOT = join(import.meta.dirname, '..', '..');
const contoh = () => JSON.parse(readFileSync(join(ROOT, 'docs', 'course-bundle', 'contoh-paket-kelas.json'), 'utf8'));
let h: Harness;
let admin: Client;

const validate = (c: Client, body: unknown) => c.json('POST', '/api/v1/admin/courses/import-bundle/validate', body);

/** Sama dengan ImportBundle.tsx: skenario → kelas (+jabatan) → materi → kuis → soal per 5. */
async function runImport(c: Client, raw: unknown): Promise<string> {
  const bundle = CourseBundleSchema.parse(raw);
  for (const d of bundleScenarioDefinitions(bundle)) expect((await c.json('POST', '/api/v1/admin/scenarios', { definition: d })).status).toBeLessThan(300);
  const { slug, title, description, visibility, targetRoles } = bundle.course;
  const created = await c.json('POST', '/api/v1/admin/courses', { slug, title, description, visibility });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  if (targetRoles.length) expect((await c.json('PATCH', `/api/v1/admin/courses/${id}`, { recommendedFor: targetRoles })).status).toBe(200);
  for (const l of bundle.lessons) {
    const { quiz, ...lesson } = l;
    const lr = await c.json('POST', `/api/v1/admin/courses/${id}/lessons`, lesson);
    expect(lr.status, JSON.stringify(lr.body)).toBe(201);
    if (quiz) {
      const ar = await c.json('PUT', `/api/v1/admin/lessons/${lr.body.id}/assessment`, quiz.settings);
      expect(ar.status).toBe(200);
      for (let k = 0; k < quiz.questions.length; k += QUESTION_IMPORT_CHUNK) {
        const r = await c.json('POST', `/api/v1/admin/assessments/${ar.body.id}/questions/import`, { questions: quiz.questions.slice(k, k + QUESTION_IMPORT_CHUNK) });
        expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
      }
    }
  }
  return id;
}

beforeAll(async () => {
  h = await createHarness();
  admin = await new Client(h).login('admin@contoh.test', 'Admin', ['admin']);
});
afterAll(() => h.dispose());

describe('validasi paket kelas', () => {
  it('paket contoh valid: ringkasan dan rencana skenario', async () => {
    const r = await validate(admin, contoh());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      ok: true,
      problems: [],
      summary: { slug: 'contoh-paket-layanan-adminduk', visibility: 'private', lessons: 2, quizzes: 1, questions: 3, scenarios: 1, targetRoles: ['sekdes', 'kasi', 'operator_sid'] },
      scenarios: [{ key: 'contoh-paket-beda-nama', action: 'create' }],
    });
  });

  it('menolak: versi skema salah, skenario rusak, jumlah soal kurang, rujukan skenario hilang, lessonKey ganda', async () => {
    const wrongVersion = { ...contoh(), schemaVersion: 'v0' };
    expect((await validate(admin, wrongVersion)).body.problems[0]).toContain('/schemaVersion');

    const broken = contoh();
    broken.scenarios[0].nodes[3].options[1].nextNodeId = 'hilang';
    expect((await validate(admin, broken)).body.problems).toContain("/scenarios/0: /nodes/3/options/1/nextNodeId: node 'hilang' tidak ada");

    const few = contoh();
    few.lessons[1].quiz.mcqCount = 5;
    expect((await validate(admin, few)).body.problems.join('\n')).toContain('menampilkan 5 PG dan 0 esai, tetapi bank berisi 3 PG');

    const missing = contoh();
    missing.scenarios = [];
    const m = await validate(admin, missing);
    expect(m.body.ok).toBe(false);
    expect(m.body.problems).toContain('Materi menyisipkan [[skenario:contoh-paket-beda-nama]], tetapi skenario itu tidak ada di paket maupun di LMS.');

    const dup = contoh();
    dup.lessons[1].lessonKey = dup.lessons[0].lessonKey;
    expect((await validate(admin, dup)).body.problems.join('\n')).toContain('lessonKey ganda');
  });

  it('peringatan (bukan galat) untuk tabel dan tag HTML; bukan JSON → 400; peserta → 403', async () => {
    const t = contoh();
    t.lessons[0].contentSource += '\n\n| a | b |\n\n<b>tebal</b>';
    const r = await validate(admin, t);
    expect(r.body.ok).toBe(true);
    expect(r.body.warnings.join('\n')).toMatch(/tabel Markdown[\s\S]*tag HTML/);

    const bad = await admin.raw('POST', '/api/v1/admin/courses/import-bundle/validate', new TextEncoder().encode('{bukan json'), { 'content-type': 'application/json' });
    expect(bad.status).toBe(400);
    const learner = await new Client(h).login('peserta@contoh.test', 'P');
    expect((await validate(learner, contoh())).status).toBe(403);
  });
});

describe('impor bertahap', () => {
  let courseId: string;

  it('membuat kelas draf lengkap: materi terurai, kode materi, kuis + penjelasan, skenario draf, jabatan', async () => {
    courseId = await runImport(admin, contoh());
    const d = (await admin.json('GET', `/api/v1/admin/courses/${courseId}`)).body;
    expect(d.course).toMatchObject({ status: 'draft', visibility: 'private', current_version_id: null });
    expect(d.recommendedFor.sort()).toEqual(['kasi', 'operator_sid', 'sekdes']);
    expect(d.lessons.map((l: any) => l.lesson_key)).toEqual(['contoh-u01-lima-langkah', 'contoh-post-test']);
    const quiz = d.lessons[1].assessment;
    expect(quiz).toMatchObject({ passing_score_pct: 70, review_policy: 'after_done', mcq_count: 3 });
    expect(quiz.questions).toHaveLength(3);
    expect(quiz.questions[0].explanation).toContain('bolak-balik');
    const sc = await h.env.DB.prepare(`SELECT status FROM scenario_blocks WHERE block_key = 'contoh-paket-beda-nama'`).first<{ status: string }>();
    expect(sc!.status).toBe('draft');
    // Validasi ulang paket yang sama: slug terpakai + draf skenario bentrok.
    const again = (await validate(admin, contoh())).body;
    expect(again.ok).toBe(false);
    expect(again.problems.join('\n')).toMatch(/Slug kelas[\s\S]*masih punya draf/);
  });

  it('setelah skenario & kelas diterbitkan, peserta melihat materi berisi bagian dan skenario', async () => {
    const block = await h.env.DB.prepare(`SELECT id FROM scenario_blocks WHERE block_key = 'contoh-paket-beda-nama'`).first<{ id: string }>();
    expect(
      (await admin.json('POST', `/api/v1/admin/scenarios/${block!.id}/status`, { status: 'published', review: { reviewedBy: 'Penelaah Uji', reviewedAt: '2026-11-20', nextReviewDue: '2027-11-20' } }))
        .status,
    ).toBe(200);
    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);
    await admin.json('PATCH', `/api/v1/admin/courses/${courseId}`, { visibility: 'public' });
    const p = await new Client(h).login('belajar@contoh.test', 'Belajar');
    expect((await p.json('POST', `/api/v1/courses/${courseId}/enroll`)).status).toBeLessThan(300);
    const detail = (await p.json('GET', `/api/v1/courses/${courseId}`)).body;
    const content = (await p.json('GET', `/api/v1/lessons/${detail.lessons[0].id}/content`)).body;
    expect(content.blocks.filter((b: any) => b.type === 'h2').map((b: any) => b.text)).toEqual(['1. AMATI', '2. ANALISIS', '3. AKSI', '4. ASESMEN']);
    expect(content.blocks).toContainEqual({ type: 'scenario', key: 'contoh-paket-beda-nama' });
    expect(content.scenarios).toHaveLength(1);
  });
});

describe('format paket kelas 1.0.0 (Daya Desa)', () => {
  const daya = () => JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'daya-desa-literasi-digital-bali-paket-lengkap.json'), 'utf8'));

  it('server mengenali dan mengubah berkas asli; catatan pengubahan masuk peringatan', async () => {
    const r = await validate(admin, daya());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      ok: true,
      format: 'course-package-1.0.0',
      problems: [],
      summary: { slug: 'daya-desa-literasi-digital-bali', visibility: 'private', lessons: 14, quizzes: 1, questions: 17, scenarios: 13 },
    });
    expect(r.body.warnings.join(' | ')).toContain('upsert_by_slug');
    expect(r.body.scenarios.every((s: any) => s.action === 'create')).toBe(true);
  });

  it('kunci PG yang tidak cocok → masalah, bukan tebakan', async () => {
    const p = daya();
    p.modules[1].questions[0].correct_answer = 'tidak ada';
    const r = await validate(admin, p);
    expect(r.body.ok).toBe(false);
    expect(r.body.problems.join(' | ')).toContain('correct_answer');
  });

  it('impor bertahap hasil pengubahan membuat kelas draf 14 materi + kuis akhir', async () => {
    const conv = convertCoursePackageV1(daya());
    const id = await runImport(admin, conv.bundle);
    const d = (await admin.json('GET', `/api/v1/admin/courses/${id}`)).body;
    expect(d.course).toMatchObject({ status: 'draft', visibility: 'private' });
    expect(d.lessons).toHaveLength(14);
    const quiz = d.lessons[13].assessment;
    expect(quiz).toMatchObject({ mcq_count: 13, essay_count: 4, passing_score_pct: 70 });
    expect(quiz.questions).toHaveLength(17);
    const n = await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM scenario_blocks WHERE status = 'draft' AND block_key LIKE 'sim-%'`).first<{ n: number }>();
    expect(n!.n).toBe(13);
  });
});
