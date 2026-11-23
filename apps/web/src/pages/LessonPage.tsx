import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AI_LOCKED_MESSAGE, HEARTBEAT, splitSlides, type Block, type LearningSessionResponse, type LessonContent, type LessonScenarioSummary } from '@patradesa/shared';
import { ApiError, api } from '../lib/api';
import { Link } from '../lib/router';
import { useSession } from '../lib/session';
import { BlockRenderer } from '../components/BlockRenderer';
import { ErrorAlert, Loading, PageTitle, formatDuration, useAsync } from '../components/common';

// Modul berat/opsional dimuat hanya saat diperlukan.
const YoutubeEmbed = lazy(() => import('../components/YoutubeEmbed'));
const PdfViewer = lazy(() => import('../components/PdfViewer'));
const AiPanel = lazy(() => import('../components/AiPanel'));
const ScenarioBlock = lazy(() => import('../components/ScenarioBlock'));

/** Muat chunk skenario hanya saat blok mendekati layar (hemat kuota). */
function ScenarioSlot({ summary, lessonId }: { summary: LessonScenarioSummary; lessonId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (near || !ref.current) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '400px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [near]);
  return (
    <div ref={ref} className="scn-slot">
      {near ? (
        <Suspense fallback={<Loading label="Memuat skenario…" />}>
          <ScenarioBlock summary={summary} lessonId={lessonId} />
        </Suspense>
      ) : (
        <p className="muted">Skenario: {summary.title}</p>
      )}
    </div>
  );
}

/**
 * Heartbeat: dikirim tiap ~25 dtk HANYA bila tab tampak dan ada interaksi dalam 60 dtk terakhir.
 * Klien tidak pernah mengirim durasi; server menghitung kredit dari jamnya sendiri.
 */
function useLearningSession(lessonId: string) {
  const [state, setState] = useState<LearningSessionResponse | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lastInteraction = useRef(0);

  const start = useCallback(async () => {
    try {
      setExpired(false);
      setState(await api<LearningSessionResponse>(`/lessons/${lessonId}/session`, { method: 'POST' }));
    } catch (e) {
      setError(e);
    }
  }, [lessonId]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    const mark = () => {
      lastInteraction.current = Date.now();
    };
    mark(); // membuka materi dihitung sebagai interaksi awal
    const evts = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const;
    evts.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    return () => evts.forEach((e) => window.removeEventListener(e, mark));
  }, []);

  useEffect(() => {
    if (!state || expired) return;
    const t = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastInteraction.current > HEARTBEAT.clientIdleMs) return;
      try {
        const r = await api<LearningSessionResponse>(`/lessons/${lessonId}/heartbeat`, {
          method: 'POST',
          body: { sessionId: state.sessionId, visible: true, interacted: true },
        });
        setState(r);
      } catch (e) {
        if (e instanceof ApiError && e.status === 410) setExpired(true);
      }
    }, HEARTBEAT.clientIntervalMs);
    return () => window.clearInterval(t);
  }, [state, expired, lessonId]);

  return { state, expired, error, restart: start };
}

function SlideDeck({ blocks, renderScenario }: { blocks: Block[]; renderScenario?: (key: string) => ReactNode }) {
  const slides = splitSlides(blocks);
  const [i, setI] = useState(0);
  const cur = slides[i] ?? [];
  return (
    <section aria-roledescription="presentasi" aria-label="Slide materi" className="card">
      <div className="slide" aria-live="polite">
        <p className="muted">
          Slide {i + 1} dari {slides.length}
        </p>
        <BlockRenderer blocks={cur} renderScenario={renderScenario} />
      </div>
      <div className="btn-row">
        <button type="button" className="btn btn-secondary" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}>
          ← Sebelumnya
        </button>
        <button type="button" className="btn" onClick={() => setI((x) => Math.min(slides.length - 1, x + 1))} disabled={i >= slides.length - 1}>
          Berikutnya →
        </button>
      </div>
    </section>
  );
}

export function LessonPage({ id }: { id: string }) {
  const { me } = useSession();
  const { data, error, loading, reload } = useAsync(() => api<LessonContent>(`/lessons/${id}/content`), [id]);
  const session = useLearningSession(id);
  const [aiOpen, setAiOpen] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data) return null;
  const s = session.state;
  const pct = s && s.requiredActiveSeconds ? Math.min(100, Math.round((s.activeSeconds / s.requiredActiveSeconds) * 100)) : 100;
  const examActive = !!me?.activeAttempt;
  const renderScenario = (key: string) => {
    const summary = (data.scenarios ?? []).find((x) => x.key === key);
    return summary ? <ScenarioSlot summary={summary} lessonId={data.id} /> : null;
  };

  return (
    <div className="stack">
      <p>
        <Link href={`/kelas/${data.courseId}`}>← Kembali ke kelas</Link>
      </p>
      <PageTitle>{data.title}</PageTitle>
      <div className="reader-layout">
        <article className="stack">
          {data.contentType === 'slides' ? (
            <SlideDeck blocks={data.blocks} renderScenario={renderScenario} />
          ) : (
            <BlockRenderer blocks={data.blocks} renderScenario={renderScenario} />
          )}
          {data.contentType === 'youtube' && data.youtubeId && (
            <Suspense fallback={<Loading />}>
              <YoutubeEmbed videoId={data.youtubeId} title={data.title} />
            </Suspense>
          )}
          {data.contentType === 'pdf' && data.fileUrl && (
            <Suspense fallback={<Loading />}>
              <PdfViewer url={data.fileUrl} title={data.title} />
            </Suspense>
          )}
        </article>
        <aside className="stack" aria-label="Progres dan bantuan belajar">
          <section className="card" aria-labelledby="progres-judul">
            <h2 id="progres-judul">Progres belajar</h2>
            {s ? (
              <>
                <p aria-live="polite">
                  {s.completed ? (
                    <span className="badge badge-success">✓ Syarat waktu belajar terpenuhi</span>
                  ) : (
                    <>
                      Tercatat {formatDuration(s.activeSeconds)} dari minimal {formatDuration(s.requiredActiveSeconds)}.
                    </>
                  )}
                </p>
                <div className="progress" role="img" aria-label={`Progres waktu belajar ${pct} persen`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <p className="help">Waktu hanya dihitung saat halaman ini terbuka dan Anda aktif membaca.</p>
              </>
            ) : session.error ? (
              <ErrorAlert error={session.error} onRetry={() => void session.restart()} />
            ) : (
              <Loading />
            )}
            {session.expired && (
              <div className="alert alert-warning" role="status">
                Sesi belajar berakhir.{' '}
                <button type="button" className="btn btn-secondary" onClick={() => void session.restart()}>
                  Lanjutkan belajar
                </button>
              </div>
            )}
          </section>
          {examActive ? (
            <p className="alert alert-warning">{AI_LOCKED_MESSAGE}</p>
          ) : (
            <section className="card" aria-labelledby="ai-judul">
              <h2 id="ai-judul">Pendamping AI</h2>
              {aiOpen ? (
                <Suspense fallback={<Loading />}>
                  <AiPanel lessonId={data.id} />
                </Suspense>
              ) : (
                <>
                  <p className="muted">Bertanya seputar materi ini. Jawaban hanya berdasarkan materi yang disetujui.</p>
                  <button type="button" className="btn btn-secondary" onClick={() => setAiOpen(true)} data-testid="ai-open">
                    Buka Pendamping AI
                  </button>
                </>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
