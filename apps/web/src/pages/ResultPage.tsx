import { useState, type FormEvent } from 'react';
import type { AttemptResult } from '@patradesa/shared';
import { api, errorMessage } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorAlert, Loading, PageTitle, useAsync } from '../components/common';

const STATUS = {
  passed: { text: 'Lulus', cls: 'alert-success' },
  failed: { text: 'Belum lulus', cls: 'alert-error' },
  pending_review: { text: 'Menunggu penilaian mentor', cls: 'alert-warning' },
  pending: { text: 'Sedang diproses', cls: 'alert-warning' },
} as const;

export function ResultPage({ id }: { id: string }) {
  const { refresh } = useSession();
  const { data, error, loading, reload } = useAsync(async () => {
    const r = await api<AttemptResult>(`/attempts/${id}/result`);
    void refresh(); // lock ujian sudah terlepas → perbarui status UI
    return r;
  }, [id]);
  const [appealMsg, setAppealMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (loading) return <Loading />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data) return null;
  const st = STATUS[data.resultStatus];

  const appeal = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      await api(`/attempts/${id}/appeal`, { method: 'POST', body: { reason: String(new FormData(e.currentTarget).get('reason') ?? '') } });
      setAppealMsg({ ok: true, text: 'Banding terkirim. Mentor akan meninjau.' });
      reload();
    } catch (ex) {
      setAppealMsg({ ok: false, text: errorMessage(ex) });
    }
  };

  return (
    <div className="stack prose">
      <PageTitle>Hasil kuis</PageTitle>
      <div className={`alert ${st.cls}`} role="status">
        <strong>Status: {st.text}</strong>
        {data.status === 'expired' && <p style={{ margin: 0 }}>Waktu habis; jawaban yang tersimpan telah dinilai.</p>}
      </div>
      <dl className="card">
        <dt>
          <strong>Pilihan ganda</strong>
        </dt>
        <dd>
          {data.mcqScore ?? '–'} / {data.mcqMax ?? '–'} poin
        </dd>
        {data.essayMax ? (
          <>
            <dt>
              <strong>Esai</strong>
            </dt>
            <dd>{data.essayScore === null ? 'Menunggu penilaian' : `${data.essayScore} / ${data.essayMax} poin`}</dd>
          </>
        ) : null}
        <dt>
          <strong>Nilai akhir</strong>
        </dt>
        <dd>
          {data.finalScorePct === null ? 'Belum final' : `${data.finalScorePct}%`} (batas lulus {data.passingScorePct}%)
        </dd>
      </dl>
      {data.essays.map((e) => (
        <section key={e.questionId} className="card">
          <h2>Umpan balik esai</h2>
          <p>{e.stem}</p>
          <p>
            <strong>Nilai:</strong> {e.score === null ? 'Menunggu penilaian' : `${e.score} / ${e.maxScore}`}
          </p>
          {e.feedback && (
            <p>
              <strong>Umpan balik mentor:</strong> {e.feedback}
            </p>
          )}
        </section>
      ))}
      {data.mcqReview ? (
        <section className="card" aria-labelledby="pembahasan-judul">
          <h2 id="pembahasan-judul">Pembahasan soal</h2>
          <ol className="stack">
            {data.mcqReview.map((q) => {
              const chosen = q.options.find((o) => o.chosen);
              const right = !!chosen?.correct;
              return (
                <li key={q.sequence}>
                  <p>{q.stem}</p>
                  <ul>
                    {q.options.map((o, i) => (
                      <li key={i}>
                        {o.body}
                        {o.correct && <strong> — jawaban benar</strong>}
                        {o.chosen && <span className="muted"> (pilihan Anda)</span>}
                      </li>
                    ))}
                  </ul>
                  <p>
                    <span className={right ? 'badge badge-success' : 'badge badge-danger'}>{right ? '✓ Benar' : chosen ? '✕ Kurang tepat' : '– Tidak dijawab'}</span>
                  </p>
                  {q.explanation && (
                    <p>
                      <strong>Penjelasan:</strong> {q.explanation}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ) : (
        <p className="muted">{data.reviewNote ?? 'Kunci jawaban tidak ditampilkan karena percobaan ulang mungkin diizinkan.'}</p>
      )}
      {appealMsg && (
        <div className={`alert ${appealMsg.ok ? 'alert-success' : 'alert-error'}`} role="status">
          {appealMsg.text}
        </div>
      )}
      {data.canAppeal && (
        <form className="card" onSubmit={appeal}>
          <h2>Ajukan banding nilai</h2>
          <div className="field">
            <label htmlFor="reason">Alasan banding</label>
            <textarea id="reason" name="reason" minLength={10} maxLength={2000} required />
          </div>
          <button className="btn btn-secondary" type="submit">
            Kirim banding
          </button>
        </form>
      )}
    </div>
  );
}
