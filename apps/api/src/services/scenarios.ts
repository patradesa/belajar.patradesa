/**
 * Blok Skenario Bercabang (docs/scenario-block/README.md, ADR-0008).
 * Server memegang kunci: verdict, skor, umpan balik, dan cabang berikutnya tidak pernah dikirim
 * sebelum peserta memilih; `scoring`, `review`, `authors`, dan id opsi asli tidak pernah dikirim.
 */
import {
  ERROR_CODES,
  SCENARIO_VERDICT_LABELS,
  maxDecisionsOnPath,
  scenarioKeys,
  scoreResult,
  type Block,
  type LessonScenarioSummary,
  type ScenarioChoiceResponse,
  type ScenarioDefinition,
  type ScenarioDelivery,
  type ScenarioNode,
  type ScenarioVerdict,
} from '@patradesa/shared';
import { HttpError, notFound } from '../lib/http';
import { newId, secureShuffle } from '../lib/crypto';
import { requireLessonAccess } from './access';

export interface ScenarioBlockRow {
  id: string;
  block_key: string;
  version: number;
  status: 'draft' | 'in_review' | 'published' | 'archived';
  mode: 'formative' | 'graded';
  title: string;
  max_attempts: number;
  pass_percent: number;
  max_score: number;
  definition_json: string;
  valid_from: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  next_review_due: string | null;
  created_by: string;
  published_by: string | null;
  created_at: number;
  updated_at: number;
}

interface AttemptRow {
  id: string;
  scenario_block_id: string;
  block_version: number;
  user_id: string;
  enrollment_id: string;
  lesson_id: string;
  attempt_no: number;
  status: 'in_progress' | 'completed' | 'abandoned';
  current_node_id: string | null;
  option_order_json: string;
  score: number;
  max_score: number;
  percent: number | null;
  band_key: string | null;
  passed: number | null;
}

interface ChoiceRow {
  node_id: string;
  option_id: string | null;
  verdict: ScenarioVerdict | null;
  score: number;
  seq: number;
}

type Choice = { nodeId: string; optionKey: string } | { nodeId: string; continue: true };

export async function loadBlock(db: D1Database, id: string): Promise<{ row: ScenarioBlockRow; def: ScenarioDefinition } | null> {
  const row = await db.prepare('SELECT * FROM scenario_blocks WHERE id = ?').bind(id).first<ScenarioBlockRow>();
  return row ? { row, def: JSON.parse(row.definition_json) as ScenarioDefinition } : null;
}

const findNode = (def: ScenarioDefinition, id: string): ScenarioNode => {
  const n = def.nodes.find((x) => x.id === id);
  if (!n) throw new HttpError(500, ERROR_CODES.INTERNAL, 'Definisi skenario rusak.');
  return n;
};

// ---------------------------------------------------------------- penyisipan & pin

/** Saat menyimpan materi: setiap [[skenario:kunci]] harus merujuk blok yang ada dan belum diarsipkan. */
export async function assertScenarioKeysExist(db: D1Database, blocks: Block[]): Promise<void> {
  for (const key of scenarioKeys(blocks)) {
    const row = await db.prepare(`SELECT 1 AS x FROM scenario_blocks WHERE block_key = ? AND status <> 'archived' LIMIT 1`).bind(key).first();
    if (!row) throw new HttpError(400, ERROR_CODES.VALIDATION, `Skenario "${key}" tidak ditemukan. Unggah skenarionya dulu di menu Skenario.`);
  }
}

