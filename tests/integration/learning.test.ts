/** Waktu belajar server-authoritative, sesi belajar, kelayakan kuis, akses & versi course. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createHarness, seedDemoCourse, type Harness } from '../helpers/harness';

let h: Harness;
let admin: Client;
let courseId: string;
let lesson1: string;
let quizLesson: string;
let assessmentId: string;

beforeAll(async () => {
  h = await createHarness();
  admin = await new Client(h).login('admin@contoh.test', 'Admin Uji', ['admin']);
  const s = await seedDemoCourse(admin);
  courseId = s.courseId;
  lesson1 = s.lessonIds[0]!;
  quizLesson = s.lessonIds[1]!;
  assessmentId = s.assessmentId;
});
afterAll(() => h.dispose());

const hb = (c: Client, lessonId: string, sessionId: string, visible = true, interacted = true, extra: Record<string, unknown> = {}) =>
  c.json('POST', `/api/v1/lessons/${lessonId}/heartbeat`, { sessionId, visible, interacted, ...extra });

describe('belajar & waktu aktif', () => {
  it('katalog publik tanpa login; rekomendasi berdasarkan jabatan tidak memberi akses', async () => {
    const anon = new Client(h);
    const cat = await anon.json('GET', '/api/v1/catalog');
    expect(cat.status).toBe(200);
    expect(cat.body.courses[0].slug).toBe('dasar-transparansi-desa');
    const l = await new Client(h).login('rek@contoh.test', 'Rek');
    await l.json('PATCH', '/api/v1/me', { villageRole: 'sekdes', privacyConsent: true });
    const cat2 = await l.json('GET', '/api/v1/catalog');
    expect(cat2.body.courses[0].recommended).toBe(true);
    // Belum enroll → materi tidak dapat dibuka walau direkomendasikan.
    expect((await l.json('GET', `/api/v1/lessons/${lesson1}/content`)).status).toBe(404);
  });

  it('heartbeat dikreditkan dari jam SERVER, dibatasi, nol saat tab tersembunyi/idle/spam; klaim detik dari klien ditolak', async () => {
    const l = await new Client(h).login('hb@contoh.test', 'HB');
    await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
    const s = (await l.json('POST', `/api/v1/lessons/${lesson1}/session`)).body;
    expect(s.requiredActiveSeconds).toBe(60);
    expect(s.completed).toBe(false);

    // Klaim seconds_read dari klien → skema strict menolak.
    expect((await hb(l, lesson1, s.sessionId, true, true, { seconds_read: 9999 })).status).toBe(400);

    // Spam (< 15 dtk) → tidak ada kredit.
    h.clock.t += 5_000;
    expect((await hb(l, lesson1, s.sessionId)).body.credited).toBe(0);
    // 25 dtk aktif → kredit 25 (diukur dari heartbeat terakhir yang tercatat).
    h.clock.t += 20_000;
    expect((await hb(l, lesson1, s.sessionId)).body.credited).toBe(25);
    // Tab tersembunyi → 0.
    h.clock.t += 25_000;
    expect((await hb(l, lesson1, s.sessionId, false, true)).body.credited).toBe(0);
    // Jeda panjang (idle 10 menit) → 0, bukan 600.
    h.clock.t += 600_000;
    expect((await hb(l, lesson1, s.sessionId)).body.credited).toBe(0);
    // Kredit dibatasi maksimum 30 dtk per heartbeat.
    h.clock.t += 45_000;
    const capped = await hb(l, lesson1, s.sessionId);
    expect(capped.body.credited).toBe(30);
    expect(capped.body.activeSeconds).toBe(55);
    expect(capped.body.completed).toBe(false);
    h.clock.t += 25_000;
    const done = await hb(l, lesson1, s.sessionId);
    expect(done.body.activeSeconds).toBe(80);
    expect(done.body.completed).toBe(true);
  });

  it('heartbeat paralel tidak dikreditkan ganda', async () => {
    const l = await new Client(h).login('hb2@contoh.test', 'HB2');
    await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
    const s = (await l.json('POST', `/api/v1/lessons/${lesson1}/session`)).body;
    h.clock.t += 25_000;
    const [a, b] = await Promise.all([hb(l, lesson1, s.sessionId), hb(l, lesson1, s.sessionId)]);
    expect(a.body.credited + b.body.credited).toBe(25);
  });

  it('sesi belajar kedaluwarsa → 410 dan harus mulai sesi baru', async () => {
    const l = await new Client(h).login('ttl@contoh.test', 'TTL');
    await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
    const s = (await l.json('POST', `/api/v1/lessons/${lesson1}/session`)).body;
    h.clock.t = s.expiresAt + 1;
    const r = await hb(l, lesson1, s.sessionId);
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe('SESSION_EXPIRED');
    expect((await l.json('POST', `/api/v1/lessons/${lesson1}/session`)).status).toBe(201);
  });

  it('kuis terkunci sampai syarat waktu belajar lesson terpenuhi (server)', async () => {
    await h.env.DB.prepare('UPDATE lessons SET required_active_seconds = 30 WHERE id = ?').bind(quizLesson).run();
    const l = await new Client(h).login('gate@contoh.test', 'Gate');
    await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
    const s = (await l.json('POST', `/api/v1/lessons/${quizLesson}/session`)).body;
    const blocked = await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('NOT_ELIGIBLE');
    h.clock.t += 30_000;
    expect((await hb(l, quizLesson, s.sessionId)).body.completed).toBe(true);
    expect((await l.json('POST', `/api/v1/assessments/${assessmentId}/attempts`)).status).toBe(201);
    await h.env.DB.prepare('UPDATE lessons SET required_active_seconds = 0 WHERE id = ?').bind(quizLesson).run();
  });

  it('masa akses & jendela pendaftaran ditegakkan server', async () => {
    const now = h.clock.t;
    await admin.json('PATCH', `/api/v1/admin/courses/${courseId}`, { enrollmentCloseAt: now - 1 });
    const late = await new Client(h).login('telat@contoh.test', 'Telat');
    const e = await late.json('POST', `/api/v1/courses/${courseId}/enroll`);
    expect(e.status).toBe(403);
    expect(e.body.error.code).toBe('ENROLLMENT_CLOSED');
    await admin.json('PATCH', `/api/v1/admin/courses/${courseId}`, { enrollmentCloseAt: null, accessDurationDays: 1 });
    const l = await new Client(h).login('durasi@contoh.test', 'Durasi');
    await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
    expect((await l.json('GET', `/api/v1/lessons/${lesson1}/content`)).status).toBe(200);
    h.clock.t += 86_400_000 + 1;
    const exp = await l.json('GET', `/api/v1/lessons/${lesson1}/content`);
    expect(exp.status).toBe(403);
    expect(exp.body.error.code).toBe('ACCESS_EXPIRED');
    await admin.json('PATCH', `/api/v1/admin/courses/${courseId}`, { accessDurationDays: null });
  });

  it('konten terstruktur (tanpa HTML mentah) dan versi terbit immutable; peserta lama tetap pada versinya', async () => {
    const l = await new Client(h).login('versi@contoh.test', 'Versi');
    await l.json('POST', `/api/v1/courses/${courseId}/enroll`);
    const c = await l.json('GET', `/api/v1/lessons/${lesson1}/content`);
    expect(c.body.blocks[0]).toEqual({ type: 'h2', text: 'Keterbukaan membangun kepercayaan' });
    // Edit langsung pada versi terbit ditolak.
    const edit = await admin.json('PUT', `/api/v1/admin/lessons/${lesson1}`, { title: 'Ubah', contentType: 'html', contentSource: 'x' });
    expect(edit.status).toBe(409);
    // Draft baru (clone) → edit → publish.
    const d = await admin.json('POST', `/api/v1/admin/courses/${courseId}/draft`);
    expect(d.status).toBe(201);
    const detail = await admin.json('GET', `/api/v1/admin/courses/${courseId}`);
    expect(detail.body.lessons).toHaveLength(2);
    expect(detail.body.lessons[1].assessment.questions.length).toBe(12);
    const newLesson1 = detail.body.lessons[0].id;
    expect((await admin.json('PUT', `/api/v1/admin/lessons/${newLesson1}`, { title: 'Judul Versi 2', contentType: 'html', contentSource: '## Baru' })).status).toBe(200);
    expect((await admin.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(200);
    // Peserta lama tetap melihat versi 1.
    const old = await l.json('GET', `/api/v1/courses/${courseId}`);
    expect(old.body.lessons[0].title).toBe('Mengapa Keterbukaan Penting');
    // Peserta baru mendapat versi 2.
    const n = await new Client(h).login('baru@contoh.test', 'Baru');
    await n.json('POST', `/api/v1/courses/${courseId}/enroll`);
    expect((await n.json('GET', `/api/v1/courses/${courseId}`)).body.lessons[0].title).toBe('Judul Versi 2');
    // content_editor tidak dapat publish.
    const editor = await new Client(h).login('editor@contoh.test', 'Editor', ['content_editor']);
    await editor.json('POST', `/api/v1/admin/courses/${courseId}/draft`);
    expect((await editor.json('POST', `/api/v1/admin/courses/${courseId}/publish`)).status).toBe(403);
  });
});
