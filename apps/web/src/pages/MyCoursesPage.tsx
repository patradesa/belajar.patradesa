import { api } from '../lib/api';
import { Link } from '../lib/router';
import { useSession } from '../lib/session';
import { ErrorAlert, Loading, PageTitle, useAsync } from '../components/common';

interface MyCourse {
  id: string;
  slug: string;
  title: string;
  status: string;
  expiresAt: number | null;
  requiredLessons: number;
  completedLessons: number;
}

export function MyCoursesPage() {
  const { me, loading: sLoading } = useSession();
  const { data, error, loading, reload } = useAsync(() => (me ? api<{ courses: MyCourse[] }>('/me/courses') : Promise.resolve({ courses: [] })), [me?.user.id]);
  if (sLoading) return <Loading />;
  if (!me)
    return (
      <p>
        <Link href="/masuk">Masuk</Link> untuk melihat kelas Anda.
      </p>
    );
  return (
    <div className="stack">
      <PageTitle>Kelas Saya</PageTitle>
      {loading && <Loading />}
      {Boolean(error) && <ErrorAlert error={error} onRetry={reload} />}
      {data && data.courses.length === 0 && (
        <p>
          Anda belum mendaftar kelas. <Link href="/">Lihat katalog</Link>.
        </p>
      )}
      <ul className="lesson-list">
        {data?.courses.map((c) => {
          const pct = c.requiredLessons ? Math.round((c.completedLessons / c.requiredLessons) * 100) : 0;
          return (
            <li key={c.id} className="card">
              <h2>
                <Link href={`/kelas/${c.slug}`}>{c.title}</Link>
              </h2>
              <p>
                {c.completedLessons} dari {c.requiredLessons} materi wajib selesai ({pct}%)
              </p>
              <div className="progress" role="img" aria-label={`Progres ${pct} persen`}>
                <span style={{ width: `${pct}%` }} />
              </div>
              {c.expiresAt && <p className="muted">Akses berakhir {new Date(c.expiresAt).toLocaleDateString('id-ID')}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
