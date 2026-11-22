import { useState, type FormEvent } from 'react';
import { VILLAGE_ROLES, VILLAGE_ROLE_LABELS } from '@patradesa/shared';
import { api } from '../lib/api';
import { hasRole, useSession } from '../lib/session';
import { ErrorAlert, Loading, useAsync } from '../components/common';
import { useAction } from './useAction';
import { ImportQuestions } from './ImportQuestions';
import { QuestionBank } from './QuestionBank';

type Row = Record<string, any>;

const toLocal = (ms: number | null | undefined) => {
  if (!ms) return '';
  const d = new Date(ms);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: FormDataEntryValue | null) => (v && String(v) ? new Date(String(v)).getTime() : null);
const num = (v: FormDataEntryValue | null) => Number(v ?? 0);

function LessonForm({ lesson, onSave, submitLabel }: { lesson?: Row; onSave: (body: unknown) => Promise<void>; submitLabel: string }) {
  const pre = lesson?.id ?? 'new';
  const [type, setType] = useState<string>(lesson?.content_type ?? 'html');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await onSave({
          title: String(f.get('title')),
          summary: String(f.get('summary') ?? ''),
          contentType: type,
          contentSource: String(f.get('contentSource') ?? ''),
          youtube: type === 'youtube' ? String(f.get('youtube') ?? '') : null,
          requiredActiveSeconds: num(f.get('required')) * 60,
          isRequired: f.get('isRequired') === 'on',
        });
      }}
    >
      <div className="field">
        <label htmlFor={`${pre}-title`}>Judul materi</label>
        <input id={`${pre}-title`} name="title" type="text" required maxLength={160} defaultValue={lesson?.title ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`${pre}-summary`}>Ringkasan</label>
        <input id={`${pre}-summary`} name="summary" type="text" maxLength={500} defaultValue={lesson?.summary ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`${pre}-type`}>Jenis</label>
        <select id={`${pre}-type`} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="html">Bacaan</option>
          <option value="slides">Slide</option>
          <option value="pdf">PDF (unggah setelah disimpan)</option>
          <option value="youtube">Video YouTube</option>
        </select>
      </div>
      {type === 'youtube' && (
        <div className="field">
          <label htmlFor={`${pre}-yt`}>Tautan atau ID YouTube</label>
          <input id={`${pre}-yt`} name="youtube" type="text" required defaultValue={lesson?.youtube_id ?? ''} />
        </div>
      )}
      <div className="field">
        <label htmlFor={`${pre}-src`}>Isi materi / pengantar</label>
        <textarea id={`${pre}-src`} name="contentSource" rows={10} maxLength={60000} defaultValue={lesson?.content_source ?? ''} aria-describedby={`${pre}-src-help`} />
        <span id={`${pre}-src-help`} className="help">
          Format: “## Judul”, “### Subjudul”, “- butir”, “1. butir”, “&gt; catatan”, “---” pemisah slide, **tebal**, [teks](https://…). HTML
          tidak diizinkan.
        </span>
      </div>
      <div className="field">
        <label htmlFor={`${pre}-req`}>Waktu belajar minimum (menit)</label>
        <input id={`${pre}-req`} name="required" type="number" min={0} max={600} defaultValue={Math.round((lesson?.required_active_seconds ?? 300) / 60)} />
      </div>
      <label className="check">
        <input type="checkbox" name="isRequired" defaultChecked={lesson ? lesson.is_required === 1 : true} /> Materi wajib
      </label>
      <button className="btn" type="submit">
        {submitLabel}
      </button>
    </form>
  );
}

