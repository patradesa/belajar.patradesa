import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LessonScenarioSummary, ScenarioChoiceResponse, ScenarioDelivery, ScenarioVerdict } from '@patradesa/shared';
import { api, errorMessage } from '../lib/api';
import { Link } from '../lib/router';

/**
 * Blok Skenario Bercabang untuk peserta (docs/scenario-block/README.md §8).
 * Dimuat lazy. Satu node per layar; kunci & skor hanya diketahui server.
 * Teks memakai Markdown terbatas (**tebal**, *miring*, daftar) — dirender sebagai text node, tanpa HTML.
 */

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] !== undefined ? <strong key={k++}>{m[1]}</strong> : <em key={k++}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <>
      {text.split(/\n\s*\n/).map((para, i) => {
        const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length && lines.every((l) => /^[-*]\s+/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^[-*]\s+/, ''))}</li>)}</ul>;
        }
        if (lines.length && lines.every((l) => /^\d+[.)]\s+/.test(l))) {
          return <ol key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\d+[.)]\s+/, ''))}</li>)}</ol>;
        }
        return <p key={i}>{inline(lines.join(' '))}</p>;
      })}
    </>
  );
}

const VERDICT_CLASS: Record<ScenarioVerdict, string> = {
  best: 'badge badge-success',
  acceptable: 'badge',
  risky: 'badge badge-warning',
  wrong: 'badge badge-danger',
};
const VERDICT_ICON: Record<ScenarioVerdict, string> = { best: '✓', acceptable: '≈', risky: '!', wrong: '✕' };

function Verdict({ verdict, label }: { verdict: ScenarioVerdict; label: string }) {
  return (
    <span className={VERDICT_CLASS[verdict]}>
      <span aria-hidden="true">{VERDICT_ICON[verdict]}</span> {label}
    </span>
  );
}

function Intro({ s, onStart, busy }: { s: LessonScenarioSummary; onStart: () => void; busy: boolean }) {
  const left = s.maxAttempts - s.attemptsUsed;
  const label = s.activeAttemptId ? 'Lanjutkan skenario' : s.attemptsUsed ? 'Coba lagi' : 'Mulai skenario';
  return (
    <>
      <p className="muted">
        ± {s.estimatedMinutes} menit · {s.mode === 'graded' ? 'Dinilai (syarat lulus kelas)' : 'Latihan (tidak dinilai)'} · Berlaku per {s.validFrom}
      </p>
      <p>{s.summary}</p>
      {s.bestPercent !== null && (
        <p>
          Hasil terbaik Anda: <strong>{s.bestPercent}%</strong> {s.passed && <span className="badge badge-success">✓ Lulus</span>}
        </p>
      )}
      {left > 0 || s.activeAttemptId ? (
        <button type="button" className="btn" onClick={onStart} disabled={busy}>
          {busy ? 'Memuat…' : label}
        </button>
      ) : (
        <p className="muted">Kesempatan mencoba sudah habis ({s.maxAttempts}×).</p>
      )}
    </>
  );
}

