import { describe, expect, it } from 'vitest';
import { extractYoutubeId, parseContent, splitSlides, questionCreateSchema, profilePatchSchema, heartbeatSchema } from '@patradesa/shared';
import { pickBalanced } from '../../apps/api/src/services/attempts';
import { secureRandomInt, secureShuffle, timingSafeEqual } from '../../apps/api/src/lib/crypto';
import { isLearnerAiPath } from '../../apps/api/src/services/examLock';

describe('parser konten', () => {
  it('menghasilkan blok terstruktur', () => {
    const b = parseContent('## Judul\n\nParagraf **tebal**.\n\n- a\n- b\n\n1. satu\n\n> catatan\n\n---\n\n### Sub');
    expect(b.map((x) => x.type)).toEqual(['h2', 'p', 'ul', 'ol', 'callout', 'slide', 'h3']);
    expect(splitSlides(b)).toHaveLength(2);
  });
  it('tidak pernah menghasilkan HTML; tautan non-https dibuang', () => {
    const b = parseContent('<script>alert(1)</script> [x](javascript:alert(1)) [y](http://a.b) [z](https://a.b/c)');
    const s = JSON.stringify(b);
    expect(s).not.toContain('"href":"javascript');
    expect(s).not.toContain('"href":"http://');
    expect(s).toContain('"href":"https://a.b/c"');
  });
  it('YouTube ID divalidasi', () => {
    expect(extractYoutubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeId('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(extractYoutubeId('javascript:alert(1)')).toBeNull();
  });
});

describe('skema validasi', () => {
  it('MCQ wajib tepat satu jawaban benar', () => {
    const base = { type: 'mcq', stem: 'Pertanyaan uji?', options: [{ body: 'a', isCorrect: true }, { body: 'b', isCorrect: true }] };
    expect(questionCreateSchema.safeParse(base).success).toBe(false);
    expect(questionCreateSchema.safeParse({ ...base, options: [{ body: 'a', isCorrect: true }, { body: 'b', isCorrect: false }] }).success).toBe(true);
  });
  it('profil menolak field role sistem & data sensitif yang tidak dikenal', () => {
    expect(profilePatchSchema.safeParse({ roles: ['admin'] }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ nik: '123' }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ villageRole: 'super_admin' }).success).toBe(false);
  });
  it('heartbeat tidak menerima klaim durasi dari klien', () => {
    expect(heartbeatSchema.safeParse({ sessionId: 'abcdefgh12', visible: true, interacted: true, seconds: 600 }).success).toBe(false);
  });
});

describe('acak & kripto', () => {
  it('secureRandomInt dalam rentang dan tersebar', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = secureRandomInt(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });
  it('secureShuffle mempertahankan elemen', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(secureShuffle(a).sort()).toEqual(a);
  });
  it('pickBalanced menyeimbangkan topik & tidak menduplikasi', () => {
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, topic: 'a', difficulty: 1 })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, topic: 'b', difficulty: 1 })),
    ];
    const pick = pickBalanced(pool, 6);
    expect(new Set(pick.map((p) => p.id)).size).toBe(6);
    expect(pick.filter((p) => p.topic === 'a')).toHaveLength(3);
    expect(pickBalanced(pool.slice(0, 2), 5)).toHaveLength(2);
  });
  it('timingSafeEqual', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('pola path AI learner (guard exam lock)', () => {
  it.each([
    ['/api/v1/lessons/x/ai/chat', true],
    ['/api/v1/lessons/x/ai/summary', true],
    ['/api/v1/ai/recommendations', true],
    ['/api/v2/ai/anything', true],
    ['/api/v1/lessons/x/ai', true],
    ['/api/v1/admin/ai/grading', false],
    ['/api/internal/ai/grade', false],
    ['/api/v1/lessons/x/content', false],
    ['/api/v1/aids', false],
    ['/materi/ai/chat', false],
  ])('%s → %s', (p, expected) => {
    expect(isLearnerAiPath(p)).toBe(expected);
  });
});
