import type { PublicCertificate } from '@patradesa/shared';
import { api } from '../lib/api';
import { ErrorAlert, Loading, PageTitle, useAsync } from '../components/common';
import { QrCode } from '../components/QrCode';
import { formatCertCode, formatDateId, formatPct } from '../components/CertificateCard';
import { Icon } from '../components/Icon';

/** Halaman cetak sertifikat (publik dengan kode). Keaslian selalu dicek di Sertifikat Studio lewat QR. */
export function CertificatePage({ code }: { code: string }) {
  const { data, error, loading, reload } = useAsync(() => api<PublicCertificate>(`/certificates/${encodeURIComponent(code)}`), [code]);
  if (loading && !data) return <Loading label="Memuat sertifikat…" />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data) return null;
  const revoked = data.status === 'revoked';
  return (
    <div className="stack">
      <div className="no-print btn-row">
        <button type="button" className="btn btn-accent" onClick={() => window.print()} disabled={revoked}>
          Cetak / simpan PDF
        </button>
        <a className="btn btn-secondary" href={data.verifyUrl} target="_blank" rel="noopener">
          Cek keaslian<span className="visually-hidden"> (tab baru)</span>
        </a>
      </div>
      {revoked && (
        <div className="alert alert-error" role="alert">
          <strong>Sertifikat ini sudah dicabut</strong> dan tidak berlaku lagi.
        </div>
      )}
      <article className={`cert-sheet${revoked ? ' is-revoked' : ''}`} aria-labelledby="cert-title">
        <div className="cert-sheet-inner">
          <header className="cert-brand">
            <img src="/logo-patradesa.png" alt="Patra Desa" width={197} height={48} />
            <p className="cert-org">PatraDesa Belajar</p>
          </header>
          <div className="cert-title-wrap" id="cert-title">
            <PageTitle>Sertifikat Kelulusan</PageTitle>
          </div>
          <p className="cert-lead">Diberikan kepada</p>
          <p className="cert-name">{data.recipientName}</p>
          <p className="cert-lead">yang telah menyelesaikan seluruh materi dan lulus evaluasi kelas</p>
          <p className="cert-course">{data.courseTitle}</p>
          {data.finalScorePct !== null && <p className="cert-score">Nilai akhir {formatPct(data.finalScorePct)}%</p>}
          <footer className="cert-foot">
            <dl className="cert-meta">
              <div>
                <dt>Nomor</dt>
                <dd>{data.certificateNo}</dd>
              </div>
              <div>
                <dt>Tanggal terbit</dt>
                <dd>{formatDateId(data.issuedAt)}</dd>
              </div>
              <div>
                <dt>Kode verifikasi</dt>
                <dd className="mono">{formatCertCode(data.code)}</dd>
              </div>
            </dl>
            <div className="cert-qr">
              <QrCode value={data.verifyUrl} size={112} label={`Kode QR verifikasi: ${data.verifyUrl}`} />
              <p>
                <Icon name="shield" /> Pindai atau buka <span className="mono">{data.verifyUrl.replace(/^https?:\/\//, '')}</span>
              </p>
            </div>
          </footer>
          {revoked && (
            <p className="cert-stamp" aria-hidden="true">
              DICABUT
            </p>
          )}
        </div>
      </article>
    </div>
  );
}
