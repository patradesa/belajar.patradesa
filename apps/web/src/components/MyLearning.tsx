import { courseProgressPct, type CertificateView, type MyCourse } from '@patradesa/shared';
import { Link } from '../lib/router';
import { formatCertCode, formatDateId } from './CertificateCard';
import { Icon } from './Icon';
import { PassedBadge } from './PassedBadge';

type Heading = 'h2' | 'h3';

function courseState(c: MyCourse): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (c.certificateStatus === 'issued') return { label: 'Lulus · sertifikat terbit', tone: 'success' };
  if (c.status === 'completed' || c.certificateStatus === 'pending') return { label: 'Lulus', tone: 'success' };
  if (c.status === 'expired') return { label: 'Akses berakhir', tone: 'warning' };
  if (c.reviewingQuizzes > 0) return { label: 'Menunggu penilaian esai', tone: 'warning' };
  return { label: 'Sedang belajar', tone: 'neutral' };
}

/** Daftar kelas yang diikuti beserta progres (materi wajib selesai + kuis wajib lulus). */
export function MyCourseList({ courses, heading: H = 'h2' }: { courses: MyCourse[]; heading?: Heading }) {
  if (courses.length === 0) {
    return (
      <p>
        Anda belum mendaftar kelas. <Link href="/">Lihat katalog</Link>.
      </p>
    );
  }
  return (
    <ul className="lesson-list my-courses">
      {courses.map((c) => {
        const pct = courseProgressPct(c);
        const state = courseState(c);
        const passed = c.certificateStatus !== 'revoked' && (c.status === 'completed' || c.certificateStatus === 'pending' || c.certificateStatus === 'issued');
        const titleId = `kelas-saya-${c.id}`;
        return (
          <li key={c.id} className="card stack" aria-labelledby={titleId}>
            <div className="my-course-head">
              <H id={titleId} style={{ margin: 0 }}>
                <Link href={`/kelas/${c.slug}`}>{c.title}</Link>
              </H>
              {passed ? (
                <PassedBadge certificateIssued={c.certificateStatus === 'issued'} />
              ) : (
                <span className="badge">{state.label}</span>
              )}
            </div>
            <div>
              <p className="meta" style={{ margin: 0 }}>
                <span>
                  <Icon name="book" /> {c.completedLessons}/{c.requiredLessons} materi wajib
                </span>
                {c.requiredQuizzes > 0 && (
                  <span>
                    <Icon name="quiz" /> {c.passedQuizzes}/{c.requiredQuizzes} kuis lulus
                  </span>
                )}
                <span>
                  <strong>{pct}%</strong> selesai
                </span>
              </p>
              <div className="progress" role="img" aria-label={`Progres kelas ${c.title}: ${pct} persen`} style={{ marginTop: '0.5rem' }}>
                <span style={{ width: `${pct}%` }} />
              </div>
            </div>
            {c.expiresAt && c.status !== 'completed' && <p className="muted" style={{ margin: 0 }}>Akses berakhir {formatDateId(c.expiresAt)}</p>}
          </li>
        );
      })}
    </ul>
  );
}

const CERT_LABEL = { pending: 'Sedang diterbitkan', issued: 'Terbit', revoked: 'Dicabut' } as const;

/** Daftar sertifikat milik peserta (profil). */
export function MyCertificateList({ certificates, heading: H = 'h3' }: { certificates: CertificateView[]; heading?: Heading }) {
  if (certificates.length === 0) {
    return <p className="muted">Belum ada sertifikat. Sertifikat terbit otomatis setelah semua materi wajib selesai dan kuis wajib lulus.</p>;
  }
  return (
    <ul className="lesson-list my-certificates">
      {certificates.map((c) => {
        const titleId = `sertifikat-saya-${c.id}`;
        return (
          <li key={c.id} className="card stack" aria-labelledby={titleId}>
            <div className="my-course-head">
              <H id={titleId} style={{ margin: 0 }}>
                {c.courseTitle}
              </H>
              <span className={`badge${c.status === 'issued' ? ' badge-success' : ''}`}>{CERT_LABEL[c.status]}</span>
            </div>
            {c.status === 'issued' && c.code ? (
              <>
                <dl className="cert-facts">
                  <div>
                    <dt>Nomor</dt>
                    <dd>{c.certificateNo}</dd>
                  </div>
                  <div>
                    <dt>Kode verifikasi</dt>
                    <dd className="mono">{formatCertCode(c.code)}</dd>
                  </div>
                  {c.issuedAt !== null && (
                    <div>
                      <dt>Tanggal terbit</dt>
                      <dd>{formatDateId(c.issuedAt)}</dd>
                    </div>
                  )}
                </dl>
                <div className="btn-row">
                  <Link className="btn btn-secondary" href={`/sertifikat/${c.code}`}>
                    Lihat &amp; cetak <span className="visually-hidden">sertifikat {c.courseTitle}</span>
                  </Link>
                  {c.verifyUrl && (
                    <a className="btn btn-secondary" href={c.verifyUrl} target="_blank" rel="noopener">
                      Cek keaslian <span className="visually-hidden">sertifikat {c.courseTitle} (tab baru)</span>
                    </a>
                  )}
                </div>
              </>
            ) : c.status === 'pending' ? (
              <p className="muted" style={{ margin: 0 }}>
                Atas nama <strong>{c.recipientName}</strong>. Sertifikat sedang diterbitkan oleh Sertifikat Studio; nomor dan kode muncul di sini
                setelah terbit.
              </p>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Sertifikat ini telah dicabut oleh pengelola.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
