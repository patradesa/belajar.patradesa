/** Pengubah format paket kelas 1.0.0 → patradesa-course-bundle-v1 (docs/course-bundle/README.md §Format 1.0.0). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CourseBundleSchema, bundleScenarioDefinitions, convertCoursePackageV1, htmlToMarkdownLite, isCoursePackageV1, validateScenario } from '@patradesa/shared';

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'daya-desa-literasi-digital-bali-paket-lengkap.json');
const paket = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
const TODAY = new Date('2026-11-27T00:00:00Z');

describe('deteksi format', () => {
  it('mengenali 1.0.0 dan tidak salah mengenali bundle v1', () => {
    expect(isCoursePackageV1(paket())).toBe(true);
    expect(isCoursePackageV1({ schemaVersion: 'patradesa-course-bundle-v1', course: {}, lessons: [] })).toBe(false);
    expect(isCoursePackageV1(null)).toBe(false);
  });
});

describe('htmlToMarkdownLite', () => {
  it('judul, paragraf, daftar, tebal, tautan https, entitas; tag tak dikenal dilaporkan', () => {
    const unknown = new Set<string>();
    const md = htmlToMarkdownLite(
      '<article><h2>Bagian</h2><p>Teks <strong>penting</strong> &amp; <em>miring</em>, lihat <a href="https://contoh.test/a">ini</a>.</p><ul><li>satu</li><li>dua</li></ul><marquee>x</marquee></article>',
      unknown,
    );
    expect(md).toContain('## Bagian');
    expect(md).toContain('Teks **penting** & miring, lihat [ini](https://contoh.test/a).');
    expect(md).toMatch(/- satu\n- dua/);
    expect(md).not.toMatch(/<[a-z]/i);
    expect([...unknown]).toEqual(['marquee']);
  });
});

describe('paket Daya Desa (berkas nyata)', () => {
  const res = convertCoursePackageV1(paket(), TODAY);

  it('tanpa masalah dan lolos skema paket LMS', () => {
    expect(res.problems).toEqual([]);
    const b = CourseBundleSchema.parse(res.bundle);
    expect(b.course).toMatchObject({ slug: 'daya-desa-literasi-digital-bali', visibility: 'private' });
    expect(b.course.targetRoles.sort()).toEqual(['kader', 'kasi', 'kaur', 'kawil', 'perbekel', 'sekdes']);
    expect(b.lessons).toHaveLength(14);
    expect(b.lessons.at(-1)!.lessonKey).toBe('evaluasi-akhir');
  });

  it('13 skenario valid; tiap materi menyisipkan skenarionya; kuis akhir 13 PG + 4 esai', () => {
    const b = CourseBundleSchema.parse(res.bundle);
    const defs = bundleScenarioDefinitions(b);
    expect(defs).toHaveLength(13);
    for (const d of defs) expect(validateScenario(d), d.id).toMatchObject({ ok: true });
    expect(defs.every((d) => d.validFrom === '2026-11-27' && d.status === 'draft' && d.mode === 'formative')).toBe(true);
    expect(b.lessons[0]!.contentSource).toContain('[[skenario:sim-01-ruang-ketiga-banjar]]');
    expect(b.lessons[0]!.contentSource).toContain('**ruang ketiga**');
    const quiz = b.lessons.at(-1)!.quiz!;
    expect(quiz.settings).toMatchObject({ mcqCount: 13, essayCount: 4, passingScorePct: 70, timeLimitSeconds: 3960, reviewPolicy: 'after_done' });
    expect(quiz.questions).toHaveLength(17);
  });

  it('penilaian pilihan dari kata pembuka umpan balik', () => {
    const sim = (res.bundle as any).scenarios.find((s: any) => s.id === 'sim-01-ruang-ketiga-banjar');
    const opts = sim.nodes[0].options;
    expect(opts.map((o: any) => [o.verdict, o.score])).toEqual([
      ['best', 10],
      ['wrong', 0],
    ]);
    expect(sim.nodes[0].prompt).toBe('Apa langkah pertama yang paling tepat?');
  });

  it('catatan pengubahan dilaporkan', () => {
    const all = res.notes.join('\n');
    expect(all).toContain('upsert_by_slug');
    expect(all).toContain('2026-11-27');
    expect(all).toMatch(/drag_and_drop/);
    expect(all).toMatch(/hotspot_checklist/);
  });
});

describe('masalah yang menghalangi (tidak ditebak)', () => {
  it('kunci PG tidak cocok dengan opsi', () => {
    const p = paket();
    p.modules[0].questions[0].correct_answer = 'jawaban yang tidak ada';
    const r = convertCoursePackageV1(p, TODAY);
    expect(r.bundle).toBeNull();
    expect(r.problems.join('\n')).toContain('correct_answer harus sama persis');
  });

  it('penilaian pilihan skenario tidak bisa ditentukan', () => {
    const p = paket();
    p.modules[0].interactive_blocks[0].nodes[0].choices[0].feedback = 'Mari kita lihat bersama.';
    const r = convertCoursePackageV1(p, TODAY);
    expect(r.bundle).toBeNull();
    expect(r.problems.join('\n')).toContain('penilaian tidak bisa ditentukan');
  });

  it('verdict eksplisit dipakai bila ada', () => {
    const p = paket();
    p.modules[0].interactive_blocks[0].nodes[0].choices[0].feedback = 'Mari kita lihat bersama.';
    p.modules[0].interactive_blocks[0].nodes[0].choices[0].verdict = 'acceptable';
    const r = convertCoursePackageV1(p, TODAY);
    expect(r.problems).toEqual([]);
  });
});
