import { useEffect, useState } from 'react';
import { FONT_SCALES } from '@patradesa/shared';
import { applyFontScale, readFontScale, saveFontScale, stepFontScale } from '../lib/fontScale';

/** Kontrol A− / A+ / Reset. Dipakai di header umum, reader, DAN layar ujian. */
export function FontScaleControl({ id = 'font' }: { id?: string }) {
  const [scale, setScale] = useState<number>(() => readFontScale());
  useEffect(() => {
    applyFontScale(scale);
  }, [scale]);

  // Sinkron antar instance (mis. header + exam bar) dan antar tab.
  useEffect(() => {
    const on = () => setScale(readFontScale());
    window.addEventListener('pd-font-scale', on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener('pd-font-scale', on);
      window.removeEventListener('storage', on);
    };
  }, []);

  const set = (v: number) => {
    setScale(v);
    applyFontScale(v);
    saveFontScale(v);
    window.dispatchEvent(new Event('pd-font-scale'));
  };
  const pct = Math.round(scale * 100);
  const min = FONT_SCALES[0];
  const max = FONT_SCALES[FONT_SCALES.length - 1] ?? 2;

  return (
    <div className="font-controls" role="group" aria-label="Ukuran teks">
      {/* Nama aksesibel memuat teks yang terlihat (WCAG 2.5.3 Label in Name). */}
      <button type="button" onClick={() => set(stepFontScale(scale, -1))} disabled={scale <= min}>
        A−{' '}
        <span className="visually-hidden">perkecil teks</span>
      </button>
      <output id={`${id}-scale`} aria-live="polite">
        {pct}%
      </output>
      <button type="button" onClick={() => set(stepFontScale(scale, 1))} disabled={scale >= max}>
        A+{' '}
        <span className="visually-hidden">perbesar teks</span>
      </button>
      <button type="button" onClick={() => set(1)}>
        Reset{' '}
        <span className="visually-hidden">ukuran teks ke 100%</span>
      </button>
    </div>
  );
}
