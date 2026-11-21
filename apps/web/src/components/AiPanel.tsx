import { useState, type FormEvent } from 'react';
import { AI_LOCKED_MESSAGE } from '@patradesa/shared';
import { ApiError, api, errorMessage } from '../lib/api';

/** Panel AI tutor (dimuat lazy). Server tetap menolak dengan 423 bila ada ujian aktif. */
export default function AiPanel({ lessonId }: { lessonId: string }) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const message = String(new FormData(e.currentTarget).get('q') ?? '').trim();
    if (!message) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ mode: string; message: string }>(`/lessons/${lessonId}/ai/chat`, { method: 'POST', body: { message } });
      setAnswer(r.message);
    } catch (ex) {
      setErr(ex instanceof ApiError && ex.code === 'EXAM_LOCKED' ? AI_LOCKED_MESSAGE : errorMessage(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={ask} className="stack" data-testid="ai-panel">
      <div className="field">
        <label htmlFor="ai-q">Pertanyaan tentang materi</label>
        <textarea id="ai-q" name="q" maxLength={1000} rows={3} required />
      </div>
      <button type="submit" className="btn" disabled={busy}>
        {busy ? 'Mengirim…' : 'Tanya'}
      </button>
      <div aria-live="polite">
        {answer && <p className="card">{answer}</p>}
        {err && (
          <p className="alert alert-error" role="alert">
            {err}
          </p>
        )}
      </div>
    </form>
  );
}
