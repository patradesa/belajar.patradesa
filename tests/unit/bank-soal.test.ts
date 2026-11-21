/**
 * Validasi kualitas berkas bank soal privat (content-private/bank-soal/*.json, tidak di-commit).
 * Di CI berkas tidak ada → tes dilewati.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { questionBankFileSchema } from '@patradesa/shared';

const DIR = join(__dirname, '..', '..', 'content-private', 'bank-soal');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];

describe.skipIf(files.length === 0)('bank soal privat', () => {
  it.each(files)('%s valid, tanpa duplikat, opsi unik, tersebar per topik', (f) => {
    const raw = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    const parsed = questionBankFileSchema.safeParse(raw);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 5))).toBe(true);
    const qs = parsed.data!.questions;
    const stems = qs.map((q) => q.stem.trim().toLowerCase());
    expect(new Set(stems).size).toBe(stems.length);
    for (const q of qs) {
      if (q.type === 'mcq') {
        const bodies = q.options.map((o) => o.body.trim().toLowerCase());
        expect(new Set(bodies).size, q.stem).toBe(bodies.length);
        expect(q.options.length).toBe(4);
      } else {
        expect(q.rubric.reduce((s, r) => s + r.maxScore, 0), q.stem).toBe(100);
        expect(q.modelAnswer.length, q.stem).toBeGreaterThan(100);
      }
    }
    // Setiap topik PG cukup banyak agar acak 20 soal tetap seimbang.
    const byTopic = new Map<string, number>();
    for (const q of qs.filter((x) => x.type === 'mcq')) byTopic.set(q.topic, (byTopic.get(q.topic) ?? 0) + 1);
    for (const [topic, n] of byTopic) expect(n, topic).toBeGreaterThanOrEqual(3);
    const cfg = raw.pengaturanKuisDisarankan as { mcqCount: number; essayCount: number } | undefined;
    if (cfg) {
      expect(qs.filter((q) => q.type === 'mcq').length).toBeGreaterThanOrEqual(cfg.mcqCount * 2);
      expect(qs.filter((q) => q.type === 'essay').length).toBeGreaterThanOrEqual(cfg.essayCount * 2);
    }
  });

  it('bank Penyelenggaraan Pemerintahan Desa: tepat 50 PG + 15 esai', () => {
    const f = join(DIR, 'penyelenggaraan-pemerintahan-desa.json');
    if (!existsSync(f)) return;
    const qs = questionBankFileSchema.parse(JSON.parse(readFileSync(f, 'utf8'))).questions;
    expect(qs.filter((q) => q.type === 'mcq')).toHaveLength(50);
    expect(qs.filter((q) => q.type === 'essay')).toHaveLength(15);
  });
});
