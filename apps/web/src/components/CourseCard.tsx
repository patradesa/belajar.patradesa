import { useState } from 'react';
import { VILLAGE_ROLE_SHORT, type CatalogCourse } from '@patradesa/shared';
import { api, errorMessage } from '../lib/api';
import { Link, navigate } from '../lib/router';
import { useSession } from '../lib/session';
import { HeroWaves, Icon } from './Icon';
import { StarRating } from './Stars';

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

  const roles = course.recommendedRoles.map((r) => VILLAGE_ROLE_SHORT[r]);
  const facts: { icon: Parameters<typeof Icon>[0]['name']; text: string }[] = [
    { icon: 'book', text: `${course.lessonCount} materi` },
    { icon: 'clock', text: formatStudyTime(course.studyMinutes) },
    { icon: 'quiz', text: course.quizQuestionCount ? `${course.quizQuestionCount} soal kuis` : 'Tanpa kuis' },
    { icon: 'users', text: `Disarankan untuk: ${roles.length ? roles.join(', ') : 'semua perangkat desa'}` },
  ];

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
        {course.description && <p className="course-card-desc">{course.description}</p>}
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
        <StarRating rating={course.rating} />
        {err && (
          <p className="alert alert-error" role="alert" style={{ margin: 0 }}>
            {err}
          </p>
        )}
        <div className="course-card-actions">
          {course.enrolled ? (
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
    </article>
  );
}
