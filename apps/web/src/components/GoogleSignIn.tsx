import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { GoogleG } from './Icon';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; 'expired-callback'?: () => void; language?: string }) => string;
    };
  }
}

export interface AuthConfig {
  turnstileSiteKey: string | null;
  googleEnabled: boolean;
  devLoginEnabled: boolean;
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

/** Verifikasi Turnstile + tombol "Masuk dengan Google". `returnTo` = path tujuan setelah login. */
export function GoogleSignIn({ config, returnTo, onError }: { config: AuthConfig; returnTo?: string; onError: (msg: string | null) => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((t: string | null) => setToken(t), []);
  const tsRef = useTurnstile(config.googleEnabled ? config.turnstileSiteKey : null, onToken);

  const start = async () => {
    if (!token) return;
    setBusy(true);
    onError(null);
    try {
      const r = await api<{ url: string }>('/auth/google/start', {
        method: 'POST',
        body: returnTo ? { turnstileToken: token, returnTo } : { turnstileToken: token },
      });
      window.location.assign(r.url);
    } catch (e) {
      onError(errorMessage(e));
      setBusy(false);
    }
  };

  if (!config.googleEnabled) return null;
  return (
    <div className="stack">
      <div ref={tsRef} className="turnstile-box" aria-label="Verifikasi keamanan" />
      <button type="button" className="btn btn-block google-btn" onClick={start} disabled={!token || busy} aria-describedby="google-help">
        <GoogleG />
        {busy ? 'Mengalihkan…' : 'Masuk dengan Google'}
      </button>
      <p id="google-help" className="help">
        {token ? 'Anda akan diarahkan ke halaman masuk Google.' : 'Selesaikan verifikasi keamanan di atas terlebih dahulu.'}
      </p>
    </div>
  );
}
