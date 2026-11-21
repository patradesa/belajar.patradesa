import { Suspense, lazy } from 'react';
import { AI_LOCKED_MESSAGE } from '@patradesa/shared';
import { Header } from './components/Header';
import { Loading } from './components/common';
import { Link, match, useLocation } from './lib/router';
import { useSession } from './lib/session';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { CoursePage } from './pages/CoursePage';
import { LessonPage } from './pages/LessonPage';
import { MyCoursesPage } from './pages/MyCoursesPage';
import { ResultPage } from './pages/ResultPage';
import { PrivacyPage } from './pages/PrivacyPage';

// Lazy: ujian, admin — tidak membebani rute awal learner.
const ExamPage = lazy(() => import('./exam/ExamPage'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

function routes(path: string) {
  let m: Record<string, string> | null;
  if (path === '/') return <HomePage />;
  if (path === '/masuk') return <LoginPage />;
  if (path === '/profil') return <ProfilePage />;
  if (path === '/privasi') return <PrivacyPage />;
  if (path === '/kelas-saya') return <MyCoursesPage />;
  if ((m = match('/kelas/:id', path))) return <CoursePage id={m.id!} />;
  if ((m = match('/materi/:id', path))) return <LessonPage id={m.id!} />;
  if ((m = match('/hasil/:id', path))) return <ResultPage id={m.id!} />;
  if (path === '/admin' || path.startsWith('/admin/')) return <AdminApp path={path} />;
  return (
    <>
      <h1>Halaman tidak ditemukan</h1>
      <p>
        <Link href="/">Kembali ke katalog</Link>
      </p>
    </>
  );
}

export function App() {
  const { path } = useLocation();
  const { me } = useSession();
  const exam = match('/kuis/:id', path);

  if (exam) {
    // ExamLayout: tanpa navigasi situs & tanpa komponen AI; kontrol font tetap ada (di dalam ExamPage).
    return (
      <Suspense fallback={<Loading label="Memuat kuis…" />}>
        <ExamPage attemptId={exam.id!} />
      </Suspense>
    );
  }

  return (
    <>
      <a className="skip-link" href="#konten">
        Lewati ke konten utama
      </a>
      <Header />
      <main id="konten">
        {me?.activeAttempt && (
          <div className="alert alert-warning" role="status">
            <p style={{ margin: 0 }}>
              <strong>Anda sedang mengerjakan kuis.</strong> {AI_LOCKED_MESSAGE}{' '}
              <Link href={`/kuis/${me.activeAttempt.id}`}>Lanjutkan kuis</Link>
            </p>
          </div>
        )}
        <Suspense fallback={<Loading />}>{routes(path)}</Suspense>
      </main>
      <footer className="muted" style={{ maxWidth: '72rem', margin: '0 auto', padding: '1rem' }}>
        <p>
          PatraDesa Belajar — data latihan bersifat fiktif. <Link href="/privasi">Privasi</Link>
        </p>
      </footer>
    </>
  );
}
