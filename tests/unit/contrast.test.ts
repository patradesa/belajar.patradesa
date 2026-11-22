/** WCAG 2.2 AA: rasio kontras token warna dibaca langsung dari apps/web/src/styles/tokens.css. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '..', '..', 'apps', 'web', 'src', 'styles', 'tokens.css'), 'utf8');
const tokens = Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]!.toLowerCase()]));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}
const t = (name: string): string => {
  const v = tokens[name];
  if (!v) throw new Error(`token --${name} tidak ada`);
  return v;
};

// [foreground, background, minimum, alasan]
const PAIRS: [string, string, number, string][] = [
  ['color-text', 'color-bg', 4.5, 'teks badan di latar halaman'],
  ['color-text', 'color-surface', 4.5, 'teks badan di kartu'],
  ['color-muted', 'color-bg', 4.5, 'teks sekunder'],
  ['color-muted', 'color-surface', 4.5, 'teks sekunder di kartu'],
  ['color-link', 'color-bg', 4.5, 'tautan'],
  ['color-link', 'color-surface', 4.5, 'tautan di kartu'],
  ['color-primary-button-text', 'color-primary-button-bg', 4.5, 'label tombol utama'],
  ['color-primary-button-text', 'color-primary-button-hover-bg', 4.5, 'label tombol utama (hover)'],
  ['color-secondary-button-text', 'color-surface', 4.5, 'tombol sekunder'],
  ['color-primary-button-bg', 'color-surface', 3, 'batas tombol utama (non-teks)'],
  ['color-focus', 'color-bg', 3, 'cincin fokus di latar'],
  ['color-focus', 'color-surface', 3, 'cincin fokus di kartu'],
  ['color-header-text', 'color-header-bg', 4.5, 'teks header'],
  ['color-header-text', 'color-nav-active-bg', 4.5, 'menu aktif (pil)'],
  ['color-focus', 'color-header-bg', 3, 'cincin fokus di header'],
  ['color-accent-button-text', 'color-accent-button-bg', 4.5, 'tombol amber (CTA)'],
  ['color-accent-button-text', 'color-accent-button-hover-bg', 4.5, 'tombol amber (hover)'],
  ['color-heading', 'color-bg', 4.5, 'judul di latar halaman'],
  ['color-heading', 'color-surface-soft', 4.5, 'judul di kartu hijau muda'],
  ['color-heading', 'color-chip-bg', 4.5, 'label pil / badge'],
  ['color-text', 'color-surface-soft', 4.5, 'teks di kartu hijau muda'],
  ['color-muted', 'color-surface-soft', 4.5, 'teks sekunder di kartu hijau muda'],
  ['color-hero-text', 'color-hero-bg', 4.5, 'judul hero'],
  ['color-hero-muted', 'color-hero-bg', 4.5, 'teks hero'],
  ['color-focus-on-dark', 'color-hero-bg', 3, 'cincin fokus di hero gelap'],
  ['color-footer-text', 'color-footer-bg', 4.5, 'teks footer'],
  ['color-footer-link', 'color-footer-bg', 4.5, 'tautan footer'],
  ['color-focus-on-dark', 'color-footer-bg', 3, 'cincin fokus di footer gelap'],
  ['color-heading', 'color-surface', 4.5, 'tombol terang di hero'],
  ['color-star', 'color-surface', 3, 'bintang rating (grafis) di kartu'],
  ['color-star', 'color-surface-soft', 3, 'bintang input rating di kartu hijau muda'],
  ['color-success', 'color-success-bg', 3, 'ikon centang di bulatan hijau'],
  ['color-border-strong', 'color-surface', 3, 'batas input'],
  ['color-success', 'color-surface', 4.5, 'teks status berhasil'],
  ['color-success', 'color-success-bg', 4.5, 'teks di alert berhasil'],
  ['color-danger', 'color-surface', 4.5, 'teks galat'],
  ['color-eyebrow', 'color-bg', 4.5, 'label kecil (eyebrow) di latar halaman'],
  ['color-eyebrow', 'color-surface', 4.5, 'label kecil (eyebrow) di kartu'],
  ['color-muted', 'color-header-bg', 4.5, 'menu tidak aktif di header'],
  ['color-primary-button-text', 'color-primary-dark', 4.5, 'tombol utama (hover gaya Studio)'],
  ['color-heading', 'color-surface-soft', 4.5, 'menu saat hover'],
  ['color-danger', 'color-danger-bg', 4.5, 'tombol bahaya saat hover'],
  ['color-text', 'color-selection-bg', 4.5, 'teks terseleksi'],
  ['color-danger', 'color-danger-bg', 4.5, 'teks di alert galat'],
  ['color-text', 'color-danger-bg', 4.5, 'teks badan di alert galat'],
  ['color-warning-text', 'color-warning-bg', 4.5, 'teks di alert peringatan'],
  ['color-link', 'color-warning-bg', 4.5, 'tautan di alert peringatan'],
  ['color-progress-fill', 'color-progress-track', 3, 'bilah progres'],
  ['color-text', 'color-progress-track', 4.5, 'label tombol nonaktif'],
];

describe('kontras warna WCAG 2.2 AA', () => {
  it.each(PAIRS)('%s di atas %s ≥ %s (%s)', (fg, bg, min) => {
    expect(contrast(t(fg), t(bg))).toBeGreaterThanOrEqual(min);
  });

  it('warna brand terang (hijau muda, amber) TIDAK lulus sebagai teks kecil di putih → tidak boleh dipakai untuk teks', () => {
    expect(contrast(t('pd-green-light'), '#ffffff')).toBeLessThan(4.5);
    expect(contrast(t('pd-amber'), '#ffffff')).toBeLessThan(4.5);
    for (const token of ['color-text', 'color-heading', 'color-muted', 'color-link', 'color-success', 'color-danger', 'color-warning-text']) {
      expect([t('pd-green-light'), t('pd-amber')]).not.toContain(t(token));
    }
  });

  it('nilai brand utama dipertahankan', () => {
    expect(t('pd-blue')).toBe('#116798');
    expect(t('pd-blue-dark')).toBe('#083a57');
    expect(t('pd-green-forest')).toBe('#2c470b');
    expect(t('pd-green-light')).toBe('#669b1f');
    expect(t('pd-amber')).toBe('#dd9933');
  });
});
