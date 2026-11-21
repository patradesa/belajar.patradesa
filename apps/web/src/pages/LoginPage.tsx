import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { navigate, useLocation } from '../lib/router';
import { useSession } from '../lib/session';
import { ErrorAlert, Loading, PageTitle, useAsync } from '../components/common';

interface AuthConfig {
  turnstileSiteKey: string | null;
  googleEnabled: boolean;
  devLoginEnabled: boolean;
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; 'expired-callback'?: () => void; language?: string }) => string;
    };
  }
}

/** Muat skrip Turnstile hanya di halaman masuk (bukan dependensi global). */
function useTurnstile(siteKey: string | null, onToken: (t: string | null) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey || !ref.current) return;
    const el = ref.current;
    const render = () => {
      if (window.turnstile && el.childElementCount === 0) {
        window.turnstile.render(el, { sitekey: siteKey, callback: onToken, 'expired-callback': () => onToken(null), language: 'id' });
      }
    };
    if (window.turnstile) render();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
  }, [siteKey, onToken]);
  return ref;
}

export function LoginPage() {
  const { search } = useLocation();
  const { me, refresh } = useSession();
  const cfg = useAsync(() => api<AuthConfig>('/auth/config'), []);
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(search.get('galat') ? 'Masuk gagal atau dibatalkan. Silakan coba lagi.' : null);
  const [busy, setBusy] = useState(false);
  const tsRef = useTurnstile(cfg.data?.googleEnabled ? cfg.data.turnstileSiteKey : null, setToken);

  useEffect(() => {
    if (me) navigate('/', { replace: true });
  }, [me]);

  const google = async () => {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ url: string }>('/auth/google/start', { method: 'POST', body: { turnstileToken: token } });
      window.location.assign(r.url);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };

  const devLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErr(null);
    try {
      await api('/auth/dev-login', {
        method: 'POST',
        body: { email: String(f.get('email')), name: String(f.get('name')), roles: f.get('admin') ? ['admin'] : [] },
      });
      const m = await refresh();
      navigate(m?.profile.privacyConsentAt ? '/' : '/profil?baru=1');
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };

  return (
    <div className="stack prose">
      <PageTitle>Masuk</PageTitle>
      {err && (
        <div className="alert alert-error" role="alert">
          {err}
        </div>
      )}
      {cfg.loading && <Loading />}
      {Boolean(cfg.error) && <ErrorAlert error={cfg.error} onRetry={cfg.reload} />}
      {cfg.data?.googleEnabled && (
        <section className="card stack" aria-labelledby="google-judul">
          <h2 id="google-judul">Masuk dengan akun Google</h2>
          <p className="muted">Kami hanya menerima nama dan email terverifikasi dari Google. Kata sandi Anda tidak pernah kami terima.</p>
          <div ref={tsRef} aria-label="Verifikasi keamanan" />
          <button type="button" className="btn" onClick={google} disabled={!token || busy}>
            {busy ? 'Mengalihkan…' : 'Masuk dengan Google'}
          </button>
          {!token && <p className="help">Selesaikan verifikasi keamanan di atas terlebih dahulu.</p>}
        </section>
      )}
      {cfg.data && !cfg.data.googleEnabled && !cfg.data.devLoginEnabled && <p>Login belum dikonfigurasi oleh administrator.</p>}
      {cfg.data?.devLoginEnabled && (
        <section className="card" aria-labelledby="dev-judul">
          <h2 id="dev-judul">Login pengembangan (lokal saja)</h2>
          <p className="alert alert-warning">Hanya aktif di komputer pengembang. Tidak tersedia di staging/produksi.</p>
          <form onSubmit={devLogin}>
            <div className="field">
              <label htmlFor="dev-email">Email (fiktif)</label>
              <input id="dev-email" name="email" type="email" required defaultValue="peserta@contoh.test" autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="dev-name">Nama</label>
              <input id="dev-name" name="name" type="text" required defaultValue="Peserta Contoh" autoComplete="off" />
            </div>
            <label className="check">
              <input type="checkbox" name="admin" /> Masuk sebagai admin (uji)
            </label>
            <button className="btn" type="submit">
              Masuk (dev)
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
