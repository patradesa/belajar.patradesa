/**
 * Pengubah format "paket kelas 1.0.0" (schema_version "1.0.0": modules[], content_html, interactive_blocks,
 * questions — dipakai alur produksi materi berbantuan AI) menjadi paket LMS patradesa-course-bundle-v1.
 *
 * Prinsip: tidak mengarang. Nilai yang tidak ada di sumber diisi bawaan yang netral dan DILAPORKAN sebagai
 * catatan; yang tidak bisa ditentukan (mis. penilaian pilihan skenario) dilaporkan sebagai masalah.
 * Spesifikasi: docs/course-bundle/README.md §"Format 1.0.0".
 */
import { z } from 'zod';
import { VILLAGE_ROLES, type VillageRole } from '../constants';
import { COURSE_BUNDLE_VERSION } from './courseBundle';

const looseText = z.string();
const choiceSchema = z.looseObject({ id: looseText.optional(), label: looseText, feedback: looseText.default(''), next_node_id: looseText.nullable().optional() });
const blockSchema = z.looseObject({ type: looseText, id: looseText, title: looseText.default('') });
const questionSchema = z.looseObject({ id: looseText.optional(), type: looseText, prompt: looseText });
const moduleSchema = z.looseObject({
  order: z.number().optional(),
  slug: looseText,
  title: looseText,
  duration_minutes: z.number().optional(),
  is_mandatory: z.boolean().optional(),
  content_html: looseText,
  interactive_blocks: z.array(blockSchema).default([]),
  questions: z.array(questionSchema).default([]),
});
export const CoursePackageV1Schema = z.looseObject({
  schema_version: z.literal('1.0.0'),
  course: z.looseObject({
    slug: looseText,
    title: looseText,
    summary: looseText.default(''),
    target_roles: z.array(looseText).default([]),
    completion_rules: z.looseObject({ min_quiz_score: z.number().optional() }).optional(),
  }),
  modules: z.array(moduleSchema).min(1),
});

export function isCoursePackageV1(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).schema_version === '1.0.0' && Array.isArray((raw as Record<string, unknown>).modules);
}

export interface ConversionResult {
  /** Paket LMS (belum divalidasi; jalankan CourseBundleSchema). Null bila ada masalah. */
  bundle: Record<string, unknown> | null;
  problems: string[];
  notes: string[];
}

// ---------------------------------------------------------------- utilitas teks

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** HTML sederhana → Markdown-lite LMS. Tag tak dikenal dibuang (teksnya dipertahankan) dan dilaporkan. */
export function htmlToMarkdownLite(html: string, unknownTags: Set<string> = new Set()): string {
  const inline = (t: string) =>
    squash(
      decode(
        t
          .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, x: string) => {
            const inner = squash(x.replace(/<[^>]+>/g, ''));
            return inner ? ` **${inner}** ` : '';
          })
          .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '$2')
          .replace(/<a\b[^>]*href="(https:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, x: string) => `[${squash(x.replace(/<[^>]+>/g, ''))}](${href})`)
          .replace(/<(\/?)([a-z0-9]+)\b[^>]*>/gi, (_m, _c, tag: string) => {
            if (!['span', 'a', 'small', 'u', 'mark', 'sup', 'sub'].includes(tag.toLowerCase())) unknownTags.add(tag.toLowerCase());
            return '';
          }),
      ),
    ).replace(/\*\* ([.,;:!?)])/g, '**$1');
  let s = html.replace(/\r\n?/g, '\n').replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl: string, t: string) => `\n\n${lvl === '3' ? '###' : '##'} ${inline(t)}\n\n`);
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, t: string) => `\n- ${inline(t)}`);
  s = s.replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n\n');
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, t: string) => `\n\n> ${inline(t)}\n\n`);
  s = s.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_m, t: string) => `\n\n${inline(t)}\n\n`);
  s = s.replace(/<\/?(article|section|div|header|footer|main)\b[^>]*>/gi, '\n');
  s = s.replace(/<(\/?)([a-z0-9]+)\b[^>]*>/gi, (_m, _c, tag: string) => {
    unknownTags.add(tag.toLowerCase());
    return '';
  });
  return decode(s)
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------- jabatan

