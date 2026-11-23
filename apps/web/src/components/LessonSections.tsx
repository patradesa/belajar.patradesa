import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { scenarioKeys, type Block, type LessonScenarioSummary } from '@patradesa/shared';
import { BlockRenderer } from './BlockRenderer';
import { Icon } from './Icon';

/**
 * Materi bacaan dipecah per judul "## " menjadi accordion sub-materi.
 * Tanda centang:
 *  - bagian berisi skenario → selesai bila semua skenarionya pernah dikerjakan sampai akhir (data server);
 *  - bagian bacaan → "sudah dibaca" saat peserta menggulir sampai akhir bagian (disimpan di perangkat ini).
 * Centang hanya alat bantu navigasi; syarat lulus tetap dihitung server (waktu belajar, kuis, skenario dinilai).
 */

export interface LessonSection {
  title: string;
  blocks: Block[];
}

export function splitSections(blocks: Block[]): { intro: Block[]; sections: LessonSection[] } {
  const intro: Block[] = [];
  const sections: LessonSection[] = [];
  for (const b of blocks) {
    if (b.type === 'h2') sections.push({ title: b.text, blocks: [] });
    else if (sections.length) sections[sections.length - 1]!.blocks.push(b);
    else intro.push(b);
  }
  return { intro, sections };
}

const storageKey = (userId: string, lessonId: string) => `pd-dibaca:${userId}:${lessonId}`;

function loadRead(key: string): Set<number> {
  try {
    const raw = window.localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}

function saveRead(key: string, read: Set<number>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...read]));
  } catch {
    /* penyimpanan diblokir: centang hanya berlaku selama halaman terbuka */
  }
}

/** Memanggil onSeen sekali saat akhir bagian terlihat di layar. */
function EndOfSection({ onSeen }: { onSeen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !ref.current) {
      onSeen();
      return;
    }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        onSeen();
        io.disconnect();
      }
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [onSeen]);
  return <div ref={ref} aria-hidden="true" className="sec-end" />;
}

export function LessonSections({
  blocks,
  lessonId,
  userId,
  scenarios,
  renderScenario,
}: {
  blocks: Block[];
  lessonId: string;
  userId: string;
  scenarios: LessonScenarioSummary[];
  renderScenario: (key: string, onFinish: () => void) => ReactNode;
}) {
  const { intro, sections } = useMemo(() => splitSections(blocks), [blocks]);
  const key = storageKey(userId, lessonId);
  const [read, setRead] = useState<Set<number>>(() => loadRead(key));
  const [finished, setFinished] = useState<Set<string>>(() => new Set(scenarios.filter((s) => s.bestPercent !== null).map((s) => s.key)));

  const pinned = useMemo(() => new Set(scenarios.map((s) => s.key)), [scenarios]);
  const keysOf = (i: number) => scenarioKeys(sections[i]!.blocks).filter((k) => pinned.has(k));
  const isDone = (i: number) => {
    const keys = keysOf(i);
    return keys.length ? keys.every((k) => finished.has(k)) : read.has(i);
  };

  const firstOpen = sections.findIndex((_, i) => !isDone(i));
  const [open, setOpen] = useState<Set<number>>(() => new Set([firstOpen === -1 ? 0 : firstOpen]));
  // Panel yang pernah dibuka tetap terpasang (skenario tidak kehilangan langkahnya saat ditutup).
  const [mounted, setMounted] = useState<Set<number>>(() => new Set(open));

  const toggle = (i: number) => {
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
    setMounted((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
  };
  const markRead = (i: number) =>
    setRead((prev) => {
      if (prev.has(i)) return prev;
      const n = new Set(prev).add(i);
      saveRead(key, n);
      return n;
    });

  const done = sections.filter((_, i) => isDone(i)).length;
  const pct = sections.length ? Math.round((done / sections.length) * 100) : 0;
  const allOpen = open.size === sections.length;
  const scenarioRenderer = (k: string) => renderScenario(k, () => setFinished((prev) => (prev.has(k) ? prev : new Set(prev).add(k))));

  return (
    <div className="lesson-sections">
      {intro.length > 0 && <BlockRenderer blocks={intro} renderScenario={scenarioRenderer} />}
      <div className="sec-summary">
        <p className="sec-summary-text" aria-live="polite">
          <strong>
            {done} dari {sections.length} bagian selesai
          </strong>
        </p>
        <div className="progress" role="img" aria-label={`${pct} persen bagian materi selesai`}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() => {
            const all = new Set(sections.map((_, i) => i));
            setOpen(allOpen ? new Set() : all);
            if (!allOpen) setMounted(all);
          }}
        >
          {allOpen ? 'Tutup semua bagian' : 'Buka semua bagian'}
        </button>
      </div>
      {sections.map((s, i) => {
        const isOpen = open.has(i);
        const finishedSec = isDone(i);
        const hasScenario = keysOf(i).length > 0;
        const btnId = `sec-btn-${i}`;
        const panelId = `sec-panel-${i}`;
        return (
          <section key={i} className={`sec sec-${(i % 4) + 1}${finishedSec ? ' is-done' : ''}`}>
            <h2 className="sec-head">
              <button type="button" id={btnId} className="sec-toggle" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(i)}>
                <span className="sec-status">
                  <Icon name={finishedSec ? 'check' : 'circle'} className="icon sec-status-icon" />
                </span>
                <span className="sec-title">{s.title}</span>
                <span className="sec-state">{finishedSec ? (hasScenario ? 'Sudah dikerjakan' : 'Sudah dibaca') : hasScenario ? 'Ada latihan' : ''}</span>
                <Icon name="chevron" className="icon sec-chevron" />
              </button>
            </h2>
            <div id={panelId} role="region" aria-labelledby={btnId} className="sec-panel" hidden={!isOpen}>
              {mounted.has(i) && (
                <>
                  <BlockRenderer blocks={s.blocks} renderScenario={scenarioRenderer} />
                  {!hasScenario && <EndOfSection onSeen={() => markRead(i)} />}
                  {i + 1 < sections.length && (
                    <div className="sec-next">
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => {
                          if (!hasScenario) markRead(i);
                          setOpen((prev) => {
                            const n = new Set(prev);
                            n.delete(i);
                            n.add(i + 1);
                            return n;
                          });
                          setMounted((prev) => new Set(prev).add(i + 1));
                          window.requestAnimationFrame(() => document.getElementById(`sec-btn-${i + 1}`)?.focus());
                        }}
                      >
                        Lanjut ke bagian berikutnya
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
