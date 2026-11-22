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
    // "# Judul" diperlakukan sebagai h2 (h1 halaman sudah dipakai judul kelas/materi).
    if (t.startsWith('## ') || t.startsWith('# ')) {
      flushAll();
      blocks.push({ type: 'h2', text: t.replace(/^#{1,2}\s+/, '').trim() });
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

export function inlinesText(items: Inline[]): string {
  return items.map((i) => i.v).join('');
}

/**
 * Ringkasan teks biasa (tanpa simbol Markdown) untuk kartu katalog & kepala halaman kelas.
 * Mengambil isi paragraf; judul, daftar, dan paragraf yang hanya berupa label tebal
 * (mis. "**Deskripsi Kelas**") dilewati. Dipotong di batas kata lalu diberi "…".
 */
export function summarize(source: string, maxChars = 280): string {
  const blocks = parseContent(source);
  const parts: string[] = [];
  let len = 0;
  for (const b of blocks) {
    if (b.type !== 'p') continue;
    if (b.inlines.length === 1 && b.inlines[0]!.t === 'strong') continue;
    const t = inlinesText(b.inlines).trim();
    if (!t) continue;
    parts.push(t);
    len += t.length + 1;
    if (len > maxChars) break;
  }
  let text = parts.join(' ');
  if (!text) {
    // Tanpa paragraf (mis. hanya judul/daftar): pakai teks apa pun yang ada.
    text = blocks
      .map((b) => ('text' in b ? b.text : 'inlines' in b ? inlinesText(b.inlines) : 'items' in b ? b.items.map(inlinesText).join('; ') : ''))
      .filter(Boolean)
      .join(' ');
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > maxChars * 0.6 ? space : maxChars).replace(/[\s,.;:–-]+$/, '')}…`;
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

/** Persentase progres kelas: langkah wajib (materi + kuis) yang sudah tuntas. */
export function courseProgressPct(c: { requiredLessons: number; completedLessons: number; requiredQuizzes: number; passedQuizzes: number }): number {
  const total = c.requiredLessons + c.requiredQuizzes;
  if (total === 0) return 0;
  return Math.round(((c.completedLessons + c.passedQuizzes) / total) * 100);
}
