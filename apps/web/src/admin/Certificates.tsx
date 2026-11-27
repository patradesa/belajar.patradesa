import { useState } from 'react';
import { api } from '../lib/api';
import { ErrorAlert, Loading, useAsync } from '../components/common';
import { formatCertCode, formatDateId, formatPct } from '../components/CertificateCard';
import { useAction } from './useAction';

interface AdminCert {
  id: string;
  status: 'pending' | 'issued' | 'revoked';
  recipient_name: string;
  course_title: string;
  final_score_pct: number | null;
  completed_at: number;
  certificate_no: string | null;
  verification_code: string | null;
  verify_url: string | null;
  issued_at: number | null;
  sync_attempts: number;
  next_retry_at: number | null;
  last_error: string | null;
  revoked_reason: string | null;
  email: string;
}

const STATUS_LABEL = {
  pending: 'Menunggu Studio',
  issued: 'Terbit',
  revoked: 'Dicabut',
} as const;

/** Tab admin: sertifikat yang diterbitkan lewat Sertifikat Studio. */
export function Certificates() {
  const { data, error, loading, reload } = useAsync(
    () =>
      api<{
        certificates: AdminCert[];
        integrationConfigured: boolean;
        integrationProblem?: string | null;
        studioUrl: string | null;
      }>('/admin/certificates'),
    [],
  );
  const { run, view } = useAction();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [check, setCheck] = useState<{ ok: boolean; status: number | null; message: string; diag: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const testStudio = async () => {
    setChecking(true);
    setCheck(null);
    try {
      setCheck(await api<{ ok: boolean; status: number | null; message: string; diag: string }>('/admin/certificates/studio-check', { method: 'POST' }));
    } catch (e) {
      setCheck({ ok: false, status: null, message: e instanceof Error ? e.message : 'Gagal menguji koneksi.', diag: '' });
    } finally {
      setChecking(false);
    }
  };

  const retry = (id: string) =>
    run(async () => {
      const r = await api<{ status: string; lastError: string | null }>(`/admin/certificates/${id}/retry`, { method: 'POST' });
      reload();
      if (r.status !== 'issued') throw new Error(r.lastError ?? 'Belum berhasil diterbitkan.');
    }, 'Sertifikat berhasil diterbitkan.');

  const revoke = async (id: string) => {
    const ok = await run(async () => {
      await api(`/admin/certificates/${id}/revoke`, {
        method: 'POST',
        body: { reason },
      });
    }, 'Sertifikat dicabut. Halaman verifikasi Studio ikut menampilkan status dicabut.');
    if (ok) {
      setRevoking(null);
      setReason('');
      reload();
    }
  };

  return (
    <div className="stack">
      <h2>Sertifikat</h2>
      <p className="muted">
        Sertifikat terbit otomatis saat peserta lulus semua syarat kelas. Nomor dan kode verifikasi berasal dari{' '}
        {data?.studioUrl ? (
          <a href={data.studioUrl} target="_blank" rel="noopener">
            Sertifikat Studio
            <span className="visually-hidden"> (tab baru)</span>
          </a>
        ) : (
          'Sertifikat Studio'
        )}{' '}
        (format <span className="mono">0001/PD/BELAJAR/2026</span>).
      </p>
      {data && !data.integrationConfigured && (
        <div className="alert alert-warning">
          <strong>Integrasi belum aktif.</strong> {data.integrationProblem ? `${data.integrationProblem} ` : ''}Sertifikat tersimpan sebagai “Menunggu
          Studio” sampai variabel <span className="mono">SERTIFIKAT_BASE_URL</span> dan secret <span className="mono">SERTIFIKAT_INTEGRATION_SECRET</span>{' '}
          (minimal 32 karakter, sama dengan <span className="mono">LMS_INTEGRATION_SECRET</span> di Studio) dipasang di Worker (lihat docs/deploy.md).
          Setelah itu Cron menerbitkannya otomatis.
        </div>
      )}
      <div className="btn-row">
        <button type="button" className="btn btn-secondary" disabled={checking} onClick={() => void testStudio()}>
          {checking ? 'Menguji…' : 'Uji koneksi Studio'}
        </button>
      </div>
      {check && (
        <div className={check.ok ? 'alert alert-success' : 'alert alert-error'} role="status">
          <strong>{check.ok ? 'Koneksi Studio baik.' : 'Koneksi Studio bermasalah.'}</strong> {check.message}
          {check.diag ? <span className="mono"> ({check.diag})</span> : null}
        </div>
      )}
      {view}
      {loading && !data && <Loading />}
      {Boolean(error) && <ErrorAlert error={error} onRetry={reload} />}
      {data?.certificates.length === 0 && <p>Belum ada peserta yang lulus.</p>}
      {data && data.certificates.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Peserta</th>
                <th scope="col">Kelas</th>
                <th scope="col">Status</th>
                <th scope="col">Nomor &amp; kode</th>
                <th scope="col">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {data.certificates.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.recipient_name}
                    <br />
                    <span className="muted">{c.email}</span>
                  </td>
                  <td>
                    {c.course_title}
                    <br />
                    <span className="muted">
                      Lulus {formatDateId(c.completed_at)}
                      {c.final_score_pct !== null ? ` · nilai ${formatPct(c.final_score_pct)}%` : ''}
                    </span>
                  </td>
                  <td>
                    <span className={`badge${c.status === 'issued' ? ' badge-success' : ''}`}>{STATUS_LABEL[c.status]}</span>
                    {c.status === 'pending' && c.last_error && (
                      <>
                        <br />
                        <span className="muted">
                          {c.last_error} (percobaan {c.sync_attempts})
                        </span>
                      </>
                    )}
                    {c.status === 'revoked' && c.revoked_reason && (
                      <>
                        <br />
                        <span className="muted">Alasan: {c.revoked_reason}</span>
                      </>
                    )}
                  </td>
                  <td>
                    {c.certificate_no ?? '–'}
                    {c.verification_code && (
                      <>
                        <br />
                        <span className="mono">{formatCertCode(c.verification_code)}</span>
                      </>
                    )}
                  </td>
                  <td>
                    <div className="btn-row">
                      {c.status === 'pending' && (
                        <button type="button" className="btn btn-secondary" onClick={() => void retry(c.id)}>
                          Terbitkan sekarang
                        </button>
                      )}
                      {c.status === 'issued' && c.verify_url && (
                        <a className="btn btn-secondary" href={c.verify_url} target="_blank" rel="noopener">
                          Cek di Studio
                          <span className="visually-hidden"> (tab baru)</span>
                        </a>
                      )}
                      {c.status !== 'revoked' && revoking !== c.id && (
                        <button type="button" className="btn btn-danger" onClick={() => setRevoking(c.id)}>
                          Cabut
                        </button>
                      )}
                    </div>
                    {revoking === c.id && (
                      <form
                        className="stack"
                        style={{ marginTop: '0.5rem' }}
                        onSubmit={(e) => {
                          e.preventDefault();
                          void revoke(c.id);
                        }}
                      >
                        <div className="field">
                          <label htmlFor={`alasan-${c.id}`}>Alasan pencabutan</label>
                          <input
                            id={`alasan-${c.id}`}
                            type="text"
                            required
                            minLength={5}
                            maxLength={300}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </div>
                        <div className="btn-row">
                          <button type="submit" className="btn btn-danger">
                            Cabut sertifikat
                          </button>
                          <button type="button" className="btn btn-secondary" onClick={() => setRevoking(null)}>
                            Batal
                          </button>
                        </div>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
