import { Hono } from 'hono';
import { CourseBundleSchema, ERROR_CODES, bundleEmbeddedScenarioKeys, bundleScenarioDefinitions } from '@patradesa/shared';
import type { AppEnv } from '../../env';
import { HttpError } from '../../lib/http';
import { requireRole } from '../../middleware/auth';

/**
 * Impor paket kelas (docs/course-bundle/README.md).
 *
 * Endpoint ini hanya MEMVALIDASI paket dan menyusun rencana impor dengan jumlah query tetap (≤ 3).
 * Impor sebenarnya dijalankan halaman Admin → Impor paket kelas secara bertahap lewat endpoint yang
 * sudah ada (skenario, kelas, materi, kuis, soal per 5), karena D1 paket Free membatasi ±50 query per
 * permintaan — satu batch untuk seluruh kelas (ratusan statement) akan gagal di produksi.
 */
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

export function adminImportBundleRoutes() {
  const r = new Hono<AppEnv>();

  r.post('/courses/import-bundle/validate', requireRole('content_editor', 'admin'), async (c) => {
    const ct = c.req.header('content-type') ?? '';
    if (!ct.toLowerCase().startsWith('application/json')) throw new HttpError(415, ERROR_CODES.VALIDATION, 'Content-Type harus application/json.');
    const text = await c.req.text();
    if (text.length > MAX_BUNDLE_BYTES) throw new HttpError(413, ERROR_CODES.VALIDATION, 'Paket kelas terlalu besar (maks 2 MB).');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, ERROR_CODES.VALIDATION, 'Berkas bukan JSON yang valid.');
    }

    const parsed = CourseBundleSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({
        ok: false,
        problems: parsed.error.issues.slice(0, 60).map((i) => `${i.path.length ? '/' + i.path.join('/') : '/'}: ${i.message}`),
        warnings: [],
        summary: null,
        scenarios: [],
      });
    }
    const bundle = parsed.data;
    const db = c.env.DB;
    const problems: string[] = [];
    const warnings: string[] = [];

    // 1 query: slug kelas.
    const slugTaken = await db.prepare('SELECT 1 AS x FROM courses WHERE slug = ?').bind(bundle.course.slug).first();
    if (slugTaken) problems.push(`Slug kelas "${bundle.course.slug}" sudah dipakai. Ganti slug di paket, atau ubah kelas yang ada lewat editor.`);

    // 1 query: status semua skenario yang dikirim maupun yang disisipkan.
    const defs = bundleScenarioDefinitions(bundle);
    const inBundle = new Set(defs.map((d) => d.id));
    const embedded = bundleEmbeddedScenarioKeys(bundle);
    const allKeys = [...new Set([...inBundle, ...embedded])];
    const existing = new Map<string, Set<string>>();
    if (allKeys.length) {
      const { results } = await db
        .prepare(`SELECT block_key, status FROM scenario_blocks WHERE block_key IN (SELECT value FROM json_each(?))`)
        .bind(JSON.stringify(allKeys))
        .all<{ block_key: string; status: string }>();
      for (const row of results) {
        const s = existing.get(row.block_key) ?? new Set<string>();
        s.add(row.status);
        existing.set(row.block_key, s);
      }
    }

    const scenarios = defs.map((d) => {
      const st = existing.get(d.id);
      if (st && (st.has('draft') || st.has('in_review'))) {
        problems.push(`Skenario "${d.id}" masih punya draf di LMS. Terbitkan atau arsipkan draf itu dulu agar tidak tertimpa.`);
        return { key: d.id, title: d.title, action: 'conflict' as const };
      }
      if (st?.has('published')) {
        warnings.push(`Skenario "${d.id}" sudah terbit. Impor membuat versi baru berstatus draf; kelas tetap memakai versi terbit sampai versi baru diterbitkan.`);
        return { key: d.id, title: d.title, action: 'new_version' as const };
      }
      return { key: d.id, title: d.title, action: 'create' as const };
    });
    for (const k of embedded) {
      if (inBundle.has(k)) continue;
      const st = existing.get(k);
      if (!st || [...st].every((s) => s === 'archived')) problems.push(`Materi menyisipkan [[skenario:${k}]], tetapi skenario itu tidak ada di paket maupun di LMS.`);
    }

    // Peringatan format: tampil sebagai teks biasa di LMS (bukan galat).
    for (const l of bundle.lessons) {
      if (/^\s*\|.+\|\s*$/m.test(l.contentSource)) warnings.push(`Materi "${l.title}" memuat tabel Markdown; LMS menampilkannya sebagai teks biasa.`);
      if (/<[a-zA-Z/][^>]*>/.test(l.contentSource)) warnings.push(`Materi "${l.title}" memuat tag HTML; LMS menampilkannya sebagai teks, bukan format.`);
    }

    const quizzes = bundle.lessons.filter((l) => l.quiz);
    return c.json({
      ok: problems.length === 0,
      problems,
      warnings,
      summary: {
        title: bundle.course.title,
        slug: bundle.course.slug,
        visibility: bundle.course.visibility,
        targetRoles: bundle.course.targetRoles,
        lessons: bundle.lessons.length,
        quizzes: quizzes.length,
        questions: quizzes.reduce((n, l) => n + l.quiz!.questions.length, 0),
        scenarios: defs.length,
      },
      scenarios,
    });
  });

  return r;
}
