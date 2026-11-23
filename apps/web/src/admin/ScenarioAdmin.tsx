import { useState, type FormEvent } from 'react';
import { SCENARIO_VERDICT_LABELS, VILLAGE_ROLES, VILLAGE_ROLE_LABELS, type ScenarioDefinition } from '@patradesa/shared';
import { ApiError, api, errorMessage } from '../lib/api';
import { Link, navigate } from '../lib/router';
import { hasRole, useSession } from '../lib/session';
import { ErrorAlert, Loading, useAsync } from '../components/common';
import { RichText } from '../components/ScenarioBlock';

/** Admin Blok Skenario (docs/scenario-block/README.md §10). Validasi & hak akses tetap di server. */

interface ScenarioRow {
  id: string;
  key: string;
  version: number;
  status: 'draft' | 'in_review' | 'published' | 'archived';
  mode: 'formative' | 'graded';
  title: string;
  maxAttempts: number;
  passPercent: number;
  maxScore: number;
  validFrom: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  nextReviewDue: string | null;
  updatedAt: number;
}

const STATUS_LABEL: Record<ScenarioRow['status'], string> = { draft: 'Draf', in_review: 'Ditelaah', published: 'Terbit', archived: 'Arsip' };
const today = () => new Date().toISOString().slice(0, 10);
const plusYear = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

