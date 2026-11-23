/**
 * Blok Skenario Bercabang v1.0 — skema authoring, aturan alur, dan perhitungan skor.
 * Acuan: docs/scenario-block/README.md, scenario-block.schema.json, validate_scenario.py.
 * Aturan alur F1–F9 dan maxScore HARUS identik dengan validate_scenario.py (diuji di tests/unit/scenario.test.ts).
 * Dipakai server (validasi saat simpan, penilaian) — klien hanya memakai tipe delivery.
 */
import { z } from 'zod';
import { VILLAGE_ROLES } from './constants';

const nodeId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'format id node tidak sesuai');
const richText = z.string().min(1).max(1500);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'harus tanggal YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'tanggal tidak valid');

export const SCENARIO_VERDICTS = ['best', 'acceptable', 'risky', 'wrong'] as const;
export type ScenarioVerdict = (typeof SCENARIO_VERDICTS)[number];
export const SCENARIO_VERDICT_LABELS: Record<ScenarioVerdict, string> = {
  best: 'Tepat',
  acceptable: 'Bisa diterima',
  risky: 'Berisiko',
  wrong: 'Kurang tepat',
};
export const SCENARIO_STATUSES = ['draft', 'in_review', 'published', 'archived'] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

const optionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]{1,8}$/, 'format id opsi tidak sesuai'),
    text: z.string().min(3).max(300),
    verdict: z.enum(SCENARIO_VERDICTS),
    score: z.number().int().min(0).max(10),
    feedback: richText,
    nextNodeId: nodeId,
  })
  .strict();

const infoNode = z
  .object({ id: nodeId, type: z.literal('info'), title: z.string().max(100).optional(), body: richText, nextNodeId: nodeId })
  .strict();
const endNode = z.object({ id: nodeId, type: z.literal('end'), title: z.string().max(100).optional(), body: richText.optional() }).strict();
const decisionNode = z
  .object({
    id: nodeId,
    type: z.literal('decision'),
    title: z.string().max(100).optional(),
    body: richText,
    prompt: z.string().min(5).max(200),
    options: z.array(optionSchema).min(2).max(4),
  })
  .strict();