const ROLE_RULES: [RegExp, VillageRole][] = [
  [/perbekel|kepala desa|kades|lurah/i, 'perbekel'],
  [/sekretaris|sekdes/i, 'sekdes'],
  [/\bkaur\b|kepala urusan/i, 'kaur'],
  [/\bkasi\b|kepala seksi/i, 'kasi'],
  [/kelian|kepala dusun|kadus|kawil|kewilayahan/i, 'kawil'],
  [/operator|\bsid\b|sistem informasi desa/i, 'operator_sid'],
  [/\bbpd\b|badan permusyawaratan/i, 'bpd'],
  [/kader|bumdes|pkk|posyandu/i, 'kader'],
];
function mapRoles(labels: string[], notes: string[]): VillageRole[] {
  const out = new Set<VillageRole>();
  for (const label of labels) {
    const hits = ROLE_RULES.filter(([re]) => re.test(label)).map(([, r]) => r);
    if (!hits.length) notes.push(`Jabatan "${label}" tidak cocok dengan kode jabatan LMS; dilewati.`);
    hits.forEach((r) => out.add(r));
  }
  return VILLAGE_ROLES.filter((r) => out.has(r));
}

// ---------------------------------------------------------------- skenario

const nodeIdOf = (raw: string | undefined, fallback: string) => {
  const s = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(s) ? s : fallback;
};
const optionIdOf = (raw: string | undefined, i: number) => {
  const s = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 8);
  return s || String.fromCharCode(97 + i);
};

type Verdict = 'best' | 'acceptable' | 'risky' | 'wrong';
const SCORE: Record<Verdict, number> = { best: 10, acceptable: 6, risky: 3, wrong: 0 };
/** Penilaian diambil dari kata pembuka umpan balik penulis (konvensi panduan penulis); selain itu tidak ditebak. */
function verdictOf(choice: Record<string, unknown>): Verdict | null {
  const explicit = String(choice.verdict ?? '').toLowerCase();
  if (['best', 'acceptable', 'risky', 'wrong'].includes(explicit)) return explicit as Verdict;
  const f = String(choice.feedback ?? '').trim().toLowerCase();
  if (/^(kurang tepat|tidak tepat|salah|keliru)\b/.test(f)) return 'wrong';
  if (/^berisiko\b/.test(f)) return 'risky';
  if (/^(bisa diterima|cukup tepat|cukup)\b/.test(f)) return 'acceptable';
  if (/^(tepat|benar|sangat tepat)\b/.test(f)) return 'best';
  return null;
}

/** Pisahkan kalimat tanya terakhir sebagai prompt (maks 200 karakter). */
function splitPrompt(situation: string): { body: string; prompt: string } {
  const text = squash(situation);
  const m = /([^.?!]*\?)\s*$/.exec(text);
  if (m && m[1]!.trim().length >= 5 && m[1]!.trim().length <= 200) {
    const body = text.slice(0, m.index).trim();
    return { body: body || text, prompt: m[1]!.trim() };
  }
  return { body: text, prompt: 'Apa langkah yang paling tepat?' };
}

const BANDS_GRADED = [
  { key: 'ulang', minPercent: 0, label: 'Perlu mengulang', message: 'Beberapa pilihan masih berisiko. Baca lagi materinya, lalu coba kembali.' },
  { key: 'cukup', minPercent: 60, label: 'Cukup', message: 'Arah Anda sudah benar. Perhatikan lagi umpan balik pada pilihan yang kurang tepat.' },
  { key: 'baik', minPercent: 85, label: 'Sangat baik', message: 'Pilihan Anda tepat dan sesuai prinsip yang dipelajari.' },
];

interface ScenarioCtx {
  courseTitle: string;
  moduleTitle: string;
  roles: VillageRole[];
  validFrom: string;
  problems: string[];
  notes: string[];
}

function baseScenario(block: Record<string, unknown>, ctx: ScenarioCtx, summary: string) {
  const id = String(block.id);
  return {
    schemaVersion: '1.0',
    id,
    version: 1,
    title: clip(squash(String(block.title || `Latihan ${ctx.moduleTitle}`)), 120).padEnd(3, '.'),
    summary: clip(squash(summary || `Latihan dari ${ctx.moduleTitle}.`), 400).padEnd(10, '.'),
    audience: ctx.roles.length ? ctx.roles : (['lainnya'] as VillageRole[]),
    mode: 'formative',
    maxAttempts: 3,
    status: 'draft',
    validFrom: ctx.validFrom,
    needsLocalValidation: false,
  };
}

