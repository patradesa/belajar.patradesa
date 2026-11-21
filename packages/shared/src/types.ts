import type { Block } from './content';
import type { SystemRole, VillageRole } from './constants';

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface MeResponse {
  user: { id: string; email: string; displayName: string };
  roles: SystemRole[];
  profile: {
    certificateName: string | null;
    villageRole: VillageRole | null;
    villageName: string | null;
    district: string | null;
    regency: string | null;
    privacyConsentAt: number | null;
  };
  csrfToken: string;
  /** Status exam lock untuk UI. Server tetap memeriksa ulang di setiap endpoint AI. */
  activeAttempt: { id: string; assessmentId: string; deadlineAt: number } | null;
}

export interface CourseRating {
  /** Rata-rata 1–5 (satu desimal) atau null bila belum ada rating. */
  average: number | null;
  count: number;
}

export interface CatalogCourse {
  id: string;
  slug: string;
  title: string;
  description: string;
  lessonCount: number;
  /** Total waktu belajar minimum seluruh materi (menit, dibulatkan ke atas). */
  studyMinutes: number;
  /** Jumlah soal yang ditampilkan di kuis (PG + esai) pada versi terbit. */
  quizQuestionCount: number;
  /** Jabatan desa yang dicentang admin sebagai sasaran kelas (urut prioritas). */
  recommendedRoles: VillageRole[];
  rating: CourseRating;
  coverUrl: string | null;
  /** Peserta yang sedang login sudah terdaftar di kelas ini. */
  enrolled: boolean;
  /** Jabatan peserta yang login termasuk sasaran kelas. */
  recommended?: boolean;
}

export interface LessonSummary {
  id: string;
  seq: number;
  title: string;
  summary: string;
  contentType: 'html' | 'slides' | 'pdf' | 'youtube';
  requiredActiveSeconds: number;
  isRequired: boolean;
  activeSeconds: number;
  completed: boolean;
  assessment: AssessmentSummary | null;
}

export interface AssessmentSummary {
  id: string;
  title: string;
  timeLimitSeconds: number;
  passingScorePct: number;
  maxAttempts: number;
  attemptsUsed: number;
  eligible: boolean;
  bestResult: 'passed' | 'failed' | 'pending_review' | 'pending' | null;
}

export interface CourseDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  enrolled: boolean;
  enrollment: { id: string; status: string; expiresAt: number | null } | null;
  lessons: LessonSummary[];
  completion: { passed: boolean; reasons: string[] } | null;
  rating: CourseRating;
  /** Rating dari peserta yang login (1–5) atau null. */
  myRating: number | null;
  coverUrl: string | null;
}

export interface LessonContent {
  id: string;
  title: string;
  contentType: 'html' | 'slides' | 'pdf' | 'youtube';
  blocks: Block[];
  youtubeId: string | null;
  fileUrl: string | null;
  courseId: string;
  requiredActiveSeconds: number;
  activeSeconds: number;
  completed: boolean;
}

export interface LearningSessionResponse {
  sessionId: string;
  expiresAt: number;
  activeSeconds: number;
  requiredActiveSeconds: number;
  completed: boolean;
}

export interface AttemptQuestionView {
  id: string;
  sequence: number;
  type: 'mcq' | 'essay';
  stem: string;
  points: number;
  options: { key: string; body: string }[];
  answer: { optionKey: string | null; essayText: string | null } | null;
}

export interface AttemptView {
  id: string;
  assessmentId: string;
  assessmentTitle: string;
  courseId: string;
  status: 'in_progress' | 'submitted' | 'expired' | 'voided';
  startedAt: number;
  deadlineAt: number;
  serverNow: number;
  /** Anti-copy aktif untuk attempt ini (kebijakan admin dikurangi akomodasi aksesibilitas). */
  copyDeterrence: boolean;
  hideLessonLinks: boolean;
  questions: AttemptQuestionView[];
}

export interface AttemptResult {
  id: string;
  status: string;
  resultStatus: 'pending' | 'passed' | 'failed' | 'pending_review';
  mcqScore: number | null;
  mcqMax: number | null;
  essayScore: number | null;
  essayMax: number | null;
  finalScorePct: number | null;
  passingScorePct: number;
  essays: { questionId: string; stem: string; score: number | null; maxScore: number; feedback: string | null }[];
  canAppeal: boolean;
}
