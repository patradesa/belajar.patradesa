import { useState } from 'react';
import { api } from '../lib/api';

type Row = Record<string, unknown>;

/**
 * Bank soal satu kuis + pilihan soal yang dipakai kuis.
 * Kuis mengundi `mcq_count` PG + `essay_count` esai secara acak dari soal yang DIPAKAI (dicentang).
 * Di versi terbit: hanya-baca.
 */
export function QuestionBank({
  assessment,
  editable,
  act,
}: {
  assessment: Row;
  editable: boolean;
  act: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
}) {
  const qs = assessment.questions as Row[];
  const keyOf = (ids: Iterable<string>) => [...ids].sort().join(',');
  const initial = () => new Set(qs.filter((q) => Number(q.in_quiz ?? 1) === 1).map((q) => String(q.id)));
  const propKey = keyOf(initial());
  const [selected, setSelected] = useState<Set<string>>(initial);
  // `saved` = pilihan yang diketahui tersimpan di server (dari data terakhir ATAU dari simpan yang baru berhasil).
  const [saved, setSaved] = useState(propKey);
  const [seenProp, setSeenProp] = useState(propKey);
  const dirty = keyOf(selected) !== saved;
  // Data dimuat ulang (mis. setelah impor/simpan). Pilihan lokal hanya diganti bila server memang berbeda dari yang
  // kita ketahui DAN admin tidak sedang mengubah centang — perubahan yang dibuat selama pemuatan ulang tidak hilang.
  if (propKey !== seenProp) {
    setSeenProp(propKey);
    if (propKey !== saved) {
      setSaved(propKey);
      if (!dirty) setSelected(initial());
    }
  }

  const mcqs = qs.filter((q) => q.type === 'mcq');
  const essays = qs.filter((q) => q.type === 'essay');
  const usedMcq = mcqs.filter((q) => selected.has(String(q.id))).length;
  const usedEssay = essays.filter((q) => selected.has(String(q.id))).length;
  const needMcq = Number(assessment.mcq_count);
  const needEssay = Number(assessment.essay_count);
  const short = usedMcq < needMcq || usedEssay < needEssay;
  const aid = String(assessment.id);

  const setGroup = (group: Row[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const q of group) {
        if (on) next.add(String(q.id));
        else next.delete(String(q.id));
      }
      return next;
    });
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const save = async () => {
    const sent = keyOf(selected);
    const ok = await act(
      () =>
        api(`/admin/assessments/${aid}/questions/selection`, {
          method: 'POST',
          body: { ids: [...selected] },
        }),
      `Pilihan soal kuis tersimpan: ${usedMcq} pilihan ganda, ${usedEssay} esai.`,
    );
    if (ok) setSaved(sent);
  };

  const group = (title: string, list: Row[], used: number, key: string) => (
    <fieldset className="stack" style={{ margin: 0 }}>
      <legend>
        <strong>
          {title}: {used} dari {list.length} dipakai
        </strong>
      </legend>
      {editable && list.length > 0 && (
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={() => setGroup(list, true)}>
            Pakai semua {key}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setGroup(list, false)}>
            Keluarkan semua {key}
          </button>
        </div>
      )}
      <ol className="question-pick">
        {list.map((q) => {
          const id = String(q.id);
          const meta = `${String(q.topic)} · tingkat ${String(q.difficulty)} · ${String(q.points)} poin`;
          return (
            <li key={id}>
              {editable ? (
                <label className="check">
                  <input type="checkbox" checked={selected.has(id)} onChange={(e) => toggle(id, e.target.checked)} />
                  <span>
                    {String(q.stem)} <span className="muted">({meta})</span>
                  </span>
                </label>
              ) : (
                <span>
                  {selected.has(id) ? '✓ ' : '– '}
                  {String(q.stem)} <span className="muted">({meta})</span>
                </span>
              )}
              {editable && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() =>
                    window.confirm('Hapus soal ini dari bank? (Riwayat kuis lama tetap tersimpan.)') &&
                    void act(() => api(`/admin/questions/${id}`, { method: 'DELETE' }), 'Soal dihapus dari bank.')
                  }
                >
                  Hapus
                  <span className="visually-hidden"> soal: {String(q.stem).slice(0, 60)}</span>
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </fieldset>
  );

  return (
    <section className="stack" aria-label="Bank soal dan pilihan soal kuis">
      <h4 style={{ margin: 0 }}>
        Bank soal: {mcqs.length} pilihan ganda, {essays.length} esai
      </h4>
      <p className={short ? 'alert alert-warning' : 'help'} style={{ margin: 0 }} role={short ? 'status' : undefined}>
        Setiap peserta mendapat{' '}
        <strong>
          {needMcq} pilihan ganda + {needEssay} esai
        </strong>{' '}
        yang diacak dari soal yang <strong>dipakai</strong> (dicentang) — saat ini {usedMcq} PG dan {usedEssay} esai dipakai.
        {short ? ' Soal yang dipakai belum cukup: centang lebih banyak soal atau kurangi jumlah soal di pengaturan kuis.' : ''}
      </p>
      {!editable && (
        <p className="help" style={{ margin: 0 }}>
          Versi terbit hanya-baca. Klik “Buat draft versi baru” untuk mengubah pilihan soal.
        </p>
      )}
      <details open={editable && qs.length > 0 && qs.length <= 20}>
        <summary>
          {editable ? 'Pilih soal yang dipakai kuis' : 'Lihat daftar soal'} ({qs.length})
        </summary>
        <div className="stack" style={{ marginTop: '0.75rem' }}>
          {group('Pilihan ganda', mcqs, usedMcq, 'PG')}
          {group('Esai', essays, usedEssay, 'esai')}
        </div>
      </details>
      {editable && (
        <div className="btn-row" aria-live="polite">
          <button type="button" className="btn" onClick={() => void save()} disabled={!dirty}>
            Simpan pilihan soal kuis
          </button>
          {dirty && <span className="help">Ada perubahan yang belum disimpan.</span>}
        </div>
      )}
    </section>
  );
}
