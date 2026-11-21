import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Link, navigate, useLocation } from '../lib/router';
import { useSession } from '../lib/session';
import { ErrorAlert, Loading, PageTitle, useAsync } from '../components/common';
import { GoogleSignIn, type AuthConfig } from '../components/GoogleSignIn';
import { DevLoginForm } from '../components/DevLoginForm';
import { Icon } from '../components/Icon';

export function LoginPage() {
  const { search } = useLocation();
  const { me } = useSession();
  const cfg = useAsync(() => api<AuthConfig>('/auth/config'), []);
  const [err, setErr] = useState<string | null>(search.get('galat') ? 'Masuk gagal atau dibatalkan. Silakan coba lagi.' : null);

  useEffect(() => {
    if (me) navigate('/', { replace: true });
  }, [me]);

  return (
    <div className="auth-layout">
      <div className="stack" style={{ width: '100%', maxWidth: '28rem' }}>
        <section className="card auth-card" aria-labelledby="masuk-judul">
          <span className="icon-tile">
            <Icon name="leaf" />
          </span>
          <p className="eyebrow">Peserta</p>
          <div id="masuk-judul">
            <PageTitle>Masuk</PageTitle>
          </div>
          <p className="muted">
            Gunakan akun Google Anda. Kami hanya menerima nama dan email terverifikasi; kata sandi Anda tidak pernah kami terima.
          </p>
          {err && (
            <div className="alert alert-error" role="alert">
              {err}
            </div>
          )}
          {cfg.loading && <Loading />}
          {Boolean(cfg.error) && <ErrorAlert error={cfg.error} onRetry={cfg.reload} />}
          {cfg.data && <GoogleSignIn config={cfg.data} onError={setErr} />}
          {cfg.data && !cfg.data.googleEnabled && !cfg.data.devLoginEnabled && <p>Login belum dikonfigurasi oleh administrator.</p>}
        </section>
        {cfg.data?.devLoginEnabled && <DevLoginForm onError={setErr} />}
        <p className="muted" style={{ textAlign: 'center' }}>
          Pengelola program? <Link href="/admin/masuk">Masuk sebagai admin</Link>
        </p>
      </div>
    </div>
  );
}
