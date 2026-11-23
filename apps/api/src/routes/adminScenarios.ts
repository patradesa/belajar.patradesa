import { Hono, type Context } from 'hono';
import { ERROR_CODES, VILLAGE_ROLES, scenarioStatusSchema, scenarioUpsertSchema, validateScenario, type ScenarioDefinition } from '@patradesa/shared';
import type { AppEnv, Deps } from '../env';
import { HttpError, forbidden, notFound, param, readJson } from '../lib/http';
import { newId } from '../lib/crypto';
import { auditStmt } from '../lib/audit';
import { currentUser, hasRole, requireRole } from '../middleware/auth';
import { loadBlock, scenarioStats, type ScenarioBlockRow, type ScenarioStatsFilter } from '../services/scenarios';

/** Status yang boleh dituju dari status asal. Versi published hanya bisa diarsipkan (immutable). */
const TRANSITIONS: Record<ScenarioBlockRow['status'], ScenarioBlockRow['status'][]> = {
  draft: ['in_review', 'published', 'archived'],
  in_review: ['draft', 'published', 'archived'],
  published: ['archived'],
  archived: [],
};

const invalid = (errors: string[]) =>
  new HttpError(
    400,
    ERROR_CODES.VALIDATION,
    'Skenario tidak valid. Perbaiki bagian yang disebutkan lalu simpan lagi.',
    errors.map((e) => {
      const i = e.indexOf(': ');
      return { path: i > 0 ? e.slice(0, i) : '/', message: i > 0 ? e.slice(i + 2) : e };
    }),
  );

