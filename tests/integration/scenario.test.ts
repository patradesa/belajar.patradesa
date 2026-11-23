/** Blok Skenario Bercabang: authoring admin, pin saat terbit, delivery tanpa kunci, alur peserta, kelulusan, statistik. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, type Harness } from '../helpers/harness';

const ROOT = join(import.meta.dirname, '..', '..');
const contoh = () => JSON.parse(readFileSync(join(ROOT, 'docs', 'scenario-block', 'contoh-adm01-beda-nama-bali.json'), 'utf8'));
const KEY = 'adm01-beda-nama-bali';
const REVIEW = { reviewedBy: 'Penelaah Uji', reviewedAt: '2026-11-20', nextReviewDue: '2027-11-20' };
const LEAK = /"(verdict|score|feedback|nextNodeId|scoring|bands|passPercent|review|reviewedBy|notes|authors)"/;

let h: Harness;
let admin: Client;
let courseId: string;
let lessonId: string;
let blockId: string;

/** Kunci tampilan (p1..p4) untuk id opsi asli — hanya tes yang boleh membaca urutan acak dari DB. */
async function keyFor(attemptId: string, nodeId: string, optionId: string): Promise<string> {
  const r = await h.env.DB.prepare('SELECT option_order_json FROM scenario_attempts WHERE id = ?').bind(attemptId).first<{ option_order_json: string }>();
  const order = JSON.parse(r!.option_order_json) as Record<string, string[]>;
  return `p${order[nodeId]!.indexOf(optionId) + 1}`;
}

async function learner(email: string): Promise<Client> {
  const l = await new Client(h).login(email, email.split('@')[0]!);
  expect((await l.json('POST', `/api/v1/courses/${courseId}/enroll`)).status).toBeLessThan(300);
  await l.json('GET', `/api/v1/lessons/${lessonId}/content`);
  return l;
}

const start = (l: Client) => l.json('POST', `/api/v1/scenarios/${blockId}/attempts`, { lessonId });
const choose = (l: Client, attemptId: string, body: unknown) => l.json('POST', `/api/v1/scenario-attempts/${attemptId}/choices`, body);

/** Jalankan satu attempt sampai selesai dengan pilihan per node keputusan (id opsi asli). */
async function run(l: Client, picks: Record<string, string>) {
  let d = (await start(l)).body;
  const id = d.attempt.id as string;
  for (let i = 0; i < 12 && !d.final; i++) {
    const node = d.node;
    const body = node.type === 'info' ? { nodeId: node.id, continue: true } : { nodeId: node.id, optionKey: await keyFor(id, node.id, picks[node.id]!) };
    const r = await choose(l, id, body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    d = r.body.delivery;
  }
  return d;
}

const BEST = { d1: 'b', d2: 'a', d3: 'b' };
const WORST = { d1: 'a', d2: 'd', d3: 'a' };

beforeAll(async () => {
  h = await createHarness();
  admin = await new Client(h).login('admin@contoh.test', 'Admin', ['admin']);
});
afterAll(() => h.dispose());

describe('authoring & penerbitan', () => {
  it('editor/admin menyimpan JSON; tidak valid → 400 dengan lokasi; learner → 403', async () => {
    const bad = contoh();
    bad.nodes[3].options[1].nextNodeId = 'hilang';
    const r = await admin.json('POST', '/api/v1/admin/scenarios', { definition: bad });
    expect(r.status).toBe(400);
    expect(r.body.error.details).toContainEqual({ path: '/nodes/3/options/1/nextNodeId', message: "node 'hilang' tidak ada" });

    const ok = await admin.json('POST', '/api/v1/admin/scenarios', { definition: contoh() });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ key: KEY, version: 1, status: 'draft', maxScore: 30, mode: 'graded' });
    blockId = ok.body.id;
    // Simpan ulang saat masih draft → baris yang sama.
    expect((await admin.json('POST', '/api/v1/admin/scenarios', { definition: contoh() })).body.id).toBe(blockId);

    const l = await new Client(h).login('bukanadmin@contoh.test', 'Bukan');
    expect((await l.json('GET', '/api/v1/admin/scenarios')).status).toBe(403);
    expect((await l.json('POST', '/api/v1/admin/scenarios', { definition: contoh() })).status).toBe(403);
  });

  it('materi dengan kunci tak dikenal ditolak; kelas tidak bisa terbit sebelum skenarionya terbit', async () => {
    const c = await admin.json('POST', '/api/v1/admin/courses', { slug: 'kelas-skenario-uji', title: 'Kelas Skenario Uji', description: 'Uji', visibility: 'public' });
    courseId = c.body.id;
    const lesson = (src: string) =>
      admin.json('POST', `/api/v1/admin/courses/${courseId}/lessons`, { title: 'Layanan beda nama', summary: '', contentType: 'html', contentSource: src, requiredActiveSeconds: 0, isRequired: true });
    const unknown = await lesson('Pengantar.\n\n[[skenario:tidak-ada-skenario]]');
    expect(unknown.status).toBe(400);
    const l = await lesson(`## Layanan\n\nPengantar singkat.\n\n[[skenario:${KEY}]]`);
    expect(l.status).toBe(201);
    lessonId = l.body.id;
    const early = await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`);
    expect(early.status).toBe(409);
    expect(early.body.error.message).toContain(KEY);
  });

  it('terbit wajib data penelaah; hanya admin; lalu kelas terbit dan blok dipin', async () => {
    const editor = await new Client(h).login('editor@contoh.test', 'Editor', ['content_editor']);
    expect((await editor.json('POST', `/api/v1/admin/scenarios/${blockId}/status`, { status: 'in_review' })).status).toBe(200);
    expect((await editor.json('POST', `/api/v1/admin/scenarios/${blockId}/status`, { status: 'published', review: REVIEW })).status).toBe(403);
    expect((await admin.json('POST', `/api/v1/admin/scenarios/${blockId}/status`, { status: 'published' })).status).toBe(400);
    const pub = await admin.json('POST', `/api/v1/admin/scenarios/${blockId}/status`, { status: 'published', review: REVIEW });
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ status: 'published', reviewedBy: 'Penelaah Uji', nextReviewDue: '2027-11-20' });
    // Versi published immutable: simpan ulang membuat versi 2 (draft), bukan menimpa.
    const v2 = await admin.json('POST', '/api/v1/admin/scenarios', { definition: contoh() });
    expect(v2.body).toMatchObject({ version: 2, status: 'draft' });
    expect(v2.body.id).not.toBe(blockId);

    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);
    const pin = await h.env.DB.prepare('SELECT scenario_block_id FROM lesson_scenarios WHERE lesson_id = ?').bind(lessonId).first<{ scenario_block_id: string }>();
    expect(pin!.scenario_block_id).toBe(blockId);
    const audit = await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action = 'scenario.published' AND target_id = ?`).bind(blockId).first<{ n: number }>();
    expect(audit!.n).toBe(1);
  });
});

