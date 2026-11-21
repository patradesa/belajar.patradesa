import { useState, type ChangeEvent } from 'react';
import { QUESTION_IMPORT_CHUNK, questionBankFileSchema, type QuestionCreate } from '@patradesa/shared';
import { api, errorMessage } from '../lib/api';

/**
 * Impor bank soal dari berkas JSON (format: { "questions": [ … ] }, lihat docs/kelas).
 * Validasi lengkap di browser lebih dulu, lalu dikirim per QUESTION_IMPORT_CHUNK soal; server memvalidasi ulang.
 */
export function ImportQuestions({ assessmentId, existingCount, onDone }: { assessmentId: string; existingCount: number; onDone: () => void }) {
  const [parsed, setParsed] = useState<QuestionCreate[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    setParsed(null);
    setErrors([]);
    setStatus('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setErrors(['Berkas terlalu besar (maks 2 MB).']);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setErrors(['Berkas bukan JSON yang valid.']);
      return;
    }
    const r = questionBankFileSchema.safeParse(raw);
    if (!r.success) {
      setErrors(
        r.error.issues.slice(0, 15).map((i) => {
          const [, idx, ...rest] = i.path;
          return typeof idx === 'number' ? `Soal ke-${idx + 1}${rest.length ? ` (${rest.join('.')})` : ''}: ${i.message}` : `${i.path.join('.') || 'berkas'}: ${i.message}`;
        }),
      );
      return;
    }
    setParsed(r.data.questions);
  };

  const run = async () => {
    if (!parsed) return;
    setBusy(true);
    let done = 0;
    try {
      for (let i = 0; i < parsed.length; i += QUESTION_IMPORT_CHUNK) {
        const chunk = parsed.slice(i, i + QUESTION_IMPORT_CHUNK);
        await api(`/admin/assessments/${assessmentId}/questions/import`, { method: 'POST', body: { questions: chunk } });
        done += chunk.length;
        setStatus(`Mengimpor… ${done}/${parsed.length}`);
      }
      setStatus(`Selesai: ${done} soal ditambahkan ke bank.`);
      setParsed(null);
      onDone();
    } catch (e) {
      setStatus(`Berhenti di soal ke-${done + 1}: ${errorMessage(e)}. ${done} soal sudah tersimpan; impor ulang hanya sisa soal agar tidak ganda.`);
    } finally {
      setBusy(false);
    }
  };

  const mcq = parsed?.filter((q) => q.type === 'mcq').length ?? 0;
  const essay = (parsed?.length ?? 0) - mcq;
  const inputId = `import-${assessmentId}`;

  return (
    <details className="card card-soft">
      <summary>
        <strong>Impor bank soal dari berkas JSON</strong>
      </summary>
      <div className="stack" style={{ marginTop: '0.75rem' }}>
        <p className="help" style={{ margin: 0 }}>
          Format: <code>{'{ "questions": [ … ] }'}</code> — satu objek per soal (pilihan ganda dengan tepat satu jawaban benar, atau esai dengan
          rubrik). Berkas berisi kunci jawaban: simpan secara privat.
        </p>
        {existingCount > 0 && (
          <p className="alert alert-warning" style={{ margin: 0 }}>
            Bank ini sudah berisi {existingCount} soal. Impor akan <strong>menambah</strong>, bukan mengganti.
          </p>
        )}
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor={inputId}>Pilih berkas .json</label>
          <input id={inputId} type="file" accept="application/json,.json" onChange={(e) => void onFile(e)} disabled={busy} />
        </div>
        {errors.length > 0 && (
          <div className="alert alert-error" role="alert">
            <strong>Berkas belum dapat diimpor:</strong>
            <ul style={{ marginBottom: 0 }}>
              {errors.map((er) => (
                <li key={er}>{er}</li>
              ))}
            </ul>
          </div>
        )}
        {parsed && (
          <div className="alert alert-success" role="status">
            Berkas valid: <strong>{parsed.length} soal</strong> ({mcq} pilihan ganda, {essay} esai).
          </div>
        )}
        {parsed && (
          <div>
            <button type="button" className="btn" onClick={() => void run()} disabled={busy}>
              Impor {parsed.length} soal
            </button>
          </div>
        )}
        <p aria-live="polite" className="help" style={{ margin: 0 }}>
          {status}
        </p>
      </div>
    </details>
  );
}