function AssessmentForm({ lesson, onSave }: { lesson: Row; onSave: (body: unknown) => Promise<void> }) {
  const a = lesson.assessment as Row | null;
  const pre = `as-${String(lesson.id)}`;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await onSave({
          title: String(f.get('title')),
          instructions: String(f.get('instructions') ?? ''),
          timeLimitSeconds: num(f.get('minutes')) * 60,
          passingScorePct: num(f.get('passing')),
          maxAttempts: num(f.get('maxAttempts')),
          cooldownSeconds: num(f.get('cooldown')) * 60,
          mcqCount: num(f.get('mcqCount')),
          essayCount: num(f.get('essayCount')),
          graceSeconds: num(f.get('grace')),
          isRequired: f.get('isRequired') === 'on',
          examCopyDeterrenceEnabled: f.get('copy') === 'on',
          accessibilityExemptionPolicy: f.get('exempt') === 'on' ? 'per_user' : 'none',
          hideLessonLinksDuringExam: true,
        });
      }}
    >
      <div className="grid">
        <div className="field">
          <label htmlFor={`${pre}-title`}>Judul kuis</label>
          <input id={`${pre}-title`} name="title" type="text" required defaultValue={a?.title ?? `Kuis ${String(lesson.title)}`} />
        </div>
        <div className="field">
          <label htmlFor={`${pre}-min`}>Batas waktu (menit)</label>
          <input id={`${pre}-min`} name="minutes" type="number" min={1} max={240} defaultValue={Math.round((a?.time_limit_seconds ?? 900) / 60)} />
        </div>
        <div className="field">
          <label htmlFor={`${pre}-pass`}>Nilai lulus (%)</label>
          <input id={`${pre}-pass`} name="passing" type="number" min={0} max={100} defaultValue={a?.passing_score_pct ?? 70} />
        </div>
        <div className="field">
          <label htmlFor={`${pre}-max`}>Maks. percobaan</label>
          <input id={`${pre}-max`} name="maxAttempts" type="number" min={1} max={20} defaultValue={a?.max_attempts ?? 3} />
        </div>
        <div className="field">
          <label htmlFor={`${pre}-cd`}>Jeda antar percobaan (menit)</label>
          <input id={`${pre}-cd`} name="cooldown" type="number" min={0} max={10080} defaultValue={Math.round((a?.cooldown_seconds ?? 0) / 60)} />
        </div>
        <div className="field">
          <label htmlFor={`${pre}-grace`}>Toleransi jaringan (detik)</label>
          <input id={`${pre}-grace`} name="grace" type="number" min={0} max={120} defaultValue={a?.grace_seconds ?? 20} />
        </div>
        <div className="field">
          <label htmlFor={`${pre}-mcq`}>Jumlah soal PG ditampilkan</label>
          <input id={`${pre}-mcq`} name="mcqCount" type="number" min={0} max={100} defaultValue={a?.mcq_count ?? 10} />
        </div>
        <div className="field">
          <label htmlFor={`${pre}-essay`}>Jumlah soal esai ditampilkan</label>
          <input id={`${pre}-essay`} name="essayCount" type="number" min={0} max={10} defaultValue={a?.essay_count ?? 0} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${pre}-ins`}>Instruksi</label>
        <textarea id={`${pre}-ins`} name="instructions" rows={2} defaultValue={a?.instructions ?? ''} />
      </div>
      <label className="check">
        <input type="checkbox" name="isRequired" defaultChecked={a ? a.is_required === 1 : true} /> Kuis wajib untuk kelulusan
      </label>
      <label className="check">
        <input type="checkbox" name="copy" defaultChecked={a ? a.exam_copy_deterrence_enabled === 1 : true} /> Aktifkan penghalang salin/klik
        kanan pada soal (kuis resmi)
      </label>
      <label className="check">
        <input type="checkbox" name="exempt" defaultChecked={a ? a.accessibility_exemption_policy === 'per_user' : true} /> Hormati akomodasi
        aksesibilitas per peserta
      </label>
      <p className="help">Pendamping AI selalu dinonaktifkan selama kuis dan tidak dapat diubah.</p>
      <button className="btn" type="submit">
        Simpan pengaturan kuis
      </button>
    </form>
  );
}

function QuestionForm({ onSave }: { onSave: (body: unknown) => Promise<boolean> }) {
  const [type, setType] = useState<'mcq' | 'essay'>('mcq');
  const [key, setKey] = useState(0);
  return (
    <form
      key={key}
      onSubmit={async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const base = { stem: String(f.get('stem')), topic: String(f.get('topic') || 'umum'), difficulty: num(f.get('difficulty')) || 2 };
        const body =
          type === 'mcq'
            ? {
                type,
                ...base,
                points: 1,
                options: [0, 1, 2, 3]
                  .map((i) => ({ body: String(f.get(`o${i}`) ?? '').trim(), isCorrect: String(f.get('correct')) === String(i) }))
                  .filter((o) => o.body),
              }
            : {
                type,
                ...base,
                points: num(f.get('points')) || 10,
                modelAnswer: String(f.get('model') ?? ''),
                rubric: String(f.get('rubric') ?? '')
                  .split('\n')
                  .map((l) => l.split('|'))
                  .filter((p) => p[0]?.trim())
                  .map((p) => ({ criterion: p[0]!.trim(), maxScore: Number(p[1] ?? 10) })),
              };
        if (await onSave(body)) setKey((k) => k + 1);
      }}
    >
      <fieldset>
        <legend>Tipe soal</legend>
        <label className="check">
          <input type="radio" name="qtype" checked={type === 'mcq'} onChange={() => setType('mcq')} /> Pilihan ganda
        </label>
        <label className="check">
          <input type="radio" name="qtype" checked={type === 'essay'} onChange={() => setType('essay')} /> Esai
        </label>
      </fieldset>
      <div className="field">
        <label htmlFor="q-stem">Pertanyaan</label>
        <textarea id="q-stem" name="stem" required minLength={5} rows={3} />
      </div>
      <div className="grid">
        <div className="field">
          <label htmlFor="q-topic">Topik</label>
          <input id="q-topic" name="topic" type="text" defaultValue="umum" />
        </div>
        <div className="field">
          <label htmlFor="q-diff">Tingkat kesulitan (1–3)</label>
          <input id="q-diff" name="difficulty" type="number" min={1} max={3} defaultValue={2} />
        </div>
      </div>
      {type === 'mcq' ? (
        <fieldset>
          <legend>Pilihan jawaban (pilih satu yang benar)</legend>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="btn-row field">
              <label className="check" htmlFor={`q-c${i}`}>
                <input id={`q-c${i}`} type="radio" name="correct" value={i} required defaultChecked={i === 0} />
                <span className="visually-hidden">Pilihan {i + 1} benar</span>
              </label>
              <label htmlFor={`q-o${i}`} className="visually-hidden">
                Pilihan {i + 1}
              </label>
              <input id={`q-o${i}`} name={`o${i}`} type="text" placeholder={`Pilihan ${i + 1}`} required={i < 2} style={{ flex: 1, minWidth: '12rem' }} />
            </div>
          ))}
        </fieldset>
      ) : (
        <>
          <div className="field">
            <label htmlFor="q-points">Poin</label>
            <input id="q-points" name="points" type="number" min={1} max={100} defaultValue={10} />
          </div>
          <div className="field">
            <label htmlFor="q-rubric">Rubrik (satu kriteria per baris: “Kriteria|skor maks”)</label>
            <textarea id="q-rubric" name="rubric" rows={4} required defaultValue={'Ketepatan konsep|40\nPenerapan konteks|30\nKeamanan/etika|20\nKejelasan|10'} />
          </div>
          <div className="field">
            <label htmlFor="q-model">Contoh jawaban (hanya terlihat penilai)</label>
            <textarea id="q-model" name="model" rows={3} />
          </div>
        </>
      )}
      <button className="btn" type="submit">
        Tambah soal
      </button>
    </form>
  );
}

export function CourseEditor({ id }: { id: string }) {
  const { me } = useSession();
  const { data, error, loading, reload } = useAsync(() => api<Row>(`/admin/courses/${id}`), [id]);
  const { run, view } = useAction();
  // Saat memuat ulang (setelah simpan/impor) tetap tampilkan data lama agar panel yang terbuka tidak tertutup.
  if (loading && !data) return <Loading />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data) return null;
  const c = data.course as Row;
  const editing = data.editingVersion as Row | null;
  const isDraft = editing?.status === 'draft';
  const isAdmin = hasRole(me, 'admin');
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    const r = await run(fn, ok);
    if (r) reload();
    return r;
  };

  return (
    <div className="stack">
      <h2>{String(c.title)}</h2>
      {view}
      <p>
        Status: <strong>{String(c.status)}</strong>. Versi yang ditampilkan: v{String(editing?.version_no ?? '-')} ({String(editing?.status ?? '-')}).
      </p>
      <div className="btn-row">
        {!isDraft && (
          <button className="btn btn-secondary" type="button" onClick={() => void act(() => api(`/admin/courses/${id}/draft`, { method: 'POST' }), 'Draft dibuat.')}>
            Buat draft versi baru
          </button>
        )}
        {isDraft && isAdmin && (
          <button
            className="btn"
            type="button"
            onClick={() => {
              if (window.confirm('Terbitkan draft? Versi terbit tidak dapat diubah; peserta lama tetap di versinya.'))
                void act(() => api(`/admin/courses/${id}/publish`, { method: 'POST' }), 'Versi diterbitkan.');
            }}
          >
            Terbitkan draft
          </button>
        )}
      </div>
      {!isDraft && <p className="alert alert-warning">Versi terbit bersifat tetap. Buat draft untuk mengubah materi atau soal.</p>}

      <section className="card stack" aria-labelledby="cover-judul">
        <h3 id="cover-judul" style={{ margin: 0 }}>
          Foto sampul kelas
        </h3>
        <p className="help" style={{ margin: 0 }}>
          Tampil di kartu katalog dan halaman kelas. JPG, PNG, atau WebP, maks 2 MB; disarankan lanskap 1200×750 px dan dikompres di bawah
          200 KB agar cepat di jaringan lambat. Jangan memakai foto warga tanpa izin.
        </p>
        {data.coverUrl ? (
          <img src={String(data.coverUrl)} alt="Pratinjau foto sampul" className="course-cover" style={{ maxWidth: '24rem' }} />
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Belum ada foto sampul; katalog memakai latar hijau dengan ikon.
          </p>
        )}
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="cover-file">{data.coverUrl ? 'Ganti foto sampul' : 'Unggah foto sampul'}</label>
          <input
            id="cover-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              await act(async () => {
                if (file.size > 2 * 1024 * 1024) throw new Error('Gambar melebihi 2 MB.');
                const res = await fetch(`/api/v1/admin/courses/${id}/cover`, {
                  method: 'PUT',
                  headers: { 'content-type': file.type, 'x-csrf-token': me?.csrfToken ?? '' },
                  body: file,
                  credentials: 'same-origin',
                });
                if (!res.ok) {
                  const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
                  throw new Error(j?.error?.message ?? 'Unggah gagal.');
                }
              }, 'Foto sampul tersimpan.');
            }}
          />
        </div>
        {Boolean(data.coverUrl) && (
          <div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => window.confirm('Hapus foto sampul?') && void act(() => api(`/admin/courses/${id}/cover`, { method: 'DELETE' }), 'Foto sampul dihapus.')}
            >
              Hapus foto sampul
            </button>
          </div>
        )}
      </section>

      {isAdmin && (
        <details className="card">
          <summary>
            <strong>Pengaturan kelas, jendela waktu & rekomendasi jabatan</strong>
          </summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(() =>
                api(`/admin/courses/${id}`, {
                  method: 'PATCH',
                  body: {
                    title: String(f.get('title')),
                    description: String(f.get('description') ?? ''),
                    visibility: String(f.get('visibility')),
                    enrollmentOpenAt: fromLocal(f.get('eo')),
                    enrollmentCloseAt: fromLocal(f.get('ec')),
                    accessStartsAt: fromLocal(f.get('as')),
                    accessExpiresAt: fromLocal(f.get('ae')),
                    accessDurationDays: f.get('dur') ? num(f.get('dur')) : null,
                    learningSessionTtlSeconds: num(f.get('ttl')) * 60,
                    recommendedFor: VILLAGE_ROLES.filter((r) => f.get(`rec-${r}`) === 'on'),
                  },
                }),
              );
            }}
          >
            <div className="field">
              <label htmlFor="ce-title">Judul</label>
              <input id="ce-title" name="title" type="text" defaultValue={String(c.title)} required />
            </div>
            <div className="field">
              <label htmlFor="ce-desc">Deskripsi</label>
              <textarea id="ce-desc" name="description" rows={3} defaultValue={String(c.description ?? '')} />
            </div>
            <div className="field">
              <label htmlFor="ce-vis">Visibilitas</label>
              <select id="ce-vis" name="visibility" defaultValue={String(c.visibility)}>
                <option value="public">Publik (tampil di katalog)</option>
                <option value="private">Privat</option>
              </select>
            </div>
            <div className="grid">
              {(
                [
                  ['eo', 'Pendaftaran dibuka', c.enrollment_open_at],
                  ['ec', 'Pendaftaran ditutup', c.enrollment_close_at],
                  ['as', 'Akses mulai', c.access_starts_at],
                  ['ae', 'Akses berakhir', c.access_expires_at],
                ] as const
              ).map(([k, label, v]) => (
                <div className="field" key={k}>
                  <label htmlFor={`ce-${k}`}>{label}</label>
                  <input id={`ce-${k}`} name={k} type="datetime-local" defaultValue={toLocal(v as number | null)} />
                </div>
              ))}
              <div className="field">
                <label htmlFor="ce-dur">Durasi akses per peserta (hari, opsional)</label>
                <input id="ce-dur" name="dur" type="number" min={1} defaultValue={c.access_duration_days ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="ce-ttl">Masa aktif sesi belajar (menit)</label>
                <input id="ce-ttl" name="ttl" type="number" min={5} max={1440} defaultValue={Math.round(Number(c.learning_session_ttl_seconds) / 60)} />
              </div>
            </div>
            <fieldset>
              <legend>Disarankan untuk jabatan</legend>
              {VILLAGE_ROLES.map((r) => (
                <label key={r} className="check">
                  <input type="checkbox" name={`rec-${r}`} defaultChecked={(data.recommendedFor as string[]).includes(r)} /> {VILLAGE_ROLE_LABELS[r]}
                </label>
              ))}
            </fieldset>
            <button className="btn" type="submit">
              Simpan pengaturan
            </button>
          </form>
        </details>
      )}

      <h3>Materi</h3>
      {(data.lessons as Row[]).map((l) => (
        <details key={String(l.id)} className="card">
          <summary>
            <strong>
              {String(l.seq)}. {String(l.title)}
            </strong>{' '}
            ({String(l.content_type)}){l.assessment
              ? ` — kuis, ${String((l.assessment.questions as Row[]).length)} soal di bank, ${String((l.assessment.questions as Row[]).filter((q) => Number(q.in_quiz ?? 1) === 1).length)} dipakai`
              : ''}
          </summary>
          {isDraft ? (
            <div className="stack">
              <LessonForm lesson={l} submitLabel="Simpan materi" onSave={async (b) => void (await act(() => api(`/admin/lessons/${String(l.id)}`, { method: 'PUT', body: b })))} />
              {l.content_type === 'pdf' && (
                <div className="field">
                  <label htmlFor={`pdf-${String(l.id)}`}>Unggah PDF (maks 20 MB)</label>
                  <input
                    id={`pdf-${String(l.id)}`}
                    type="file"
                    accept="application/pdf"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      await act(async () => {
                        const res = await fetch(`/api/v1/admin/lessons/${String(l.id)}/file`, {
                          method: 'PUT',
                          headers: { 'content-type': 'application/pdf', 'x-csrf-token': me?.csrfToken ?? '' },
                          body: file,
                          credentials: 'same-origin',
                        });
                        if (!res.ok) throw new Error('Unggah gagal');
                      }, 'PDF terunggah.');
                    }}
                  />
                  {l.file_key ? <span className="help">Sudah ada berkas PDF.</span> : null}
                </div>
              )}
              <h4>Kuis materi ini</h4>
              <AssessmentForm lesson={l} onSave={async (b) => void (await act(() => api(`/admin/lessons/${String(l.id)}/assessment`, { method: 'PUT', body: b })))} />
              {l.assessment && (
                <>
                  <QuestionBank assessment={l.assessment as Row} editable act={act} />
                  <ImportQuestions assessmentId={String(l.assessment.id)} existingCount={(l.assessment.questions as Row[]).length} onDone={reload} />
                  <QuestionForm onSave={(b) => act(() => api(`/admin/assessments/${String(l.assessment.id)}/questions`, { method: 'POST', body: b }), 'Soal ditambahkan.')} />
                </>
              )}
              <button type="button" className="btn btn-danger" onClick={() => window.confirm('Hapus materi dari draft?') && void act(() => api(`/admin/lessons/${String(l.id)}`, { method: 'DELETE' }))}>
                Hapus materi dari draft
              </button>
            </div>
          ) : (
            <div className="stack">
              <p className="muted">Hanya-baca (versi terbit).</p>
              {l.assessment && <QuestionBank assessment={l.assessment as Row} editable={false} act={act} />}
            </div>
          )}
        </details>
      ))}
      {isDraft && (
        <section className="card">
          <h3>Tambah materi</h3>
          <LessonForm submitLabel="Tambah materi" onSave={async (b) => void (await act(() => api(`/admin/courses/${id}/lessons`, { method: 'POST', body: b }), 'Materi ditambahkan.'))} />
        </section>
      )}
    </div>
  );
}
