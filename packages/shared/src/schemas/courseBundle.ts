import { z } from 'zod';

const slugRegex = /^[a-z0-9][a-z0-9-]{2,63}$/;

export const VillageRoleEnum = z.enum([
  'perbekel',
  'sekdes',
  'kaur',
  'kasi',
  'kawil',
  'operator_sid',
  'bpd',
  'kader',
  'lainnya',
]);

export const BundleRubricItemSchema = z.object({
  criterion: z.string().min(3).max(100),
  maxScore: z.number().int().min(1).max(100),
  indicator: z.string().min(3).max(500).optional(),
});

export const BundleMcqQuestionSchema = z.object({
  type: z.literal('mcq'),
  stem: z.string().min(5).max(4000),
  difficulty: z.number().int().min(1).max(3).default(2),
  topic: z.string().min(1).max(64).default('umum'),
  points: z.number().int().min(1).max(100).default(10),
  explanation: z.string().max(2000).optional(),
  options: z
    .array(
      z.object({
        body: z.string().min(1).max(1000),
        isCorrect: z.boolean(),
      })
    )
    .min(2)
    .max(6)
    .refine((opts) => opts.filter((o) => o.isCorrect).length === 1, {
      message: 'Setiap soal PG wajib memiliki tepat 1 jawaban benar.',
    }),
});

export const BundleEssayQuestionSchema = z.object({
  type: z.literal('essay'),
  stem: z.string().min(10).max(4000),
  topic: z.string().min(1).max(64).default('umum'),
  points: z.number().int().min(1).max(100).default(25),
  modelAnswer: z.string().min(5).max(3000),
  rubric: z
    .array(BundleRubricItemSchema)
    .min(1)
    .max(6)
    .refine((items) => items.reduce((sum, i) => sum + i.maxScore, 0) === 100, {
      message: 'Total skor maksimal seluruh kriteria rubrik esai wajib berjumlah 100.',
    }),
});

export const BundleScenarioBlockSchema = z.object({
  id: z.string().regex(slugRegex, 'ID skenario harus huruf kecil, angka, dan tanda minus (3-64 karakter)'),
  title: z.string().min(3).max(120),
  mode: z.enum(['formative', 'graded']).default('formative'),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  passPercent: z.number().int().min(0).max(100).default(70),
  maxScore: z.number().int().min(0).default(30),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format validFrom wajib YYYY-MM-DD'),
  nodes: z.array(z.record(z.string(), z.unknown())).min(1),
  bands: z.array(z.record(z.string(), z.unknown())).min(1),
}).passthrough();

export const BundleLessonSchema = z.object({
  lessonKey: z.string().regex(slugRegex, 'lessonKey harus huruf kecil, angka, dan tanda minus'),
  title: z.string().min(1).max(160),
  summary: z.string().max(500).default(''),
  contentType: z.enum(['html', 'slides', 'pdf', 'youtube']).default('html'),
  requiredActiveSeconds: z.number().int().min(0).max(36000).default(300),
  isRequired: z.boolean().default(true),
  contentSource: z.string().min(10).max(60000),
  quiz: z
    .object({
      title: z.string().min(3).max(160),
      instructions: z.string().max(2000).default(''),
      passingScorePct: z.number().int().min(0).max(100).default(70),
      timeLimitSeconds: z.number().int().min(60).max(14400).default(900),
      maxAttempts: z.number().int().min(1).max(20).default(3),
      cooldownSeconds: z.number().int().min(0).max(604800).default(3600),
      isRequired: z.boolean().default(true),
      reviewPolicy: z.enum(['none', 'after_done']).default('after_done'),
      mcqCount: z.number().int().min(0).max(100),
      essayCount: z.number().int().min(0).max(10).default(0),
      questions: z.array(z.union([BundleMcqQuestionSchema, BundleEssayQuestionSchema])).min(1),
    })
    .optional(),
});

export const CourseBundleSchema = z
  .object({
    schemaVersion: z.literal('patradesa-course-bundle-v1'),
    course: z.object({
      title: z.string().min(3).max(160),
      slug: z.string().regex(slugRegex),
      description: z.string().max(2000).default(''),
      visibility: z.enum(['public', 'private']).default('private'),
      targetRoles: z.array(VillageRoleEnum).default([]),
    }),
    scenarios: z.array(BundleScenarioBlockSchema).default([]),
    lessons: z.array(BundleLessonSchema).min(1).max(20),
  })
  .superRefine((data, ctx) => {
    const seenLessonKeys = new Set<string>();
    const seenScenarioIds = new Set<string>();

    for (const scen of data.scenarios) {
      if (seenScenarioIds.has(scen.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplikat ID skenario di dalam bundel: ${scen.id}`,
        });
      }
      seenScenarioIds.add(scen.id);
    }

    const embedRegex = /^\[\[skenario:([a-z0-9][a-z0-9-]{2,63})\]\]$/gm;

    for (const lesson of data.lessons) {
      if (seenLessonKeys.has(lesson.lessonKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplikat lessonKey ditemukan: ${lesson.lessonKey}`,
        });
      }
      seenLessonKeys.add(lesson.lessonKey);

      if (/^\|.+\|/m.test(lesson.contentSource) || /<[a-zA-Z/][^>]*>/.test(lesson.contentSource)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unit "${lesson.title}" mengandung tabel Markdown atau tag HTML mentah yang tidak didukung parser LMS.`,
        });
      }

      let match: RegExpExecArray | null;
      while ((match = embedRegex.exec(lesson.contentSource)) !== null) {
        const refId = match[1];
        if (!seenScenarioIds.has(refId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unit "${lesson.lessonKey}" menyisipkan [[skenario:${refId}]], tetapi objek skenario tidak ditemukan di bundel.`,
          });
        }
      }
    }
  });

export type CourseBundleInput = z.infer<typeof CourseBundleSchema>;
