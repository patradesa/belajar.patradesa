import { useRef, useState } from 'react';
import { VILLAGE_ROLE_SHORT, parseContent, type Block, type CatalogCourse, type CourseDetail } from '@patradesa/shared';
import { api, errorMessage } from '../lib/api';
import { Link, navigate } from '../lib/router';
import { useSession } from '../lib/session';
import { BlockRenderer } from './BlockRenderer';
import { HeroWaves, Icon } from './Icon';
import { StarRating } from './Stars';
import { PassedBadge } from './PassedBadge';

export function formatStudyTime(minutes: number): string {
  if (minutes <= 0) return 'Tanpa batas waktu minimum';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `± ${h ? `${h} jam` : ''}${h && m ? ' ' : ''}${m ? `${m} menit` : ''} belajar`;
}

/** Kartu katalog kelas: foto, judul, ringkasan, daftar fakta bertanda centang, rating, tombol aksi. */
export function CourseCard({ course }: { course: CatalogCourse }) {
  const { me, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const href = `/kelas/${course.slug}`;
  const titleId = `kelas-${course.id}-judul`;
  const dialogTitleId = `kelas-${course.id}-tentang`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [about, setAbout] = useState<{ blocks: Block[] } | { error: string } | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  // "Ambil Kelas": peserta yang login langsung terdaftar lalu diarahkan ke halaman kelas.
  const take = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/courses/${course.id}/enroll`, { method: 'POST' });
      void refresh();
      navigate(href);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };

  // "Selengkapnya": kartu "Tentang kelas" (deskripsi lengkap) dalam dialog modal bawaan browser
  // (fokus terkunci di dialog, Esc menutup, fokus kembali ke tombol pemicu).
  const openAbout = async () => {
    const d = dialogRef.current;
    setAboutOpen(true);
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    if (about && 'blocks' in about) return;
    setAbout(null);
    try {
      const detail = await api<CourseDetail>(`/courses/${encodeURIComponent(course.slug)}`);
      setAbout({ blocks: parseContent(detail.description) });
    } catch (e) {
      setAbout({ error: errorMessage(e) });
    }
  };
  const closeAbout = () => {
    const d = dialogRef.current;
    if (d) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
    setAboutOpen(false);
  };

  const roles = course.recommendedRoles.map((r) => VILLAGE_ROLE_SHORT[r]);
  const facts: { icon: Parameters<typeof Icon>[0]['name']; text: string }[] = [
    { icon: 'book', text: `${course.lessonCount} materi` },
    { icon: 'clock', text: formatStudyTime(course.studyMinutes) },
    { icon: 'quiz', text: course.quizQuestionCount ? `${course.quizQuestionCount} soal kuis` : 'Tanpa kuis' },
    { icon: 'users', text: `Disarankan untuk: ${roles.length ? roles.join(', ') : 'semua perangkat desa'}` },
  ];
  const factList = (
    <ul className="check-list">
      {facts.map((f) => (
        <li key={f.icon}>
          <span className="check-dot" aria-hidden="true">
            <Icon name="tick" />
          </span>
          <span>{f.text}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <article className="course-card" aria-labelledby={titleId}>
      <div className={`course-card-media${course.coverUrl ? '' : ' course-card-media--empty'}`}>
        {course.coverUrl ? (
          <img src={course.coverUrl} alt="" loading="lazy" decoding="async" width={640} height={400} />
        ) : (
          <>
            <HeroWaves />
            <span className="icon-tile icon-tile-lg">
              <Icon name="layers" />
            </span>
          </>
        )}
        {course.recommended && <span className="badge badge-success course-card-flag">Disarankan untuk jabatan Anda</span>}
      </div>
      <div className="course-card-body">
        <h3 id={titleId}>{course.title}</h3>
        {course.summary && <p className="course-card-desc">{course.summary}</p>}
        <div>
          <button type="button" className="link-button" onClick={() => void openAbout()} aria-haspopup="dialog">
            Selengkapnya <span className="visually-hidden">tentang kelas {course.title}</span>
          </button>
        </div>
        {factList}
        <StarRating rating={course.rating} />
        {err && (
          <p className="alert alert-error" role="alert" style={{ margin: 0 }}>
            {err}
          </p>
        )}
        {course.completed && <PassedBadge certificateIssued={course.certificateIssued} />}
        <div className="course-card-actions">
          {course.completed ? (
            <Link className="btn" href={href}>
              Belajar Ulang<span className="visually-hidden">: {course.title}</span> <Icon name="arrow" />
            </Link>
          ) : course.enrolled ? (
            <Link className="btn" href={href}>
              Lanjutkan Belajar<span className="visually-hidden">: {course.title}</span> <Icon name="arrow" />
            </Link>
          ) : me ? (
            <button type="button" className="btn" onClick={() => void take()} disabled={busy}>
              {busy ? 'Mendaftarkan…' : 'Ambil Kelas'}
              <span className="visually-hidden">: {course.title}</span> <Icon name="arrow" />
            </button>
          ) : (
            <Link className="btn" href={`/masuk`}>
              Ambil Kelas<span className="visually-hidden">: {course.title}</span> <Icon name="arrow" />
            </Link>
          )}
        </div>
      </div>
      <dialog
        ref={dialogRef}
        className="about-dialog"
        aria-labelledby={dialogTitleId}
        onClose={() => setAboutOpen(false)}
      >
        {aboutOpen && (
          <div className="about-dialog-box card course-about stack">
            <div className="about-dialog-head">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>
                  Tentang kelas
                </p>
                <h2 id={dialogTitleId} style={{ margin: 0 }}>
                  {course.title}
                </h2>
              </div>
              <button type="button" className="icon-button" onClick={closeAbout}>
                <Icon name="close" />
                <span className="visually-hidden">Tutup</span>
              </button>
            </div>
            <StarRating rating={course.rating} />
            <div className="about-dialog-content" aria-live="polite" aria-busy={about === null}>
              {about === null && <p className="muted">Memuat deskripsi kelas…</p>}
              {about && 'error' in about && (
                <p className="alert alert-error" role="alert">
                  {about.error}
                </p>
              )}
              {about && 'blocks' in about && (about.blocks.length ? <BlockRenderer blocks={about.blocks} /> : <p>{course.summary}</p>)}
            </div>
            {factList}
            <div className="btn-row about-dialog-actions">
              {course.completed ? (
                <Link className="btn" href={href}>
                  Belajar Ulang <Icon name="arrow" />
                </Link>
              ) : course.enrolled ? (
                <Link className="btn" href={href}>
                  Lanjutkan Belajar <Icon name="arrow" />
                </Link>
              ) : me ? (
                <button type="button" className="btn" onClick={() => void take()} disabled={busy}>
                  {busy ? 'Mendaftarkan…' : 'Ambil Kelas'} <Icon name="arrow" />
                </button>
              ) : (
                <Link className="btn" href="/masuk">
                  Ambil Kelas <Icon name="arrow" />
                </Link>
              )}
              <Link className="btn btn-secondary" href={href}>
                Buka halaman kelas
              </Link>
              <button type="button" className="btn btn-secondary" onClick={closeAbout}>
                Tutup
              </button>
            </div>
          </div>
        )}
      </dialog>
    </article>
  );
}
