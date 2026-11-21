import { useState } from 'react';
import type { AttemptView, CourseDetail } from '@patradesa/shared';
import { api, errorMessage } from '../lib/api';
import { Link, navigate } from '../lib/router';
import { useSession } from '../lib/session';
import { ErrorAlert, Loading, PageTitle, formatDuration, useAsync } from '../components/common';

const TYPE_LABEL = { html: 'Bacaan', slides: 'Slide', pdf: 'PDF', youtube: 'Video' } as const;
const RESULT_LABEL = { passed: 'Lulus', failed: 'Belum lulus', pending_review: 'Menunggu penilaian', pending: 'Diproses' } as const;

export function CoursePage({ id }: { id: string }) {
  const { me, refresh } = useSession();
  const { data, error, loading, reload } = useAsync(() => api<CourseDetail>(`/courses/${encodeURIComponent(id)}`), [id, me?.user.id]);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data) return null;

  const enroll = async () => {
    setBusy(true);
    setActionErr(null);
    try {
      await api(`/courses/${data.id}/enroll`, { method: 'POST' });
      reload();
    } catch (e) {
      setActionErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const startQuiz = async (assessmentId: string) => {
    setBusy(true);
    setActionErr(null);
    try {
      const a = await api<AttemptView>(`/assessments/${assessmentId}/attempts`, { method: 'POST' });
      await refresh(); // status exam lock untuk UI
      navigate(`/kuis/${a.id}`);
    } catch (e) {
      setActionErr(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageTitle>{data.title}</PageTitle>
      <p className="prose">{data.description}</p>
      {actionErr && (
        <div className="alert alert-error" role="alert">
          {actionErr}
        </div>
      )}
      {!data.enrolled &&
        (me ? (
          <button type="button" className="btn" onClick={enroll} disabled={busy}>
            Daftar kelas ini
          </button>
        ) : (
          <p>
            <Link href="/masuk">Masuk</Link> untuk mendaftar kelas ini.
          </p>
        ))}
      {data.completion && (
        <div className={`alert ${data.completion.passed ? 'alert-success' : 'alert-warning'}`}>
          {data.completion.passed ? (
            <strong>Selamat, semua syarat kelulusan kelas terpenuhi.</strong>
          ) : (
            <>
              <strong>Syarat kelulusan yang belum terpenuhi:</strong>
              <ul>
                {data.completion.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <section aria-labelledby="materi-judul">
        <h2 id="materi-judul">Materi</h2>
        <ol className="lesson-list">
          {data.lessons.map((l) => {
            const pct = l.requiredActiveSeconds ? Math.min(100, Math.round((l.activeSeconds / l.requiredActiveSeconds) * 100)) : 100;
            return (
              <li key={l.id} className="card">
                <h3>
                  {data.enrolled ? <Link href={`/materi/${l.id}`}>{l.title}</Link> : l.title}{' '}
                  <span className="muted">({TYPE_LABEL[l.contentType]})</span>
                </h3>
                {l.summary && <p>{l.summary}</p>}
                {data.enrolled && (
                  <p>
                    {l.completed ? (
                      <span className="badge badge-success">✓ Selesai</span>
                    ) : (
                      <>
                        Waktu belajar: {formatDuration(l.activeSeconds)} dari minimal {formatDuration(l.requiredActiveSeconds)} ({pct}%)
                      </>
                    )}
                  </p>
                )}
                {l.assessment && data.enrolled && (
                  <div className="stack">
                    <p>
                      <strong>{l.assessment.title}</strong> — {Math.round(l.assessment.timeLimitSeconds / 60)} menit, nilai lulus{' '}
                      {l.assessment.passingScorePct}%, percobaan {l.assessment.attemptsUsed}/{l.assessment.maxAttempts}.
                      {l.assessment.bestResult && <> Status: {RESULT_LABEL[l.assessment.bestResult]}.</>}
                    </p>
                    {me?.activeAttempt?.assessmentId === l.assessment.id ? (
                      <Link className="btn" href={`/kuis/${me.activeAttempt.id}`}>
                        Lanjutkan kuis
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void startQuiz(l.assessment!.id)}
                        disabled={busy || !l.assessment.eligible || !!me?.activeAttempt}
                        aria-describedby={`kuis-${l.id}-help`}
                      >
                        Mulai Kuis
                      </button>
                    )}
                    <p id={`kuis-${l.id}-help`} className="help">
                      {l.assessment.eligible
                        ? 'Waktu dihitung server sejak kuis dimulai. Pendamping AI tidak tersedia selama kuis.'
                        : l.completed
                          ? 'Kuis belum dapat dimulai (batas percobaan atau masa jeda).'
                          : 'Kuis terbuka setelah waktu belajar minimum materi ini terpenuhi.'}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
