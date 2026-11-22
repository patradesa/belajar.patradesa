// Server e2e: build web, D1 lokal baru (terisolasi di .wrangler/e2e), lalu `wrangler dev` di localhost:8787.
// Tidak menyentuh resource Cloudflare remote. Telemetri wrangler dimatikan.
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const persist = join(root, '.wrangler', 'e2e');
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: process.env.CI ?? '' };
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (args) => {
  const r = spawnSync(npx, args, { cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!process.env.E2E_SKIP_BUILD) run(['vite', 'build', 'apps/web']);
rmSync(persist, { recursive: true, force: true });
run(['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist]);

const child = spawn(
  npx,
  [
    'wrangler',
    'dev',
    '--port',
    '8787',
    '--persist-to',
    persist,
    '--var',
    'SESSION_SECRET:e2e-local-secret-not-for-production-0123456789',
    '--var',
    'DEV_LOGIN_ENABLED:true',
    '--var',
    'ENVIRONMENT:development',
    // Sertifikat Studio tiruan (tests/e2e/mock-studio.ts, dijalankan global-setup).
    '--var',
    'SERTIFIKAT_BASE_URL:http://127.0.0.1:8799',
    '--var',
    'SERTIFIKAT_INTEGRATION_SECRET:e2e-sertifikat-secret-not-for-production-0123456789',
  ],
  { cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32' },
);
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
