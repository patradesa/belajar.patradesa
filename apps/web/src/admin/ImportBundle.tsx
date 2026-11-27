import { useState } from 'react';
import { CourseBundleSchema, QUESTION_IMPORT_CHUNK, VILLAGE_ROLE_SHORT, bundleScenarioDefinitions, type CourseBundle } from '@patradesa/shared';
import { api, errorMessage } from '../lib/api';
import { Link } from '../lib/router';
import { hasRole, useSession } from '../lib/session';

/**
 * Impor paket kelas (docs/course-bundle/README.md): validasi di server, lalu impor bertahap lewat endpoint
 * yang sudah ada agar tiap permintaan kecil (batas query D1). Semua hasil berstatus draf dan privat bila tidak diatur.
 */

interface Validation {
  ok: boolean;
  problems: string[];
  warnings: string[];
  summary: { title: string; slug: string; visibility: string; targetRoles: string[]; lessons: number; quizzes: number; questions: number; scenarios: number } | null;
  scenarios: { key: string; title: string; action: 'create' | 'new_version' | 'conflict' }[];
}

type StepState = 'wait' | 'run' | 'ok' | 'fail';
interface Step {
  label: string;
  state: StepState;
  note?: string;
}

const ACTION_LABEL = { create: 'dibuat (draf)', new_version: 'versi baru (draf)', conflict: 'bentrok' } as const;