/** Saat menerbitkan versi kelas: pin versi published terbaru setiap kunci ke lesson_scenarios. */
export async function pinScenarioStatements(db: D1Database, versionId: string): Promise<D1PreparedStatement[]> {
  const { results: lessons } = await db
    .prepare('SELECT id, content_json FROM lessons WHERE course_version_id = ?')
    .bind(versionId)
    .all<{ id: string; content_json: string }>();
  const stmts: D1PreparedStatement[] = [];
  for (const l of lessons) {
    stmts.push(db.prepare('DELETE FROM lesson_scenarios WHERE lesson_id = ?').bind(l.id));
    const keys = scenarioKeys(JSON.parse(l.content_json) as Block[]);
    for (const [i, key] of keys.entries()) {
      const b = await db
        .prepare(`SELECT id FROM scenario_blocks WHERE block_key = ? AND status = 'published' ORDER BY version DESC LIMIT 1`)
        .bind(key)
        .first<{ id: string }>();
      if (!b) throw new HttpError(409, ERROR_CODES.CONFLICT, `Skenario "${key}" belum diterbitkan. Terbitkan skenarionya sebelum menerbitkan kelas.`);
      stmts.push(
        db.prepare('INSERT INTO lesson_scenarios (lesson_id, scenario_block_id, block_key, position) VALUES (?, ?, ?, ?)').bind(l.id, b.id, key, i + 1),
      );
    }
  }
  return stmts;
}

/** Ringkasan blok untuk halaman materi (kartu sebelum mulai + status peserta). */
export async function lessonScenarioSummaries(db: D1Database, userId: string, lessonId: string): Promise<LessonScenarioSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT sb.id, sb.block_key, sb.title, sb.mode, sb.max_attempts, sb.valid_from, sb.definition_json,
              (SELECT COUNT(*) FROM scenario_attempts sa WHERE sa.scenario_block_id = sb.id AND sa.user_id = ?) AS used,
              (SELECT sa.id FROM scenario_attempts sa WHERE sa.scenario_block_id = sb.id AND sa.user_id = ? AND sa.status = 'in_progress') AS active_id,
              (SELECT MAX(sa.percent) FROM scenario_attempts sa WHERE sa.scenario_block_id = sb.id AND sa.user_id = ? AND sa.status = 'completed') AS best,
              EXISTS (SELECT 1 FROM scenario_attempts sa WHERE sa.scenario_block_id = sb.id AND sa.user_id = ? AND sa.passed = 1) AS passed
       FROM lesson_scenarios ls JOIN scenario_blocks sb ON sb.id = ls.scenario_block_id
       WHERE ls.lesson_id = ? ORDER BY ls.position`,
    )
    .bind(userId, userId, userId, userId, lessonId)
    .all<{
      id: string;
      block_key: string;
      title: string;
      mode: 'formative' | 'graded';
      max_attempts: number;
      valid_from: string;
      definition_json: string;
      used: number;
      active_id: string | null;
      best: number | null;
      passed: number;
    }>();
  return results.map((r) => {
    const def = JSON.parse(r.definition_json) as ScenarioDefinition;
    return {
      blockId: r.id,
      key: r.block_key,
      title: r.title,
      summary: def.summary,
      mode: r.mode,
      estimatedMinutes: def.estimatedMinutes,
      maxAttempts: r.max_attempts,
      validFrom: r.valid_from,
      needsLocalValidation: def.needsLocalValidation,
      localValidationNote: def.localValidationNote ?? null,
      attemptsUsed: r.used,
      activeAttemptId: r.active_id,
      bestPercent: r.best,
      passed: !!r.passed,
    };
  });
}

// ---------------------------------------------------------------- attempt

async function ownAttempt(db: D1Database, attemptId: string, userId: string): Promise<AttemptRow> {
  // Bukan pemilik → 404 (keberadaan attempt tidak dibocorkan).
  const a = await db.prepare('SELECT * FROM scenario_attempts WHERE id = ? AND user_id = ?').bind(attemptId, userId).first<AttemptRow>();
  if (!a) throw notFound('Skenario');
  return a;
}

export async function startScenarioAttempt(
  db: D1Database,
  userId: string,
  blockId: string,
  lessonId: string,
  now: number,
): Promise<{ attemptId: string; created: boolean }> {
  const acc = await requireLessonAccess(db, userId, lessonId, now);
  const pinned = await db.prepare('SELECT 1 AS x FROM lesson_scenarios WHERE lesson_id = ? AND scenario_block_id = ?').bind(lessonId, blockId).first();
  if (!pinned) throw notFound('Skenario');
  const block = await loadBlock(db, blockId);
  if (!block) throw notFound('Skenario');

  const active = await db
    .prepare(`SELECT id FROM scenario_attempts WHERE user_id = ? AND scenario_block_id = ? AND status = 'in_progress'`)
    .bind(userId, blockId)
    .first<{ id: string }>();
  if (active) return { attemptId: active.id, created: false };

  const used = await db
    .prepare('SELECT COUNT(*) AS n FROM scenario_attempts WHERE user_id = ? AND scenario_block_id = ?')
    .bind(userId, blockId)
    .first<{ n: number }>();
  const n = used?.n ?? 0;
  if (n >= block.row.max_attempts) {
    throw new HttpError(409, ERROR_CODES.MAX_ATTEMPTS, 'Kesempatan mencoba skenario ini sudah habis. Hubungi mentor bila perlu kesempatan tambahan.');
  }

  const order: Record<string, string[]> = {};
  for (const node of block.def.nodes) {
    if (node.type !== 'decision') continue;
    const ids = node.options.map((o) => o.id);
    order[node.id] = block.def.shuffleOptions === false ? ids : secureShuffle(ids);
  }
  const p = await db
    .prepare('SELECT village_role, village_name, district, regency FROM user_profiles WHERE user_id = ?')
    .bind(userId)
    .first<{ village_role: string | null; village_name: string | null; district: string | null; regency: string | null }>();
  const id = newId();
  try {
    await db
      .prepare(
        `INSERT INTO scenario_attempts (id, scenario_block_id, block_version, user_id, enrollment_id, lesson_id, attempt_no, status, current_node_id,
           option_order_json, score, max_score, role_snapshot, village_snapshot, district_snapshot, regency_snapshot, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        blockId,
        block.row.version,
        userId,
        acc.enrollment_id,
        lessonId,
        n + 1,
        block.def.startNodeId,
        JSON.stringify(order),
        block.row.max_score,
        p?.village_role ?? null,
        p?.village_name ?? null,
        p?.district ?? null,
        p?.regency ?? null,
        now,
        now,
      )
      .run();
  } catch {
    // Mulai bersamaan dari dua tab: unique index memastikan satu menang; kembalikan attempt aktif yang sama.
    const again = await db
      .prepare(`SELECT id FROM scenario_attempts WHERE user_id = ? AND scenario_block_id = ? AND status = 'in_progress'`)
      .bind(userId, blockId)
      .first<{ id: string }>();
    if (again) return { attemptId: again.id, created: false };
    throw new HttpError(409, ERROR_CODES.CONFLICT, 'Skenario sedang dimulai di perangkat lain. Muat ulang halaman.');
  }
  return { attemptId: id, created: true };
}

