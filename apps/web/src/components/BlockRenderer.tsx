import type { ReactNode } from 'react';
import type { Block, Inline } from '@patradesa/shared';

/** Render konten terstruktur. TIDAK memakai dangerouslySetInnerHTML: semua teks menjadi text node. */
function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((it, i) => {
        if (it.t === 'strong') return <strong key={i}>{it.v}</strong>;
        if (it.t === 'link') {
          return (
            <a key={i} href={it.href} target="_blank" rel="noopener noreferrer">
              {it.v}
              <span className="visually-hidden"> (membuka tab baru)</span>
            </a>
          );
        }
        return <span key={i}>{it.v}</span>;
      })}
    </>
  );
}

/** `renderScenario`: halaman materi menyisipkan blok interaktif (lazy); tanpa itu blok diabaikan. */
export function BlockRenderer({ blocks, renderScenario }: { blocks: Block[]; renderScenario?: (key: string) => ReactNode }) {
  return (
    <div className="content prose">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h2':
            return <h2 key={i}>{b.text}</h2>;
          case 'h3':
            return <h3 key={i}>{b.text}</h3>;
          case 'p':
            return (
              <p key={i}>
                <Inlines items={b.inlines} />
              </p>
            );
          case 'ul':
          case 'ol': {
            const Tag = b.type;
            return (
              <Tag key={i}>
                {b.items.map((li, j) => (
                  <li key={j}>
                    <Inlines items={li} />
                  </li>
                ))}
              </Tag>
            );
          }
          case 'callout':
            return (
              <aside key={i} className="callout" aria-label="Catatan">
                <Inlines items={b.inlines} />
              </aside>
            );
          case 'scenario':
            return renderScenario ? <div key={i}>{renderScenario(b.key)}</div> : null;
          default:
            return null;
        }
      })}
    </div>
  );
}
