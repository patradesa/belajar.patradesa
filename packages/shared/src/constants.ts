/** Profil jabatan desa (self-declared). BUKAN hak akses aplikasi. */
export const VILLAGE_ROLES = [
  'perbekel',
  'sekdes',
  'kaur',
  'kasi',
  'kawil',
  'operator_sid',
  'bpd',
  'kader',
  'lainnya',
] as const;
export type VillageRole = (typeof VILLAGE_ROLES)[number];

export const VILLAGE_ROLE_LABELS: Record<VillageRole, string> = {
  perbekel: 'Perbekel / Kepala Desa',
  sekdes: 'Sekretaris Desa',
  kaur: 'Kepala Urusan (Kaur)',
  kasi: 'Kepala Seksi (Kasi)',
  kawil: 'Kepala Kewilayahan / Kelian',
  operator_sid: 'Operator Sistem Informasi Desa',
  bpd: 'Anggota BPD',
  kader: 'Kader Desa',
  lainnya: 'Lainnya',
};

/** Label singkat jabatan untuk kartu katalog. */
export const VILLAGE_ROLE_SHORT: Record<VillageRole, string> = {
  perbekel: 'Perbekel/Kades',
  sekdes: 'Sekdes',
  kaur: 'Kaur',
  kasi: 'Kasi',
  kawil: 'Kawil/Kelian',
  operator_sid: 'Operator SID',
  bpd: 'BPD',
  kader: 'Kader',
  lainnya: 'Umum',
};

/** Role sistem (hak akses). Hanya ditetapkan backend/admin. */
export const SYSTEM_ROLES = ['learner', 'mentor', 'content_editor', 'admin', 'super_admin'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  CSRF_FAILED: 'CSRF_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION',
  RATE_LIMITED: 'RATE_LIMITED',
  EXAM_LOCKED: 'EXAM_LOCKED',
  EXAM_LOCK_UNVERIFIED: 'EXAM_LOCK_UNVERIFIED',
  ACTIVE_ATTEMPT_ELSEWHERE: 'ACTIVE_ATTEMPT_ELSEWHERE',
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  MAX_ATTEMPTS: 'MAX_ATTEMPTS',
  COOLDOWN: 'COOLDOWN',
  ATTEMPT_CLOSED: 'ATTEMPT_CLOSED',
  ENROLLMENT_CLOSED: 'ENROLLMENT_CLOSED',
  ACCESS_EXPIRED: 'ACCESS_EXPIRED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  TURNSTILE_FAILED: 'TURNSTILE_FAILED',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Skala teks yang didukung kontrol A−/A+ (100%–200%). */
export const FONT_SCALES = [1, 1.125, 1.25, 1.5, 1.75, 2] as const;

/** Aturan heartbeat belajar (server authoritative). */
export const HEARTBEAT = {
  /** Interval kirim klien saat tab tampak & ada interaksi. */
  clientIntervalMs: 25_000,
  /** Heartbeat lebih cepat dari ini tidak memberi kredit (anti spam). */
  minIntervalMs: 15_000,
  /** Kredit maksimum per heartbeat (detik). */
  maxCreditSeconds: 30,
  /** Jika jeda > ini, dianggap idle: tidak ada kredit untuk jeda tersebut. */
  idleGapMs: 90_000,
  /** Interaksi terakhir lebih lama dari ini → klien berhenti mengirim. */
  clientIdleMs: 60_000,
} as const;

export const AI_LOCKED_MESSAGE = 'Pendamping AI tidak tersedia selama kuis.';