function nodeDelivery(def: ScenarioDefinition, node: ScenarioNode, order: Record<string, string[]>) {
  const base = { id: node.id, type: node.type, title: node.title ?? null, body: node.body ?? null, prompt: null as string | null, options: [] as { key: string; text: string }[] };
  if (node.type !== 'decision') return base;
  const ids = order[node.id] ?? node.options.map((o) => o.id);
  return {
    ...base,
    prompt: node.prompt,
    options: ids.map((oid, i) => ({ key: `p${i + 1}`, text: node.options.find((o) => o.id === oid)!.text })),
  };
}

async function resolveRemedialLesson(db: D1Database, lessonId: string, lessonKey: string | undefined): Promise<string | null> {
  if (!lessonKey) return null;
  const r = await db
    .prepare('SELECT l2.id FROM lessons l JOIN lessons l2 ON l2.course_version_id = l.course_version_id WHERE l.id = ? AND l2.lesson_key = ?')
    .bind(lessonId, lessonKey)
    .first<{ id: string }>();
  return r?.id ?? null;
}

export async function scenarioDelivery(db: D1Database, attemptId: string, userId: string): Promise<ScenarioDelivery> {
  const a = await ownAttempt(db, attemptId, userId);
  const block = await loadBlock(db, a.scenario_block_id);
  if (!block) throw notFound('Skenario');
  const { def, row } = block;
  const order = JSON.parse(a.option_order_json) as Record<string, string[]>;
  const { results: choices } = await db
    .prepare('SELECT node_id, option_id, verdict, score, seq FROM scenario_choices WHERE attempt_id = ? ORDER BY seq')
    .bind(a.id)
    .all<ChoiceRow>();

  const history = choices.flatMap((c) => {
    if (!c.option_id || !c.verdict) return [];
    const node = findNode(def, c.node_id);
    if (node.type !== 'decision') return [];
    const opt = node.options.find((o) => o.id === c.option_id)!;
    return [{ nodeId: c.node_id, optionText: opt.text, label: SCENARIO_VERDICT_LABELS[c.verdict], verdict: c.verdict, feedback: opt.feedback }];
  });

  const current = a.current_node_id ? findNode(def, a.current_node_id) : null;
  let final: ScenarioDelivery['final'] = null;
  if (a.status === 'completed') {
    const used = await db
      .prepare('SELECT COUNT(*) AS n FROM scenario_attempts WHERE user_id = ? AND scenario_block_id = ?')
      .bind(userId, a.scenario_block_id)
      .first<{ n: number }>();
    const band = def.scoring.bands.find((b) => b.key === a.band_key) ?? def.scoring.bands[0]!;
    final = {
      score: a.score,
      maxScore: a.max_score,
      percent: a.percent ?? 0,
      passed: a.passed === 1,
      band: { label: band.label, message: band.message },
      takeaways: def.takeaways,
      remedial: def.remedial ? { label: def.remedial.label, lessonId: await resolveRemedialLesson(db, a.lesson_id, def.remedial.lessonKey) } : null,
      attemptsLeft: Math.max(0, row.max_attempts - (used?.n ?? 0)),
    };
  }

  return {
    attempt: { id: a.id, status: a.status, attemptNo: a.attempt_no, maxAttempts: row.max_attempts },
    block: {
      key: row.block_key,
      version: row.version,
      title: def.title,
      mode: def.mode,
      validFrom: def.validFrom,
      needsLocalValidation: def.needsLocalValidation,
      localValidationNote: def.localValidationNote ?? null,
      regulations: def.regulations ?? [],
      estimatedMinutes: def.estimatedMinutes,
      decisionCount: { done: history.length, maxOnPath: history.length + (current && a.status === 'in_progress' ? maxDecisionsOnPath(def, current.id) : 0) },
    },
    node: current ? nodeDelivery(def, current, order) : null,
    history,
    final,
  };
}

