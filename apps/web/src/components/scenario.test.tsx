/** ScenarioBlock: alur peserta, umpan balik aria-live, kirim ulang saat sinyal putus, teks tanpa HTML. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { LessonScenarioSummary, ScenarioDelivery } from '@patradesa/shared';
import ScenarioBlock from './ScenarioBlock';
import { LessonPage } from '../pages/LessonPage';
import { SessionProvider } from '../lib/session';

const summary: LessonScenarioSummary = {
  blockId: 'b1',
  key: 'adm01-uji',
  title: 'Nama Anak Beda di KK',
  summary: 'Latihan verifikasi data warga.',
  mode: 'graded',
  estimatedMinutes: 8,
  maxAttempts: 3,
  validFrom: '2026-11-01',
  needsLocalValidation: true,
  attemptsUsed: 0,
  activeAttemptId: null,
  bestPercent: null,
  passed: false,
};

const block: ScenarioDelivery['block'] = {
  key: 'adm01-uji',
  version: 1,
  title: 'Nama Anak Beda di KK',
  mode: 'graded',
  validFrom: '2026-11-01',
  needsLocalValidation: true,
  regulations: [],
  estimatedMinutes: 8,
  decisionCount: { done: 0, maxOnPath: 1 },
};

const atDecision: ScenarioDelivery = {
  attempt: { id: 'sa1', status: 'in_progress', attemptNo: 1, maxAttempts: 3 },
  block,
  node: {
    id: 'd1',
    type: 'decision',
    title: 'Nama yang tidak sama',
    body: 'Di KK tertulis **I Putu Agus**. <img src=x onerror=alert(1)>',
    prompt: 'Apa langkah pertama Anda?',
    options: [
      { key: 'p1', text: 'Langsung cetak surat' },
      { key: 'p2', text: 'Periksa dokumen asli dan catat' },
    ],
  },
  history: [],
  final: null,
};

const finished: ScenarioDelivery = {
  ...atDecision,
  attempt: { ...atDecision.attempt, status: 'completed' },
  node: { id: 'selesai', type: 'end', title: 'Layanan selesai', body: 'Ibu Kadek berhasil mendaftar.', prompt: null, options: [] },
  history: [{ nodeId: 'd1', optionText: 'Periksa dokumen asli dan catat', label: 'Tepat', verdict: 'best', feedback: 'Verifikasi adalah dasar.' }],
  final: {
    score: 10,
    maxScore: 10,
    percent: 100,
    passed: true,
    band: { label: 'Sangat baik', message: 'Anda melayani dengan tepat.' },
    takeaways: ['Periksa dokumen asli sebelum menerbitkan surat.'],
    remedial: null,
    attemptsLeft: 2,
  },
};

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('ScenarioBlock', () => {
  it('kartu awal → node keputusan tanpa kunci → umpan balik → hasil akhir', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        if (url.endsWith('/scenarios/b1/attempts')) return ok(atDecision, 201);
        if (url.endsWith('/scenario-attempts/sa1/choices')) return ok({ result: { label: 'Tepat', verdict: 'best', feedback: 'Verifikasi adalah dasar.' }, delivery: finished });
        return ok({});
      }),
    );
    render(<ScenarioBlock summary={summary} lessonId="l1" />);
    expect(screen.getByText(/Cek SOP desa\/Disdukcapil setempat/)).toBeTruthy();
    expect(screen.getByText(/Berlaku per 2026-11-01/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mulai skenario' }));

    await screen.findByRole('heading', { name: 'Nama yang tidak sama' });
    expect(calls[0]!.body).toEqual({ lessonId: 'l1' });
    expect(screen.getByText('Keputusan 1 dari 1')).toBeTruthy();
    // Markdown terbatas: tebal jadi <strong>, HTML tampil sebagai teks.
    expect(screen.getByText('I Putu Agus').tagName).toBe('STRONG');
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
    expect(screen.queryByText('Tepat')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Periksa dokumen asli dan catat' }));
    await screen.findByText('Verifikasi adalah dasar.');
    expect(calls[1]!.body).toEqual({ nodeId: 'd1', optionKey: 'p2' });
    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toContain('Tepat');
    expect(document.activeElement?.textContent).toBe('Umpan balik');

    fireEvent.click(screen.getByRole('button', { name: 'Lihat hasil' }));
    await screen.findByRole('heading', { name: 'Hasil skenario' });
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('Sangat baik')).toBeTruthy();
    expect(screen.getByText('Periksa dokumen asli sebelum menerbitkan surat.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coba lagi (2 kesempatan)' })).toBeTruthy();
  });

  it('sinyal putus saat memilih → pesan + "Kirim ulang" mengirim pilihan yang sama', async () => {
    let fail = true;
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/scenario-attempts/sa9')) return ok(atDecision);
        if (url.endsWith('/choices')) {
          bodies.push(JSON.parse(String(init!.body)));
          if (fail) {
            fail = false;
            throw new TypeError('Failed to fetch');
          }
          return ok({ result: { label: 'Berisiko', verdict: 'risky', feedback: 'Masih berisiko.' }, delivery: finished });
        }
        return ok({});
      }),
    );
    render(<ScenarioBlock summary={{ ...summary, activeAttemptId: 'sa9', attemptsUsed: 1 }} lessonId="l1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan skenario' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Langsung cetak surat' }));
    await screen.findByText(/Koneksi terputus/);
    fireEvent.click(screen.getByRole('button', { name: 'Kirim ulang' }));
    await screen.findByText('Masih berisiko.');
    expect(bodies).toEqual([
      { nodeId: 'd1', optionKey: 'p1' },
      { nodeId: 'd1', optionKey: 'p1' },
    ]);
  });

  it('kesempatan habis → tidak ada tombol mulai', () => {
    render(<ScenarioBlock summary={{ ...summary, attemptsUsed: 3, bestPercent: 40 }} lessonId="l1" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Kesempatan mencoba sudah habis/)).toBeTruthy();
  });
});

describe('LessonPage + skenario', () => {
  it('blok [[skenario]] dirender di posisinya (chunk lazy) bila dipin ke materi', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/me')) return ok({ user: { id: 'u', email: 'x@contoh.test', displayName: 'X' }, roles: ['learner'], profile: {}, csrfToken: 't', activeAttempt: null });
        if (url.endsWith('/content'))
          return ok({
            id: 'l1',
            title: 'Materi Uji',
            contentType: 'html',
            blocks: [
              { type: 'p', inlines: [{ t: 'text', v: 'Isi materi' }] },
              { type: 'scenario', key: 'adm01-uji' },
              { type: 'scenario', key: 'tidak-dipin' },
            ],
            youtubeId: null,
            fileUrl: null,
            courseId: 'c1',
            requiredActiveSeconds: 0,
            activeSeconds: 0,
            completed: true,
            scenarios: [summary],
          });
        if (url.endsWith('/session')) return ok({ sessionId: 's1', expiresAt: Date.now() + 1e6, activeSeconds: 0, requiredActiveSeconds: 0, completed: true }, 201);
        return ok({});
      }),
    );
    render(
      <SessionProvider>
        <LessonPage id="l1" />
      </SessionProvider>,
    );
    await screen.findByText('Isi materi');
    expect(await screen.findByRole('heading', { name: 'Nama Anak Beda di KK' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Mulai skenario' })).toHaveLength(1);
  });
});
