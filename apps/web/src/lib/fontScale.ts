import { FONT_SCALES } from '@patradesa/shared';

/** Preferensi ukuran teks: non-sensitif, disimpan di localStorage (fallback aman bila storage nonaktif). */
export const FONT_SCALE_KEY = 'pd-font-scale';

export function readFontScale(): number {
  try {
    const v = Number(window.localStorage.getItem(FONT_SCALE_KEY));
    return (FONT_SCALES as readonly number[]).includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

export function applyFontScale(scale: number): void {
  document.documentElement.style.setProperty('--font-scale', String(scale));
}

export function saveFontScale(scale: number): void {
  try {
    window.localStorage.setItem(FONT_SCALE_KEY, String(scale));
  } catch {
    // storage diblokir: preferensi hanya berlaku di sesi ini
  }
}

export function stepFontScale(current: number, dir: 1 | -1): number {
  const list = FONT_SCALES as readonly number[];
  const i = list.indexOf(current);
  const next = list[Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))];
  return next ?? 1;
}
