import type { CertificateView } from '@patradesa/shared';
import { Link } from '../lib/router';
import { Icon } from './Icon';

export function formatCertCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

export function formatPct(n: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(n);
}

export function formatDateId(ms: number): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Makassar',
  }).format(new Date(ms));
}

/** Kartu sertifikat di halaman kelas (status pending / terbit / dicabut). */
export function CertificateCard({ cert, onRefresh }: { cert: CertificateView; onRefresh: () => void }) {
  return (
    <section className="card cert-card stack" aria-labelledby="sertifikat-judul">
      <div className="cert-card-head">
        <span className="icon-tile" aria-hidden="true">
          <Icon name="shield" />
        </span>
        <h2 id="sertifikat-judul" style={{ margin: 0 }}>
          Sertifikat kelulusan
        </h2>
      </div>
      {cert.status === 'pending' && (
        <>
          <p style={{ margin: 0 }} role="status">
            Sertifikat atas nama <strong>{cert.recipientName}</strong> sedang diterbitkan oleh Sertifikat Studio Patra Desa. Biasanya hanya beberapa
            detik; bila belum muncul, sistem mencoba lagi otomatis.
          </p>
          <div>
            <button type="button" className="btn btn-secondary" onClick={onRefresh}>
              Periksa lagi
            </button>
          </div>
        </>
      )}
      {cert.status === 'issued' && cert.code && (
        <>
          <dl className="cert-facts">
            <div>
              <dt>Nama</dt>
              <dd>{cert.recipientName}</dd>
            </div>
            <div>
              <dt>Nomor</dt>
              <dd>{cert.certificateNo}</dd>
            </div>
            <div>
              <dt>Kode verifikasi</dt>
              <dd className="mono">{formatCertCode(cert.code)}</dd>
            </div>
            {cert.issuedAt !== null && (
              <div>
                <dt>Tanggal terbit</dt>
                <dd>{formatDateId(cert.issuedAt)}</dd>
              </div>
            )}
          </dl>
          <div className="btn-row">
            <Link className="btn btn-accent" href={`/sertifikat/${cert.code}`}>
              Lihat &amp; cetak sertifikat <Icon name="arrow" />
            </Link>
            {cert.verifyUrl && (
              <a className="btn btn-secondary" href={cert.verifyUrl} target="_blank" rel="noopener">
                Cek keaslian di Sertifikat Studio
                <span className="visually-hidden"> (tab baru)</span>
              </a>
            )}
          </div>
        </>
      )}
      {cert.status === 'revoked' && (
        <p className="alert alert-warning" style={{ margin: 0 }}>
          Sertifikat untuk kelas ini telah dicabut oleh pengelola. Hubungi admin PatraDesa Belajar bila ada pertanyaan.
        </p>
      )}
    </section>
  );
}
