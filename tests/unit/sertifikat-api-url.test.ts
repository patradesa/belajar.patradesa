/** Panggilan server ke Sertifikat Studio memakai SERTIFIKAT_API_URL (beda zona, cegah HTTP 522); tautan verifikasi tetap SERTIFIKAT_BASE_URL. */
import { describe, expect, it } from 'vitest';
import { studioApiBase } from '../../apps/api/src/services/certificates';
import type { Env } from '../../apps/api/src/env';

const env = (v: Partial<Env>) => v as Env;

describe('studioApiBase', () => {
  it('memakai SERTIFIKAT_API_URL bila ada, tanpa garis miring akhir', () => {
    expect(studioApiBase(env({ SERTIFIKAT_BASE_URL: 'https://sertifikat.patradesa.id', SERTIFIKAT_API_URL: 'https://sertifikat-patradesa.pages.dev/' }))).toBe(
      'https://sertifikat-patradesa.pages.dev',
    );
  });
  it('jatuh ke SERTIFIKAT_BASE_URL bila SERTIFIKAT_API_URL kosong', () => {
    expect(studioApiBase(env({ SERTIFIKAT_BASE_URL: 'https://sertifikat.patradesa.id/' }))).toBe('https://sertifikat.patradesa.id');
    expect(studioApiBase(env({ SERTIFIKAT_BASE_URL: 'https://sertifikat.patradesa.id', SERTIFIKAT_API_URL: '' }))).toBe('https://sertifikat.patradesa.id');
  });
});
