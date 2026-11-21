/** Reader: panel AI disembunyikan bila ada ujian aktif (server tetap menolak 423 secara independen). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LessonPage } from './LessonPage';
import { SessionProvider } from '../lib/session';

function stub(activeAttempt: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/me'))
        return new Response(JSON.stringify({ user: { id: 'u', email: 'x@contoh.test', displayName: 'X' }, roles: ['learner'], profile: {}, csrfToken: 't', activeAttempt }));
      if (url.endsWith('/content'))
        return new Response(
          JSON.stringify({ id: 'l1', title: 'Materi Uji', contentType: 'html', blocks: [{ type: 'p', inlines: [{ t: 'text', v: 'Isi materi' }] }], youtubeId: null, fileUrl: null, courseId: 'c1', requiredActiveSeconds: 60, activeSeconds: 0, completed: false }),
        );
      if (url.endsWith('/session')) return new Response(JSON.stringify({ sessionId: 's1', expiresAt: Date.now() + 1e6, activeSeconds: 0, requiredActiveSeconds: 60, completed: false }), { status: 201 });
      return new Response('{}');
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('LessonPage', () => {
  it('menampilkan tombol Pendamping AI saat tidak ada ujian', async () => {
    stub(null);
    render(
      <SessionProvider>
        <LessonPage id="l1" />
      </SessionProvider>,
    );
    await screen.findByText('Isi materi');
    expect(await screen.findByTestId('ai-open')).toBeTruthy();
  });

  it('menyembunyikan AI dan menampilkan pesan saat ada ujian aktif', async () => {
    stub({ id: 'att1', assessmentId: 'a1', deadlineAt: Date.now() + 1e5 });
    render(
      <SessionProvider>
        <LessonPage id="l1" />
      </SessionProvider>,
    );
    await screen.findByText('Isi materi');
    await screen.findByText('Pendamping AI tidak tersedia selama kuis.');
    expect(screen.queryByTestId('ai-open')).toBeNull();
  });

  it('konten dirender tanpa innerHTML (teks HTML ditampilkan sebagai teks)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/content'))
          return new Response(JSON.stringify({ id: 'l1', title: 'X', contentType: 'html', blocks: [{ type: 'p', inlines: [{ t: 'text', v: '<img src=x onerror=alert(1)>' }] }], youtubeId: null, fileUrl: null, courseId: 'c1', requiredActiveSeconds: 0, activeSeconds: 0, completed: true }));
        if (url.endsWith('/session')) return new Response(JSON.stringify({ sessionId: 's1', expiresAt: 0, activeSeconds: 0, requiredActiveSeconds: 0, completed: true }));
        return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'x' } }), { status: 401 });
      }),
    );
    render(
      <SessionProvider>
        <LessonPage id="l1" />
      </SessionProvider>,
    );
    await screen.findByText('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});
