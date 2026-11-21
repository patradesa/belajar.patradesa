// Ubah file migrasi menjadi versi untuk Console D1 di dashboard Cloudflare:
// tanpa komentar, satu statement per baris, idempoten (IF NOT EXISTS), dan dicatat di tabel
// d1_migrations agar `wrangler d1 migrations apply` berikutnya tidak menjalankannya ulang.
// Pemakaian: node scripts/make-console-sql.mjs 0001_init.sql
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const name = process.argv[2] ?? '0001_init.sql';
const root = join(import.meta.dirname, '..');
const src = readFileSync(join(root, 'db', 'migrations', name), 'utf8');

const statements = src
  .split('\n')
  .map((l) => l.replace(/--.*$/, '')) // migrasi tidak memakai "--" di dalam string
  .join('\n')
  .split(/;\s*(?:\n|$)/)
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter(Boolean)
  .map((s) =>
    s
      .replace(/^CREATE TABLE (?!IF NOT EXISTS)/i, 'CREATE TABLE IF NOT EXISTS ')
      .replace(/^CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/i, (_m, u) => `CREATE ${u ?? ''}INDEX IF NOT EXISTS `),
  );

statements.push(
  'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
  `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${name}')`,
);

const outDir = join(root, 'db', 'console');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, name.replace(/\.sql$/, '.console.sql'));
writeFileSync(out, statements.map((s) => `${s};`).join('\n') + '\n');
console.log(`${statements.length} statement → ${out}`);
