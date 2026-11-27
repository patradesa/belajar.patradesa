import { useEffect, useRef, useState, type FormEvent } from 'react';
import { VILLAGE_ROLES, VILLAGE_ROLE_LABELS, VILLAGE_ROLE_SHORT } from '@patradesa/shared';
import { api, errorMessage } from '../lib/api';
import { hasRole, useSession } from '../lib/session';
import { navigate } from '../lib/router';
import { ErrorAlert, Loading, useAsync } from '../components/common';
import { useAction } from './useAction';
import { ImportQuestions } from './ImportQuestions';
import { QuestionBank } from './QuestionBank';
import { Icon } from '../components/Icon';

type Row = Record<string, any>;

/** Format kode materi yang valid (sama dengan skema server). */
const KEY_OK = /^[a-z0-9][a-z0-9-]{1,63}$/;

const toLocal = (ms: number | null | undefined) => {
  if (!ms) return '';
  const d = new Date(ms);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: FormDataEntryValue | null) => (v && String(v) ? new Date(String(v)).getTime() : null);
const num = (v: FormDataEntryValue | null) => Number(v ?? 0);
const fmtDate = (ms: unknown) =>
  ms ? new Date(Number(ms)).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
const STATUS_NAME: Record<string, string> = { published: 'Diterbitkan', draft: 'Draf', archived: 'Diarsipkan' };

