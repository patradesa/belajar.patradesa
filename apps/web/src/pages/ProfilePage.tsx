import { useState, type FormEvent } from 'react';
import { VILLAGE_ROLES, VILLAGE_ROLE_LABELS, type CertificateView, type MyCourse, type VillageRole } from '@patradesa/shared';
import { api, errorMessage } from '../lib/api';
import { Link, navigate, useLocation } from '../lib/router';
import { useSession } from '../lib/session';
import { ErrorAlert, Loading, PageTitle, useAsync } from '../components/common';
import { MyCertificateList, MyCourseList } from '../components/MyLearning';

export function ProfilePage() {
  const { me, loading, refresh } = useSession();
  const { search } = useLocation();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [consentErr, setConsentErr] = useState(false);
  // Kelas & sertifikat: dimuat setelah persetujuan privasi (akun baru belum punya data belajar).
  const learning = useAsync(
    () =>
      me?.profile.privacyConsentAt
        ? Promise.all([api<{ courses: MyCourse[] }>('/me/courses'), api<{ certificates: CertificateView[] }>('/me/certificates')])
        : Promise.resolve(null),
    [me?.user.id, me?.profile.privacyConsentAt],
  );
  if (loading) return <Loading />;
  if (!me) {
    return (
      <p>
        <Link href="/masuk">Masuk</Link> untuk melihat profil.
      </p>
    );
  }
  const needsConsent = !me.profile.privacyConsentAt;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (needsConsent && !f.get('consent')) {
      setConsentErr(true);
      return;
    }
    setConsentErr(false);
    const val = (k: string) => {
      const v = String(f.get(k) ?? '').trim();
      return v === '' ? null : v;
    };
    try {
      await api('/me', {
        method: 'PATCH',
        body: {
          displayName: String(f.get('displayName') ?? '').trim() || undefined,
          certificateName: val('certificateName'),
          villageRole: (val('villageRole') as VillageRole | null) ?? null,
          villageName: val('villageName'),
          district: val('district'),
          regency: val('regency'),
          ...(f.get('consent') ? { privacyConsent: true } : {}),
        },
      });
      await refresh();
      setMsg({ ok: true, text: 'Profil tersimpan.' });
      if (search.get('baru')) navigate('/');
    } catch (ex) {
      setMsg({ ok: false, text: errorMessage(ex) });
    }
  };

  return (
    <div className="stack">
      <div className="page-title-block">
        <PageTitle>Profil</PageTitle>
        <p className="muted">
          Kami hanya meminta data minimal. Jangan isi NIK, nomor KK, alamat lengkap, atau tanggal lahir. Pilihan jabatan hanya untuk
          saran materi, <strong>bukan</strong> hak akses.
        </p>
      </div>
      {msg && (
        <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </div>
      )}
      <div className="two-col">
        <form onSubmit={submit} className="card" noValidate aria-labelledby="profil-data">
          <h2 id="profil-data">Data profil</h2>
          <div className="field">
            <label htmlFor="displayName">Nama panggilan</label>
            <input id="displayName" name="displayName" type="text" maxLength={120} defaultValue={me.user.displayName} autoComplete="nickname" />
          </div>
          <div className="field">
            <label htmlFor="certificateName">Nama untuk sertifikat (opsional)</label>
            <input id="certificateName" name="certificateName" type="text" maxLength={120} defaultValue={me.profile.certificateName ?? ''} autoComplete="name" />
          </div>
          <div className="field">
            <label htmlFor="villageRole">Jabatan di desa</label>
            <select id="villageRole" name="villageRole" defaultValue={me.profile.villageRole ?? ''} aria-describedby="villageRole-help">
              <option value="">— Pilih —</option>
              {VILLAGE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {VILLAGE_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <span id="villageRole-help" className="help">
              Digunakan untuk menyarankan materi yang relevan.
            </span>
          </div>
          <div className="field">
            <label htmlFor="villageName">Nama desa (opsional)</label>
            <input id="villageName" name="villageName" type="text" maxLength={80} defaultValue={me.profile.villageName ?? ''} />
          </div>
          <div className="field">
            <label htmlFor="district">Kecamatan (opsional)</label>
            <input id="district" name="district" type="text" maxLength={80} defaultValue={me.profile.district ?? ''} />
          </div>
          <div className="field">
            <label htmlFor="regency">Kabupaten (opsional)</label>
            <input id="regency" name="regency" type="text" maxLength={80} defaultValue={me.profile.regency ?? ''} />
          </div>
          {needsConsent && (
            <div className="field">
              <label className="check" htmlFor="consent">
                <input id="consent" name="consent" type="checkbox" aria-describedby={consentErr ? 'consent-err' : undefined} aria-invalid={consentErr || undefined} />
                <span>
                  Saya telah membaca dan menyetujui <Link href="/privasi">kebijakan privasi</Link>. (wajib)
                </span>
              </label>
              {consentErr && (
                <p id="consent-err" className="field-error" role="alert">
                  Persetujuan kebijakan privasi wajib dicentang.
                </p>
              )}
            </div>
          )}
          <button type="submit" className="btn">
            Simpan profil
          </button>
        </form>
        {!needsConsent && (
          <div className="col-stack">
            <section className="card stack" aria-labelledby="profil-kelas">
              <h2 id="profil-kelas">Kelas yang diikuti</h2>
              {learning.loading && !learning.data && <Loading />}
              {Boolean(learning.error) && <ErrorAlert error={learning.error} onRetry={learning.reload} />}
              {learning.data && <MyCourseList courses={learning.data[0].courses} heading="h3" />}
            </section>
            <section className="card stack" aria-labelledby="profil-sertifikat">
              <h2 id="profil-sertifikat">Sertifikat saya</h2>
              {learning.data && <MyCertificateList certificates={learning.data[1].certificates} heading="h3" />}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
