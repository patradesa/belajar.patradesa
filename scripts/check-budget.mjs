// Cek anggaran performa build: JS & CSS awal (yang dimuat index.html) dalam KiB gzip,
// serta larangan dependensi font/skrip eksternal di bundle awal. Keluar 1 jika melewati anggaran.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = join(import.meta.dirname, '..', 'apps', 'web', 'dist');
const BUDGET = { jsKiB: 150, cssKiB: 35 };

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
const kib = (buf) => gzipSync(buf, { level: 9 }).length / 1024;

let js = 0;
let css = 0;
const rows = [];
for (const r of new Set(refs)) {
  const buf = readFileSync(join(DIST, r));
  const size = kib(buf);
  if (r.endsWith('.js')) js += size;
  if (r.endsWith('.css')) css += size;
  rows.push([r, size.toFixed(1)]);
}

const problems = [];
if (/fonts\.googleapis|fonts\.gstatic/.test(html)) problems.push('index.html memuat Google Fonts');
for (const f of readdirSync(join(DIST, 'assets')).filter((x) => x.endsWith('.css'))) {
  const c = readFileSync(join(DIST, 'assets', f), 'utf8');
  if (/@import\s+url\(\s*['"]?https?:|@font-face[^}]*https?:/.test(c)) problems.push(`${f} memuat font/CSS eksternal`);
}
if (/<script[^>]+src="https?:/.test(html)) problems.push('index.html memuat skrip eksternal');

console.log('Aset awal (gzip):');
for (const [r, s] of rows) console.log(`  ${s.padStart(7)} KiB  ${r}`);
console.log(`JS awal : ${js.toFixed(1)} KiB (anggaran ${BUDGET.jsKiB})`);
console.log(`CSS awal: ${css.toFixed(1)} KiB (anggaran ${BUDGET.cssKiB})`);
if (js > BUDGET.jsKiB) problems.push(`JS awal ${js.toFixed(1)} KiB > ${BUDGET.jsKiB}`);
if (css > BUDGET.cssKiB) problems.push(`CSS awal ${css.toFixed(1)} KiB > ${BUDGET.cssKiB}`);
if (problems.length) {
  console.error('GAGAL anggaran:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('OK: dalam anggaran.');
