import type { CatalogCourse } from '@patradesa/shared';
import { api } from '../lib/api';
import { Link } from '../lib/router';
import { useSession } from '../lib/session';
import { ErrorAlert, Loading, PageTitle, useAsync } from '../components/common';

export function HomePage() {
  const { me } = useSession();
  const { data, error, loading, reload } = useAsync(() => api<{ courses: CatalogCourse[] }>('/catalog'), [me?.user.id, me?.profile.villageRole]);
  return (
    <div className="stack">
      <PageTitle>Belajar untuk perangkat desa</PageTitle>
      <p className="prose">
        Materi singkat, kuis, dan umpan balik untuk mendukung tugas perangkat desa. Dapat dibuka di ponsel dengan koneksi terbatas.
        {!me && (
          <>
            {' '}
            <Link href="/masuk">Masuk</Link> untuk mulai belajar.
          </>
        )}
      </p>
      {me && !me.profile.villageRole && (
        <div className="alert alert-warning">
          <Link href="/profil">Lengkapi profil jabatan</Link> agar kami dapat menyarankan materi yang relevan.
        </div>
      )}
      <section aria-labelledby="katalog-judul" className="stack">
        <h2 id="katalog-judul">Katalog kelas</h2>
        {loading && <Loading />}
        {Boolean(error) && <ErrorAlert error={error} onRetry={reload} />}
        {data && data.courses.length === 0 && <p>Belum ada kelas yang terbit.</p>}
        {data && (
          <ul className="grid lesson-list">
            {data.courses.map((c) => (
              <li key={c.id} className="card">
                <h3>
                  <Link href={`/kelas/${c.slug}`}>{c.title}</Link>
                </h3>
                {c.recommended && <p className="badge badge-success">Disarankan untuk jabatan Anda</p>}
                <p>{c.description}</p>
                <p className="muted">{c.lessonCount} materi</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
