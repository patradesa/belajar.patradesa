import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_LOCKED_MESSAGE, type AttemptQuestionView, type AttemptView } from '@patradesa/shared';
import '../styles/exam.css';
import { ApiError, api, errorMessage } from '../lib/api';
import { navigate } from '../lib/router';
import { useSession } from '../lib/session';
import { FontScaleControl } from '../components/FontScaleControl';
import { ErrorAlert, Loading } from '../components/common';
import { QuizQuestionRegion } from './QuizQuestionRegion';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type AnswerMap = Record<string, { optionKey?: string | null; essayText?: string }>;

function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Timer berbasis deadline SERVER (offset jam dikoreksi dari serverNow), bukan hitung mundur browser. */
function useServerCountdown(deadlineAt: number, serverNow: number) {
  const offset = useRef(0); // diisi di effect (bukan saat render)
  const [remaining, setRemaining] = useState(deadlineAt - serverNow);
  useEffect(() => {
    offset.current = serverNow - Date.now();
  }, [serverNow]);
  useEffect(() => {
    const t = window.setInterval(() => setRemaining(deadlineAt - (Date.now() + offset.current)), 1000);
    return () => window.clearInterval(t);
  }, [deadlineAt]);
  return remaining;
}

function ExamTimer({ attempt, onTimeUp }: { attempt: AttemptView; onTimeUp: () => void }) {
  const remaining = useServerCountdown(attempt.deadlineAt, attempt.serverNow);
  const total = attempt.deadlineAt - attempt.startedAt;
  const [announce, setAnnounce] = useState('');
  const fired = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Notifikasi 5 & 1 menit, sekali saja (tidak terlalu sering untuk pembaca layar).
    for (const [key, ms, text] of [
      ['5', 300_000, 'Sisa waktu 5 menit.'],
      ['1', 60_000, 'Sisa waktu 1 menit.'],
    ] as const) {
      if (remaining <= ms && remaining > ms - 5_000 && !fired.current.has(key)) {
        fired.current.add(key);
        setAnnounce(text);
      }
    }
    if (remaining <= 0 && !fired.current.has('end')) {
      fired.current.add('end');
      onTimeUp();
    }
  }, [remaining, onTimeUp]);
  const pctLeft = Math.max(0, Math.min(100, (remaining / total) * 100));
  return (
    <div>
      <p className={`exam-timer ${remaining < 60_000 ? 'low' : ''}`} style={{ margin: 0 }}>
        <span className="visually-hidden">Sisa waktu: </span>⏱ {fmt(remaining)}
      </p>
      <div className="progress" role="img" aria-label={`Sisa waktu ${Math.round(pctLeft)} persen`} style={{ minWidth: '8rem' }}>
        <span style={{ width: `${pctLeft}%` }} />
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  const text = { idle: '', saving: 'Menyimpan…', saved: '✓ Tersimpan', error: '⚠ Gagal tersimpan — mencoba lagi' }[state];
  return (
    <p className={`save-status ${state === 'error' ? 'error' : state === 'saved' ? 'ok' : ''}`} aria-live="polite" role="status" style={{ margin: 0 }}>
      {text}
    </p>
  );
}

function Question({
  q,
  value,
  deterrence,
  onChange,
}: {
  q: AttemptQuestionView;
  value: AnswerMap[string] | undefined;
  deterrence: boolean;
  onChange: (v: AnswerMap[string]) => void;
}) {
  const stemId = `q-${q.id}-stem`;
  if (q.type === 'mcq') {
    return (
      <div className="question" data-testid="mcq-question">
        <QuizQuestionRegion enabled={deterrence}>
          <p id={stemId} className="question-stem">
            {q.sequence}. {q.stem} <span className="muted">({q.points} poin)</span>
          </p>
          <div role="radiogroup" aria-labelledby={stemId}>
            {q.options.map((o) => (
              <label key={o.key} className="option">
                <input type="radio" name={`q-${q.id}`} value={o.key} checked={value?.optionKey === o.key} onChange={() => onChange({ optionKey: o.key })} />
                <span>{o.body}</span>
              </label>
            ))}
          </div>
        </QuizQuestionRegion>
      </div>
    );
  }
  return (
    <div className="question" data-testid="essay-question">
      <QuizQuestionRegion enabled={deterrence}>
        <p id={stemId} className="question-stem">
          {q.sequence}. {q.stem} <span className="muted">({q.points} poin, esai)</span>
        </p>
      </QuizQuestionRegion>
      {/* Area jawaban esai DI LUAR region anti-salin: bebas memilih, menyalin, menempel, mengedit. */}
      <label htmlFor={`essay-${q.id}`}>Jawaban Anda</label>
      <textarea
        id={`essay-${q.id}`}
        className="essay-answer"
        aria-describedby={stemId}
        maxLength={20000}
        value={value?.essayText ?? ''}
        onChange={(e) => onChange({ essayText: e.target.value })}
        spellCheck
      />
    </div>
  );
}

