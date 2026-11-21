/**
 * Uji komponen (jsdom): ExamLayout tanpa AI, kontrol font di kuis, anti-copy hanya pada soal,
 * input esai tetap bisa dipilih/disalin/ditempel/diedit, pengecualian aksesibilitas.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AttemptView } from '@patradesa/shared';
import ExamPage from './ExamPage';
import { QuizQuestionRegion } from './QuizQuestionRegion';
import { FontScaleControl } from '../components/FontScaleControl';
import { SessionProvider } from '../lib/session';

function attempt(copyDeterrence = true): AttemptView {
  const now = Date.now();
  return {
    id: 'att1234567890',
    assessmentId: 'as1',
    assessmentTitle: 'Kuis Uji',
    courseId: 'c1',
    status: 'in_progress',
    startedAt: now,
    deadlineAt: now + 600_000,
    serverNow: now,
    copyDeterrence,
    hideLessonLinks: true,
    questions: [
      { id: 'q1aaaaaaaaaaaaaa', sequence: 1, type: 'mcq', stem: 'Soal pilihan ganda rahasia?', points: 1, options: [{ key: 'k1', body: 'Opsi A' }, { key: 'k2', body: 'Opsi B' }], answer: null },
      { id: 'q2bbbbbbbbbbbbbb', sequence: 2, type: 'essay', stem: 'Soal esai rahasia?', points: 10, options: [], answer: null },
    ],
  };
}

function mockFetch(a: AttemptView) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith('/me')) {
      return new Response(JSON.stringify({ user: { id: 'u', email: 'x@contoh.test', displayName: 'X' }, roles: ['learner'], profile: {}, csrfToken: 'csrf', activeAttempt: { id: a.id, assessmentId: a.assessmentId, deadlineAt: a.deadlineAt } }));
    }
    if (url.includes('/answers')) return new Response(JSON.stringify({ savedAt: Date.now() }));
    if (url.includes('/attempts/')) return new Response(JSON.stringify(a));
    return new Response('{}');
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

async function renderExam(a = attempt()) {
  const calls = mockFetch(a);
  render(
    <SessionProvider>
      <ExamPage attemptId={a.id} />
    </SessionProvider>,
  );
  await screen.findByText('Soal pilihan ganda rahasia?', { exact: false });
  return calls;
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExamLayout', () => {
  it('tidak menampilkan komponen AI apa pun dan menampilkan pemberitahuan AI tidak tersedia', async () => {
    await renderExam();
    expect(screen.getByTestId('ai-locked-notice').textContent).toContain('Pendamping AI tidak tersedia selama kuis.');
    expect(screen.queryByTestId('ai-open')).toBeNull();
    expect(screen.queryByTestId('ai-panel')).toBeNull();
    expect(screen.queryByRole('button', { name: /pendamping ai|tanya/i })).toBeNull();
    // Navigasi situs disembunyikan (meminimalkan navigasi selama ujian).
    expect(screen.queryByRole('navigation', { name: 'Navigasi utama' })).toBeNull();
  });

  it('kontrol font A−/A+/Reset tersedia di layar kuis dan mengubah --font-scale', async () => {
    await renderExam();
    const plus = screen.getByRole('button', { name: /perbesar teks/i });
    await userEvent.click(plus);
    await userEvent.click(plus);
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.25');
    expect(window.localStorage.getItem('pd-font-scale')).toBe('1.25');
    for (let i = 0; i < 6; i++) await userEvent.click(plus).catch(() => {});
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('2');
    await userEvent.click(screen.getByRole('button', { name: /Reset\s+ukuran teks/ }));
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1');
  });

  it('anti-copy: soal & opsi tidak dapat dipilih/klik kanan; esai TIDAK diblokir', async () => {
    await renderExam();
    const stem = screen.getByText('Soal pilihan ganda rahasia?', { exact: false });
    const region = stem.closest('[data-copy-deterrence]')!;
    expect(region.getAttribute('data-copy-deterrence')).toBe('on');
    expect(region.classList.contains('exam-question-content')).toBe(true);

    const ctxQuestion = fireEvent.contextMenu(stem);
    expect(ctxQuestion).toBe(false); // defaultPrevented

    const essay = screen.getByLabelText('Jawaban Anda') as HTMLTextAreaElement;
    expect(essay.closest('.exam-question-content')).toBeNull();
    expect(fireEvent.contextMenu(essay)).toBe(true); // tidak dicegah

    // copy dari area soal dicegah
    const sel = document.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(stem);
    sel.removeAllRanges();
    sel.addRange(range);
    expect(fireEvent.copy(stem)).toBe(false);

    // esai: ketik, pilih semua (Ctrl+A di dalam textarea), salin, tempel — semuanya berfungsi
    sel.removeAllRanges();
    const user = userEvent.setup();
    await user.click(essay);
    await user.type(essay, 'Jawaban pertama');
    expect(essay.value).toBe('Jawaban pertama');
    await user.keyboard('{Control>}a{/Control}');
    expect(essay.selectionStart).toBe(0);
    expect(essay.selectionEnd).toBe('Jawaban pertama'.length);
    expect(fireEvent.copy(essay)).toBe(true);
    expect(fireEvent.cut(essay)).toBe(true);
    expect(fireEvent.paste(essay)).toBe(true);
    await user.keyboard('Diganti'); // mengetik menggantikan seleksi
    expect(essay.value).toBe('Diganti');
  });

  it('autosave esai dikirim ke server (debounce) tanpa skor/durasi dari klien', async () => {
    const calls = await renderExam();
    const essay = screen.getByLabelText('Jawaban Anda');
    await userEvent.type(essay, 'Teks esai');
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true), { timeout: 4000 });
    const patch = calls.filter((c) => c.method === 'PATCH').at(-1)!;
    expect(patch.body).toEqual({ answers: [{ questionId: 'q2bbbbbbbbbbbbbb', essayText: 'Teks esai' }] });
    await screen.findByText('✓ Tersimpan');
  });

  it('pengecualian aksesibilitas: copyDeterrence=false → soal dapat dipilih & klik kanan', async () => {
    await renderExam(attempt(false));
    const stem = screen.getByText('Soal pilihan ganda rahasia?', { exact: false });
    expect(stem.closest('.exam-question-content')).toBeNull();
    expect(fireEvent.contextMenu(stem)).toBe(true);
    expect(fireEvent.copy(stem)).toBe(true);
  });

  it('pilihan ganda dapat dioperasikan dengan keyboard (radio group berlabel)', async () => {
    await renderExam();
    const group = screen.getByRole('radiogroup', { name: /Soal pilihan ganda rahasia/ });
    expect(group).toBeTruthy();
    const optA = screen.getByRole('radio', { name: 'Opsi A' });
    optA.focus();
    await userEvent.keyboard(' ');
    expect((optA as HTMLInputElement).checked).toBe(true);
  });
});

describe('FontScaleControl', () => {
  it('tetap berfungsi bila localStorage diblokir', async () => {
    const orig = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      render(<FontScaleControl />);
      await userEvent.click(screen.getByRole('button', { name: /perbesar teks/i }));
      expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.125');
    } finally {
      if (orig) Object.defineProperty(window, 'localStorage', orig);
    }
  });
});

describe('QuizQuestionRegion', () => {
  it('copy yang dipicu dari textarea di DALAM region tetap diizinkan', () => {
    render(
      <QuizQuestionRegion enabled>
        <p>soal</p>
        <textarea aria-label="catatan" defaultValue="abc" />
      </QuizQuestionRegion>,
    );
    const ta = screen.getByLabelText('catatan');
    expect(fireEvent.contextMenu(ta)).toBe(true);
    expect(fireEvent.copy(ta)).toBe(true);
    act(() => {});
  });
});
