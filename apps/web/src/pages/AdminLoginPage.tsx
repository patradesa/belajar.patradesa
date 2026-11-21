import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Link, navigate } from '../lib/router';
import { hasRole, useSession } from '../lib/session';
import { ErrorAlert, Loading, PageTitle, useAsync } from '../components/common';
import { GoogleSignIn, type AuthConfig } from '../components/GoogleSignIn';
import { DevLoginForm } from '../components/DevLoginForm';
import { Icon } from '../components/Icon';

/**
 * Halaman masuk pengelola (admin, editor konten, mentor). Autentikasinya sama dengan peserta
 * (Google OIDC — tanpa kata sandi), tetapi hak akses ditentukan oleh role sistem di server.
 * Halaman ini hanya UI: setiap endpoint /api/v1/admin tetap memeriksa role.
 */
export function AdminLoginPage() {
  const { me, loading, logout } = useSession();
  const cfg = useAsync(() => api<AuthConfig>('/auth/config'), []);
  const [err, setErr] = useState<string | null>(null);
  const allowed = hasRole(me, 'admin', 'content_editor', 'mentor');

  useEffect(() => {
    if (me && allowed) navigate('/admin', { replace: true });
  }, [me, allowed]);

  if (loading || (me && allowed)) return <Loading />;

  return (
    <div className="auth-layout">
      <div className="stack" style={{ width: '100%', maxWidth: '28rem' }}>
        <section className="card auth-card">
          <span className="icon-tile">
            <Icon name="shield" />
          </span>
          <p className="eyebrow">Khusus pengelola</p>
          <PageTitle>Masuk Admin</PageTitle>
          {me ? (
            <div className="stack">
              <div className="alert alert-warning" role="status">
                Akun <strong>{me.user.email}</strong> tidak memiliki akses pengelola. Minta super admin memberi peran admin, editor konten,
                atau mentor, lalu muat ulang halaman ini.
              </div>
              <div className="btn-row">
                <button type="button" className="btn btn-secondary" onClick={() => void logout()}>
                  <Icon name="logout" />
                  Keluar & ganti akun
                </button>
                <Link className="btn btn-light" href="/">
                  Ke beranda
                </Link>
              </div>
            </div>
          ) : (
            <>
              <p className="muted">Untuk admin, editor konten, dan mentor. Masuk dengan akun Google yang sudah diberi akses oleh super admin.</p>
              {err && (
                <div className="alert alert-error" role="alert">
                  {err}
                </div>
              )}
              {cfg.loading && <Loading />}
              {Boolean(cfg.error) && <ErrorAlert error={cfg.error} onRetry={cfg.reload} />}
              {cfg.data && <GoogleSignIn config={cfg.data} returnTo="/admin" onError={setErr} />}
              {cfg.data && !cfg.data.googleEnabled && !cfg.data.devLoginEnabled && <p>Login belum dikonfigurasi.</p>}
              <p className="help">
                <Icon name="lock" /> Akses diperiksa di server untuk setiap tindakan admin dan dicatat di log audit.
              </p>
            </>
          )}
        </section>
        {!me && cfg.data?.devLoginEnabled && <DevLoginForm asAdmin next="/admin" onError={setErr} />}
        <p className="muted" style={{ textAlign: 'center' }}>
          Peserta? <Link href="/masuk">Masuk di sini</Link>
        </p>
      </div>
    </div>
  );
}
