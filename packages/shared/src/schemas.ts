import { z } from 'zod';
import { SYSTEM_ROLES, VILLAGE_ROLES } from './constants';

const shortText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const idParam = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const profilePatchSchema = z
  .object({
    displayName: shortText(120).optional(),
    certificateName: optionalText(120),
    villageRole: z.enum(VILLAGE_ROLES).nullable().optional(),
    villageName: optionalText(80),
    district: optionalText(80),
    regency: optionalText(80),
    privacyConsent: z.literal(true).optional(),
  })
  .strict();
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export const heartbeatSchema = z
  .object({
    sessionId: idParam,
    visible: z.boolean(),
    interacted: z.boolean(),
  })
  .strict();

export const answersPatchSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            questionId: idParam,
            optionKey: z.string().max(64).nullable().optional(),
            essayText: z.string().max(20_000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const aiPromptSchema = z.object({ message: z.string().trim().min(1).max(1000) }).strict();

export const ratingSchema = z.object({ stars: z.number().int().min(1).max(5) }).strict();

export const appealSchema =z.object({ reason: z.string().trim().min(10).max(2000) }).strict();

export const googleStartSchema = z
  .object({
    turnstileToken: z.string().min(1).max(4096),
    returnTo: z
      .string()
      .max(200)
      .regex(/^\/(?!\/)[A-Za-z0-9/_\-?=&.]*$/)
      .optional(),
  })
  .strict();

export const devLoginSchema = z
  .object({
    email: z.email().max(200),
    name: shortText(120),
    roles: z.array(z.enum(SYSTEM_ROLES)).max(5).optional(),
  })
  .strict();

// ------------------------------------------------------------------ admin
const epochMs = z.number().int().min(0).max(4_102_444_800_000).nullable().optional();

export const courseCreateSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{3,80}$/),
    title: shortText(160),
    description: z.string().trim().max(2000).default(''),
    visibility: z.enum(['public', 'private']).default('public'),
  })
  .strict();

export const coursePatchSchema = z
  .object({
    title: shortText(160).optional(),
    description: z.string().trim().max(2000).optional(),
    visibility: z.enum(['public', 'private']).optional(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    enrollmentOpenAt: epochMs,
    enrollmentCloseAt: epochMs,
    accessStartsAt: epochMs,
    accessExpiresAt: epochMs,
    accessDurationDays: z.number().int().min(1).max(3650).nullable().optional(),
    learningSessionTtlSeconds: z.number().int().min(300).max(86_400).optional(),
    recommendedFor: z.array(z.enum(VILLAGE_ROLES)).max(9).optional(),
  })
  .strict();

export const lessonUpsertSchema = z
  .object({
    title: shortText(160),
    summary: z.string().trim().max(500).default(''),
    contentType: z.enum(['html', 'slides', 'pdf', 'youtube']),
    contentSource: z.string().max(60_000).default(''),
    youtube: z.string().trim().max(200).nullable().optional(),
    requiredActiveSeconds: z.number().int().min(0).max(36_000).default(300),
    isRequired: z.boolean().default(true),
  })
  .strict();

export const assessmentUpsertSchema = z
  .object({
    title: shortText(160),
    instructions: z.string().trim().max(2000).default(''),
    timeLimitSeconds: z.number().int().min(60).max(14_400),
    passingScorePct: z.number().int().min(0).max(100),
    maxAttempts: z.number().int().min(1).max(20),
    cooldownSeconds: z.number().int().min(0).max(604_800),
    mcqCount: z.number().int().min(0).max(100),
    essayCount: z.number().int().min(0).max(10),
    graceSeconds: z.number().int().min(0).max(120).default(20),
    isRequired: z.boolean().default(true),
    examCopyDeterrenceEnabled: z.boolean().default(true),
    accessibilityExemptionPolicy: z.enum(['per_user', 'none']).default('per_user'),
    hideLessonLinksDuringExam: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.mcqCount + v.essayCount > 0, { message: 'Minimal satu soal.' });

const rubricCriterion = z.object({ criterion: shortText(120), maxScore: z.number().int().min(1).max(100) }).strict();

export const questionCreateSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('mcq'),
      stem: z.string().trim().min(5).max(4000),
      difficulty: z.number().int().min(1).max(3).default(2),
      topic: z.string().trim().max(60).default('umum'),
      points: z.number().int().min(1).max(100).default(1),
      options: z
        .array(z.object({ body: shortText(1000), isCorrect: z.boolean() }).strict())
        .min(2)
        .max(6)
        .refine((o) => o.filter((x) => x.isCorrect).length === 1, { message: 'Tepat satu jawaban benar.' }),
    })
    .strict(),
  z
    .object({
      type: z.literal('essay'),
      stem: z.string().trim().min(5).max(4000),
      difficulty: z.number().int().min(1).max(3).default(2),
      topic: z.string().trim().max(60).default('umum'),
      points: z.number().int().min(1).max(100).default(10),
      rubric: z.array(rubricCriterion).min(1).max(8),
      modelAnswer: z.string().trim().max(8000).default(''),
    })
    .strict(),
]);
export type QuestionCreate = z.infer<typeof questionCreateSchema>;

/**
 * Impor bank soal. Klien mengirim per potongan kecil (QUESTION_IMPORT_CHUNK) agar setiap request
 * tetap jauh di bawah batas query D1 per invocation Worker (paket Free: 50).
 */
export const QUESTION_IMPORT_CHUNK = 5;
export const questionImportSchema = z
  .object({ questions: z.array(questionCreateSchema).min(1).max(QUESTION_IMPORT_CHUNK) })
  .strict();

/** Berkas bank soal (JSON). Kunci lain (judul, sumber, catatan) diabaikan. */
export const questionBankFileSchema = z.object({
  questions: z.array(questionCreateSchema).min(1).max(500),
});

export const reviewDecisionSchema = z
  .object({
    rubricScores: z.array(z.object({ criterion: shortText(120), score: z.number().int().min(0).max(100) }).strict()).min(1).max(8),
    feedback: z.string().trim().max(4000).default(''),
    reason: z.string().trim().max(500).default(''),
  })
  .strict();

export const roleAssignSchema = z.object({ role: z.enum(SYSTEM_ROLES), grant: z.boolean() }).strict();

export const accommodationSchema = z
  .object({ copyDeterrenceExempt: z.boolean(), note: z.string().trim().max(300).default('') })
  .strict();

export const mentorAssignSchema = z.object({ mentorId: idParam, assign: z.boolean() }).strict();

export const appealResolveSchema = z
  .object({ status: z.enum(['resolved', 'rejected']), resolution: z.string().trim().min(3).max(2000) })
  .strict();

export const certificateRevokeSchema = z.object({ reason: z.string().trim().min(5).max(300) }).strict();

/** Kode verifikasi Sertifikat Studio: 16 karakter Crockford Base32 (boleh diketik dengan strip). */
export function normalizeCertificateCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(s) ? s : null;
}

/** Pilihan soal kuis: daftar LENGKAP soal bank yang dipakai (soal lain di bank tidak ikut diundi). */
export const questionSelectionSchema = z.object({ ids: z.array(idParam).max(1000) }).strict();