export const scenarioDefinitionSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/, 'format id blok tidak sesuai'),
    version: z.number().int().min(1),
    title: z.string().min(3).max(120),
    summary: z.string().min(10).max(400),
    audience: z
      .array(z.enum(VILLAGE_ROLES))
      .min(1)
      .refine((a) => new Set(a).size === a.length, 'butir tidak boleh berulang'),
    estimatedMinutes: z.number().int().min(2).max(20),
    mode: z.enum(['formative', 'graded']),
    maxAttempts: z.number().int().min(1).max(10),
    shuffleOptions: z.boolean().optional(),
    status: z.enum(SCENARIO_STATUSES),
    validFrom: isoDate,
    needsLocalValidation: z.boolean(),
    regulations: z
      .array(z.object({ ref: z.string().min(3).max(160), note: z.string().max(300).optional() }).strict())
      .max(8)
      .optional(),
    startNodeId: nodeId,
    nodes: z.array(z.discriminatedUnion('type', [infoNode, decisionNode, endNode])).min(2).max(30),
    scoring: z
      .object({
        passPercent: z.number().int().min(0).max(100),
        bands: z
          .array(
            z
              .object({
                key: z.string().regex(/^[a-z0-9-]{2,32}$/),
                minPercent: z.number().int().min(0).max(100),
                label: z.string().min(2).max(40),
                message: richText,
              })
              .strict(),
          )
          .min(1)
          .max(5),
      })
      .strict(),
    takeaways: z.array(z.string().min(5).max(200)).min(1).max(6),
    remedial: z
      .object({ label: z.string().max(80), lessonKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/).optional() })
      .strict()
      .optional(),
    authors: z.array(z.string().max(60)).max(5).optional(),
    review: z
      .object({
        reviewedBy: z.string().max(80).optional(),
        reviewedAt: isoDate.optional(),
        nextReviewDue: isoDate.optional(),
        notes: z.string().max(1000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ScenarioDefinition = z.infer<typeof scenarioDefinitionSchema>;
export type ScenarioNode = ScenarioDefinition['nodes'][number];
export type ScenarioDecisionNode = Extract<ScenarioNode, { type: 'decision' }>;

const loc = (path: readonly PropertyKey[]): string => '/' + path.map(String).join('/');

type IndexedNode = { index: number; node: ScenarioNode };

function indexNodes(doc: ScenarioDefinition): Map<string, IndexedNode> {
  const m = new Map<string, IndexedNode>();
  doc.nodes.forEach((node, index) => m.set(node.id, { index, node }));
  return m;
}

export function scenarioEdges(node: ScenarioNode): string[] {
  if (node.type === 'info') return [node.nextNodeId];
  if (node.type === 'decision') return [...new Set(node.options.map((o) => o.nextNodeId))];
  return [];
}

/** Nilai jalur terbesar dari startNodeId ke node 'end' (prasyarat: alur valid). */
export function computeMaxScore(doc: ScenarioDefinition): number {
  const idx = indexNodes(doc);
  const memo = new Map<string, number>();
  const best = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const node = idx.get(id)!.node;
    let v = 0;
    if (node.type === 'info') v = best(node.nextNodeId);
    else if (node.type === 'decision') v = Math.max(...node.options.map((o) => o.score + best(o.nextNodeId)));
    memo.set(id, v);
    return v;
  };
  return best(doc.startNodeId);
}

/** Jumlah node keputusan terbanyak pada satu jalur (untuk indikator "langkah x dari y"). */
export function maxDecisionsOnPath(doc: ScenarioDefinition, fromId = doc.startNodeId): number {
  const idx = indexNodes(doc);
  const memo = new Map<string, number>();
  const walk = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const node = idx.get(id)!.node;
    const next = scenarioEdges(node);
    const v = (node.type === 'decision' ? 1 : 0) + (next.length ? Math.max(...next.map(walk)) : 0);
    memo.set(id, v);
    return v;
  };
  return walk(fromId);
}

/** Aturan alur F1–F9 (lihat validate_scenario.py). */
export function checkScenarioFlow(doc: ScenarioDefinition): string[] {
  const errs: string[] = [];
  const { nodes } = doc;

  // F1
  const ids = new Map<string, number>();
  nodes.forEach((n, i) => {
    const prev = ids.get(n.id);
    if (prev !== undefined) errs.push(`/nodes/${i}/id: id '${n.id}' sudah dipakai node /nodes/${prev}`);
    else ids.set(n.id, i);
    if (n.type === 'decision') {
      const seen = new Set<string>();
      n.options.forEach((o, j) => {
        if (seen.has(o.id)) errs.push(`/nodes/${i}/options/${j}/id: id opsi '${o.id}' berulang di node '${n.id}'`);
        seen.add(o.id);
      });
    }
  });
  if (errs.length) return errs;

  // F2
  if (!ids.has(doc.startNodeId)) errs.push(`/startNodeId: node '${doc.startNodeId}' tidak ada`);
  nodes.forEach((n, i) => {
    if (n.type === 'info' && !ids.has(n.nextNodeId)) errs.push(`/nodes/${i}/nextNodeId: node '${n.nextNodeId}' tidak ada`);
    if (n.type === 'decision') {
      n.options.forEach((o, j) => {
        if (!ids.has(o.nextNodeId)) errs.push(`/nodes/${i}/options/${j}/nextNodeId: node '${o.nextNodeId}' tidak ada`);
        if (o.nextNodeId === n.id) errs.push(`/nodes/${i}/options/${j}/nextNodeId: opsi menunjuk node itu sendiri`);
      });
    }
  });
  if (errs.length) return errs;

  const idx = indexNodes(doc);

  // F3 siklus
  const color = new Map<string, 0 | 1 | 2>([...ids.keys()].map((k) => [k, 0]));
  const cycles: string[] = [];
  const dfs = (id: string, trail: string[]): void => {
    color.set(id, 1);
    for (const nxt of scenarioEdges(idx.get(id)!.node)) {
      if (color.get(nxt) === 1) {
        const loop = trail.includes(nxt) ? [...trail.slice(trail.indexOf(nxt)), id, nxt] : [id, nxt];
        cycles.push(`/nodes/${idx.get(id)!.index}: siklus terdeteksi (${[...new Set(loop)].join(' -> ')} -> ${nxt})`);
      } else if (color.get(nxt) === 0) {
        dfs(nxt, [...trail, id]);
      }
    }
    color.set(id, 2);
  };
  for (const id of ids.keys()) if (color.get(id) === 0) dfs(id, []);
  if (cycles.length) return [...errs, ...cycles];

  // F4 node yatim
  const reach = new Set<string>();
  const stack = [doc.startNodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (reach.has(cur)) continue;
    reach.add(cur);
    stack.push(...scenarioEdges(idx.get(cur)!.node));
  }
  nodes.forEach((n, i) => {
    if (!reach.has(n.id)) errs.push(`/nodes/${i}: node '${n.id}' yatim (tidak terjangkau dari startNodeId)`);
  });

  // F5
  if (![...reach].some((id) => idx.get(id)!.node.type === 'end')) errs.push(`/nodes: tidak ada node 'end' yang terjangkau`);

  // F6
  nodes.forEach((n, i) => {
    if (n.type !== 'decision') return;
    const top = Math.max(...n.options.map((o) => o.score));
    const bests = n.options.flatMap((o, j) => (o.verdict === 'best' ? [j] : []));
    if (!bests.length) {
      errs.push(`/nodes/${i}/options: node '${n.id}' tidak punya opsi 'best'`);
      return;
    }
    for (const j of bests) {
      if (n.options[j]!.score !== top) errs.push(`/nodes/${i}/options/${j}/score: opsi 'best' harus memegang skor tertinggi node (${top})`);
    }
    n.options.forEach((o, j) => {
      if (o.verdict !== 'best' && o.score >= top) {
        errs.push(`/nodes/${i}/options/${j}/score: opsi '${o.verdict}' tidak boleh menyamai/melebihi skor opsi 'best'`);
      }
    });
  });

  // F7
  const bands = doc.scoring.bands;
  const mins = bands.map((b) => b.minPercent);
  const keys = bands.map((b) => b.key);
  if (!mins.includes(0)) errs.push('/scoring/bands: wajib ada band dengan minPercent 0');
  if (new Set(mins).size !== mins.length) errs.push('/scoring/bands: minPercent tidak boleh berulang');
  if (new Set(keys).size !== keys.length) errs.push('/scoring/bands: key tidak boleh berulang');

  // F8
  if (doc.status === 'published') {
    const review = doc.review ?? {};
    for (const f of ['reviewedBy', 'reviewedAt', 'nextReviewDue'] as const) {
      if (!review[f]) errs.push(`/review/${f}: wajib diisi untuk status 'published'`);
    }
    if (review.reviewedAt && review.nextReviewDue && review.nextReviewDue <= review.reviewedAt) {
      errs.push('/review/nextReviewDue: harus setelah reviewedAt');
    }
  }

  // F9
  if (!errs.length && doc.mode === 'graded' && computeMaxScore(doc) <= 0) errs.push(`/mode: blok 'graded' wajib punya maxScore > 0`);
  return errs;
}

export type ScenarioValidation = { ok: true; definition: ScenarioDefinition; maxScore: number } | { ok: false; errors: string[] };

/** Struktur (Zod) lalu aturan alur. Pesan galat memuat lokasi gaya JSON Pointer. */
export function validateScenario(input: unknown): ScenarioValidation {
  const parsed = scenarioDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 50).map((i) => `${loc(i.path)}: ${i.message}`) };
  }
  const errors = checkScenarioFlow(parsed.data);
  if (errors.length) return { ok: false, errors };
  return { ok: true, definition: parsed.data, maxScore: computeMaxScore(parsed.data) };
}