const listView = (r: ScenarioBlockRow) => ({
  id: r.id,
  key: r.block_key,
  version: r.version,
  status: r.status,
  mode: r.mode,
  title: r.title,
  maxAttempts: r.max_attempts,
  passPercent: r.pass_percent,
  maxScore: r.max_score,
  validFrom: r.valid_from,
  reviewedBy: r.reviewed_by,
  reviewedAt: r.reviewed_at,
  nextReviewDue: r.next_review_due,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Mentor hanya untuk blok yang dipasang di kelas yang ditugaskan kepadanya. */
async function canSeeStats(c: Context<AppEnv>, blockId: string): Promise<boolean> {
  if (hasRole(c, 'admin')) return true;
  const u = currentUser(c);
  const r = await c.env.DB.prepare(
    `SELECT 1 AS x FROM lesson_scenarios ls JOIN lessons l ON l.id = ls.lesson_id JOIN course_versions cv ON cv.id = l.course_version_id
     JOIN mentor_assignments m ON m.course_id = cv.course_id AND m.mentor_id = ? WHERE ls.scenario_block_id = ? LIMIT 1`,
  )
    .bind(u.id, blockId)
    .first();
  return !!r;
}

function statsFilter(c: Context<AppEnv>): ScenarioStatsFilter {
  const q = (k: string) => {
    const v = c.req.query(k)?.trim();
    if (!v) return undefined;
    if (v.length > 80) throw new HttpError(400, ERROR_CODES.VALIDATION, `Filter ${k} terlalu panjang.`);
    return v;
  };
  const day = (k: string, plusDay = false) => {
    const v = q(k);
    if (!v) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new HttpError(400, ERROR_CODES.VALIDATION, `Tanggal ${k} harus YYYY-MM-DD.`);
    return Date.parse(`${v}T00:00:00+08:00`) + (plusDay ? 86_400_000 : 0); // WITA
  };
  const role = q('role');
  if (role && !(VILLAGE_ROLES as readonly string[]).includes(role)) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Jabatan tidak dikenal.');
  return { role, regency: q('regency'), district: q('district'), village: q('village'), from: day('from'), to: day('to', true) };
}

export function scenarioAdminRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  const editors = requireRole('content_editor', 'admin');
  const staff = requireRole('content_editor', 'admin', 'mentor');

  r.get('/', staff, async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM scenario_blocks ORDER BY block_key, version DESC LIMIT 500').all<ScenarioBlockRow>();
    return c.json({ scenarios: results.map(listView) });
  });

  r.get('/:id', staff, async (c) => {
    const b = await loadBlock(c.env.DB, param(c, 'id'));
    if (!b) throw notFound('Skenario');
    const { results: usedIn } = await c.env.DB.prepare(
      `SELECT c.id AS course_id, c.title AS course_title, cv.version_no, l.title AS lesson_title
       FROM lesson_scenarios ls JOIN lessons l ON l.id = ls.lesson_id JOIN course_versions cv ON cv.id = l.course_version_id JOIN courses c ON c.id = cv.course_id
       WHERE ls.scenario_block_id = ? ORDER BY c.title, cv.version_no`,
    )
      .bind(b.row.id)
      .all();
    return c.json({ ...listView(b.row), definition: b.def, usedIn });
  });

  /** Simpan JSON authoring. Ada versi draft/in_review → ditimpa (kembali ke draft); tidak ada → versi baru. */
  r.post('/', editors, async (c) => {
    const u = currentUser(c);
    const now = deps.now();
    const { definition } = await readJson(c, scenarioUpsertSchema);
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw invalid(['/: harus berupa objek JSON']);
    const input = { ...(definition as Record<string, unknown>), status: 'draft' };
    const pre = validateScenario(input);
    if (!pre.ok) throw invalid(pre.errors);
    const key = pre.definition.id;

    const editable = await c.env.DB.prepare(`SELECT id, version FROM scenario_blocks WHERE block_key = ? AND status IN ('draft', 'in_review')`)
      .bind(key)
      .first<{ id: string; version: number }>();
    const max = await c.env.DB.prepare('SELECT MAX(version) AS v FROM scenario_blocks WHERE block_key = ?').bind(key).first<{ v: number | null }>();
    const version = editable?.version ?? (max?.v ?? 0) + 1;
    const def: ScenarioDefinition = { ...pre.definition, version, status: 'draft' };
    const json = JSON.stringify(def);
    if (json.length > 200_000) throw invalid(['/: skenario terlalu besar']);

    const id = editable?.id ?? newId();
    const stmt = editable
      ? c.env.DB.prepare(
          `UPDATE scenario_blocks SET status = 'draft', mode = ?, title = ?, max_attempts = ?, pass_percent = ?, max_score = ?, definition_json = ?,
             valid_from = ?, reviewed_by = NULL, reviewed_at = NULL, next_review_due = NULL, updated_at = ? WHERE id = ?`,
        ).bind(def.mode, def.title, def.maxAttempts, def.scoring.passPercent, pre.maxScore, json, def.validFrom, now, id)
      : c.env.DB.prepare(
          `INSERT INTO scenario_blocks (id, block_key, version, status, mode, title, max_attempts, pass_percent, max_score, definition_json, valid_from, created_by, created_at, updated_at)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, key, version, def.mode, def.title, def.maxAttempts, def.scoring.passPercent, pre.maxScore, json, def.validFrom, u.id, now, now);
    try {
      await c.env.DB.batch([stmt, auditStmt(c.env.DB, now, u.id, editable ? 'scenario.update' : 'scenario.create', 'scenario', id, { key, version })]);
    } catch {
      throw new HttpError(409, ERROR_CODES.CONFLICT, 'Skenario ini sedang disimpan dari tempat lain. Muat ulang lalu coba lagi.');
    }
    return c.json({ ...listView((await loadBlock(c.env.DB, id))!.row) }, editable ? 200 : 201);
  });

  r.post('/:id/status', editors, async (c) => {
    const u = currentUser(c);
    const now = deps.now();
    const b = await loadBlock(c.env.DB, param(c, 'id'));
    if (!b) throw notFound('Skenario');
    const body = await readJson(c, scenarioStatusSchema);
    const to = body.status;
    if (!TRANSITIONS[b.row.status].includes(to)) {
      throw new HttpError(409, ERROR_CODES.CONFLICT, `Status "${b.row.status}" tidak dapat diubah menjadi "${to}".`);
    }
    if ((to === 'published' || to === 'archived') && !hasRole(c, 'admin')) throw forbidden('Hanya admin yang dapat menerbitkan atau mengarsipkan skenario.');

    const stmts: D1PreparedStatement[] = [];
    if (to === 'published') {
      if (!body.review) throw invalid(['/review: data penelaah wajib diisi untuk menerbitkan']);
      const def: ScenarioDefinition = { ...b.def, status: 'published', review: { ...b.def.review, ...body.review } };
      const v = validateScenario(def);
      if (!v.ok) throw invalid(v.errors);
      stmts.push(
        // Versi published lama tetap terbaca oleh kelas yang sudah memasangnya, tetapi tidak dipakai untuk penerbitan baru.
        c.env.DB.prepare(`UPDATE scenario_blocks SET status = 'archived', updated_at = ? WHERE block_key = ? AND status = 'published'`).bind(now, b.row.block_key),
        c.env.DB.prepare(
          `UPDATE scenario_blocks SET status = 'published', definition_json = ?, reviewed_by = ?, reviewed_at = ?, next_review_due = ?, published_by = ?, updated_at = ?
           WHERE id = ? AND status = ?`,
        ).bind(JSON.stringify(def), body.review.reviewedBy, body.review.reviewedAt, body.review.nextReviewDue, u.id, now, b.row.id, b.row.status),
      );
    } else {
      const def = { ...b.def, status: to };
      stmts.push(
        c.env.DB.prepare('UPDATE scenario_blocks SET status = ?, definition_json = ?, updated_at = ? WHERE id = ? AND status = ?').bind(
          to,
          JSON.stringify(def),
          now,
          b.row.id,
          b.row.status,
        ),
      );
    }
    stmts.push(
      auditStmt(c.env.DB, now, u.id, `scenario.${to}`, 'scenario', b.row.id, {
        key: b.row.block_key,
        version: b.row.version,
        from: b.row.status,
        selfReviewed: to === 'published' && b.row.created_by === u.id,
      }),
    );
    try {
      await c.env.DB.batch(stmts);
    } catch {
      throw new HttpError(409, ERROR_CODES.CONFLICT, 'Status skenario berubah di tempat lain. Muat ulang lalu coba lagi.');
    }
    return c.json(listView((await loadBlock(c.env.DB, b.row.id))!.row));
  });

  /** Statistik agregat: tanpa nama/email; sel < 5 disamarkan; setiap akses dicatat. */
  r.get('/:id/stats', requireRole('admin', 'mentor'), async (c) => {
    const u = currentUser(c);
    const b = await loadBlock(c.env.DB, param(c, 'id'));
    if (!b) throw notFound('Skenario');
    if (!(await canSeeStats(c, b.row.id))) throw notFound('Skenario');
    const f = statsFilter(c);
    const stats = await scenarioStats(c.env.DB, b, f);
    await auditStmt(c.env.DB, deps.now(), u.id, 'scenario.stats.view', 'scenario', b.row.id, {
      role: f.role ?? null,
      regency: f.regency ?? null,
      district: f.district ?? null,
      village: f.village ?? null,
    }).run();
    return c.json(stats);
  });

  return r;
}
