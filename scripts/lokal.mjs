// Server kerja LOKAL yang cepat: data D1 tetap (tidak dihapus tiap start), tampilan dibangun ulang otomatis saat kode diubah.
// Pemakaian: `npm run lokal` → buka http://localhost:8787 (masuk admin: /admin/masuk → "Masuk (dev)").
//
// Beda dengan scripts/e2e-server.mjs: e2e selalu mulai dari D1 kosong (untuk tes). Server ini menyimpan data di
// .wrangler/lokal sehingga kelas yang dibuat/diimpor tetap ada. Kelas demo fiktif diisi sekali (scripts/seed-dev.mjs).
// Tidak menyentuh resource Cloudflare remote. Reset data: `npm run lokal -- --reset`.
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const persist = join(root, '.wrangler', 'lokal');
const PORT = 8787;
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const shell = process.platform === 'win32';
const run = (args) => {
  const r = spawnSync(npx, args, { cwd: root, stdio: 'inherit', env, shell });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (process.argv.includes('--reset')) {
  rmSync(persist, { recursive: true, force: true });
  console.log('[lokal] Data lokal dihapus; mulai dari kosong.');
}

console.log('[lokal] 1/4 Membangun tampilan…');
run(['vite', 'build', 'apps/web', '--logLevel', 'warn']);
console.log('[lokal] 2/4 Migrasi D1 lokal (yang sudah diterapkan dilewati)…');
run(['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist]);

const children = [];
const start = (args, label) => {
  const child = spawn(npx, args, { cwd: root, stdio: 'inherit', env, shell });
  child.on('exit', (code) => {
    console.log(`[lokal] ${label} berhenti (kode ${code}).`);
    stopAll();
  });
  children.push(child);
  return child;
};
const stopAll = () => {
  for (const c of children) if (!c.killed) c.kill();
  process.exit(0);
};
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

console.log('[lokal] 3/4 Menjalankan server + bangun-ulang otomatis…');
// Bangun ulang apps/web/dist setiap file berubah; wrangler dev memuat aset baru → cukup muat ulang halaman.
start(['vite', 'build', 'apps/web', '--watch', '--logLevel', 'warn'], 'Pembangun tampilan');
start(
  [
    'wrangler',
    'dev',
    '--port',
    String(PORT),
    '--persist-to',
    persist,
    '--var',
    'SESSION_SECRET:lokal-secret-not-for-production-0123456789abcdef',
    '--var',
    'DEV_LOGIN_ENABLED:true',
    '--var',
    'ENVIRONMENT:development',
  ],
  'Server',
);

// Tunggu server siap, lalu isi kelas demo bila belum ada.
for (let i = 0; i < 90; i++) {
  try {
    if ((await fetch(BASE + '/api/v1/catalog')).ok) break;
  } catch {
    /* belum siap */
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('[lokal] 4/4 Mengisi kelas demo (sekali saja)…');
spawnSync(process.execPath, [join(root, 'scripts', 'seed-dev.mjs')], { cwd: root, stdio: 'inherit', env: { ...env, SEED_BASE: BASE } });
console.log(`\n[lokal] SIAP → ${BASE}   (admin: ${BASE}/admin/masuk → Masuk (dev))\n[lokal] Ubah kode → tunggu ±1 detik → muat ulang halaman. Berhenti: Ctrl+C.\n`);
