import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../lib/api';
import { useAction } from './useAction';
import { Link, match, navigate } from '../lib/router';
import { hasRole, useSession } from '../lib/session';
import { ErrorAlert, Loading, PageTitle, useAsync } from '../components/common';
import { CourseEditor } from './CourseEditor';
import { AdminLoginPage } from '../pages/AdminLoginPage';
import { Certificates } from './Certificates';
import { ScenarioDetail, ScenarioList } from './ScenarioAdmin';
import { ImportBundle } from './ImportBundle';

/** Area admin/mentor/editor — dimuat lazy, tidak termasuk bundle awal learner. */

type Row = Record<string, unknown>;

function Tabs({ path }: { path: string }) {
  const { me } = useSession();
  const items: [string, string, boolean][] = [
    ['/admin', 'Kelas', hasRole(me, 'admin', 'content_editor')],
    ['/admin/skenario', 'Skenario', hasRole(me, 'admin', 'content_editor', 'mentor')],
    ['/admin/impor-paket', 'Impor paket', hasRole(me, 'admin', 'content_editor')],
    ['/admin/review', 'Review esai', hasRole(me, 'admin', 'mentor')],
    ['/admin/banding', 'Banding', hasRole(me, 'admin', 'mentor')],
    ['/admin/pengguna', 'Pengguna', hasRole(me, 'admin', 'mentor')],
    ['/admin/sertifikat', 'Sertifikat', hasRole(me, 'admin')],
    ['/admin/audit', 'Audit', hasRole(me, 'admin')],
    ['/panduan/admin', 'Panduan', true],
  ];
  return (
    <nav aria-label="Menu admin" className="subnav">
      <ul>
        {items
          .filter((i) => i[2])
          .map(([href, label]) => {
            // "Kelas" juga aktif di editor & laporan kelas.
            const active = href === '/admin' ? path === '/admin' || path.startsWith('/admin/kelas/') || path.startsWith('/admin/laporan/') : href === '/admin/skenario' ? path.startsWith('/admin/skenario') : path === href;
            return (
              <li key={href}>
                <Link href={href} aria-current={active ? 'page' : undefined}>
                  {label}
                </Link>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}

function CourseList() {
  const { me } = useSession();
  const { data, error, loading, reload } = useAsync(() => api<{ courses: Row[]; demoAvailable?: boolean }>('/admin/courses'), []);
  const { run, view } = useAction();
  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let id = '';
    const ok = await run(async () => {
      const r = await api<{ id: string }>('/admin/courses', {
        method: 'POST',
        body: { slug: String(f.get('slug')), title: String(f.get('title')), description: String(f.get('description') ?? '') },
      });
      id = r.id;
    }, 'Kelas dibuat.');
    if (ok) navigate(`/admin/kelas/${id}`);
  };
  const isAdmin = hasRole(me, 'admin');
  return (
    <div className="stack">
      {view}
      <div className="two-col">
        {isAdmin && (
          <form className="card" onSubmit={create} aria-labelledby="buat-kelas-judul">
            <h2 id="buat-kelas-judul">Buat kelas baru</h2>
            <div className="field">
              <label htmlFor="c-title">Judul</label>
              <input id="c-title" name="title" type="text" required minLength={3} maxLength={160} />
            </div>
            <div className="field">
              <label htmlFor="c-slug">Slug URL</label>
              <input id="c-slug" name="slug" type="text" required pattern="[a-z0-9-]{3,80}" aria-describedby="c-slug-help" />
              <span id="c-slug-help" className="help">
                Huruf kecil, angka, tanda minus. Contoh: dasar-keterbukaan
              </span>
            </div>
            <div className="field">
              <label htmlFor="c-desc">Deskripsi</label>
              <textarea id="c-desc" name="description" maxLength={2000} rows={3} />
            </div>
            <button className="btn" type="submit">
              Buat kelas
            </button>
          </form>
        )}
        {isAdmin && data?.demoAvailable && (
          <section className="card stack" aria-labelledby="demo-judul">
            <h2 id="demo-judul">Uji alur penilaian sampai sertifikat</h2>
            <p style={{ margin: 0 }}>
              Membuat kelas <strong>privat</strong> berisi 3 materi dan kuis (5 pilihan ganda + 2 esai), plus satu peserta <strong>fiktif</strong> yang sudah
              menyelesaikan materi dan mengumpulkan kuis (4 dari 5 PG benar). Lanjutkan di <strong>Review esai</strong>: beri skor rubrik pada 2 esai. Nilai
              akhir ≥ 70% → lulus → sertifikat terbit (lihat tab <strong>Sertifikat</strong>). Total esai minimal 13 dari 20 poin agar lulus.
            </p>
            <p className="help" style={{ margin: 0 }}>
              Tidak tersedia di produksi. Bila integrasi Sertifikat Studio aktif, sertifikat demo memakai nomor resmi berikutnya; cabut dari tab Sertifikat
              setelah selesai menguji.
            </p>
            <div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  void run(async () => {
                    await api('/admin/demo/grading', { method: 'POST' });
                    reload();
                  }, 'Kelas demo dibuat. Buka tab “Review esai” untuk menilai 2 esai peserta demo.')
                }
              >
                Buat kelas demo penilaian
              </button>
            </div>
          </section>
        )}
        <section className="card span-2" aria-labelledby="daftar-kelas-judul">
          <h2 id="daftar-kelas-judul">Daftar kelas</h2>
          {loading && !data && <Loading />}
          {Boolean(error) && <ErrorAlert error={error} onRetry={reload} />}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Judul</th>
                  <th scope="col">Status</th>
                  <th scope="col">Versi</th>
                  <th scope="col">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {data?.courses.map((c) => (
                  <tr key={String(c.id)}>
                    <td>{String(c.title)}</td>
                    <td>{({ published: 'Terbit', draft: 'Draf', archived: 'Diarsipkan' } as Record<string, string>)[String(c.status)] ?? String(c.status)}</td>
                    <td>
                      v{String(c.latest_version ?? 1)}
                      {c.draft_version_id ? ' (ada draft)' : ''}
                    </td>
                    <td>
                      <Link href={`/admin/kelas/${String(c.id)}`}>Kelola</Link>
                      {isAdmin && (
                        <>
                          {' · '}
                          <Link href={`/admin/laporan/${String(c.id)}`}>Laporan</Link>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Reviews() {
  const { data, error, loading, reload } = useAsync(() => api<{ reviews: Row[] }>('/admin/reviews'), []);
  const { run, view } = useAction();
  return (
    <div className="stack">
      <h2>Antrean review esai</h2>
      <p className="muted">Review buta: identitas peserta tidak ditampilkan. Nilai final hanya setelah penilaian manusia.</p>
      {view}
      {loading && <Loading />}
      {Boolean(error) && <ErrorAlert error={error} onRetry={reload} />}
      {data?.reviews.length === 0 && <p>Tidak ada esai yang menunggu penilaian.</p>}
      {data?.reviews.map((r) => {
        const rubric = JSON.parse(String(r.rubric_json ?? '[]')) as { criterion: string; maxScore: number }[];
        const submit = async (e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const ok = await run(
            () =>
              api(`/admin/reviews/${String(r.answer_id)}/decision`, {
                method: 'POST',
                body: {
                  rubricScores: rubric.map((c, i) => ({ criterion: c.criterion, score: Number(f.get(`s${i}`)) })),
                  feedback: String(f.get('feedback') ?? ''),
                },
              }),
            'Nilai tersimpan.',
          );
          if (ok) reload();
        };
        return (
          <form key={String(r.answer_id)} className="card stack" onSubmit={submit}>
            <h3>{String(r.assessment_title)}</h3>
            <p>
              <strong>Soal:</strong> {String(r.stem_snapshot)}
            </p>
            <p style={{ whiteSpace: 'pre-wrap' }}>
              <strong>Jawaban:</strong> {r.essay_text ? String(r.essay_text) : <em>(kosong)</em>}
            </p>
            {Boolean(r.model_answer) && (
              <details>
                <summary>Contoh jawaban (khusus penilai)</summary>
                <p>{String(r.model_answer)}</p>
              </details>
            )}
            {rubric.map((c, i) => (
              <div className="field" key={c.criterion}>
                <label htmlFor={`${String(r.answer_id)}-s${i}`}>
                  {c.criterion} (0–{c.maxScore})
                </label>
                <input id={`${String(r.answer_id)}-s${i}`} name={`s${i}`} type="number" min={0} max={c.maxScore} required inputMode="numeric" />
              </div>
            ))}
            <div className="field">
              <label htmlFor={`${String(r.answer_id)}-fb`}>Umpan balik untuk peserta</label>
              <textarea id={`${String(r.answer_id)}-fb`} name="feedback" maxLength={4000} rows={3} />
            </div>
            <button className="btn" type="submit">
              Simpan nilai
            </button>
          </form>
        );
      })}
    </div>
  );
}

function Appeals() {
  const { data, error, loading, reload } = useAsync(() => api<{ appeals: Row[] }>('/admin/appeals'), []);
  const { run, view } = useAction();
  return (
    <div className="stack">
      <h2>Banding nilai</h2>
      {view}
      {loading && <Loading />}
      {Boolean(error) && <ErrorAlert error={error} onRetry={reload} />}
      {data?.appeals.length === 0 && <p>Belum ada banding.</p>}
      {data?.appeals.map((a) => (
        <form
          key={String(a.id)}
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (await run(() => api(`/admin/appeals/${String(a.id)}`, { method: 'POST', body: { status: String(f.get('status')), resolution: String(f.get('resolution')) } })))
              reload();
          }}
        >
          <p>
            <strong>Status:</strong> {String(a.status)} — hasil {String(a.result_status)} ({String(a.final_score_pct ?? '–')}%)
          </p>
          <p>{String(a.reason)}</p>
          {a.status === 'open' && (
            <>
              <div className="field">
                <label htmlFor={`res-${String(a.id)}`}>Tanggapan</label>
                <textarea id={`res-${String(a.id)}`} name="resolution" required minLength={3} rows={2} />
              </div>
              <div className="field">
                <label htmlFor={`st-${String(a.id)}`}>Keputusan</label>
                <select id={`st-${String(a.id)}`} name="status">
                  <option value="resolved">Diterima / ditinjau ulang</option>
                  <option value="rejected">Ditolak</option>
                </select>
              </div>
              <button className="btn" type="submit">
                Simpan
              </button>
            </>
          )}
        </form>
      ))}
    </div>
  );
}

function Users() {
  const { me } = useSession();
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useAsync(() => api<{ users: Row[] }>(`/admin/users?q=${encodeURIComponent(q)}`), [q]);
  const { run, view } = useAction();
  const roles = ['mentor', 'content_editor', 'admin'];
  return (
    <div className="stack">
      <h2>Pengguna & akomodasi</h2>
      {view}
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(String(new FormData(e.currentTarget).get('q') ?? ''));
        }}
        className="btn-row"
      >
        <label htmlFor="user-q" className="visually-hidden">
          Cari pengguna
        </label>
        <input id="user-q" name="q" type="search" placeholder="Cari nama atau email" style={{ maxWidth: '20rem' }} />
        <button className="btn btn-secondary" type="submit">
          Cari
        </button>
      </form>
      {loading && <Loading />}
      {Boolean(error) && <ErrorAlert error={error} onRetry={reload} />}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Nama</th>
              <th scope="col">Role</th>
              <th scope="col">Pengecualian anti-salin</th>
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => {
              const userRoles = String(u.roles ?? '').split(',');
              return (
                <tr key={String(u.id)}>
                  <td>
                    {String(u.display_name)}
                    {u.email ? <div className="muted">{String(u.email)}</div> : null}
                  </td>
                  <td>
                    {hasRole(me, 'admin')
                      ? roles.map((r) => (
                          <label key={r} className="check">
                            <input
                              type="checkbox"
                              checked={userRoles.includes(r)}
                              onChange={async (e) => {
                                if (await run(() => api(`/admin/users/${String(u.id)}/roles`, { method: 'POST', body: { role: r, grant: e.target.checked } })))
                                  reload();
                              }}
                            />
                            {r}
                          </label>
                        ))
                      : userRoles.join(', ')}
                  </td>
                  <td>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={u.copy_deterrence_exempt === 1}
                        onChange={async (e) => {
                          if (
                            await run(() =>
                              api(`/admin/users/${String(u.id)}/accommodation`, {
                                method: 'PUT',
                                body: { copyDeterrenceExempt: e.target.checked, note: 'akomodasi aksesibilitas' },
                              }),
                            )
                          )
                            reload();
                        }}
                      />
                      Bebaskan dari pembatasan salin/klik kanan (akomodasi aksesibilitas)
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Audit() {
  const { data, error, loading, reload } = useAsync(() => api<{ logs: Row[] }>('/admin/audit'), []);
  return (
    <div className="stack">
      <h2>Log audit admin</h2>
      {loading && <Loading />}
      {Boolean(error) && <ErrorAlert error={error} onRetry={reload} />}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Waktu</th>
              <th scope="col">Pelaku</th>
              <th scope="col">Aksi</th>
              <th scope="col">Target</th>
            </tr>
          </thead>
          <tbody>
            {data?.logs.map((l) => (
              <tr key={String(l.id)}>
                <td>{new Date(Number(l.created_at)).toLocaleString('id-ID')}</td>
                <td>{String(l.actor ?? '–')}</td>
                <td>{String(l.action)}</td>
                <td>
                  {String(l.target_type)} {String(l.target_id ?? '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Report({ courseId }: { courseId: string }) {
  const { data, error, loading, reload } = useAsync(() => api<{ learners: Row[] }>(`/admin/reports/${courseId}`), [courseId]);
  const { run, view } = useAction();
  const upgrade = (l: Row) =>
    window.confirm(`Pindahkan ${String(l.display_name)} dari versi ${String(l.version_no)} ke versi ${String(l.current_version_no)}? Progres materi dengan kode yang sama ikut terbawa.`) &&
    void run(async () => {
      await api(`/admin/courses/${courseId}/enrollments/${String(l.user_id)}/upgrade`, { method: 'POST' });
      reload();
    }, 'Peserta dipindahkan ke versi terbaru.');
  return (
    <div className="stack">
      <h2>Laporan kelas</h2>
      <p className="muted">Data minimal sesuai kebutuhan pemantauan. Jangan diekspor ke pihak yang tidak berwenang.</p>
      {view}
      {loading && <Loading />}
      {Boolean(error) && <ErrorAlert error={error} onRetry={reload} />}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Peserta</th>
              <th scope="col">Materi selesai</th>
              <th scope="col">Percobaan</th>
              <th scope="col">Nilai terbaik</th>
              <th scope="col">Lulus</th>
              <th scope="col">Versi</th>
            </tr>
          </thead>
          <tbody>
            {data?.learners.map((l, i) => (
              <tr key={i}>
                <td>{String(l.display_name)}</td>
                <td>
                  {String(l.lessons_completed)}/{String(l.lessons_total)}
                </td>
                <td>{String(l.attempts)}</td>
                <td>{l.best_score === null ? '–' : `${String(l.best_score)}%`}</td>
                <td>{Number(l.passed_attempts) > 0 ? 'Ya' : 'Belum'}</td>
                <td>
                  v{String(l.version_no)}
                  {l.current_version_no !== null && Number(l.version_no) < Number(l.current_version_no) && (
                    <>
                      {' '}
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => upgrade(l)}>
                        Pindahkan ke v{String(l.current_version_no)}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminApp({ path }: { path: string }) {
  const { me, loading } = useSession();
  if (loading) return <Loading />;
  // Belum login / tanpa role pengelola → halaman masuk admin (server tetap menolak API admin).
  if (!me || !hasRole(me, 'admin', 'content_editor', 'mentor')) return <AdminLoginPage />;
  let body: ReactNode;
  let m: Record<string, string> | null;
  if ((m = match('/admin/kelas/:id', path))) body = <CourseEditor id={m.id!} />;
  else if ((m = match('/admin/laporan/:id', path))) body = <Report courseId={m.id!} />;
  else if (path === '/admin/impor-paket') body = <ImportBundle />;
  else if (path === '/admin/skenario') body = <ScenarioList />;
  else if ((m = match('/admin/skenario/:id', path))) body = <ScenarioDetail id={m.id!} />;
  else if (path === '/admin/review') body = <Reviews />;
  else if (path === '/admin/banding') body = <Appeals />;
  else if (path === '/admin/pengguna') body = <Users />;
  else if (path === '/admin/sertifikat') body = <Certificates />;
  else if (path === '/admin/audit') body = <Audit />;
  else body = hasRole(me, 'admin', 'content_editor') ? <CourseList /> : <Reviews />;
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Panel pengelola</p>
        <PageTitle>Admin</PageTitle>
      </div>
      <Tabs path={path} />
      {body}
    </div>
  );
}
