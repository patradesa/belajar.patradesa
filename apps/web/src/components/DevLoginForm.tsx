import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { navigate } from '../lib/router';
import { useSession } from '../lib/session';

/** Login pengembangan — server hanya mengizinkan di localhost saat ENVIRONMENT=development. */
export function DevLoginForm({ asAdmin = false, next, onError }: { asAdmin?: boolean; next?: string; onError: (msg: string | null) => void }) {
  const { refresh } = useSession();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    onError(null);
    try {
      await api('/auth/dev-login', {
        method: 'POST',
        body: { email: String(f.get('email')), name: String(f.get('name')), roles: f.get('admin') ? ['admin'] : [] },
      });
      const m = await refresh();
      navigate(m?.profile.privacyConsentAt ? (next ?? '/') : '/profil?baru=1');
    } catch (ex) {
      onError(errorMessage(ex));
    }
  };
  return (
    <details className="card card-soft" open>
      <summary>
        <strong>Login pengembangan (lokal saja)</strong>
      </summary>
      <p className="help">Hanya aktif di komputer pengembang. Tidak tersedia di staging/produksi.</p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="dev-email">Email (fiktif)</label>
          <input id="dev-email" name="email" type="email" required defaultValue={asAdmin ? 'admin@contoh.test' : 'peserta@contoh.test'} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="dev-name">Nama</label>
          <input id="dev-name" name="name" type="text" required defaultValue={asAdmin ? 'Admin Contoh' : 'Peserta Contoh'} autoComplete="off" />
        </div>
        <label className="check">
          <input type="checkbox" name="admin" defaultChecked={asAdmin} /> Masuk sebagai admin (uji)
        </label>
        <button className="btn btn-secondary" type="submit">
          Masuk (dev)
        </button>
      </form>
    </details>
  );
}
