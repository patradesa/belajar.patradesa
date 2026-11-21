// Lighthouse mobile (emulasi perangkat menengah + throttling "slow 4G" bawaan Lighthouse) terhadap
// server lokal `wrangler dev`. Menyimpan laporan ke reports/lighthouse dan gagal bila melewati anggaran.
// Pemakaian: jalankan server (`npm run e2e:server`), lalu `CHROME_PATH=... npm run lighthouse`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const BASE = process.env.LH_BASE ?? 'http://localhost:8787';
const PAGES = ['/', '/kelas/dasar-transparansi-desa', '/masuk'];
const BUDGET = { performance: 0.9, accessibility: 0.95, lcpMs: 2500, cls: 0.1, tbtMs: 200 };
const out = join(import.meta.dirname, '..', 'reports', 'lighthouse');
mkdirSync(out, { recursive: true });

const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-first-run'] });
const fails = [];
const summary = [];
try {
  for (const p of PAGES) {
    const r = await lighthouse(`${BASE}${p}`, { port: chrome.port, output: 'html', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices'], formFactor: 'mobile' });
    const lhr = r.lhr;
    const row = {
      page: p,
      performance: lhr.categories.performance.score,
      accessibility: lhr.categories.accessibility.score,
      bestPractices: lhr.categories['best-practices'].score,
      lcpMs: Math.round(lhr.audits['largest-contentful-paint'].numericValue),
      cls: Number(lhr.audits['cumulative-layout-shift'].numericValue.toFixed(3)),
      tbtMs: Math.round(lhr.audits['total-blocking-time'].numericValue),
      transferKiB: Math.round(lhr.audits['total-byte-weight'].numericValue / 1024),
    };
    summary.push(row);
    writeFileSync(join(out, `${p === '/' ? 'home' : p.replace(/\W+/g, '_')}.html`), r.report);
    if (row.performance < BUDGET.performance) fails.push(`${p}: performance ${row.performance}`);
    if (row.accessibility < BUDGET.accessibility) fails.push(`${p}: accessibility ${row.accessibility}`);
    if (row.lcpMs > BUDGET.lcpMs) fails.push(`${p}: LCP ${row.lcpMs}ms`);
    if (row.cls > BUDGET.cls) fails.push(`${p}: CLS ${row.cls}`);
    if (row.tbtMs > BUDGET.tbtMs) fails.push(`${p}: TBT ${row.tbtMs}ms (proksi INP di lab)`);
  }
} finally {
  await chrome.kill();
}
const env = { date: new Date().toISOString(), device: 'Lighthouse mobile emulation (Moto G Power class), simulated slow 4G, 4x CPU slowdown', base: BASE };
writeFileSync(join(out, 'summary.json'), JSON.stringify({ env, budget: BUDGET, summary }, null, 2));
console.table(summary);
if (fails.length) {
  console.error('GAGAL anggaran Lighthouse:\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('OK: Lighthouse dalam anggaran.');
