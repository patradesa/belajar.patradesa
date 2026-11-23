/** Accordion sub-materi: pembagian per "##", buka/tutup, centang dibaca (tersimpan) & centang skenario (data server). */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { parseContent, type LessonScenarioSummary } from '@patradesa/shared';
import { LessonSections, splitSections } from './LessonSections';

const src = 'Pengantar unit.\n\n## 1. AMATI\n\nSituasi pembuka.\n\n## 2. AKSI\n\n[[skenario:uji-aksi]]\n\n## 3. ASESMEN\n\n- ☐ Checklist';
const blocks = parseContent(src);
const summary = (bestPercent: number | null): LessonScenarioSummary => ({
  blockId: 'b1', key: 'uji-aksi', title: 'Aksi', summary: 'Latihan.', mode: 'formative', estimatedMinutes: 4, maxAttempts: 3,
  validFrom: '2026-02-12', needsLocalValidation: false, localValidationNote: null, attemptsUsed: 0, activeAttemptId: null, bestPercent, passed: false,
});

afterEach(() => window.localStorage.clear());

describe('LessonSections', () => {
  it('membagi blok per judul ## (pengantar terpisah)', () => {
    const { intro, sections } = splitSections(blocks);
    expect(intro.map((b) => b.type)).toEqual(['p']);
    expect(sections.map((s) => s.title)).toEqual(['1. AMATI', '2. AKSI', '3. ASESMEN']);
  });

  it('bagian pertama terbuka & tercentang dibaca; tombol membuka/menutup dengan aria-expanded; centang tersimpan', () => {
    const { unmount } = render(<LessonSections blocks={blocks} lessonId="l1" userId="u1" scenarios={[summary(null)]} renderScenario={() => <p>SKENARIO</p>} />);
    expect(screen.getByText('Pengantar unit.')).toBeTruthy();
    const amati = screen.getByRole('button', { name: /1\. AMATI/ });
    expect(amati.getAttribute('aria-expanded')).toBe('true');
    // Tanpa IntersectionObserver (jsdom) bagian dianggap terbaca saat dibuka.
    expect(screen.getByText('1 dari 3 bagian selesai')).toBeTruthy();
    expect(amati.textContent).toContain('Sudah dibaca');

    const aksi = screen.getByRole('button', { name: /2\. AKSI/ });
    expect(aksi.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('SKENARIO')).toBeNull();
    fireEvent.click(aksi);
    expect(aksi.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('SKENARIO')).toBeTruthy();
    // Bagian skenario tidak tercentang hanya karena dibuka.
    expect(screen.getByText('1 dari 3 bagian selesai')).toBeTruthy();
    fireEvent.click(amati);
    expect(amati.getAttribute('aria-expanded')).toBe('false');
    unmount();

    render(<LessonSections blocks={blocks} lessonId="l1" userId="u1" scenarios={[summary(null)]} renderScenario={() => null} />);
    expect(screen.getByRole('button', { name: /1\. AMATI/ }).textContent).toContain('Sudah dibaca');
  });

  it('bagian skenario tercentang bila skenario pernah diselesaikan, dan saat onFinish dipanggil', () => {
    let finish: () => void = () => {};
    render(
      <LessonSections
        blocks={blocks}
        lessonId="l2"
        userId="u1"
        scenarios={[summary(null)]}
        renderScenario={(_k, onFinish) => {
          finish = onFinish;
          return <button onClick={onFinish}>selesaikan</button>;
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /2\. AKSI/ }));
    fireEvent.click(screen.getByRole('button', { name: 'selesaikan' }));
    expect(screen.getByRole('button', { name: /2\. AKSI/ }).textContent).toContain('Sudah dikerjakan');
    expect(typeof finish).toBe('function');
  });

  it('dengan skenario yang sudah selesai, bagian pertama yang belum selesai terbuka otomatis', () => {
    window.localStorage.setItem('pd-dibaca:u1:l3', JSON.stringify([0]));
    render(<LessonSections blocks={blocks} lessonId="l3" userId="u1" scenarios={[summary(80)]} renderScenario={() => null} />);
    expect(screen.getByRole('button', { name: /2\. AKSI/ }).textContent).toContain('Sudah dikerjakan');
    expect(screen.getByRole('button', { name: /3\. ASESMEN/ }).getAttribute('aria-expanded')).toBe('true');
  });
});
