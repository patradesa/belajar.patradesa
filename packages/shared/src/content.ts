/**
 * Format konten terpercaya ("Markdown-lite") -> blok terstruktur.
 * Tidak ada HTML mentah: renderer hanya membuat elemen dari tipe blok yang diketahui
 * dan memasukkan teks sebagai text node, sehingga XSS lewat materi tidak mungkin
 * selama renderer tidak memakai innerHTML / dangerouslySetInnerHTML.
 *
 * Sintaks: "## Judul", "### Subjudul", "- butir", "1. butir", "> catatan",
 * "---" (pemisah slide), baris kosong = paragraf baru,
 * inline: **tebal**, [teks](https://tautan) (hanya https).
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; v: string }
  | { t: 'link'; v: string; href: string };

export type Block =
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'p'; inlines: Inline[] }
  | { type: 'ul'; items: Inline[][] }
  | { type: 'ol'; items: Inline[][] }
  | { type: 'callout'; inlines: Inline[] }
  | { type: 'slide' };

export const MAX_CONTENT_CHARS = 60_000;

const SAFE_URL = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s<>"'`]*)?$/i;

export function isSafeHttpsUrl(href: string): boolean {
  return href.length <= 500 && SAFE_URL.test(href);
}

export function parseInlines(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ t: 'text', v: src.slice(last, m.index) });
    if (m[1] !== undefined) {
      out.push({ t: 'strong', v: m[1] });
    } else if (m[2] !== undefined && m[3] !== undefined) {
      if (isSafeHttpsUrl(m[3])) out.push({ t: 'link', v: m[2], href: m[3] });
      else out.push({ t: 'text', v: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) });
  return out;
}

export function parseContent(source: string): Block[] {
  const text = source.slice(0, MAX_CONTENT_CHARS).replace(/\r\n?/g, '\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { type: 'ul' | 'ol'; items: Inline[][] } | null = null;

  const flushPara = (): void => {
    if (para.length) {
      blocks.push({ type: 'p', inlines: parseInlines(para.join(' ')) });
      para = [];
    }
  };
  const flushList = (): void => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };
  const flushAll = (): void => {
    flushPara();
    flushList();
  };

  for (const raw of text.split('\n')) {
    const t = raw.trim();
    if (t === '') {
      flushAll();
      continue;
    }
    if (t === '---') {
      flushAll();
      blocks.push({ type: 'slide' });
      continue;
    }
    if (t.startsWith('### ')) {
      flushAll();
      blocks.push({ type: 'h3', text: t.slice(4).trim() });
      continue;
    }
    if (t.startsWith('## ')) {
      flushAll();
      blocks.push({ type: 'h2', text: t.slice(3).trim() });
      continue;
    }
    if (t.startsWith('> ')) {
      flushAll();
      blocks.push({ type: 'callout', inlines: parseInlines(t.slice(2).trim()) });
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(t);
    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    const match = ul ?? ol;
    if (match) {
      flushPara();
      const kind: 'ul' | 'ol' = ul ? 'ul' : 'ol';
      if (!list || list.type !== kind) {
        flushList();
        list = { type: kind, items: [] };
      }
      list.items.push(parseInlines(match[1] ?? ''));
      continue;
    }
    flushList();
    para.push(t);
  }
  flushAll();
  return blocks;
}

/** Pecah blok menjadi slide berdasarkan penanda "---". */
export function splitSlides(blocks: Block[]): Block[][] {
  const slides: Block[][] = [[]];
  for (const b of blocks) {
    if (b.type === 'slide') slides.push([]);
    else slides[slides.length - 1]!.push(b);
  }
  return slides.filter((s) => s.length > 0);
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Terima ID YouTube 11 karakter atau URL youtube.com / youtu.be; kembalikan ID atau null. */
export function extractYoutubeId(input: string): string | null {
  const s = input.trim();
  if (YT_ID.test(s)) return s;
  const short = /^https:\/\/youtu\.be\/([A-Za-z0-9_-]{11})(?:[?#][^\s]*)?$/.exec(s);
  if (short) return short[1]!;
  const long =
    /^https:\/\/(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com)\/(?:watch\?(?:[^\s#]*&)?v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})(?:[&?#][^\s]*)?$/.exec(s);
  return long ? long[1]! : null;
}
