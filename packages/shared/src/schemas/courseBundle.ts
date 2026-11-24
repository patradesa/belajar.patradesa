import { z } from 'zod';

const slugRegex = /^[a-z0-9][a-z0-9-]{2,63}$/;

export const BundleRubricItemSchema = z.object({
  criterion: z.string().min(3).max(100),
  maxScore: z.number().int().min(1).max(100),
  indicator: z.string().min(3).max(500).optional(),
});

export const BundleMcqQuestionSchema = z.object({
  type: z.literal('mcq'),
  stem: z.string().min(5).max(2000),
  difficulty: z.number().int().min(1).max(3).default(2),
  topic: z.string().min(1).max(64).default('umum'),
  points: z.number().int().min(1).max(100).default(10),
  explanation: z.string().max(2000).optional(),
  options: z
    .array(
      z.object({
        body: z.string().min(1).max(500),
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
  stem: z.string().min(10).max(3000),
  topic: z.string().min(1).max(64).default('umum'),
  points: z.number().int().min(1).max(100).default(25),
  sampleAnswer: z.string().min(5).max(3000),
  rubric: z
    .array(BundleRubricItemSchema)
    .min(1)
    .max(6)
    .refine((items) => items.reduce((sum, i) => sum + i.maxScore, 0) === 100, {
      message: 'Total skor maksimal seluruh kriteria rubrik esai wajib berjumlah 100.',
    }),
});

export const BundleLessonSchema = z.object({
  lessonKey: z.string().regex(slugRegex, 'lessonKey harus huruf kecil, angka, dan tanda minus'),
  title: z.string().min(3).max(200),
  summary: z.string().max(500).default(''),
  type: z.enum(['html', 'slides', 'pdf', 'youtube']).default('html'),
  requiredMinutes: z.number().int().min(0).max(120).default(5),
  isRequired: z.boolean().default(true),
  contentSource: z.string().min(10).max(60000),
  quiz: z
    .object({
      title: z.string().min(3).max(200),
      passPercent: z.number().int().min(0).max(100).default(70),
      timeLimitMinutes: z.number().int().min(1).max(180).default(15),
      maxAttempts: z.number().int().min(1).max(10).default(3),
      cooldownMinutes: z.number().int().min(0).max(1440).default(60),
      isRequired: z.boolean().default(true),
      showExplanations: z.boolean().default(true),
      mcqDisplayCount: z.number().int().min(0).max(50),
      essayDisplayCount: z.number().int().min(0).max(10).default(0),
      questions: z.array(z.union([BundleMcqQuestionSchema, BundleEssayQuestionSchema])).min(1),
    })
    .optional(),
});

export const CourseBundleSchema = z
  .object({
    schemaVersion: z.literal('patradesa-course-bundle-v1'),
    course: z.object({
      title: z.string().min(5).max(200),
      slug: z.string().regex(slugRegex),
      description: z.string().min(10).max(2000),
      targetRoles: z.array(z.string()).default([]),
    }),
    // Skenario divalidasi oleh validator skenario eksisting di service layer
    scenarios: z.array(z.record(z.string(), z.unknown())).default([]),
    lessons: z.array(BundleLessonSchema).min(1).max(20),
  })
  .superRefine((data, ctx) => {
    // 1. Cek keunikan lessonKey
    const seenKeys = new Set<string>();
    for (const lesson of data.lessons) {
      if (seenKeys.has(lesson.lessonKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplikat lessonKey ditemukan: ${lesson.lessonKey}`,
        });
      }
      seenKeys.add(lesson.lessonKey);

      // 2. Cek larangan tabel Markdown & tag HTML mentah agar ramah BlockRenderer
      if (/^\|.+\|/m.test(lesson.contentSource) || /<[a-zA-Z/][^>]*>/.test(lesson.contentSource)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unit "${lesson.title}" mengandung tabel Markdown atau tag HTML mentah yang tidak didukung parser LMS.`,
        });
      }
    }

    // 3. Cek semua tag [[skenario:id]] memiliki pasangan di array scenarios
    const scenarioIds = new Set(
      data.scenarios.map((s) => (typeof s.id === 'string' ? s.id : '')).filter(Boolean)
    );
    const embedRegex = /^\[\[skenario:([a-z0-9][a-z0-9-]{2,63})\]\]$/gm;

    for (const lesson of data.lessons) {
      let match: RegExpExecArray | null;
      while ((match = embedRegex.exec(lesson.contentSource)) !== null) {
        const refId = match[1];
        if (!scenarioIds.has(refId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unit "${lesson.lessonKey}" menyisipkan [[skenario:${refId}]], tetapi objek skenario tersebut tidak ada di bundel.`,
          });
        }
      }
    }
  });

export type CourseBundleInput = z.infer<typeof CourseBundleSchema>;