/** Persen dibulatkan ke bawah; band = minPercent terbesar yang ≤ persen. */
export function scoreResult(doc: ScenarioDefinition, score: number, maxScore: number) {
  const percent = maxScore > 0 ? Math.floor((score * 100) / maxScore) : 100;
  const band = [...doc.scoring.bands].sort((a, b) => b.minPercent - a.minPercent).find((b) => b.minPercent <= percent) ?? doc.scoring.bands[0]!;
  return { percent, band, passed: percent >= doc.scoring.passPercent };
}

// ---------------------------------------------------------------- delivery (ke peserta)

export interface ScenarioNodeDelivery {
  id: string;
  type: 'info' | 'decision' | 'end';
  title: string | null;
  body: string | null;
  prompt: string | null;
  /** Hanya teks + kunci acak per attempt. TANPA verdict/score/feedback/nextNodeId. */
  options: { key: string; text: string }[];
}

export interface ScenarioHistoryItem {
  nodeId: string;
  optionText: string;
  label: string;
  verdict: ScenarioVerdict;
  feedback: string;
}

export interface ScenarioFinal {
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
  band: { label: string; message: string };
  takeaways: string[];
  remedial: { label: string; lessonId: string | null } | null;
  attemptsLeft: number;
}

export interface ScenarioDelivery {
  attempt: { id: string; status: 'in_progress' | 'completed' | 'abandoned'; attemptNo: number; maxAttempts: number };
  block: {
    key: string;
    version: number;
    title: string;
    mode: 'formative' | 'graded';
    validFrom: string;
    needsLocalValidation: boolean;
    regulations: { ref: string; note?: string }[];
    estimatedMinutes: number;
    decisionCount: { done: number; maxOnPath: number };
  };
  node: ScenarioNodeDelivery | null;
  history: ScenarioHistoryItem[];
  final: ScenarioFinal | null;
}

export interface ScenarioChoiceResponse {
  result: { label: string; verdict: ScenarioVerdict; feedback: string } | null;
  delivery: ScenarioDelivery;
}

/** Ringkasan blok di konten pelajaran (untuk kartu sebelum mulai). */
export interface LessonScenarioSummary {
  blockId: string;
  key: string;
  title: string;
  summary: string;
  mode: 'formative' | 'graded';
  estimatedMinutes: number;
  maxAttempts: number;
  validFrom: string;
  needsLocalValidation: boolean;
  attemptsUsed: number;
  activeAttemptId: string | null;
  bestPercent: number | null;
  passed: boolean;
}

export const scenarioStartSchema = z.object({ lessonId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/) }).strict();
export const scenarioChoiceSchema = z.union([
  z.object({ nodeId, optionKey: z.string().regex(/^p[1-4]$/) }).strict(),
  z.object({ nodeId, continue: z.literal(true) }).strict(),
]);
export const scenarioUpsertSchema = z.object({ definition: z.unknown() }).strict();
export const scenarioStatusSchema = z
  .object({
    status: z.enum(['draft', 'in_review', 'published', 'archived']),
    review: z
      .object({
        reviewedBy: z.string().trim().min(2).max(80),
        reviewedAt: isoDate,
        nextReviewDue: isoDate,
        notes: z.string().max(1000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
