import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '../lib/api';
import { navigationCount } from '../lib/router';

export function Loading({ label = 'Memuat…' }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" className="muted">
      {label}
    </p>
  );
}

export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="alert alert-error" role="alert">
      <p style={{ margin: 0 }}>
        <strong>Gagal: </strong>
        {errorMessage(error)}
      </p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry} style={{ marginTop: '0.5rem' }}>
          Coba lagi
        </button>
      )}
    </div>
  );
}

/** Muat data async dengan status loading/error dan fungsi reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: unknown; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef.current().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error: unknown) => alive && setState({ data: null, error, loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function PageTitle({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Pindahkan fokus ke judul HANYA saat navigasi SPA (bukan muat awal, agar skip link tetap pertama).
    if (navigationCount() > 0) ref.current?.focus();
    if (typeof children === 'string') document.title = `${children} — PatraDesa Belajar`;
  }, [children]);
  return (
    <h1 ref={ref} tabIndex={-1}>
      {children}
    </h1>
  );
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} menit${s ? ` ${s} detik` : ''}` : `${s} detik`;
}
