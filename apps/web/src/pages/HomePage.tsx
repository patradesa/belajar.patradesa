import type { CatalogCourse } from '@patradesa/shared';
import { api } from '../lib/api';
import { Link } from '../lib/router';
import { useSession } from '../lib/session';
import { ErrorAlert, Loading, PageTitle, useAsync } from '../components/common';
import { HeroWaves, Icon } from '../components/Icon';
import { CourseCard } from '../components/CourseCard';

export function HomePage() {
  const { me } = useSession();
  const { data, error, loading, reload } = useAsync(() => api<{ courses: CatalogCourse[] }>('/catalog'), [me?.user.id, me?.profile.villageRole]);
  return (
    <div>
      <section className="hero" aria-labelledby="hero-judul">
        <HeroWaves />
        <p className="eyebrow">
          <Icon name="leaf" /> Daya bersama, sama berdaya
        </p>
        <div id="hero-judul">
          <PageTitle>Belajar untuk perangkat desa</PageTitle>
        </div>
        <p>Materi singkat, kuis, dan umpan balik untuk mendukung tugas perangkat desa. Dapat dibuka di ponsel dengan koneksi terbatas.</p>
        <div className="btn-row">
          <a className="btn btn-accent" href="#katalog-judul">
            Lihat katalog <Icon name="arrow" />
          </a>
          {me ? (
            <Link className="btn btn-light" href="/kelas-saya">
              Kelas Saya
            </Link>
          ) : (
            <Link className="btn btn-light" href="/masuk">
              Masuk untuk mulai belajar
            </Link>
          )}
        </div>
      </section>

      {me && !me.profile.villageRole && (
        <div className="alert alert-warning">
          <Link href="/profil">Lengkapi profil jabatan</Link> agar kami dapat menyarankan materi yang relevan.
        </div>
      )}

      <section aria-labelledby="katalog-judul" className="stack">
        <div>
          <p className="eyebrow">Kelas tersedia</p>
          <h2 id="katalog-judul">Katalog kelas</h2>
        </div>
        {loading && <Loading />}
        {Boolean(error) && <ErrorAlert error={error} onRetry={reload} />}
        {data && data.courses.length === 0 && (
          <div className="card card-soft">
            <p style={{ margin: 0 }}>Belum ada kelas yang terbit.</p>
          </div>
        )}
        {data && data.courses.length > 0 && (
          <ul className="grid grid-3 lesson-list course-grid">
            {data.courses.map((c) => (
              <li key={c.id}>
                <CourseCard course={c} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
