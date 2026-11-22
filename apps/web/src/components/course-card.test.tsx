/** Kartu katalog: fakta kelas, jabatan sasaran, rating, dan tombol Ambil/Lanjutkan sesuai status. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CatalogCourse } from '@patradesa/shared';
import { CourseCard, formatStudyTime } from './CourseCard';
import { SessionProvider } from '../lib/session';

const base: CatalogCourse = {
  id: 'c1',
  slug: 'penyelenggaraan-pemerintahan-desa',
  title: 'Penyelenggaraan Pemerintahan Desa',
  summary: 'Dasar penyelenggaraan pemerintahan desa.',
  lessonCount: 3,
  studyMinutes: 75,
  quizQuestionCount: 25,
  recommendedRoles: ['perbekel', 'sekdes', 'bpd'],
  rating: { average: 4.5, count: 12 },
  coverUrl: null,
  enrolled: false,
  recommended: true,
};

function stubFetch(loggedIn: boolean) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/me')) {
        return loggedIn
          ? new Response(JSON.stringify({ user: { id: 'u', email: 'x@contoh.test', displayName: 'X' }, roles: ['learner'], profile: {}, csrfToken: 't', activeAttempt: null }))
          : new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'x' } }), { status: 401 });
      }
      if (url.endsWith('/enroll')) return new Response(JSON.stringify({ enrollmentId: 'e1', created: true }), { status: 201 });
      if (url.endsWith('/courses/penyelenggaraan-pemerintahan-desa')) {
        return new Response(JSON.stringify({ description: '## Tujuan kelas\n\nPeserta memahami tugas pokok pemerintah desa secara utuh.' }));
      }
      return new Response('{}');
    }),
  );
  return calls;
}

function renderCard(course: CatalogCourse, loggedIn = false) {
  const calls = stubFetch(loggedIn);
  render(
    <SessionProvider>
      <CourseCard course={course} />
    </SessionProvider>,
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('CourseCard', () => {
  it('menampilkan judul, ringkasan, jumlah materi, waktu, soal kuis, jabatan, dan rating', () => {
    renderCard(base);
    expect(screen.getByRole('heading', { name: base.title })).toBeTruthy();
    expect(screen.getByText(base.summary)).toBeTruthy();
    expect(screen.getByText('3 materi')).toBeTruthy();
    expect(screen.getByText('± 1 jam 15 menit belajar')).toBeTruthy();
    expect(screen.getByText('25 soal kuis')).toBeTruthy();
    expect(screen.getByText('Disarankan untuk: Perbekel/Kades, Sekdes, BPD')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Rating 4,5 dari 5, 12 penilaian' })).toBeTruthy();
    expect(screen.getByText('Disarankan untuk jabatan Anda')).toBeTruthy();
  });

  it('tanpa rating & tanpa jabatan: teks pengganti yang jelas', () => {
    renderCard({ ...base, rating: { average: null, count: 0 }, recommendedRoles: [], recommended: false });
    expect(screen.getByText('Belum ada rating')).toBeTruthy();
    expect(screen.getByText('Disarankan untuk: semua perangkat desa')).toBeTruthy();
  });

  it('tamu: "Ambil Kelas" menuju halaman masuk; nama tautan memuat judul kelas', () => {
    renderCard(base, false);
    const link = screen.getByRole('link', { name: /Ambil Kelas: Penyelenggaraan Pemerintahan Desa/ });
    expect(link.getAttribute('href')).toBe('/masuk');
  });

  it('peserta login belum terdaftar: "Ambil Kelas" mendaftarkan lalu membuka kelas', async () => {
    const calls = renderCard(base, true);
    const btn = await screen.findByRole('button', { name: /Ambil Kelas/ });
    await userEvent.click(btn);
    await waitFor(() => expect(calls).toContain('POST /api/v1/courses/c1/enroll'));
    await waitFor(() => expect(window.location.pathname).toBe('/kelas/penyelenggaraan-pemerintahan-desa'));
  });

  it('sudah terdaftar: "Lanjutkan Belajar" ke halaman kelas', () => {
    renderCard({ ...base, enrolled: true }, true);
    const link = screen.getByRole('link', { name: /Lanjutkan Belajar/ });
    expect(link.getAttribute('href')).toBe('/kelas/penyelenggaraan-pemerintahan-desa');
  });

  it('"Selengkapnya" membuka dialog Tentang kelas berisi deskripsi lengkap; Tutup menutupnya', async () => {
    const calls = renderCard(base);
    expect(screen.queryByRole('heading', { name: 'Tujuan kelas' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Selengkapnya tentang kelas Penyelenggaraan Pemerintahan Desa' }));
    expect(await screen.findByRole('heading', { name: 'Tujuan kelas' })).toBeTruthy();
    expect(screen.getByText('Peserta memahami tugas pokok pemerintah desa secara utuh.')).toBeTruthy();
    expect(calls).toContain('GET /api/v1/courses/penyelenggaraan-pemerintahan-desa');
    const dialog = document.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe('kelas-c1-tentang');
    await userEvent.click(screen.getAllByRole('button', { name: 'Tutup' })[1]!);
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Tujuan kelas' })).toBeNull();
  });

  it('format waktu belajar', () => {
    expect(formatStudyTime(0)).toBe('Tanpa batas waktu minimum');
    expect(formatStudyTime(45)).toBe('± 45 menit belajar');
    expect(formatStudyTime(120)).toBe('± 2 jam belajar');
  });
});