function ValidationErrors({ error }: { error: unknown }) {
  if (!error) return null;
  const details = error instanceof ApiError && Array.isArray(error.details) ? (error.details as { path: string; message: string }[]) : [];
  return (
    <div className="alert alert-error" role="alert">
      <p style={{ margin: 0 }}>
        <strong>Gagal: </strong>
        {errorMessage(error)}
      </p>
      {details.length > 0 && (
        <ul>
          {details.map((d, i) => (
            <li key={i}>
              <code>{d.path}</code> — {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type BatchRow = { name: string; ok: boolean; text: string; error?: unknown };

function BatchResults({ rows }: { rows: BatchRow[] }) {
  if (!rows.length) return null;
  const ok = rows.filter((r) => r.ok).length;
  return (
    <div role="status" className="stack">
      <p>
        <strong>
          {ok} dari {rows.length} berhasil.
        </strong>
      </p>
      <ul>
        {rows.map((r, i) => (
          <li key={i}>
            {r.ok ? '✓' : '✕'} <code>{r.name}</code> — {r.text}
            {!r.ok && <ValidationErrors error={r.error} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Unggah banyak berkas sekaligus: diproses berurutan; satu berkas gagal tidak menghentikan yang lain. */
function BulkUpload({ onDone }: { onDone: () => void }) {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const out: BatchRow[] = [];
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
    for (const f of sorted) {
      try {
        const definition: unknown = JSON.parse(await f.text());
        const r = await api<ScenarioRow>('/admin/scenarios', { method: 'POST', body: { definition } });
        out.push({ name: f.name, ok: true, text: `${r.key} v${r.version} · ${STATUS_LABEL[r.status]} · skor maks ${r.maxScore}` });
      } catch (err) {
        out.push({ name: f.name, ok: false, text: err instanceof SyntaxError ? 'bukan JSON yang valid' : 'ditolak', error: err instanceof SyntaxError ? null : err });
      }
      setRows([...out]);
    }
    setBusy(false);
    onDone();
  };
  return (
    <section className="card stack">
      <h2>Unggah banyak skenario sekaligus</h2>
      <p className="help">Pilih beberapa berkas .json (mis. seluruh isi folder <code>_siap-impor\skenario</code>). Diproses berurutan sesuai nama berkas.</p>
      <label>
        Berkas JSON{' '}
        <input type="file" accept="application/json,.json" multiple disabled={busy} onChange={(e) => void run(e.target.files)} />
      </label>
      {busy && <Loading label={`Mengunggah… (${rows.length} selesai)`} />}
      <BatchResults rows={rows} />
    </section>
  );
}

/** Terbitkan banyak skenario dengan satu data penelaah (hanya admin; server tetap memvalidasi tiap skenario). */
function BulkPublish({ rows, onDone }: { rows: ScenarioRow[]; onDone: () => void }) {
  const candidates = rows.filter((r) => r.status === 'draft' || r.status === 'in_review');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<BatchRow[]>([]);
  const [busy, setBusy] = useState(false);
  if (!candidates.length) return null;
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const review: Record<string, string> = {
      reviewedBy: String(f.get('reviewedBy') ?? ''),
      reviewedAt: String(f.get('reviewedAt') ?? ''),
      nextReviewDue: String(f.get('nextReviewDue') ?? ''),
    };
    const notes = String(f.get('notes') ?? '').trim();
    if (notes) review.notes = notes;
    setBusy(true);
    const out: BatchRow[] = [];
    for (const r of candidates.filter((c) => picked.has(c.id))) {
      try {
        await api(`/admin/scenarios/${r.id}/status`, { method: 'POST', body: { status: 'published', review } });
        out.push({ name: r.key, ok: true, text: `v${r.version} terbit` });
      } catch (err) {
        out.push({ name: r.key, ok: false, text: 'gagal', error: err });
      }
      setResult([...out]);
    }
    setBusy(false);
    setPicked(new Set());
    onDone();
  };
  return (
    <form className="card stack" onSubmit={(e) => void submit(e)}>
      <h2>Terbitkan beberapa skenario</h2>
      <fieldset>
        <legend>Pilih skenario draf/ditelaah</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={picked.size === candidates.length}
            onChange={(e) => setPicked(e.target.checked ? new Set(candidates.map((c) => c.id)) : new Set())}
          />{' '}
          Pilih semua ({candidates.length})
        </label>
        {candidates.map((c) => (
          <label key={c.id} className="check">
            <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} /> <code>{c.key}</code> v{c.version} — {c.title}
          </label>
        ))}
      </fieldset>
      <label>
        Nama penelaah <input name="reviewedBy" required minLength={2} maxLength={80} />
      </label>
      <label>
        Tanggal telaah <input type="date" name="reviewedAt" required defaultValue={today()} />
      </label>
      <label>
        Telaah ulang paling lambat <input type="date" name="nextReviewDue" required defaultValue={plusYear()} />
      </label>
      <label>
        Catatan penelaah (internal) <textarea name="notes" maxLength={1000} rows={2} />
      </label>
      <div className="btn-row">
        <button type="submit" className="btn" disabled={busy || picked.size === 0}>
          {busy ? 'Menerbitkan…' : `Terbitkan terpilih (${picked.size})`}
        </button>
      </div>
      <BatchResults rows={result} />
    </form>
  );
}

function Upload({ onSaved }: { onSaved: (id: string) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    let definition: unknown;
    try {
      definition = JSON.parse(text);
    } catch {
      setError(new Error('Teks bukan JSON yang valid. Periksa tanda kurung, koma, dan tanda kutip.'));
      return;
    }
    setBusy(true);
    try {
      const r = await api<ScenarioRow>('/admin/scenarios', { method: 'POST', body: { definition } });
      setText('');
      onSaved(r.id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card stack" onSubmit={(e) => void submit(e)}>
      <h2>Unggah satu skenario (JSON)</h2>
      <p className="help">
        Periksa dulu dengan <code>python validate_scenario.py berkas.json</code>. Menyimpan blok yang sudah terbit membuat versi baru berstatus draf.
      </p>
      <label>
        Berkas JSON{' '}
        <input type="file" accept="application/json,.json" onChange={(e) => void e.target.files?.[0]?.text().then(setText)} />
      </label>
      <label>
        Atau tempel isi JSON
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} spellCheck={false} style={{ fontFamily: 'monospace', width: '100%' }} />
      </label>
      <ValidationErrors error={error} />
      <div className="btn-row">
        <button type="submit" className="btn" disabled={busy || !text.trim()}>
          {busy ? 'Menyimpan…' : 'Validasi & simpan'}
        </button>
      </div>
    </form>
  );
}

export function ScenarioList() {
  const { me } = useSession();
  const { data, error, loading, reload } = useAsync(() => api<{ scenarios: ScenarioRow[] }>('/admin/scenarios'), []);
  const canEdit = hasRole(me, 'admin', 'content_editor');
  return (
    <div className="stack">
      {canEdit && <BulkUpload onDone={reload} />}
      {canEdit && <Upload onSaved={(id) => navigate(`/admin/skenario/${id}`)} />}
      {hasRole(me, 'admin') && data && <BulkPublish rows={data.scenarios} onDone={reload} />}
      <section className="card">
        <h2>Daftar skenario</h2>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorAlert error={error} onRetry={reload} />
        ) : !data?.scenarios.length ? (
          <p className="muted">Belum ada skenario.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Judul</th>
                  <th scope="col">Kunci · versi</th>
                  <th scope="col">Status</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Telaah ulang</th>
                </tr>
              </thead>
              <tbody>
                {data.scenarios.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/admin/skenario/${s.id}`}>{s.title}</Link>
                    </td>
                    <td>
                      <code>{s.key}</code> · v{s.version}
                    </td>
                    <td>{STATUS_LABEL[s.status]}</td>
                    <td>{s.mode === 'graded' ? 'Dinilai' : 'Latihan'}</td>
                    <td>{s.nextReviewDue && s.nextReviewDue < today() && s.status === 'published' ? <strong>{s.nextReviewDue} (lewat)</strong> : (s.nextReviewDue ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Tree({ def }: { def: ScenarioDefinition }) {
  return (
    <ol className="stack">
      {def.nodes.map((n) => (
        <li key={n.id} className="card card-soft">
          <p className="eyebrow">
            {n.id} · {n.type === 'decision' ? 'keputusan' : n.type === 'info' ? 'info' : 'akhir'}
            {n.id === def.startNodeId ? ' · awal' : ''}
          </p>
          {n.title && <h4>{n.title}</h4>}
          <RichText text={n.body ?? null} />
          {n.type === 'info' && <p className="muted">→ {n.nextNodeId}</p>}
          {n.type === 'decision' && (
            <>
              <p>
                <strong>{n.prompt}</strong>
              </p>
              <ul>
                {n.options.map((o) => (
                  <li key={o.id}>
                    <strong>
                      [{o.id}] {SCENARIO_VERDICT_LABELS[o.verdict]} · {o.score} poin
                    </strong>{' '}
                    {o.text} <span className="muted">→ {o.nextNodeId}</span>
                    <br />
                    <span className="muted">Umpan balik: {o.feedback}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

interface Stats {
  minCell: number;
  attempts: { total: number | null; completed: number | null; learners: number | null };
  averagePercent: number | null;
  bands: { key: string; label: string; count: number | null }[];
  nodes: { id: string; title: string | null; prompt: string; responses: number | null; options: { id: string; text: string; label: string; count: number | null; percent: number | null }[] }[];
}

const cell = (n: number | null) => (n === null ? '< 5' : String(n));

function StatsPanel({ id }: { id: string }) {
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useAsync(() => api<Stats>(`/admin/scenarios/${id}/stats${q}`), [id, q]);
  const apply = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const p = new URLSearchParams();
    for (const k of ['role', 'regency', 'district', 'village', 'from', 'to']) {
      const v = String(f.get(k) ?? '').trim();
      if (v) p.set(k, v);
    }
    setQ(p.toString() ? `?${p}` : '');
  };
  return (
    <section className="card stack" aria-labelledby="stat-judul">
      <h2 id="stat-judul">Statistik pilihan</h2>
      <p className="help">Agregat tanpa nama/email. Angka 1–4 ditampilkan "&lt; 5" agar peserta di desa kecil tidak dapat dikenali. Setiap pembukaan dicatat di audit.</p>
      <form className="btn-row" onSubmit={apply} style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <label>
          Jabatan
          <select name="role" defaultValue="">
            <option value="">Semua</option>
            {VILLAGE_ROLES.map((r) => (
              <option key={r} value={r}>
                {VILLAGE_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kabupaten <input name="regency" maxLength={80} />
        </label>
        <label>
          Kecamatan <input name="district" maxLength={80} />
        </label>
        <label>
          Desa <input name="village" maxLength={80} />
        </label>
        <label>
          Dari <input type="date" name="from" />
        </label>
        <label>
          Sampai <input type="date" name="to" />
        </label>
        <button type="submit" className="btn btn-secondary">
          Terapkan
        </button>
      </form>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorAlert error={error} onRetry={reload} />
      ) : data ? (
        <>
          <p>
            Attempt: <strong>{cell(data.attempts.total)}</strong> · selesai <strong>{cell(data.attempts.completed)}</strong> · peserta{' '}
            <strong>{cell(data.attempts.learners)}</strong> · rata-rata {data.averagePercent === null ? '—' : `${data.averagePercent}%`}
          </p>
          <p>Sebaran hasil: {data.bands.map((b) => `${b.label} ${cell(b.count)}`).join(' · ')}</p>
          {data.nodes.map((n) => (
            <div key={n.id} className="table-scroll">
              <table>
                <caption>
                  {n.id}: {n.prompt} (jawaban: {cell(n.responses)})
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Opsi</th>
                    <th scope="col">Penilaian</th>
                    <th scope="col">Jumlah</th>
                    <th scope="col">%</th>
                  </tr>
                </thead>
                <tbody>
                  {n.options.map((o) => (
                    <tr key={o.id}>
                      <td>{o.text}</td>
                      <td>{o.label}</td>
                      <td>{cell(o.count)}</td>
                      <td>{o.percent === null ? '—' : `${o.percent}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}

export function ScenarioDetail({ id }: { id: string }) {
  const { me } = useSession();
  const { data, error, loading, reload } = useAsync(
    () => api<ScenarioRow & { definition: ScenarioDefinition; usedIn: { course_title: string; version_no: number; lesson_title: string }[] }>(`/admin/scenarios/${id}`),
    [id],
  );
  const [actionError, setActionError] = useState<unknown>(null);
  const [ok, setOk] = useState<string | null>(null);
  const isAdmin = hasRole(me, 'admin');
  const canEdit = hasRole(me, 'admin', 'content_editor');

  const setStatus = async (status: ScenarioRow['status'], review?: Record<string, string>) => {
    setActionError(null);
    setOk(null);
    try {
      await api(`/admin/scenarios/${id}/status`, { method: 'POST', body: review ? { status, review } : { status } });
      setOk('Status diperbarui.');
      reload();
    } catch (e) {
      setActionError(e);
    }
  };
  const publish = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const review: Record<string, string> = {
      reviewedBy: String(f.get('reviewedBy') ?? ''),
      reviewedAt: String(f.get('reviewedAt') ?? ''),
      nextReviewDue: String(f.get('nextReviewDue') ?? ''),
    };
    const notes = String(f.get('notes') ?? '').trim();
    if (notes) review.notes = notes;
    void setStatus('published', review);
  };

  if (loading) return <Loading />;
  if (error) return <ErrorAlert error={error} onRetry={reload} />;
  if (!data) return null;
  const editable = data.status === 'draft' || data.status === 'in_review';
  return (
    <div className="stack">
      <p>
        <Link href="/admin/skenario">← Semua skenario</Link>
      </p>
      <section className="card stack">
        <h2>{data.title}</h2>
        <p>
          <code>{data.key}</code> · versi {data.version} · <strong>{STATUS_LABEL[data.status]}</strong> · {data.mode === 'graded' ? 'Dinilai' : 'Latihan'} · lulus ≥{' '}
          {data.passPercent}% · skor maks {data.maxScore} · {data.maxAttempts}× kesempatan · berlaku per {data.validFrom}
        </p>
        {data.reviewedBy && (
          <p className="muted">
            Ditelaah {data.reviewedBy} ({data.reviewedAt}); telaah ulang {data.nextReviewDue}.
          </p>
        )}
        <p>
          Sisipkan di materi dengan satu baris: <code>[[skenario:{data.key}]]</code>
        </p>
        {data.usedIn.length > 0 && (
          <p className="muted">Dipakai di: {data.usedIn.map((u) => `${u.course_title} v${u.version_no} — ${u.lesson_title}`).join('; ')}</p>
        )}
        {ok && (
          <p className="alert alert-success" role="status">
            {ok}
          </p>
        )}
        <ValidationErrors error={actionError} />
        <div className="btn-row">
          {canEdit && data.status === 'draft' && (
            <button type="button" className="btn btn-secondary" onClick={() => void setStatus('in_review')}>
              Kirim ke penelaah
            </button>
          )}
          {canEdit && data.status === 'in_review' && (
            <button type="button" className="btn btn-secondary" onClick={() => void setStatus('draft')}>
              Kembalikan ke draf
            </button>
          )}
          {isAdmin && data.status !== 'archived' && (
            <button type="button" className="btn btn-danger" onClick={() => void setStatus('archived')}>
              Arsipkan
            </button>
          )}
        </div>
        {isAdmin && editable && (
          <form className="card card-soft stack" onSubmit={publish}>
            <h3>Terbitkan (data penelaah wajib)</h3>
            <label>
              Nama penelaah <input name="reviewedBy" required minLength={2} maxLength={80} />
            </label>
            <label>
              Tanggal telaah <input type="date" name="reviewedAt" required defaultValue={today()} />
            </label>
            <label>
              Telaah ulang paling lambat <input type="date" name="nextReviewDue" required defaultValue={plusYear()} />
            </label>
            <label>
              Catatan penelaah (internal) <textarea name="notes" maxLength={1000} rows={2} />
            </label>
            <div className="btn-row">
              <button type="submit" className="btn">
                Terbitkan skenario
              </button>
            </div>
          </form>
        )}
      </section>
      {hasRole(me, 'admin', 'mentor') && data.status !== 'draft' && <StatsPanel id={id} />}
      <section className="card stack">
        <h2>Pratinjau alur</h2>
        <Tree def={data.definition} />
      </section>
    </div>
  );
}
