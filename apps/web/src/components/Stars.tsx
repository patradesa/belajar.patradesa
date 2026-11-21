import { useId } from 'react';
import type { CourseRating } from '@patradesa/shared';

const STAR = 'M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z';

function StarIcon({ fill }: { fill: 0 | 0.5 | 1 }) {
  const id = useId();
  return (
    <svg className="star" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {fill === 0.5 && (
        <defs>
          <linearGradient id={id}>
            <stop offset="50%" stopColor="currentColor" />
            <stop offset="50%" stopColor="transparent" />
          </linearGradient>
        </defs>
      )}
      <path d={STAR} fill={fill === 1 ? 'currentColor' : fill === 0.5 ? `url(#${id})` : 'none'} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function formatRating(v: number): string {
  return v.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Tampilan rating (hanya-baca). Angka selalu ditampilkan sebagai teks; bintang pelengkap visual. */
export function StarRating({ rating }: { rating: CourseRating }) {
  if (!rating.count || rating.average === null) {
    return <span className="rating rating-empty">Belum ada rating</span>;
  }
  const avg = rating.average;
  return (
    <span className="rating" role="img" aria-label={`Rating ${formatRating(avg)} dari 5, ${rating.count} penilaian`}>
      <span className="stars">
        {[1, 2, 3, 4, 5].map((i) => (
          <StarIcon key={i} fill={avg >= i - 0.25 ? 1 : avg >= i - 0.75 ? 0.5 : 0} />
        ))}
      </span>
      <span aria-hidden="true">
        <strong>{formatRating(avg)}</strong> ({rating.count})
      </span>
    </span>
  );
}

/** Input rating 1–5: grup radio berlabel (bisa keyboard & pembaca layar), tampil sebagai bintang. */
export function StarInput({ value, onChange, disabled }: { value: number | null; onChange: (v: number) => void; disabled?: boolean }) {
  const name = useId();
  return (
    <fieldset className="star-input" disabled={disabled}>
      <legend>Beri rating kelas ini</legend>
      <div className="star-input-row">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i}>
            <input
              id={`${name}-${i}`}
              className="visually-hidden"
              type="radio"
              name={name}
              value={i}
              checked={value === i}
              onChange={() => onChange(i)}
            />
            <label htmlFor={`${name}-${i}`} className={value !== null && i <= value ? 'on' : undefined}>
              <StarIcon fill={value !== null && i <= value ? 1 : 0} />
              <span className="visually-hidden">{i} bintang</span>
            </label>
          </span>
        ))}
      </div>
    </fieldset>
  );
}
