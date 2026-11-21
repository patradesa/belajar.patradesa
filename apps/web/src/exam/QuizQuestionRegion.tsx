import { useEffect, useRef, type ReactNode } from 'react';

function isEditable(node: EventTarget | Node | null): boolean {
  const el = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
  return !!el?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

/**
 * Penghalang ringan anti-salin, HANYA untuk soal & opsi (bukan seluruh halaman):
 *  - kelas `.exam-question-content` (user-select: none),
 *  - context menu dicegah di area ini saja,
 *  - event copy/cut ditolak bila target/seleksi berasal dari area ini.
 * TIDAK memblokir: input/textarea esai, paste, Ctrl/Cmd+A di luar area, shortcut browser global,
 * navigasi keyboard, pembaca layar, timer, atau kontrol font.
 * Ini BUKAN pengaman mutlak: screenshot, foto, DevTools, OCR tetap mungkin. Kontrol utama ada di server.
 */
export function QuizQuestionRegion({ enabled, children, label }: { enabled: boolean; children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const inRegion = (n: Node | EventTarget | null): boolean => !!n && n instanceof Node && !!ref.current?.contains(n) && !isEditable(n);
    const onCopy = (e: ClipboardEvent) => {
      const sel = document.getSelection();
      if (inRegion(e.target) || (sel && !sel.isCollapsed && (inRegion(sel.anchorNode) || inRegion(sel.focusNode)))) {
        e.preventDefault();
      }
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
    };
  }, [enabled]);

  return (
    <div
      ref={ref}
      className={enabled ? 'exam-question-content' : undefined}
      data-copy-deterrence={enabled ? 'on' : 'off'}
      aria-label={label}
      onContextMenu={
        enabled
          ? (e) => {
              if (!isEditable(e.target)) e.preventDefault();
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}