function fromBranching(block: Record<string, unknown>, ctx: ScenarioCtx) {
  const where = `Skenario "${String(block.id)}"`;
  const nodes = Array.isArray(block.nodes) ? (block.nodes as Record<string, unknown>[]) : [];
  if (!nodes.length) {
    ctx.problems.push(`${where}: tidak punya node.`);
    return null;
  }
  const idMap = new Map<string, string>();
  nodes.forEach((n, i) => idMap.set(String(n.id), nodeIdOf(String(n.id), `n${i + 1}`)));
  const takeaways: string[] = [];
  const out = nodes.map((n, i) => {
    const choices = (Array.isArray(n.choices) ? n.choices : []).map((c) => choiceSchema.parse(c));
    const { body, prompt } = splitPrompt(String(n.situation ?? ''));
    return {
      id: idMap.get(String(n.id))!,
      type: 'decision',
      body: clip(body, 1500),
      prompt,
      options: choices.slice(0, 4).map((c, j) => {
        const v = verdictOf(c as Record<string, unknown>);
        if (!v)
          ctx.problems.push(
            `${where}, node ${String(n.id ?? i + 1)}, pilihan ${String(c.id ?? j + 1)}: penilaian tidak bisa ditentukan. Mulai umpan balik dengan "Tepat." / "Kurang tepat." atau isi "verdict" (best/acceptable/risky/wrong).`,
          );
        if (v === 'best' && takeaways.length < 4) {
          const t = squash(c.feedback.replace(/^(sangat tepat|tepat|benar)[.!:,\s-]*/i, ''));
          if (t.length >= 5) takeaways.push(clip(t, 200));
        }
        const next = c.next_node_id ? idMap.get(c.next_node_id) : 'selesai';
        if (c.next_node_id && !next) ctx.problems.push(`${where}: pilihan ${String(c.id ?? j + 1)} menuju node "${c.next_node_id}" yang tidak ada.`);
        return { id: optionIdOf(c.id, j), text: clip(squash(c.label), 300), verdict: v ?? 'wrong', score: SCORE[v ?? 'wrong'], feedback: clip(squash(c.feedback) || '—', 1500), nextNodeId: next ?? 'selesai' };
      }),
    };
  });
  if (nodes.some((n) => Array.isArray(n.choices) && n.choices.length > 4)) ctx.problems.push(`${where}: lebih dari 4 pilihan dalam satu node (maks 4).`);
  return {
    ...baseScenario(block, ctx, `Simulasi keputusan dari ${ctx.moduleTitle}.`),
    estimatedMinutes: Math.min(20, Math.max(2, nodes.length * 2)),
    startNodeId: idMap.get(String(block.start_node_id ?? nodes[0]!.id)) ?? out[0]!.id,
    nodes: [...out, { id: 'selesai', type: 'end', title: 'Selesai' }],
    scoring: { passPercent: 70, bands: BANDS_GRADED },
    takeaways: takeaways.length ? takeaways : ['Baca kembali umpan balik setiap pilihan untuk memahami alasannya.'],
  };
}