export default function ExamPage({ attemptId }: { attemptId: string }) {
  const { refresh } = useSession();
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [save, setSave] = useState<SaveState>('idle');
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef<AnswerMap>({});
  const timer = useRef<number | undefined>(undefined);

  const goResult = useCallback(() => {
    void refresh();
    navigate(`/hasil/${attemptId}`, { replace: true });
  }, [attemptId, refresh]);

  useEffect(() => {
    document.title = 'Kuis — PatraDesa Belajar';
    api<AttemptView>(`/attempts/${attemptId}`).then(
      (a) => {
        if (a.status !== 'in_progress') return goResult();
        setAttempt(a);
        const init: AnswerMap = {};
        for (const q of a.questions) if (q.answer) init[q.id] = { optionKey: q.answer.optionKey, essayText: q.answer.essayText ?? undefined };
        setAnswers(init);
      },
      (e: unknown) => setError(e),
    );
  }, [attemptId, goResult]);

  // Referensi ke versi flush terbaru (untuk retry, unmount) tanpa rekursi langsung.
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const flush = useCallback(async () => {
    const batch = pending.current;
    const ids = Object.keys(batch);
    if (!ids.length) return;
    pending.current = {};
    setSave('saving');
    try {
      await api(`/attempts/${attemptId}/answers`, {
        method: 'PATCH',
        body: { answers: ids.map((id) => ({ questionId: id, ...batch[id] })) },
      });
      setSave('saved');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ATTEMPT_CLOSED') return goResult();
      // Kembalikan ke antrean (jawaban terbaru menang) lalu coba lagi.
      pending.current = { ...batch, ...pending.current };
      setSave('error');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flushRef.current(), 5000);
    }
  }, [attemptId, goResult]);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const change = (q: AttemptQuestionView, v: AnswerMap[string]) => {
    setAnswers((a) => ({ ...a, [q.id]: v }));
    pending.current[q.id] = v;
    window.clearTimeout(timer.current);
    // MCQ disimpan segera; esai dengan debounce.
    timer.current = window.setTimeout(() => void flush(), q.type === 'mcq' ? 0 : 1500);
  };

  useEffect(() => {
    const online = () => void flush();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [flush]);

  // Saat meninggalkan halaman kuis: hentikan timer debounce dan kirim jawaban yang tertunda.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      void flushRef.current();
    },
    [],
  );

  const submit = useCallback(
    async (auto = false) => {
      if (!auto && !window.confirm('Kumpulkan jawaban sekarang? Jawaban tidak dapat diubah setelah dikumpulkan.')) return;
      setSubmitting(true);
      window.clearTimeout(timer.current);
      try {
        await flush();
        await api(`/attempts/${attemptId}/submit`, { method: 'POST' });
        goResult();
      } catch (e) {
        setSubmitting(false);
        setError(e);
      }
    },
    [attemptId, flush, goResult],
  );

  const onTimeUp = useCallback(() => void submit(true), [submit]);

  if (error && !attempt) return <ErrorAlert error={error} />;
  if (!attempt) return <Loading label="Memuat kuis…" />;
  const answered = attempt.questions.filter((q) => {
    const a = answers[q.id];
    return q.type === 'mcq' ? !!a?.optionKey : !!a?.essayText?.trim();
  }).length;

  return (
    <div className="exam-layout">
      <header className="exam-bar">
        <div className="exam-bar-inner">
          <div>
            <strong>{attempt.assessmentTitle}</strong>
            <p className="muted" style={{ margin: 0 }}>
              Terjawab {answered} dari {attempt.questions.length}
            </p>
          </div>
          <ExamTimer attempt={attempt} onTimeUp={onTimeUp} />
          <SaveStatus state={save} />
          <FontScaleControl id="exam-font" />
        </div>
      </header>
      <main id="konten" style={{ maxWidth: '48rem' }}>
        <h1 tabIndex={-1}>Kuis</h1>
        <p className="alert alert-warning" data-testid="ai-locked-notice">
          {AI_LOCKED_MESSAGE} Waktu dan nilai dihitung oleh server.
        </p>
        {error ? (
          <div className="alert alert-error" role="alert">
            {errorMessage(error)}
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
        >
          {attempt.questions.map((q) => (
            <Question key={q.id} q={q} value={answers[q.id]} deterrence={attempt.copyDeterrence} onChange={(v) => change(q, v)} />
          ))}
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? 'Mengumpulkan…' : 'Kumpulkan jawaban'}
          </button>
        </form>
      </main>
    </div>
  );
}
