/**
 * Paket kelas (course bundle) v1: satu berkas JSON berisi kelas, materi, kuis + soal, dan skenario.
 * Dipakai halaman Admin → Impor paket kelas. Bagian-bagiannya MEMAKAI ULANG skema endpoint yang ada
 * (courseCreateSchema, lessonUpsertSchema, assessmentUpsertSchema, questionCreateSchema, validateScenario),
 * sehingga paket yang lolos validasi ini pasti diterima endpoint saat impor bertahap.
 * Spesifikasi: docs/course-bundle/README.md.
 */
import { z } from 'zod';
import { VILLAGE_ROLES } from '../constants';
import { SCENARIO_EMBED } from '../content';
import { validateScenario, type ScenarioDefinition } from '../scenario';
import { assessmentUpsertSchema, courseCreateSchema, lessonUpsertSchema, questionCreateSchema } from '../schemas';

export const COURSE_BUNDLE_VERSION = 'patradesa-course-bundle-v1' as const;
export const VillageRoleEnum = z.enum(VILLAGE_ROLES);

const lessonKeyRegex = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Kuis datar (pengaturan + soal). Pengaturan divalidasi dengan skema endpoint PUT /lessons/:id/assessment. */
export const BundleQuizSchema = z
  .object({ questions: z.array(questionCreateSchema).min(1).max(500) })
  .catchall(z.unknown())
  .transform((q, ctx) => {
    const { questions, ...rest } = q;
    const s = assessmentUpsertSchema.safeParse(rest);
    if (!s.success) {
      for (const i of s.error.issues) ctx.addIssue({ code: 'custom', message: i.message, path: i.path });
      return z.NEVER;
    }
    return { settings: s.data, questions };
  });

export const BundleLessonSchema = lessonUpsertSchema.extend({
  lessonKey: z.string().trim().regex(lessonKeyRegex, 'lessonKey: huruf kecil, angka, dan tanda minus (2–64 karakter).'),
  quiz: BundleQuizSchema.optional(),
});

export const CourseBundleSchema = z
  .object({
    schemaVersion: z.literal(COURSE_BUNDLE_VERSION),
    course: courseCreateSchema.extend({
      // Impor selalu aman: privat bila tidak disebut.
      visibility: z.enum(['public', 'private']).default('private'),
      targetRoles: z.array(VillageRoleEnum).max(9).default([]),
    }),
    /** Definisi skenario lengkap (format docs/scenario-block). Status dipaksa draf saat impor. */
    scenarios: z.array(z.unknown()).max(40).default([]),
    lessons: z.array(BundleLessonSchema).min(1).max(30),
  })
  .strict()
  .superRefine((data, ctx) => {
    const ids = new Set<string>();
    data.scenarios.forEach((raw, i) => {
      const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>), status: 'draft' } : raw;
      const v = validateScenario(input);
      if (!v.ok) {
        for (const e of v.errors.slice(0, 10)) ctx.addIssue({ code: 'custom', path: ['scenarios', i], message: e });
        return;
      }
      if (ids.has(v.definition.id)) ctx.addIssue({ code: 'custom', path: ['scenarios', i, 'id'], message: `ID skenario ganda: ${v.definition.id}` });
      ids.add(v.definition.id);
    });

    const keys = new Set<string>();
    data.lessons.forEach((l, i) => {
      if (keys.has(l.lessonKey)) ctx.addIssue({ code: 'custom', path: ['lessons', i, 'lessonKey'], message: `lessonKey ganda: ${l.lessonKey}` });
      keys.add(l.lessonKey);
      const q = l.quiz;
      if (q) {
        const mcq = q.questions.filter((x) => x.type === 'mcq').length;
        const essay = q.questions.length - mcq;
        if (mcq < q.settings.mcqCount || essay < q.settings.essayCount) {
          ctx.addIssue({
            code: 'custom',
            path: ['lessons', i, 'quiz'],
            message: `Kuis "${q.settings.title}" menampilkan ${q.settings.mcqCount} PG dan ${q.settings.essayCount} esai, tetapi bank berisi ${mcq} PG dan ${essay} esai.`,
          });
        }
      }
    });
  });

export type CourseBundleInput = z.input<typeof CourseBundleSchema>;
export type CourseBundle = z.output<typeof CourseBundleSchema>;

/** Kunci skenario yang disisipkan di materi ([[skenario:kunci]]), urut kemunculan. */
export function bundleEmbeddedScenarioKeys(bundle: CourseBundle): string[] {
  const out: string[] = [];
  for (const l of bundle.lessons) {
    for (const line of l.contentSource.split('\n')) {
      const m = SCENARIO_EMBED.exec(line.trim());
      if (m && !out.includes(m[1]!)) out.push(m[1]!);
    }
  }
  return out;
}

/** Definisi skenario siap kirim ke POST /admin/scenarios (sudah tervalidasi oleh CourseBundleSchema). */
export function bundleScenarioDefinitions(bundle: CourseBundle): ScenarioDefinition[] {
  return bundle.scenarios.map((raw) => {
    const v = validateScenario({ ...(raw as Record<string, unknown>), status: 'draft' });
    if (!v.ok) throw new Error('Skenario tidak valid; validasi paket dulu.');
    return v.definition;
  });
}
