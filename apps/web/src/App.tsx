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
import { AdminLoginPage } from './pages/AdminLoginPage';
import { Icon } from './components/Icon';
import { FontScaleControl } from './components/FontScaleControl';

// Lazy: ujian, admin — tidak membebani rute awal learner.
const ExamPage = lazy(() => import('./exam/ExamPage'));
const AdminApp = lazy(() => import('./admin/AdminApp'));
// Lazy: panduan penggunaan (isi panjang) hanya saat dibuka.
const GuideIndexPage = lazy(() => import('./pages/GuidePage').then((m) => ({ default: m.GuideIndexPage })));
const GuideDetailPage = lazy(() => import('./pages/GuidePage').then((m) => ({ default: m.GuideDetailPage })));
// Lazy: halaman cetak sertifikat (memuat pembuat QR) hanya saat dibuka.
const CertificatePage = lazy(() => import('./pages/CertificatePage').then((m) => ({ default: m.CertificatePage })));

function routes(path: string) {
  let m: Record<string, string> | null;
  if (path === '/') return <HomePage />;
  if (path === '/masuk') return <LoginPage />;
  if (path === '/profil') return <ProfilePage />;
  if (path === '/privasi') return <PrivacyPage />;
  if (path === '/panduan') return <GuideIndexPage />;
  if ((m = match('/panduan/:slug', path))) return <GuideDetailPage slug={m.slug!} />;
  if (path === '/kelas-saya') return <MyCoursesPage />;
  if ((m = match('/kelas/:id', path))) return <CoursePage id={m.id!} />;
  if ((m = match('/materi/:id', path))) return <LessonPage id={m.id!} />;
  if ((m = match('/hasil/:id', path))) return <ResultPage id={m.id!} />;
  if ((m = match('/sertifikat/:code', path))) return <CertificatePage code={m.code!} />;
  if (path === '/admin/masuk') return <AdminLoginPage />;
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
      <footer className="site-footer">
        <div className="footer-inner">
          <p>
            <strong>PatraDesa Belajar</strong> — pelatihan daring untuk perangkat desa. Data latihan bersifat fiktif.
          </p>
          <ul className="footer-links">
            <li>
              <Link href="/panduan">Panduan</Link>
            </li>
            <li>
              <Link href="/privasi">Privasi</Link>
            </li>
            <li>
              <a href="https://patradesa.id/" rel="noopener">
                patradesa.id
              </a>
            </li>
            <li>
              <Link href="/admin/masuk">
                <Icon name="shield" /> Masuk pengelola
              </Link>
            </li>
          </ul>
        </div>
      </footer>
      {/* Kontrol A−/A+ mengambang di tengah bawah (bukan di header) agar selalu terjangkau tanpa memakan ruang. */}
      <div className="font-float">
        <span className="font-float-label" aria-hidden="true">
          Ukuran teks
        </span>
        <FontScaleControl id="float-font" />
      </div>
    </>
  );
}