function fromDragDrop(block: Record<string, unknown>, ctx: ScenarioCtx) {
  const where = `Skenario "${String(block.id)}"`;
  const pairs = (Array.isArray(block.pairs) ? block.pairs : []) as { target?: string; items?: string[] }[];
  if (pairs.length < 2 || pairs.length > 4) {
    ctx.problems.push(`${where}: drag_and_drop butuh 2–4 kategori (ada ${pairs.length}).`);
    return null;
  }
  // Selang-seling antarkategori agar jawaban tidak berurutan.
  const queue: { item: string; target: number }[] = [];
  const longest = Math.max(...pairs.map((p) => (p.items ?? []).length));
  for (let k = 0; k < longest; k++) pairs.forEach((p, t) => p.items?.[k] && queue.push({ item: p.items[k]!, target: t }));
  if (!queue.length || queue.length > 29) {
    ctx.problems.push(`${where}: jumlah butir ${queue.length} (harus 1–29).`);
    return null;
  }
  const good = squash(String(block.feedback_correct ?? '')) || 'Tepat.';
  const bad = squash(String(block.feedback_incorrect ?? '')) || 'Belum tepat. Periksa kembali ciri kategori ini.';
  const instruction = squash(String(block.instruction ?? ''));
  const nodes = queue.map((q, i) => ({
    id: `b${i + 1}`,
    type: 'decision',
    title: `Butir ${i + 1} dari ${queue.length}`,
    body: clip(`${instruction ? `${instruction}\n\n` : ''}**${squash(q.item)}**`, 1500),
    prompt: 'Kondisi ini termasuk kategori mana?',
    options: pairs.map((p, t) => ({
      id: String.fromCharCode(97 + t),
      text: clip(squash(String(p.target ?? `Kategori ${t + 1}`)), 300),
      verdict: t === q.target ? 'best' : 'wrong',
      score: t === q.target ? 10 : 0,
      feedback: clip(t === q.target ? good : bad, 1500),
      nextNodeId: i + 1 < queue.length ? `b${i + 2}` : 'selesai',
    })),
  }));
  ctx.notes.push(`${where} (drag_and_drop) dijadikan latihan "pilih kategori" per butir (${queue.length} butir); latihan formatif, tidak menentukan kelulusan.`);
  return {
    ...baseScenario(block, ctx, instruction || `Latihan pengelompokan dari ${ctx.moduleTitle}.`),
    estimatedMinutes: Math.min(20, Math.max(2, Math.ceil(queue.length / 2))),
    startNodeId: 'b1',
    nodes: [...nodes, { id: 'selesai', type: 'end', title: 'Selesai' }],
    scoring: { passPercent: 70, bands: BANDS_GRADED },
    takeaways: [clip(good.replace(/^(tepat|benar)[.!:,\s-]*/i, '') || good, 200).padEnd(5, '.')],
  };
}

function fromHotspot(block: Record<string, unknown>, ctx: ScenarioCtx) {
  const where = `Skenario "${String(block.id)}"`;
  const spots = (Array.isArray(block.spots) ? block.spots : []) as { step?: number; situation?: string; recommended_action?: string; feedback?: string }[];
  if (!spots.length || spots.length > 14) {
    ctx.problems.push(`${where}: hotspot_checklist butuh 1–14 langkah (ada ${spots.length}).`);
    return null;
  }
  const nodes = spots.flatMap((s, i) => [
    {
      id: `s${i + 1}`,
      type: 'info',
      title: `Situasi ${i + 1} dari ${spots.length}`,
      body: clip(`${squash(String(s.situation ?? ''))}\n\nPikirkan dulu langkah Anda, lalu tekan **Lanjut** untuk melihat langkah yang disarankan.`, 1500),
      nextNodeId: `r${i + 1}`,
    },
    {
      id: `r${i + 1}`,
      type: 'info',
      title: 'Langkah yang disarankan',
      body: clip(`**${squash(String(s.recommended_action ?? ''))}**\n\n${squash(String(s.feedback ?? ''))}`.trim(), 1500),
      nextNodeId: i + 1 < spots.length ? `s${i + 2}` : 'selesai',
    },
  ]);
  ctx.notes.push(`${where} (hotspot_checklist) dijadikan latihan langkah demi langkah: situasi tampil dulu, langkah yang disarankan terbuka setelah Lanjut (tanpa skor).`);
  return {
    ...baseScenario(block, ctx, `Latihan langkah demi langkah dari ${ctx.moduleTitle}.`),
    estimatedMinutes: Math.min(20, Math.max(2, spots.length * 2)),
    startNodeId: 's1',
    nodes: [...nodes, { id: 'selesai', type: 'end', title: 'Selesai' }],
    scoring: { passPercent: 0, bands: [{ key: 'selesai', minPercent: 0, label: 'Selesai', message: 'Latihan selesai. Bandingkan langkah Anda dengan langkah yang disarankan.' }] },
    takeaways: spots.slice(0, 4).map((s) => clip(squash(String(s.recommended_action ?? 'Langkah yang disarankan.')), 200).padEnd(5, '.')),
  };
}

// ---------------------------------------------------------------- pengubah utama

const IGNORED_COURSE_KEYS = ['code', 'status', 'estimated_minutes', 'low_bandwidth_friendly', 'privacy_policy'];