function resultFor(def: ScenarioDefinition, c: ChoiceRow): ScenarioChoiceResponse['result'] {
  if (!c.option_id || !c.verdict) return null;
  const node = findNode(def, c.node_id);
  if (node.type !== 'decision') return null;
  const opt = node.options.find((o) => o.id === c.option_id)!;
  return { label: SCENARIO_VERDICT_LABELS[c.verdict], verdict: c.verdict, feedback: opt.feedback };
}

export async function submitScenarioChoice(db: D1Database, userId: string, attemptId: string, choice: Choice, now: number): Promise<ScenarioChoiceResponse> {
  const a = await ownAttempt(db, attemptId, userId);
  await requireLessonAccess(db, userId, a.lesson_id, now);
  const block = await loadBlock(db, a.scenario_block_id);
  if (!block) throw notFound('Skenario');
  const { def } = block;
  const order = JSON.parse(a.option_order_json) as Record<string, string[]>;

  /** Kirim ulang (mis. koneksi putus) → hasil yang sama; pilihan berbeda → 409. */
  const replay = async (): Promise<ScenarioChoiceResponse | null> => {
    const prev = await db
      .prepare('SELECT node_id, option_id, verdict, score, seq FROM scenario_choices WHERE attempt_id = ? AND node_id = ?')
      .bind(a.id, choice.nodeId)
      .first<ChoiceRow>();
    if (!prev) return null;
    const sameOption = 'optionKey' in choice ? order[choice.nodeId]?.[Number(choice.optionKey.slice(1)) - 1] === prev.option_id : prev.option_id === null;
    if (!sameOption) throw new HttpError(409, ERROR_CODES.ALREADY_ANSWERED, 'Langkah ini sudah dijawab. Muat ulang untuk melanjutkan.');
    return { result: resultFor(def, prev), delivery: await scenarioDelivery(db, a.id, userId) };
  };

  const replayed = await replay();
  if (replayed) return replayed;
  if (a.status !== 'in_progress') throw new HttpError(409, ERROR_CODES.ATTEMPT_CLOSED, 'Skenario ini sudah selesai.');
  if (choice.nodeId !== a.current_node_id) throw new HttpError(409, ERROR_CODES.NODE_NOT_ACTIVE, 'Langkah ini bukan langkah yang sedang aktif. Muat ulang untuk melanjutkan.');

  const node = findNode(def, a.current_node_id);
  let optionId: string | null = null;
  let verdict: ScenarioVerdict | null = null;
  let delta = 0;
  let nextId: string;
  if (node.type === 'info') {
    if (!('continue' in choice)) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Langkah ini tidak memiliki pilihan.');
    nextId = node.nextNodeId;
  } else if (node.type === 'decision') {
    if (!('optionKey' in choice)) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Pilih salah satu jawaban.');
    const oid = order[node.id]?.[Number(choice.optionKey.slice(1)) - 1];
    const opt = oid ? node.options.find((o) => o.id === oid) : undefined;
    if (!opt) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Pilihan tidak dikenal.');
    optionId = opt.id;
    verdict = opt.verdict;
    delta = opt.score;
    nextId = opt.nextNodeId;
  } else {
    throw new HttpError(409, ERROR_CODES.ATTEMPT_CLOSED, 'Skenario ini sudah selesai.');
  }

  const next = findNode(def, nextId);
  const finishing = next.type === 'end';
  const newScore = a.score + delta;
  const res = finishing ? scoreResult(def, newScore, a.max_score) : null;

  const guard = `id = ? AND status = 'in_progress' AND current_node_id = ?`;
  try {
    const out = await db.batch([
      db
        .prepare(
          `INSERT INTO scenario_choices (id, attempt_id, seq, node_id, option_id, verdict, score, chosen_at)
           SELECT ?, ?, (SELECT COUNT(*) + 1 FROM scenario_choices WHERE attempt_id = ?), ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM scenario_attempts WHERE ${guard})`,
        )
        .bind(newId(), a.id, a.id, node.id, optionId, verdict, delta, now, a.id, node.id),
      res
        ? db
            .prepare(
              `UPDATE scenario_attempts SET current_node_id = ?, score = score + ?, updated_at = ?, status = 'completed',
                 percent = ?, band_key = ?, passed = ?, completed_at = ? WHERE ${guard}`,
            )
            .bind(next.id, delta, now, res.percent, res.band.key, res.passed ? 1 : 0, now, a.id, node.id)
        : db.prepare(`UPDATE scenario_attempts SET current_node_id = ?, score = score + ?, updated_at = ? WHERE ${guard}`).bind(next.id, delta, now, a.id, node.id),
    ]);
    if (!out[1]?.meta.changes) throw new Error('race');
  } catch {
    // Permintaan bersamaan untuk langkah yang sama: yang kalah membaca hasil pemenang.
    const r = await replay();
    if (r) return r;
    throw new HttpError(409, ERROR_CODES.NODE_NOT_ACTIVE, 'Langkah ini bukan langkah yang sedang aktif. Muat ulang untuk melanjutkan.');
  }

  const result = optionId && verdict ? { label: SCENARIO_VERDICT_LABELS[verdict], verdict, feedback: (node as Extract<ScenarioNode, { type: 'decision' }>).options.find((o) => o.id === optionId)!.feedback } : null;
  return { result, delivery: await scenarioDelivery(db, a.id, userId) };
}