export default function ScenarioBlock({ summary, lessonId }: { summary: LessonScenarioSummary; lessonId: string }) {
  const [s, setS] = useState(summary);
  const [d, setD] = useState<ScenarioDelivery | null>(null);
  const [result, setResult] = useState<ScenarioChoiceResponse | null>(null);
  const [pending, setPending] = useState<{ nodeId: string; optionKey?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const titleId = `skenario-${s.key}`;

  const nodeId = d?.node?.id;
  useEffect(() => {
    if (nodeId) headRef.current?.focus();
  }, [nodeId, result]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const del = s.activeAttemptId
        ? await api<ScenarioDelivery>(`/scenario-attempts/${s.activeAttemptId}`)
        : await api<ScenarioDelivery>(`/scenarios/${s.blockId}/attempts`, { method: 'POST', body: { lessonId } });
      setD(del);
      setResult(null);
      setS((x) => ({ ...x, activeAttemptId: del.attempt.status === 'in_progress' ? del.attempt.id : null }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /** Kirim pilihan; aman diulang bila sinyal putus (server idempoten). */
  const send = async (p: { nodeId: string; optionKey?: string }) => {
    if (!d) return;
    setPending(p);
    setBusy(true);
    setError(null);
    try {
      const body = p.optionKey ? { nodeId: p.nodeId, optionKey: p.optionKey } : { nodeId: p.nodeId, continue: true };
      const r = await api<ScenarioChoiceResponse>(`/scenario-attempts/${d.attempt.id}/choices`, { method: 'POST', body });
      setPending(null);
      if (r.result) setResult(r);
      else setD(r.delivery);
      if (r.delivery.final) {
        const f = r.delivery.final;
        setS((x) => ({
          ...x,
          activeAttemptId: null,
          attemptsUsed: x.maxAttempts - f.attemptsLeft,
          bestPercent: Math.max(x.bestPercent ?? 0, f.percent),
          passed: x.passed || f.passed,
        }));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (result) setD(result.delivery);
    setResult(null);
  };

  let body: ReactNode;
  if (!d) {
    body = <Intro s={s} onStart={() => void start()} busy={busy} />;
  } else if (result) {
    const r = result.result!;
    body = (
      <div className="scn-feedback">
        <p>
          <Verdict verdict={r.verdict} label={r.label} />
        </p>
        <RichText text={r.feedback} />
        <button type="button" className="btn" onClick={next}>
          {result.delivery.final ? 'Lihat hasil' : 'Lanjut'}
        </button>
      </div>
    );
  } else if (d.final) {
    const f = d.final;
    body = (
      <div className="stack">
        <p className="scn-score">
          <strong>{f.percent}%</strong> ({f.score} dari {f.maxScore} poin) · <span className={f.passed ? 'badge badge-success' : 'badge'}>{f.band.label}</span>
        </p>
        <RichText text={f.band.message} />
        {d.node?.body && <RichText text={d.node.body} />}
        <h4>Poin bawa pulang</h4>
        <ul>
          {f.takeaways.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
        {f.remedial && (f.remedial.lessonId ? <Link href={`/materi/${f.remedial.lessonId}`}>{f.remedial.label}</Link> : <p className="muted">{f.remedial.label}</p>)}
        <details>
          <summary>Tinjau pilihan Anda ({d.history.length})</summary>
          <ol>
            {d.history.map((h) => (
              <li key={h.nodeId}>
                {h.optionText} — <Verdict verdict={h.verdict} label={h.label} />
              </li>
            ))}
          </ol>
        </details>
        <div className="btn-row">
          {f.attemptsLeft > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setD(null);
              }}
            >
              Coba lagi ({f.attemptsLeft} kesempatan)
            </button>
          )}
        </div>
      </div>
    );
  } else if (d.node) {
    const n = d.node;
    const step = d.block.decisionCount;
    body = (
      <div className="stack">
        {n.type === 'decision' && (
          <p className="muted">
            Keputusan {step.done + 1} dari {step.maxOnPath}
          </p>
        )}
        <RichText text={n.body} />
        {n.type === 'decision' ? (
          <fieldset className="scn-options" disabled={busy}>
            <legend>
              <strong>{n.prompt}</strong>
            </legend>
            {n.options.map((o) => (
              <button key={o.key} type="button" className="btn btn-secondary scn-option" onClick={() => void send({ nodeId: n.id, optionKey: o.key })}>
                {o.text}
              </button>
            ))}
          </fieldset>
        ) : (
          <button type="button" className="btn" onClick={() => void send({ nodeId: n.id })} disabled={busy}>
            Lanjut
          </button>
        )}
      </div>
    );
  }

  const heading = !d ? s.title : result ? 'Umpan balik' : d.final ? 'Hasil skenario' : (d.node?.title ?? s.title);
  return (
    <section className="card scn" aria-labelledby={titleId}>
      <p className="eyebrow">Skenario {s.mode === 'graded' ? '· dinilai' : '· latihan'}</p>
      <h3 id={titleId} ref={headRef} tabIndex={-1}>
        {heading}
      </h3>
      {s.needsLocalValidation && <p className="alert alert-warning">Cek SOP desa/Disdukcapil setempat. Prosedur bisa berbeda antardaerah.</p>}
      <div aria-live="polite">{body}</div>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}{' '}
          {pending && (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void send(pending)}>
              Kirim ulang
            </button>
          )}
        </div>
      )}
    </section>
  );
}