export function ImportBundle() {
  const { me } = useSession();
  const isAdmin = hasRole(me, 'admin');
  const [name, setName] = useState('');
  const [bundle, setBundle] = useState<CourseBundle | null>(null);
  const [raw, setRaw] = useState<unknown>(null);
  const [val, setVal] = useState<Validation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setBundle(null);
    setRaw(null);
    setVal(null);
    setErr(null);
    setSteps([]);
    setCourseId(null);
    setDone(false);
  };

  const pick = async (file: File | undefined) => {
    reset();
    if (!file) return;
    setName(file.name);
    setBusy(true);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('Berkas bukan JSON yang valid. Periksa tanda kurung, koma, dan tanda kutip.');
      }
      setRaw(data);
      const v = await api<Validation>('/admin/courses/import-bundle/validate', { method: 'POST', body: data });
      setVal(v);
      if (v.ok) {
        const parsed = CourseBundleSchema.safeParse(data);
        if (parsed.success) setBundle(parsed.data);
        else setErr('Paket lolos validasi server tetapi tidak terbaca di browser. Muat ulang halaman lalu coba lagi.');
      }
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!bundle || !raw) return;
    if (!window.confirm(`Impor kelas "${bundle.course.title}" sebagai draf? Kelas dan skenario belum terlihat peserta sampai diterbitkan.`)) return;
    setBusy(true);
    setErr(null);
    const defs = bundleScenarioDefinitions(bundle);
    const plan: Step[] = [
      ...defs.map((d) => ({ label: `Skenario ${d.id}`, state: 'wait' as StepState })),
      { label: `Kelas "${bundle.course.title}"`, state: 'wait' },
      ...bundle.lessons.map((l) => ({ label: `Materi ${l.title}${l.quiz ? ` + kuis (${l.quiz.questions.length} soal)` : ''}`, state: 'wait' as StepState })),
    ];
    setSteps(plan);
    let i = 0;
    const mark = (state: StepState, note?: string) => {
      plan[i] = { ...plan[i]!, state, note };
      setSteps([...plan]);
    };
    let cid: string | null = null;
    try {
      for (const d of defs) {
        mark('run');
        await api('/admin/scenarios', { method: 'POST', body: { definition: d } });
        mark('ok');
        i++;
      }
      mark('run');
      const { slug, title, description, visibility, targetRoles } = bundle.course;
      const created = await api<{ id: string }>('/admin/courses', { method: 'POST', body: { slug, title, description, visibility } });
      cid = created.id;
      setCourseId(cid);
      if (targetRoles.length) await api(`/admin/courses/${cid}`, { method: 'PATCH', body: { recommendedFor: targetRoles } });
      mark('ok');
      i++;
      for (const l of bundle.lessons) {
        mark('run');
        const { quiz, ...lesson } = l;
        const lr = await api<{ id: string }>(`/admin/courses/${cid}/lessons`, { method: 'POST', body: lesson });
        if (quiz) {
          const ar = await api<{ id: string }>(`/admin/lessons/${lr.id}/assessment`, { method: 'PUT', body: quiz.settings });
          for (let k = 0; k < quiz.questions.length; k += QUESTION_IMPORT_CHUNK) {
            mark('run', `soal ${Math.min(k + QUESTION_IMPORT_CHUNK, quiz.questions.length)}/${quiz.questions.length}`);
            await api(`/admin/assessments/${ar.id}/questions/import`, { method: 'POST', body: { questions: quiz.questions.slice(k, k + QUESTION_IMPORT_CHUNK) } });
          }
        }
        mark('ok');
        i++;
      }
      setDone(true);
    } catch (e) {
      mark('fail', errorMessage(e));
      setErr(
        `Impor berhenti di langkah "${plan[i]!.label}": ${errorMessage(e)}${cid ? ' Bagian sebelumnya sudah tersimpan sebagai draf; lanjutkan atau perbaiki lewat editor kelas.' : ''}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="impor-paket-judul">
        <h2 id="impor-paket-judul">Impor paket kelas (JSON)</h2>
        <p className="help">
          Satu berkas berisi kelas, materi, kuis, soal, dan skenario (format <code>patradesa-course-bundle-v1</code>). Paket diperiksa dulu; hasil impor
          berstatus <strong>draf</strong> dan baru terlihat peserta setelah skenario dan kelas diterbitkan.
        </p>
        <label>
          Berkas paket{' '}
          <input type="file" accept="application/json,.json" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        {busy && !steps.length && <p role="status">Memeriksa {name}…</p>}
      </section>

      {val && (
        <section className="card stack" aria-labelledby="hasil-periksa">
          <h3 id="hasil-periksa">Hasil pemeriksaan: {name}</h3>
          {val.summary && (
            <ul>
              <li>
                Kelas: <strong>{val.summary.title}</strong> (<code>{val.summary.slug}</code>, {val.summary.visibility === 'private' ? 'privat' : 'publik'})
              </li>
              <li>
                {val.summary.lessons} materi · {val.summary.quizzes} kuis · {val.summary.questions} soal · {val.summary.scenarios} skenario
              </li>
              {val.summary.targetRoles.length > 0 && (
                <li>Jabatan sasaran: {val.summary.targetRoles.map((r) => VILLAGE_ROLE_SHORT[r as keyof typeof VILLAGE_ROLE_SHORT] ?? r).join(', ')}</li>
              )}
            </ul>
          )}
          {val.problems.length > 0 && (
            <div className="alert alert-error" role="alert">
              <strong>Belum bisa diimpor ({val.problems.length}):</strong>
              <ul>
                {val.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {val.warnings.length > 0 && (
            <div className="alert alert-warning">
              <strong>Perhatian:</strong>
              <ul>
                {val.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {val.scenarios.length > 0 && (
            <details>
              <summary>Skenario dalam paket ({val.scenarios.length})</summary>
              <ul>
                {val.scenarios.map((s) => (
                  <li key={s.key}>
                    <code>{s.key}</code> — {s.title}: {ACTION_LABEL[s.action]}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {val.ok &&
            !steps.length &&
            (isAdmin ? (
              <div className="btn-row">
                <button type="button" className="btn" disabled={busy || !bundle} onClick={() => void run()}>
                  Impor sebagai draf
                </button>
              </div>
            ) : (
              <p className="muted">Paket valid. Minta admin menjalankan impor (membuat kelas khusus admin).</p>
            ))}
        </section>
      )}

      {steps.length > 0 && (
        <section className="card stack" aria-labelledby="progres-impor">
          <h3 id="progres-impor">Progres impor</h3>
          <ol className="import-steps" aria-live="polite">
            {steps.map((s, i) => (
              <li key={i} className={`import-step is-${s.state}`}>
                <span aria-hidden="true">{s.state === 'ok' ? '✓' : s.state === 'fail' ? '✕' : s.state === 'run' ? '…' : '○'}</span> {s.label}
                {s.note ? <span className="muted"> — {s.note}</span> : null}
                <span className="visually-hidden">
                  {' '}
                  ({s.state === 'ok' ? 'selesai' : s.state === 'fail' ? 'gagal' : s.state === 'run' ? 'berjalan' : 'menunggu'})
                </span>
              </li>
            ))}
          </ol>
          {done && (
            <div className="alert alert-success" role="status">
              <strong>Impor selesai.</strong> Langkah berikutnya: telaah dan terbitkan skenario di tab <Link href="/admin/skenario">Skenario</Link>, lalu tinjau
              dan terbitkan kelas di <Link href={`/admin/kelas/${courseId}`}>editor kelas</Link>.
            </div>
          )}
          {!done && !busy && courseId && (
            <p>
              <Link href={`/admin/kelas/${courseId}`}>Buka editor kelas</Link>
            </p>
          )}
        </section>
      )}
      {err && (
        <div className="alert alert-error" role="alert">
          {err}
        </div>
      )}
    </div>
  );
}