export function convertCoursePackageV1(raw: unknown, today: Date = new Date()): ConversionResult {
  const problems: string[] = [];
  const notes: string[] = [];
  const parsed = CoursePackageV1Schema.safeParse(raw);
  if (!parsed.success) {
    return { bundle: null, problems: parsed.error.issues.slice(0, 40).map((i) => `${i.path.length ? '/' + i.path.join('/') : '/'}: ${i.message}`), notes };
  }
  const pkg = parsed.data;
  const c = pkg.course;
  const validFrom = today.toISOString().slice(0, 10);
  const roles = mapRoles(c.target_roles, notes);
  const ignored = IGNORED_COURSE_KEYS.filter((k) => k in c);
  if (ignored.length) notes.push(`Metadata kelas berikut tidak dipakai LMS: ${ignored.join(', ')}.`);
  const rules = c.completion_rules as Record<string, unknown> | undefined;
  if (rules && 'remedial_on_quiz_fail' in rules) notes.push('Aturan remedial (remedial_on_quiz_fail) belum didukung; peserta yang gagal mengulang lewat kesempatan kuis.');
  if ((pkg as Record<string, unknown>).mode === 'upsert_by_slug') notes.push('Mode upsert_by_slug: impor selalu membuat kelas BARU; bila slug sudah dipakai, impor ditolak.');
  notes.push(`Tanggal berlaku skenario diisi tanggal impor (${validFrom}); ubah di skenario bila ada tanggal acuan regulasi.`);

  const scenarios: unknown[] = [];
  const lessons: Record<string, unknown>[] = [];
  const mcq: Record<string, unknown>[] = [];
  const essays: Record<string, unknown>[] = [];
  const unknownTags = new Set<string>();
  const modules = [...pkg.modules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const m of modules) {
    const ctx: ScenarioCtx = { courseTitle: c.title, moduleTitle: m.title, roles, validFrom, problems, notes };
    let body = htmlToMarkdownLite(m.content_html, unknownTags);
    // Judul modul di awal isi sudah tampil sebagai judul materi.
    const firstH2 = /^##\s+(.+)\n?/.exec(body);
    if (firstH2 && squash(firstH2[1]!) === squash(m.title)) body = body.slice(firstH2[0].length).trim();
    const parts = [/^##\s/m.test(body) ? body : `## Bacaan\n\n${body}`];
    for (const b of m.interactive_blocks) {
      const block = b as Record<string, unknown>;
      const conv = b.type === 'branching_scenario' ? fromBranching(block, ctx) : b.type === 'drag_and_drop' ? fromDragDrop(block, ctx) : b.type === 'hotspot_checklist' ? fromHotspot(block, ctx) : undefined;
      if (conv === undefined) {
        notes.push(`Blok "${b.id}" bertipe ${b.type} belum didukung; dilewati.`);
        continue;
      }
      if (!conv) continue;
      scenarios.push(conv);
      parts.push(`## Latihan: ${clip(squash(b.title || b.id), 140)}\n\n[[skenario:${b.id}]]`);
    }
    const firstSentence = /^[^#\n>-][^\n]*?[.!?](\s|$)/m.exec(body)?.[0]?.trim() ?? '';
    const minutes = Math.max(1, Math.floor((m.duration_minutes ?? 10) / 2));
    lessons.push({
      lessonKey: m.slug,
      title: clip(squash(m.title), 160),
      summary: clip(firstSentence, 300),
      contentType: 'html',
      contentSource: parts.join('\n\n'),
      requiredActiveSeconds: minutes * 60,
      isRequired: m.is_mandatory ?? true,
    });

    const topic = clip(m.slug.split('-')[0] ?? 'umum', 60);
    for (const q of m.questions) {
      const where = `Soal "${String(q.id ?? q.prompt.slice(0, 30))}"`;
      const qq = q as Record<string, unknown>;
      if (q.type === 'multiple_choice') {
        const options = (Array.isArray(qq.options) ? qq.options : []).map((o) => String(o));
        const correct = String(qq.correct_answer ?? '').trim();
        const hits = options.filter((o) => o.trim() === correct).length;
        if (hits !== 1) problems.push(`${where}: correct_answer harus sama persis dengan tepat satu opsi (cocok ${hits}).`);
        mcq.push({
          type: 'mcq',
          stem: clip(squash(q.prompt), 4000),
          topic,
          difficulty: 2,
          points: 10,
          options: options.map((o) => ({ body: clip(squash(o), 1000), isCorrect: o.trim() === correct })),
          ...(qq.feedback ? { explanation: clip(squash(String(qq.feedback)), 2000) } : {}),
        });
      } else if (q.type === 'essay') {
        const rubric = (Array.isArray(qq.rubric) ? qq.rubric : []).map((r) => squash(String(r))).filter(Boolean).slice(0, 8);
        if (!rubric.length) problems.push(`${where}: esai tanpa rubrik.`);
        if (rubric.some((r) => r.length > 120)) notes.push(`${where}: kriteria rubrik lebih dari 120 karakter dipotong.`);
        const n = Math.max(1, rubric.length);
        const base = Math.floor(100 / n);
        essays.push({
          type: 'essay',
          stem: clip(squash(q.prompt), 4000),
          topic,
          difficulty: 2,
          points: 15,
          rubric: rubric.map((r, i) => ({ criterion: clip(r, 120), maxScore: base + (i === 0 ? 100 - base * n : 0) })),
          modelAnswer: '',
        });
      } else {
        notes.push(`${where}: tipe soal ${q.type} belum didukung; dilewati.`);
      }
    }
  }
  if (unknownTags.size) notes.push(`Tag HTML berikut tidak didukung dan dibuang (teksnya tetap): ${[...unknownTags].sort().join(', ')}.`);

  if (mcq.length || essays.length) {
    if (essays.length > 10) problems.push(`Ada ${essays.length} soal esai; kuis LMS menampilkan maksimal 10 esai.`);
    const pass = typeof rules?.min_quiz_score === 'number' ? Math.round(rules.min_quiz_score) : 70;
    let key = 'evaluasi-akhir';
    while (lessons.some((l) => l.lessonKey === key)) key += '-x';
    lessons.push({
      lessonKey: key,
      title: 'Evaluasi Akhir',
      summary: 'Ukur pemahaman dari seluruh materi kelas.',
      contentType: 'html',
      contentSource: `Evaluasi akhir berisi **${mcq.length} soal pilihan ganda**${essays.length ? ` dan **${essays.length} soal esai**` : ''} dari seluruh materi. **Nilai minimal ${pass}** untuk lulus kelas.${
        essays.length ? '\n\nJawaban esai dinilai mentor; nilai akhir tampil setelah penilaian selesai.' : ''
      }\n\nGunakan nama dan contoh fiktif. Jangan menulis NIK, nomor KK, atau data pribadi warga.`,
      requiredActiveSeconds: 0,
      isRequired: true,
      quiz: {
        title: clip(`Evaluasi Akhir: ${c.title}`, 160),
        instructions: 'Pilih satu jawaban terbaik untuk soal pilihan ganda. Untuk esai, jawab dengan contoh fiktif.',
        timeLimitSeconds: Math.min(14_400, Math.max(600, mcq.length * 120 + essays.length * 600)),
        passingScorePct: pass,
        maxAttempts: 3,
        cooldownSeconds: 0,
        mcqCount: mcq.length,
        essayCount: Math.min(10, essays.length),
        isRequired: true,
        reviewPolicy: 'after_done',
        questions: [...mcq, ...essays],
      },
    });
    notes.push(
      `Semua soal (${mcq.length} PG${essays.length ? `, ${essays.length} esai` : ''}) digabung ke materi terakhir "Evaluasi Akhir" (lulus ${pass}%, 3 kesempatan, pembahasan setelah selesai).`,
    );
    if (essays.length) notes.push('Bobot rubrik esai dibagi rata (total 100) karena paket tidak menetapkan bobot; tinjau di editor kuis sebelum terbit.');
  }
  notes.push('Skor pilihan skenario: Tepat 10 · Bisa diterima 6 · Berisiko 3 · Kurang tepat 0 (dari kata pembuka umpan balik). Telaah sebelum skenario diterbitkan.');

  if (problems.length) return { bundle: null, problems, notes };
  return {
    bundle: {
      schemaVersion: COURSE_BUNDLE_VERSION,
      course: { slug: c.slug, title: clip(squash(c.title), 160), description: clip(c.summary.trim(), 2000), visibility: 'private', targetRoles: roles },
      scenarios,
      lessons,
    },
    problems,
    notes,
  };
}