/** Kolom kiri editor: identitas kelas (sampul, status, ringkasan) seperti panel info di LMS lain. */
function CourseInfo({
  c,
  data,
  statusLine,
  lessons,
  showSettings,
  onToggleSettings,
  actions,
}: {
  c: Row;
  data: Row;
  statusLine: string;
  lessons: Row[];
  showSettings: boolean;
  onToggleSettings: () => void;
  actions: React.ReactNode;
}) {
  // Di HP detail tertutup dulu agar daftar materi cepat terlihat; di desktop terbuka.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 960px)').matches);
  const minutes = lessons.reduce((t, l) => t + Math.round(Number(l.required_active_seconds) / 60), 0);
  const quizzes = lessons.filter((l) => l.assessment).length;
  const roles = ((data.recommendedFor ?? []) as string[]).map((r) => VILLAGE_ROLE_SHORT[r as keyof typeof VILLAGE_ROLE_SHORT] ?? r);
  const mentors = ((data.mentors ?? []) as Row[]).map((m) => String(m.display_name));
  const status = String(c.status);
  const desc = String(c.description ?? '').replace(/[#*]/g, '').trim();
  return (
    <aside className="card course-info" aria-labelledby="kelas-judul">
      {data.coverUrl ? (
        <img src={String(data.coverUrl)} alt="" className="course-info-cover" />
      ) : (
        <div className="course-info-cover course-info-placeholder" aria-hidden="true">
          <img src="/logo-patradesa.png" alt="" width={140} height={34} />
          <span>Belum ada foto sampul</span>
        </div>
      )}
      <div className="course-info-body">
        <div className="badge-row">
          <span className={status === 'published' ? 'badge badge-success' : 'badge badge-warning'}>{STATUS_NAME[status] ?? status}</span>
          <span className="badge">{c.visibility === 'private' ? 'Privat' : 'Publik'}</span>
        </div>
        <h2 id="kelas-judul" className="course-info-title">
          {String(c.title)}
        </h2>
        <p className="muted course-info-status">{statusLine}</p>
        {status === 'archived' && (
          <p className="alert alert-warning course-info-archived" role="status">
            <strong>Diarsipkan.</strong> Kelas tidak tampil di katalog dan peserta tidak bisa membukanya. Data belajar dan sertifikat tetap tersimpan.
          </p>
        )}
        <button type="button" className="btn btn-secondary icon-text" aria-expanded={showSettings} onClick={onToggleSettings}>
          <Icon name="pencil" /> Edit kelas
        </button>
        <div className="course-info-detail">
          <button type="button" className="course-info-toggle" aria-expanded={open} aria-controls="kelas-detail" onClick={() => setOpen((x) => !x)}>
            Detail <span aria-hidden="true">{open ? '▴' : '▾'}</span>
          </button>
          <dl id="kelas-detail" hidden={!open}>
            <dt>Kode kelas</dt>
            <dd>
              <code>{String(c.slug)}</code>
            </dd>
            <dt>Isi</dt>
            <dd>
              {lessons.length} materi · {quizzes} kuis · {minutes} menit minimum
            </dd>
            <dt>Peserta</dt>
            <dd>
              {Number(data.enrollmentCount ?? 0)} terdaftar · {Number(data.certificateCount ?? 0)} sertifikat
            </dd>
            {roles.length > 0 && (
              <>
                <dt>Jabatan sasaran</dt>
                <dd>{roles.join(', ')}</dd>
              </>
            )}
            {mentors.length > 0 && (
              <>
                <dt>Mentor</dt>
                <dd>{mentors.join(', ')}</dd>
              </>
            )}
            {desc && (
              <>
                <dt>Deskripsi</dt>
                <dd className="course-info-desc">{desc}</dd>
              </>
            )}
            <dt>Dibuat pada</dt>
            <dd>{fmtDate(c.created_at)}</dd>
            <dt>Terakhir diubah</dt>
            <dd>{fmtDate(c.updated_at)}</dd>
          </dl>
        </div>
        {actions}
      </div>
    </aside>
  );
}

function LessonForm({
  lesson,
  onSave,
  canPublish,
  draftLabel,
}: {
  lesson?: Row;
  onSave: (body: unknown, mode: SaveMode) => Promise<void>;
  canPublish: boolean;
  draftLabel?: string;
}) {
  const pre = lesson?.id ?? 'new';
  const [type, setType] = useState<string>(lesson?.content_type ?? 'html');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const mode = submitMode(e);
        const f = new FormData(e.currentTarget);
        await onSave({
          title: String(f.get('title')),
          summary: String(f.get('summary') ?? ''),
          contentType: type,
          contentSource: String(f.get('contentSource') ?? ''),
          youtube: type === 'youtube' ? String(f.get('youtube') ?? '') : null,
          requiredActiveSeconds: num(f.get('required')) * 60,
          isRequired: f.get('isRequired') === 'on',
          ...(String(f.get('lessonKey') ?? '').trim() ? { lessonKey: String(f.get('lessonKey')).trim() } : {}),
        }, mode);
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
        <label htmlFor={`${pre}-key`}>Kode materi (opsional)</label>
        <input
          id={`${pre}-key`}
          name="lessonKey"
          type="text"
          pattern="[a-z0-9][a-z0-9\-]{1,63}"
          maxLength={64}
          // Materi lama punya kode acak (huruf besar/garis bawah) yang tidak lolos pola; kosongkan agar kode itu tidak berubah dan formulir tetap bisa disimpan.
          defaultValue={KEY_OK.test(String(lesson?.lesson_key ?? '')) ? String(lesson?.lesson_key) : ''}
          placeholder={lesson?.lesson_key && !KEY_OK.test(String(lesson.lesson_key)) ? `otomatis: ${String(lesson.lesson_key)}` : undefined}
          aria-describedby={`${pre}-key-help`}
        />
        <span id={`${pre}-key-help`} className="help">
          Huruf kecil, angka, tanda hubung — mis. <code>dd26-u01-pilih-dasar-aturan</code>. Dipakai tautan remedial skenario. Kosongkan agar kode tidak berubah.
        </span>
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
          Format: “## Judul”, “### Subjudul”, “- butir”, “1. butir”, “&gt; catatan”, “---” pemisah slide, **tebal**, [teks](https://…),
          dan satu baris “[[skenario:kode]]” untuk menyisipkan skenario. HTML tidak diizinkan.
        </span>
      </div>
      <div className="field">
        <label htmlFor={`${pre}-req`}>Waktu belajar minimum (menit)</label>
        <input id={`${pre}-req`} name="required" type="number" min={0} max={600} defaultValue={Math.round((lesson?.required_active_seconds ?? 300) / 60)} />
      </div>
      <label className="check">
        <input type="checkbox" name="isRequired" defaultChecked={lesson ? lesson.is_required === 1 : true} /> Materi wajib
      </label>
      <SaveButtons canPublish={canPublish} draftLabel={draftLabel} />
    </form>
  );
}

function AssessmentForm({ lesson, onSave, canPublish }: { lesson: Row; onSave: (body: unknown, mode: SaveMode) => Promise<void>; canPublish: boolean }) {
  const a = lesson.assessment as Row | null;
  const pre = `as-${String(lesson.id)}`;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const mode = submitMode(e);
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
          reviewPolicy: f.get('review') === 'on' ? 'after_done' : 'none',
        }, mode);
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
      <label className="check">
        <input type="checkbox" name="review" defaultChecked={a ? a.review_policy === 'after_done' : false} /> Tampilkan pembahasan (kunci +
        penjelasan soal) setelah peserta lulus atau kesempatannya habis
      </label>
      <p className="help">Pendamping AI selalu dinonaktifkan selama kuis dan tidak dapat diubah.</p>
      <SaveButtons canPublish={canPublish} draftLabel="Simpan kuis sebagai draf" />
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
                ...(String(f.get('explanation') ?? '').trim() ? { explanation: String(f.get('explanation')).trim() } : {}),
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
          <div className="field">
            <label htmlFor="q-expl">Penjelasan (opsional, tampil di pembahasan bila diaktifkan)</label>
            <textarea id="q-expl" name="explanation" rows={2} maxLength={2000} />
          </div>
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

