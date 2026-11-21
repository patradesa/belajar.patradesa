import { useState } from 'react';
import { parseContent, summarize, type AttemptView, type CourseDetail, type CourseRating } from '@patradesa/shared';
import { BlockRenderer } from '../components/BlockRenderer';
import { StarInput, StarRating } from '../components/Stars';
import { api, errorMessage } from '../lib/api';
import { Link, navigate } from '../lib/router';
import { useSession } from '../lib/session';
import { ErrorAlert, Loading, PageTitle, formatDuration, useAsync } from '../components/common';
import { Icon } from '../components/Icon';

const TYPE_LABEL = { html: 'Bacaan', slides: 'Slide', pdf: 'PDF', youtube: 'Video' } as const;
const TYPE_ICON = { html: 'book', slides: 'slides', pdf: 'file', youtube: 'play' } as const;
const RESULT_LABEL = { passed: 'Lulus', failed: 'Belum lulus', pending_review: 'Menunggu penilaian', pending: 'Diproses' } as const;

export function CoursePage({ id }: { id: string }) {
  const { me, refresh } = useSession();
  const { data, error, loading, reload } = useAsync(() => api<CourseDetail>(`/courses/${encodeURIComponent(id)}`), [id, me?.user.id]);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rated, setRated] = useState<{ rating: CourseRating; myRating: number } | null>(null);
  const [rateMsg, setRateMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Saat memuat ulang setelah aksi, tetap tampilkan data lama (hindari kedip & hilang fokus).
  if (loading && !data) return <Loading />;
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

  const rate = async (stars: number) => {
    setRateMsg(null);
    try {
      const r = await api<{ rating: CourseRating; myRating: number }>(`/courses/${data.id}/rating`, { method: 'POST', body: { stars } });
      setRated(r);
      setRateMsg({ ok: true, text: `Terima kasih! Rating Anda: ${stars} bintang.` });
    } catch (e) {
      setRateMsg({ ok: false, text: errorMessage(e) });
    }
  };
  // Kepala halaman: ringkasan; deskripsi lengkap berformat di bagian "Tentang kelas" (bila lebih dari ringkasan).
  const summary = summarize(data.description, 320);
  const descBlocks = parseContent(data.description);
  const showFullDescription = descBlocks.length > 1 || summary.endsWith('…');
  const rating = rated?.rating ?? data.rating;
  const myRating = rated?.myRating ?? data.myRating;

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
    <div className="stack-lg">
      <header className={`page-head course-head${data.coverUrl ? ' has-cover' : ''}`}>
        <div className="stack">
          <p className="eyebrow">
            <Icon name="layers" /> Kelas
          </p>
          <PageTitle>{data.title}</PageTitle>
          {summary && <p>{summary}</p>}
          <StarRating rating={rating} />
          {!data.enrolled &&
            (me ? (
              <div>
                <button type="button" className="btn btn-accent" onClick={enroll} disabled={busy}>
                  Daftar kelas ini <Icon name="arrow" />
                </button>
              </div>
            ) : (
              <div>
                <Link className="btn btn-accent" href="/masuk">
                  Masuk untuk mendaftar
                </Link>
              </div>
            ))}
        </div>
        {data.coverUrl && <img className="course-cover" src={data.coverUrl} alt="" width={640} height={400} decoding="async" fetchPriority="high" />}
      </header>
      {actionErr && (
        <div className="alert alert-error" role="alert">
          {actionErr}
        </div>
      )}
      {data.completion && (
        <div className={`alert ${data.completion.passed ? 'alert-success' : 'alert-warning'}`}>
          {data.completion.passed ? (
            <strong>Selamat, semua syarat kelulusan kelas terpenuhi.</strong>
          ) : (
            <>
              <strong>Syarat kelulusan yang belum terpenuhi:</strong>
              <ul style={{ marginBottom: 0 }}>
                {data.completion.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {showFullDescription && (
        <section aria-labelledby="tentang-judul" className="card course-about">
          <h2 id="tentang-judul">Tentang kelas</h2>
          <BlockRenderer blocks={descBlocks} />
        </section>
      )}
      <section aria-labelledby="materi-judul" className="stack">
        <h2 id="materi-judul">Materi</h2>
        <ol className="lesson-list">
          {data.lessons.map((l) => {
            const pct = l.requiredActiveSeconds ? Math.min(100, Math.round((l.activeSeconds / l.requiredActiveSeconds) * 100)) : 100;
            return (
              <li key={l.id} className="card">
                <div className="lesson-item">
                  <span className="icon-tile">
                    <Icon name={l.completed ? 'check' : TYPE_ICON[l.contentType]} />
                  </span>
                  <div className="stack">
                    <div>
                      <p className="meta" style={{ marginBottom: '0.25rem' }}>
                        <span className="step-no">{String(l.seq).padStart(2, '0')}</span>
                        <span className="badge">{TYPE_LABEL[l.contentType]}</span>
                        {l.completed && <span className="badge badge-success">Selesai</span>}
                      </p>
                      <h3 style={{ margin: 0 }}>{data.enrolled ? <Link href={`/materi/${l.id}`}>{l.title}</Link> : l.title}</h3>
                    </div>
                    {l.summary && <p className="muted" style={{ margin: 0 }}>{l.summary}</p>}
                    {data.enrolled && !l.completed && (
                      <div>
                        <p className="meta">
                          <span>
                            <Icon name="clock" /> {formatDuration(l.activeSeconds)} dari minimal {formatDuration(l.requiredActiveSeconds)} ({pct}%)
                          </span>
                        </p>
                        <div className="progress" role="img" aria-label={`Progres waktu belajar ${pct} persen`} style={{ marginTop: '0.5rem' }}>
                          <span style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                    {l.assessment && data.enrolled && (
                      <div className="card card-soft stack" style={{ padding: '1rem' }}>
                        <p style={{ margin: 0 }}>
                          <strong>
                            <Icon name="quiz" /> {l.assessment.title}
                          </strong>
                        </p>
                        <p className="meta">
                          <span>
                            <Icon name="clock" /> {Math.round(l.assessment.timeLimitSeconds / 60)} menit
                          </span>
                          <span>Nilai lulus {l.assessment.passingScorePct}%</span>
                          <span>
                            Percobaan {l.assessment.attemptsUsed}/{l.assessment.maxAttempts}
                          </span>
                          {l.assessment.bestResult && <span className="badge">{RESULT_LABEL[l.assessment.bestResult]}</span>}
                        </p>
                        <div>
                          {me?.activeAttempt?.assessmentId === l.assessment.id ? (
                            <Link className="btn btn-accent" href={`/kuis/${me.activeAttempt.id}`}>
                              Lanjutkan kuis
                            </Link>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-accent"
                              onClick={() => void startQuiz(l.assessment!.id)}
                              disabled={busy || !l.assessment.eligible || !!me?.activeAttempt}
                              aria-describedby={`kuis-${l.id}-help`}
                            >
                              {l.assessment.eligible ? null : <Icon name="lock" />}
                              Mulai Kuis
                            </button>
                          )}
                        </div>
                        <p id={`kuis-${l.id}-help`} className="help" style={{ margin: 0 }}>
                          {l.assessment.eligible
                            ? 'Waktu dihitung server sejak kuis dimulai. Pendamping AI tidak tersedia selama kuis.'
                            : l.completed
                              ? 'Kuis belum dapat dimulai (batas percobaan atau masa jeda).'
                              : 'Kuis terbuka setelah waktu belajar minimum materi ini terpenuhi.'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      {data.enrolled && (
        <section className="card card-soft stack" aria-labelledby="rating-judul">
          <h2 id="rating-judul">Bagaimana kelas ini menurut Anda?</h2>
          <p className="muted" style={{ margin: 0 }}>
            Rating membantu peserta lain memilih kelas. Anda dapat mengubahnya kapan saja.
          </p>
          <StarInput value={myRating} onChange={(v) => void rate(v)} />
          <div aria-live="polite">
            {rateMsg && (
              <p className={`alert ${rateMsg.ok ? 'alert-success' : 'alert-error'}`} style={{ margin: 0 }}>
                {rateMsg.text}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
