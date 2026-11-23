/** Validator Blok Skenario: harus memberi hasil yang sama dengan docs/scenario-block/validate_scenario.py. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeMaxScore, maxDecisionsOnPath, parseContent, scenarioKeys, scoreResult, validateScenario, type ScenarioDefinition } from '@patradesa/shared';

const ROOT = join(import.meta.dirname, '..', '..');
const base = (): ScenarioDefinition => JSON.parse(readFileSync(join(ROOT, 'docs', 'scenario-block', 'contoh-adm01-beda-nama-bali.json'), 'utf8'));
const node = (d: ScenarioDefinition, id: string) => d.nodes.find((n) => n.id === id)! as any;
const errorsOf = (d: unknown): string[] => {
  const r = validateScenario(d);
  return r.ok ? [] : r.errors;
};

describe('validator skenario', () => {
  it('menerima berkas contoh; maxScore = 30; jalur keputusan terpanjang = 3', () => {
    const r = validateScenario(base());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.maxScore).toBe(30);
    expect(computeMaxScore(r.definition)).toBe(30);
    expect(maxDecisionsOnPath(r.definition)).toBe(3);
  });

  it('menolak siklus', () => {
    const d = base();
    node(d, 'd3').options[0].nextNodeId = 'd1';
    expect(errorsOf(d)).toEqual([expect.stringContaining('siklus terdeteksi')]);
  });

  it('menolak rujukan node yang tidak ada (dengan lokasi)', () => {
    const d = base();
    node(d, 'd2').options[1].nextNodeId = 'hilang';
    expect(errorsOf(d)).toEqual(["/nodes/3/options/1/nextNodeId: node 'hilang' tidak ada"]);
  });

  it("menolak node keputusan tanpa opsi 'best'", () => {
    const d = base();
    for (const o of node(d, 'd2').options) if (o.verdict === 'best') o.verdict = 'acceptable';
    expect(errorsOf(d)).toContain("/nodes/3/options: node 'd2' tidak punya opsi 'best'");
  });

  it('menolak node info yang punya opsi', () => {
    const d = base();
    node(d, 'intro').options = [];
    expect(errorsOf(d).join('\n')).toMatch(/^\/nodes\/0/);
  });

  it("menolak status 'published' tanpa data penelaah; menerima bila lengkap", () => {
    const d = base();
    d.status = 'published';
    expect(errorsOf(d)).toEqual([
      "/review/reviewedBy: wajib diisi untuk status 'published'",
      "/review/reviewedAt: wajib diisi untuk status 'published'",
      "/review/nextReviewDue: wajib diisi untuk status 'published'",
    ]);
    d.review = { reviewedBy: 'Penelaah A', reviewedAt: '2026-11-20', nextReviewDue: '2027-11-20' };
    expect(validateScenario(d).ok).toBe(true);
    d.review.nextReviewDue = '2026-11-01';
    expect(errorsOf(d)).toEqual(['/review/nextReviewDue: harus setelah reviewedAt']);
  });

  it('menolak node yatim', () => {
    const d = base();
    d.nodes.push({ id: 'yatim', type: 'info', body: 'tidak dirujuk', nextNodeId: 'selesai' });
    expect(errorsOf(d)).toEqual(["/nodes/6: node 'yatim' yatim (tidak terjangkau dari startNodeId)"]);
  });

  it("menolak opsi non-best yang skornya menyamai 'best' dan band tanpa minPercent 0", () => {
    const d = base();
    node(d, 'd1').options[0].score = 10;
    d.scoring.bands = d.scoring.bands.filter((b) => b.minPercent !== 0);
    const e = errorsOf(d);
    expect(e).toContain("/nodes/1/options/0/score: opsi 'wrong' tidak boleh menyamai/melebihi skor opsi 'best'");
    expect(e).toContain('/scoring/bands: wajib ada band dengan minPercent 0');
  });

  it('menolak field tak dikenal dan tipe salah dengan lokasi', () => {
    const d = base() as any;
    d.extra = 1;
    d.maxAttempts = 'tiga';
    const e = errorsOf(d);
    expect(e.some((x) => x.startsWith('/maxAttempts'))).toBe(true);
    expect(e.some((x) => x.includes('extra'))).toBe(true);
  });
});

describe('skor & band', () => {
  it('jalur terbaik 30/30 → 100% "Sangat baik"; terburuk 0/30 → 0% "Perlu mengulang"', () => {
    const d = base();
    expect(scoreResult(d, 30, 30)).toMatchObject({ percent: 100, passed: true, band: { key: 'baik' } });
    expect(scoreResult(d, 0, 30)).toMatchObject({ percent: 0, passed: false, band: { key: 'ulang' } });
    expect(scoreResult(d, 20, 30)).toMatchObject({ percent: 66, passed: false, band: { key: 'cukup' } });
    expect(scoreResult(d, 26, 30)).toMatchObject({ percent: 86, passed: true, band: { key: 'baik' } });
  });
});

describe('penyisipan di konten', () => {
  it('[[skenario:kunci]] menjadi blok scenario; sintaks lain tetap teks', () => {
    const b = parseContent('Pengantar.\n\n[[skenario:adm01-beda-nama-bali]]\n\nTeks [[skenario:bukan-baris-sendiri]] di paragraf.\n[[skenario:X_Salah]]');
    expect(b.map((x) => x.type)).toEqual(['p', 'scenario', 'p']);
    expect(scenarioKeys(b)).toEqual(['adm01-beda-nama-bali']);
  });
});