export type SaveMode = 'draft' | 'publish';

/** Tombol simpan bersama: "Simpan sebagai draf" (semua editor) dan "Simpan & terbitkan" (admin). */
function SaveButtons({ canPublish, draftLabel = 'Simpan sebagai draf' }: { canPublish: boolean; draftLabel?: string }) {
  return (
    <div className="btn-row">
      <button className="btn btn-secondary" type="submit" value="draft">
        {draftLabel}
      </button>
      {canPublish && (
        <button className="btn" type="submit" value="publish">
          Simpan &amp; terbitkan
        </button>
      )}
    </div>
  );
}

const submitMode = (e: FormEvent<HTMLFormElement>): SaveMode =>
  ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === 'publish' ? 'publish' : 'draft';

const scenarioCount = (src: unknown) => (String(src ?? '').match(/^\[\[skenario:[a-z0-9-]+\]\]$/gm) ?? []).length;

/** Panel terbit: ringkasan perubahan, masalah yang menghalangi, dan opsi memindahkan peserta lama. */
function PublishPanel({ courseId, onClose, onPublished }: { courseId: string; onClose: () => void; onPublished: (msg: string) => void }) {
  const { data, error, loading } = useAsync(() => api<{ draftVersionId: string | null; changes: string[]; problems: string[] }>(`/admin/courses/${courseId}/changes`), [courseId]);
  const [move, setMove] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    panelRef.current?.focus();
  }, []);
  const publish = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/admin/courses/${courseId}/publish`, { method: 'POST' });
      let moved = 0;
      const skipped: string[] = [];
      if (move) {
        const rep = await api<{ learners: Row[] }>(`/admin/reports/${courseId}`);
        const older = rep.learners.filter((l) => l.current_version_no !== null && Number(l.version_no) < Number(l.current_version_no));
        for (const [i, l] of older.entries()) {
          setProgress(`Memindahkan peserta ${i + 1} dari ${older.length}…`);
          try {
            await api(`/admin/courses/${courseId}/enrollments/${String(l.user_id)}/upgrade`, { method: 'POST' });
            moved++;
          } catch (e) {
            skipped.push(`${String(l.display_name)}: ${errorMessage(e)}`);
          }
        }
      }
      onPublished(
        `Versi baru diterbitkan.${move ? ` ${moved} peserta dipindahkan ke versi baru.` : ''}${skipped.length ? ` Belum dipindahkan: ${skipped.join('; ')}` : ''}`,
      );
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  return (
    <section ref={panelRef} tabIndex={-1} className="card stack publish-panel" aria-labelledby="terbit-judul">
      <h3 id="terbit-judul">Terbitkan perubahan</h3>
      {loading && <Loading />}
      {Boolean(error) && <ErrorAlert error={error} />}
      {data && (
        <>
          {data.changes.length ? (
            <>
              <p>Yang akan terlihat peserta setelah terbit:</p>
              <ul className="change-list">
                {data.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">Tidak ada perubahan dibanding versi yang sedang terbit.</p>
          )}
          {data.problems.length > 0 && (
            <div className="alert alert-error" role="alert">
              <strong>Belum bisa terbit:</strong>
              <ul>
                {data.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} /> Pindahkan juga peserta yang sudah terdaftar ke versi
            baru (progres materi yang kodenya sama ikut terbawa; peserta yang sedang kuis atau sudah bersertifikat dilewati)
          </label>
          {err ? <ErrorAlert error={err} /> : null}
          {progress && <Loading label={progress} />}
          <div className="btn-row">
            <button type="button" className="btn" disabled={busy || data.problems.length > 0 || !data.draftVersionId} onClick={() => void publish()}>
              {busy ? 'Menerbitkan…' : 'Terbitkan sekarang'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
              Nanti saja
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function CourseLog({ courseId }: { courseId: string }) {
  const { data, error, loading, reload } = useAsync(() => api<{ log: { id: string; at: number; actor: string; label: string; detail: string }[] }>(`/admin/courses/${courseId}/log`), [courseId]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data?.log.length) return <p className="muted">Belum ada catatan perubahan.</p>;
  return (
    // Bisa digulir mendatar di HP: wadah wajib dapat difokus agar tabel bisa digeser dengan keyboard (axe: scrollable-region-focusable).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- wilayah gulir harus dapat dijangkau keyboard (WCAG 2.1.1)
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Log perubahan kelas">
      <table>
        <caption className="visually-hidden">Log perubahan kelas</caption>
        <thead>
          <tr>
            <th scope="col">Waktu</th>
            <th scope="col">Oleh</th>
            <th scope="col">Perubahan</th>
            <th scope="col">Rincian</th>
          </tr>
        </thead>
        <tbody>
          {data.log.map((r) => (
            <tr key={r.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</td>
              <td>{r.actor}</td>
              <td>{r.label}</td>
              <td>{r.detail || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CourseSettings({ c, data, id, act, isAdmin, csrf }: { c: Row; data: Row; id: string; act: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>; isAdmin: boolean; csrf: string }) {
  return (
    <div className="two-col">
      <section className="card stack" aria-labelledby="cover-judul">
        <h3 id="cover-judul" style={{ margin: 0 }}>
          Foto sampul kelas
        </h3>
        <p className="help" style={{ margin: 0 }}>
          JPG, PNG, atau WebP, maks 2 MB; disarankan lanskap 1200×750 px, di bawah 200 KB. Jangan memakai foto warga tanpa izin.
        </p>
        {data.coverUrl ? <img src={String(data.coverUrl)} alt="Pratinjau foto sampul" className="course-cover" style={{ maxWidth: '24rem' }} /> : <p className="muted">Belum ada foto sampul.</p>}
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
                  headers: { 'content-type': file.type, 'x-csrf-token': csrf },
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
            <button type="button" className="btn btn-secondary" onClick={() => window.confirm('Hapus foto sampul?') && void act(() => api(`/admin/courses/${id}/cover`, { method: 'DELETE' }), 'Foto sampul dihapus.')}>
              Hapus foto sampul
            </button>
          </div>
        )}
      </section>
      {isAdmin && (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act(
              () =>
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
              'Pengaturan kelas tersimpan (langsung berlaku).',
            );
          }}
        >
          <h3 style={{ margin: 0 }}>Pengaturan kelas</h3>
          <p className="help" style={{ margin: 0 }}>
            Judul, visibilitas, dan jadwal langsung berlaku tanpa perlu terbit.
          </p>
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
              <option value="private">Privat (hanya lewat tautan / peserta terdaftar)</option>
            </select>
          </div>
          <details>
            <summary>Jadwal akses &amp; sesi (opsional)</summary>
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
                <label htmlFor="ce-dur">Durasi akses per peserta (hari)</label>
                <input id="ce-dur" name="dur" type="number" min={1} defaultValue={c.access_duration_days ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="ce-ttl">Masa aktif sesi belajar (menit)</label>
                <input id="ce-ttl" name="ttl" type="number" min={5} max={1440} defaultValue={Math.round(Number(c.learning_session_ttl_seconds) / 60)} />
              </div>
            </div>
          </details>
          <fieldset>
            <legend>Disarankan untuk jabatan</legend>
            {VILLAGE_ROLES.map((r) => (
              <label key={r} className="check">
                <input type="checkbox" name={`rec-${r}`} defaultChecked={(data.recommendedFor as string[]).includes(r)} /> {VILLAGE_ROLE_LABELS[r]}
              </label>
            ))}
          </fieldset>
          <div className="btn-row">
            <button className="btn" type="submit">
              Simpan pengaturan
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const TYPE_NAME: Record<string, string> = { html: 'Bacaan', slides: 'Slide', pdf: 'PDF', youtube: 'Video' };

export function CourseEditor({ id }: { id: string }) {
  const { me } = useSession();
  const { data, error, loading, reload } = useAsync(() => api<Row>(`/admin/courses/${id}`), [id]);
  const { run, view } = useAction();
  const [tab, setTab] = useState<'materi' | 'log'>('materi');
  const [editKey, setEditKey] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  // Saat memuat ulang (setelah simpan/impor) tetap tampilkan data lama agar panel yang terbuka tidak tertutup.
  if (loading && !data) return <Loading />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data) return null;
  const c = data.course as Row;
  const editing = data.editingVersion as Row | null;
  const isDraft = editing?.status === 'draft';
  const isAdmin = hasRole(me, 'admin');
  const lessons = data.lessons as Row[];
  const current = (data.versions as Row[]).find((v) => v.id === c.current_version_id);
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    const r = await run(fn, ok);
    if (r) reload();
    return r;
  };

  /** Pensil pertama kali pada versi terbit → draf dibuat otomatis (salinan versi terbit). */
  const startEdit = async (key: string) => {
    setEditKey(key);
    setPublishOpen(false);
    if (isDraft) return;
    setPreparing(true);
    const ok = await run(() => api(`/admin/courses/${id}/draft`, { method: 'POST' }), 'Draf dibuat otomatis. Peserta belum melihat perubahan sampai Anda menerbitkannya.');
    setPreparing(false);
    if (ok) reload();
    else setEditKey(null);
  };
  const afterSave = (mode: SaveMode) => (ok: boolean) => {
    if (ok && mode === 'publish') setPublishOpen(true);
  };

  const enrolled = Number(data.enrollmentCount ?? 0) + Number(data.certificateCount ?? 0);
  const archived = c.status === 'archived';
  const archive = () =>
    window.confirm(
      `Arsipkan kelas "${String(c.title)}"?\n\nKelas hilang dari katalog dan peserta tidak bisa membukanya. Pendaftaran, nilai, dan sertifikat tetap tersimpan, dan kelas bisa dipulihkan kapan saja.`,
    ) && void act(() => api(`/admin/courses/${id}/archive`, { method: 'POST' }), 'Kelas diarsipkan.');
  const unarchive = () => void act(() => api(`/admin/courses/${id}/unarchive`, { method: 'POST' }), 'Kelas dipulihkan dari arsip.');
  const remove = async () => {
    const typed = window.prompt(
      `Hapus permanen kelas "${String(c.title)}" beserta semua materi, kuis, dan soalnya? Tindakan ini tidak bisa dibatalkan.\n\nKetik HAPUS untuk melanjutkan.`,
    );
    if (typed?.trim().toUpperCase() !== 'HAPUS') return;
    const ok = await run(() => api(`/admin/courses/${id}`, { method: 'DELETE' }), 'Kelas dihapus.');
    if (ok) navigate('/admin');
  };
  const courseActions = isAdmin ? (
    <div className="course-info-actions">
      <h3>Kelola kelas</h3>
      {archived ? (
        <button type="button" className="btn btn-secondary" onClick={unarchive}>
          Pulihkan dari arsip
        </button>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={archive}>
          Arsipkan kelas
        </button>
      )}
      {enrolled === 0 ? (
        <button type="button" className="btn btn-danger" onClick={() => void remove()}>
          Hapus permanen
        </button>
      ) : (
        <p className="help">Hapus permanen tidak tersedia karena kelas sudah punya peserta. Arsipkan untuk menyembunyikannya.</p>
      )}
    </div>
  ) : null;

  const statusLine = `${c.status === 'published' ? `Terbit v${String(current?.version_no ?? '-')}` : 'Belum pernah terbit'} · ${c.visibility === 'private' ? 'Privat' : 'Publik'}${
    isDraft ? ` · draf v${String(editing?.version_no)} belum terbit` : ''
  }`;

  return (
    <div className="course-manage">
      <CourseInfo
        c={c}
        data={data}
        statusLine={statusLine}
        lessons={lessons}
        showSettings={showSettings}
        onToggleSettings={() => setShowSettings((x) => !x)}
        actions={courseActions}
      />
      <div className="stack course-manage-main">
      {view}
      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}
      {showSettings && <CourseSettings c={c} data={data} id={id} act={act} isAdmin={isAdmin} csrf={me?.csrfToken ?? ''} />}

      {isDraft && !publishOpen && (
        <div className="draft-bar" role="status">
          <span>
            <strong>Ada perubahan yang belum terbit.</strong> Peserta masih melihat versi sebelumnya.
          </span>
          {isAdmin ? (
            <button type="button" className="btn" onClick={() => setPublishOpen(true)}>
              Tinjau &amp; terbitkan
            </button>
          ) : (
            <span className="muted">Minta admin menerbitkan.</span>
          )}
        </div>
      )}
      {publishOpen && isAdmin && (
        <PublishPanel
          courseId={id}
          onClose={() => setPublishOpen(false)}
          onPublished={(msg) => {
            setPublishOpen(false);
            setEditKey(null);
            setNotice(msg);
            reload();
          }}
        />
      )}

      <div className="course-manage-head">
        <h3>Daftar materi</h3>
        <div className="subnav">
        <ul role="tablist" aria-label="Bagian editor kelas">
          <li role="presentation">
            <button type="button" role="tab" aria-selected={tab === 'materi'} className="tab-btn" onClick={() => setTab('materi')}>
              Materi
            </button>
          </li>
          <li role="presentation">
            <button type="button" role="tab" aria-selected={tab === 'log'} className="tab-btn" onClick={() => setTab('log')}>
              <Icon name="history" /> Log perubahan
            </button>
          </li>
        </ul>
        </div>
      </div>

      {tab === 'log' ? (
        <CourseLog courseId={id} />
      ) : (
        <>
          <ol className="editor-lessons">
            {lessons.map((l) => {
              const key = String(l.lesson_key);
              const quiz = l.assessment as Row | null;
              const sc = scenarioCount(l.content_source);
              const isEditing = editKey === key;
              return (
                <li key={String(l.id)} className={`editor-lesson${isEditing ? ' is-editing' : ''}`}>
                  <div className="editor-lesson-row">
                    <span className="editor-lesson-no">{String(l.seq)}</span>
                    <div className="editor-lesson-main">
                      <strong>{String(l.title)}</strong>
                      <span className="muted">
                        {TYPE_NAME[String(l.content_type)] ?? String(l.content_type)} · {Math.round(Number(l.required_active_seconds) / 60)} menit ·{' '}
                        {Number(l.is_required) === 1 ? 'wajib' : 'opsional'}
                        {sc ? ` · ${sc} skenario` : ''}
                        {quiz ? ` · kuis ${(quiz.questions as Row[]).length} soal${Number(quiz.is_required) === 1 ? ' (wajib)' : ''}` : ''}
                      </span>
                    </div>
                    <span className={Number(l.is_required) === 1 ? 'badge badge-success editor-lesson-badge' : 'badge editor-lesson-badge'}>
                      {Number(l.is_required) === 1 ? 'Wajib' : 'Opsional'}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={isEditing ? `Tutup editor ${String(l.title)}` : `Edit materi ${String(l.title)}`}
                      aria-expanded={isEditing}
                      onClick={() => (isEditing ? setEditKey(null) : void startEdit(key))}
                    >
                      <Icon name={isEditing ? 'close' : 'pencil'} />
                    </button>
                  </div>
                  {isEditing &&
                    (!isDraft || preparing ? (
                      <Loading label="Menyiapkan draf…" />
                    ) : (
                      <div className="editor-panel stack">
                        <LessonForm
                          lesson={l}
                          canPublish={isAdmin}
                          onSave={async (b, mode) => afterSave(mode)(await act(() => api(`/admin/lessons/${String(l.id)}`, { method: 'PUT', body: b }), 'Materi disimpan sebagai draf.'))}
                        />
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
                        <details className="card card-soft" open={Boolean(quiz)}>
                          <summary>
                            <strong>{quiz ? `Kuis: ${String(quiz.title)}` : 'Tambah kuis untuk materi ini (opsional)'}</strong>
                          </summary>
                          <div className="stack">
                            <AssessmentForm
                              lesson={l}
                              canPublish={isAdmin}
                              onSave={async (b, mode) =>
                                afterSave(mode)(await act(() => api(`/admin/lessons/${String(l.id)}/assessment`, { method: 'PUT', body: b }), 'Pengaturan kuis disimpan sebagai draf.'))
                              }
                            />
                            {quiz && (
                              <>
                                <QuestionBank assessment={quiz} editable act={act} />
                                <ImportQuestions assessmentId={String(quiz.id)} existingCount={(quiz.questions as Row[]).length} onDone={reload} />
                                <QuestionForm onSave={(b) => act(() => api(`/admin/assessments/${String(quiz.id)}/questions`, { method: 'POST', body: b }), 'Soal ditambahkan.')} />
                                <div>
                                  <button
                                    type="button"
                                    className="btn btn-danger"
                                    onClick={() =>
                                      window.confirm(`Hapus kuis "${String(quiz.title)}" beserta ${(quiz.questions as Row[]).length} soalnya? Materinya tetap ada.`) &&
                                      void act(() => api(`/admin/lessons/${String(l.id)}/assessment`, { method: 'DELETE' }), 'Kuis dihapus dari materi.')
                                    }
                                  >
                                    Hapus kuis dari materi ini
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </details>
                        <div className="btn-row">
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => window.confirm(`Hapus materi "${String(l.title)}"? Peserta tetap melihatnya sampai versi baru diterbitkan.`) && void act(() => api(`/admin/lessons/${String(l.id)}`, { method: 'DELETE' }), 'Materi dihapus dari draf.')}
                          >
                            Hapus materi
                          </button>
                          <button type="button" className="btn btn-secondary" onClick={() => setEditKey(null)}>
                            Tutup
                          </button>
                        </div>
                      </div>
                    ))}
                </li>
              );
            })}
          </ol>
          {editKey === '__baru__' ? (
            !isDraft || preparing ? (
              <Loading label="Menyiapkan draf…" />
            ) : (
              <section className="card editor-panel">
                <h3>Tambah materi</h3>
                <LessonForm
                  canPublish={isAdmin}
                  draftLabel="Tambah sebagai draf"
                  onSave={async (b, mode) => {
                    const ok = await act(() => api(`/admin/courses/${id}/lessons`, { method: 'POST', body: b }), 'Materi ditambahkan ke draf.');
                    if (ok) setEditKey(null);
                    afterSave(mode)(ok);
                  }}
                />
              </section>
            )
          ) : (
            <div>
              <button type="button" className="btn btn-secondary icon-text" onClick={() => void startEdit('__baru__')}>
                <Icon name="pencil" /> Tambah materi
              </button>
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}
