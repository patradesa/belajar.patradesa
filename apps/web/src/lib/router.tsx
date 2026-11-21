import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/** Router mini berbasis History API (menghindari dependensi tambahan). */
const listeners = new Set<() => void>();
let navigations = 0;

/** Jumlah navigasi SPA sejak muat awal (0 = muat halaman pertama). */
export function navigationCount(): number {
  return navigations;
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  navigations++;
  listeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

if (typeof window !== 'undefined') window.addEventListener('popstate', () => navigations++);

export function useLocation(): { path: string; search: URLSearchParams } {
  const [, force] = useState(0);
  useEffect(() => {
    const on = () => force((x) => x + 1);
    listeners.add(on);
    window.addEventListener('popstate', on);
    return () => {
      listeners.delete(on);
      window.removeEventListener('popstate', on);
    };
  }, []);
  return { path: window.location.pathname, search: new URLSearchParams(window.location.search) };
}

/** Cocokkan pola seperti "/kelas/:id"; kembalikan parameter atau null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(':')) out[seg.slice(1)] = decodeURIComponent(s[i]!);
    else if (seg !== s[i]) return null;
  }
  return out;
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!href.startsWith('/') || href.startsWith('/api/')) return;
    e.preventDefault();
    navigate(href);
  };
  const current = typeof window !== 'undefined' && window.location.pathname === href ? 'page' : undefined;
  // Konten (children) diteruskan lewat `rest`.
  // eslint-disable-next-line jsx-a11y/anchor-has-content
  return <a href={href} aria-current={current} onClick={handle} {...rest} />;
}