// ---------------------------------------------------------------- statistik admin

export const MIN_CELL = 5;
const suppress = (n: number): number | null => (n > 0 && n < MIN_CELL ? null : n);

export interface ScenarioStatsFilter {
  role?: string;
  regency?: string;
  district?: string;
  village?: string;
  from?: number;
  to?: number;
}

export async function scenarioStats(db: D1Database, block: { row: ScenarioBlockRow; def: ScenarioDefinition }, f: ScenarioStatsFilter) {
  const where = ['sa.scenario_block_id = ?'];
  const args: (string | number)[] = [block.row.id];
  const textEq = (col: string, v?: string) => {
    if (v) {
      where.push(`lower(trim(${col})) = lower(trim(?))`);
      args.push(v);
    }
  };
  if (f.role) {
    where.push('sa.role_snapshot = ?');
    args.push(f.role);
  }
  textEq('sa.regency_snapshot', f.regency);
  textEq('sa.district_snapshot', f.district);
  textEq('sa.village_snapshot', f.village);
  if (f.from !== undefined) {
    where.push('sa.started_at >= ?');
    args.push(f.from);
  }
  if (f.to !== undefined) {
    where.push('sa.started_at < ?');
    args.push(f.to);
  }
  const w = where.join(' AND ');

  const totals = await db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
              AVG(CASE WHEN status = 'completed' THEN percent END) AS avg_pct,
              COUNT(DISTINCT user_id) AS learners
       FROM scenario_attempts sa WHERE ${w}`,
    )
    .bind(...args)
    .first<{ total: number; completed: number | null; avg_pct: number | null; learners: number }>();
  const { results: bandRows } = await db
    .prepare(`SELECT band_key, COUNT(*) AS n FROM scenario_attempts sa WHERE ${w} AND sa.status = 'completed' GROUP BY band_key`)
    .bind(...args)
    .all<{ band_key: string; n: number }>();
  const { results: choiceRows } = await db
    .prepare(
      `SELECT sc.node_id, sc.option_id, COUNT(*) AS n FROM scenario_choices sc JOIN scenario_attempts sa ON sa.id = sc.attempt_id
       WHERE ${w} AND sc.option_id IS NOT NULL GROUP BY sc.node_id, sc.option_id`,
    )
    .bind(...args)
    .all<{ node_id: string; option_id: string; n: number }>();

  const completed = totals?.completed ?? 0;
  const count = (nodeId: string, optionId: string) => choiceRows.find((r) => r.node_id === nodeId && r.option_id === optionId)?.n ?? 0;
  return {
    block: { id: block.row.id, key: block.row.block_key, version: block.row.version, title: block.row.title, status: block.row.status, maxScore: block.row.max_score },
    minCell: MIN_CELL,
    attempts: { total: suppress(totals?.total ?? 0), completed: suppress(completed), learners: suppress(totals?.learners ?? 0) },
    averagePercent: completed >= MIN_CELL && totals?.avg_pct !== null && totals?.avg_pct !== undefined ? Math.round(totals.avg_pct) : null,
    bands: block.def.scoring.bands.map((b) => ({ key: b.key, label: b.label, count: suppress(bandRows.find((r) => r.band_key === b.key)?.n ?? 0) })),
    nodes: block.def.nodes.flatMap((node) => {
      if (node.type !== 'decision') return [];
      const total = node.options.reduce((s, o) => s + count(node.id, o.id), 0);
      return [
        {
          id: node.id,
          title: node.title ?? null,
          prompt: node.prompt,
          responses: suppress(total),
          options: node.options.map((o) => {
            const n = count(node.id, o.id);
            const shown = suppress(n);
            return {
              id: o.id,
              text: o.text,
              verdict: o.verdict,
              label: SCENARIO_VERDICT_LABELS[o.verdict],
              count: shown,
              percent: shown !== null && total >= MIN_CELL ? Math.round((n * 100) / total) : null,
            };
          }),
        },
      ];
    }),
  };
}