describe('alur peserta', () => {
  it('materi memuat ringkasan blok; delivery tidak membocorkan kunci; urutan opsi p1..p4', async () => {
    const l = await learner('budi@contoh.test');
    const content = await l.json('GET', `/api/v1/lessons/${lessonId}/content`);
    expect(content.body.blocks).toContainEqual({ type: 'scenario', key: KEY });
    expect(content.body.scenarios).toEqual([
      expect.objectContaining({ blockId, key: KEY, mode: 'graded', maxAttempts: 3, attemptsUsed: 0, activeAttemptId: null, passed: false, needsLocalValidation: true, localValidationNote: expect.stringContaining('Disdukcapil') }),
    ]);

    const s = await start(l);
    expect(s.status).toBe(201);
    expect(JSON.stringify(s.body)).not.toMatch(LEAK);
    expect(s.body.node).toMatchObject({ id: 'intro', type: 'info', options: [] });
    expect(s.body.block).toMatchObject({ key: KEY, validFrom: '2026-11-01', needsLocalValidation: true, decisionCount: { done: 0, maxOnPath: 3 } });

    // Mulai lagi → attempt aktif yang sama (idempoten).
    const again = await start(l);
    expect(again.status).toBe(200);
    expect(again.body.attempt.id).toBe(s.body.attempt.id);

    const next = await choose(l, s.body.attempt.id, { nodeId: 'intro', continue: true });
    expect(next.body.result).toBeNull();
    const d1 = next.body.delivery.node;
    expect(d1.id).toBe('d1');
    expect(d1.options.map((o: any) => o.key)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(JSON.stringify(next.body)).not.toMatch(LEAK);
    for (const o of d1.options) expect(Object.keys(o).sort()).toEqual(['key', 'text']);
  });

  it('node tidak aktif → 409; kirim ulang pilihan sama → hasil sama; pilihan beda → 409', async () => {
    const l = await learner('sari@contoh.test');
    const s = (await start(l)).body;
    const id = s.attempt.id;
    const wrongNode = await choose(l, id, { nodeId: 'd2', optionKey: 'p1' });
    expect(wrongNode.status).toBe(409);
    expect(wrongNode.body.error.code).toBe('NODE_NOT_ACTIVE');
    await choose(l, id, { nodeId: 'intro', continue: true });
    const k = await keyFor(id, 'd1', 'b');
    const first = await choose(l, id, { nodeId: 'd1', optionKey: k });
    expect(first.body.result).toMatchObject({ verdict: 'best', label: 'Tepat' });
    const replay = await choose(l, id, { nodeId: 'd1', optionKey: k });
    expect(replay.status).toBe(200);
    expect(replay.body.result).toEqual(first.body.result);
    expect(replay.body.delivery.node.id).toBe('d2');
    const other = await choose(l, id, { nodeId: 'd1', optionKey: k === 'p1' ? 'p2' : 'p1' });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('ALREADY_ANSWERED');
    // Lanjut setelah "koneksi putus": GET melanjutkan dari node aktif dengan riwayat.
    const resume = await l.json('GET', `/api/v1/scenario-attempts/${id}`);
    expect(resume.body.node.id).toBe('d2');
    expect(resume.body.history).toEqual([expect.objectContaining({ nodeId: 'd1', label: 'Tepat' })]);
  });

  it('IDOR: attempt milik orang lain → 404; tidak terdaftar → 404', async () => {
    const owner = await learner('owner@contoh.test');
    const id = (await start(owner)).body.attempt.id;
    const intruder = await learner('intruder@contoh.test');
    expect((await intruder.json('GET', `/api/v1/scenario-attempts/${id}`)).status).toBe(404);
    expect((await choose(intruder, id, { nodeId: 'intro', continue: true })).status).toBe(404);
    const outsider = await new Client(h).login('luar@contoh.test', 'Luar');
    expect((await start(outsider)).status).toBe(404);
    expect((await new Client(h).json('GET', `/api/v1/scenario-attempts/${id}`)).status).toBe(401);
  });

  it('jalur terbaik 30/30 → 100% "Sangat baik" & syarat lulus terpenuhi; jalur terburuk 0/30 → "Perlu mengulang"', async () => {
    const l = await learner('terbaik@contoh.test');
    const before = await l.json('GET', `/api/v1/courses/${courseId}`);
    expect(before.body.completion.reasons).toContain('Skenario "Nama Anak Beda di KK dan Akta: Melayani Tanpa Menolak" belum lulus.');
    const best = await run(l, BEST);
    expect(best.final).toMatchObject({ score: 30, maxScore: 30, percent: 100, passed: true, band: { label: 'Sangat baik' }, attemptsLeft: 2 });
    expect(best.history).toHaveLength(3);
    expect(best.node).toMatchObject({ type: 'end' });
    const after = await l.json('GET', `/api/v1/courses/${courseId}`);
    expect(after.body.completion).toEqual({ passed: true, reasons: [] });
    expect((await l.json('GET', `/api/v1/lessons/${lessonId}/content`)).body.scenarios[0]).toMatchObject({ passed: true, bestPercent: 100, attemptsUsed: 1 });

    const w = await learner('terburuk@contoh.test');
    const worst = await run(w, WORST);
    expect(worst.final).toMatchObject({ score: 0, percent: 0, passed: false, band: { label: 'Perlu mengulang' } });
    expect((await w.json('GET', `/api/v1/courses/${courseId}`)).body.completion.passed).toBe(false);
    const mine = (await w.json('GET', '/api/v1/me/courses')).body.courses.find((c: any) => c.id === courseId);
    expect(mine).toMatchObject({ requiredQuizzes: 1, passedQuizzes: 0 });
  });

  it('batas attempt ditegakkan; attempt selesai tidak bisa diubah', async () => {
    const l = await learner('ulang@contoh.test');
    let last: any;
    for (let i = 0; i < 3; i++) last = await run(l, WORST);
    expect(last.final.attemptsLeft).toBe(0);
    const over = await start(l);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('MAX_ATTEMPTS');
    const closed = await choose(l, last.attempt.id, { nodeId: 'selesai', continue: true });
    expect(closed.status).toBe(409);
  });
});

describe('statistik admin', () => {
  it('admin: sebaran per node tanpa identitas, sel < 5 disamarkan, akses diaudit; learner 403; mentor tak ditugaskan 404', async () => {
    const before = await admin.json('GET', `/api/v1/admin/scenarios/${blockId}/stats`);
    // Sejauh ini opsi 'a' di d1 dipilih 4× → masih disamarkan.
    expect(before.body.nodes[0].options.find((o: any) => o.id === 'a').count).toBeNull();
    await run(await learner('kelima@contoh.test'), WORST);
    const r = await admin.json('GET', `/api/v1/admin/scenarios/${blockId}/stats`);
    expect(r.status).toBe(200);
    expect(r.body.minCell).toBe(5);
    expect(r.body.nodes.map((n: any) => n.id)).toEqual(['d1', 'd2', 'd3']);
    expect(JSON.stringify(r.body)).not.toMatch(/@contoh\.test|display_name|user_id/);
    const d1 = r.body.nodes[0];
    // Opsi 'a' (terburuk) kini dipilih 5× → tampil; 'b' 2× → tetap disamarkan.
    expect(d1.options.find((o: any) => o.id === 'a')).toMatchObject({ count: 5, label: 'Kurang tepat' });
    expect(d1.options.find((o: any) => o.id === 'b')).toMatchObject({ count: null, percent: null });

    const filtered = await admin.json('GET', `/api/v1/admin/scenarios/${blockId}/stats?role=sekdes&regency=Buleleng&from=2026-11-01&to=2026-11-30`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.attempts.total).toBe(0);
    expect((await admin.json('GET', `/api/v1/admin/scenarios/${blockId}/stats?role=raja`)).status).toBe(400);

    const audit = await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action = 'scenario.stats.view'`).first<{ n: number }>();
    expect(audit!.n).toBe(3);

    const l = await new Client(h).login('peserta-stat@contoh.test', 'P');
    expect((await l.json('GET', `/api/v1/admin/scenarios/${blockId}/stats`)).status).toBe(403);
    const mentor = await new Client(h).login('mentor@contoh.test', 'Mentor', ['mentor']);
    expect((await mentor.json('GET', `/api/v1/admin/scenarios/${blockId}/stats`)).status).toBe(404);
  });
});
