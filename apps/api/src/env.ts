import type { SystemRole } from '@patradesa/shared';
import type { AiProvider } from './ai/provider';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS?: Fetcher;
  ENVIRONMENT: 'development' | 'test' | 'staging' | 'production';
  APP_ORIGIN: string;
  DEV_LOGIN_ENABLED?: string;
  SESSION_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  AI_DAILY_QUOTA?: string;
  /** Alamat Sertifikat Studio, mis. https://sertifikat.patradesa.id (tanpa garis miring akhir). */
  SERTIFIKAT_BASE_URL?: string;
  /** Alamat yang dipanggil server untuk API integrasi. Wajib beda zona dari Worker ini (mis. *.pages.dev):
   *  subrequest Worker ke situs Pages di zona yang sama (patradesa.id) gagal HTTP 522. Kosong → SERTIFIKAT_BASE_URL. */
  SERTIFIKAT_API_URL?: string;
  /** Rahasia bersama HMAC dengan Studio (LMS_INTEGRATION_SECRET di Studio), minimal 32 karakter. */
  SERTIFIKAT_INTEGRATION_SECRET?: string;
}

export interface GoogleClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/** Dependensi yang dapat diganti di tes (jam, AI, jaringan keluar, verifikasi token). */
export interface Deps {
  now: () => number;
  ai: AiProvider;
  fetch: typeof fetch;
  verifyGoogleIdToken: (idToken: string, clientId: string, nonce: string) => Promise<GoogleClaims>;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  roles: SystemRole[];
}

export interface Vars {
  user: AuthUser | null;
  sessionId: string | null;
}

export type AppEnv = { Bindings: Env; Variables: Vars };
