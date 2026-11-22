/**
 * Tiruan Sertifikat Studio untuk e2e (localhost:8799): memverifikasi tanda tangan HMAC persis seperti
 * Studio asli (`x-pd-timestamp`, `x-pd-signature` = HMAC-SHA256(secret, `${ts}.${body}`)), idempoten
 * per idempotencyKey, dan menerbitkan nomor `{urut}/PD/BELAJAR/{tahun}` + kode Crockford 16 karakter.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';

export const MOCK_STUDIO_PORT = 8799;
export const MOCK_STUDIO_SECRET = 'e2e-sertifikat-secret-not-for-production-0123456789';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function startMockStudio(): Promise<Server | null> {
  const issued = new Map<string, { serial: string; code: string; issuedAt: string }>();
  let counter = 0;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      const send = (status: number, data: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const ts = String(req.headers['x-pd-timestamp'] ?? '');
      const sig = String(req.headers['x-pd-signature'] ?? '');
      const expected = createHmac('sha256', MOCK_STUDIO_SECRET).update(`${ts}.${raw}`).digest('hex');
      const fresh = Math.abs(Date.now() - Number(ts)) < 5 * 60_000;
      if (!fresh || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return send(401, { error: 'Tanda tangan permintaan tidak sah.' });
      }
      const body = JSON.parse(raw) as Record<string, string>;
      if (req.url === '/api/integrasi/terbitkan') {
        const prev = issued.get(body.idempotencyKey!);
        if (prev) return send(200, { ...prev, status: 'valid', repeated: true });
        counter++;
        const code = Array.from({ length: 16 }, () => ALPHABET[randomInt(32)]).join('');
        const cert = { serial: `${String(counter).padStart(4, '0')}/PD/BELAJAR/2026`, code, issuedAt: new Date().toISOString() };
        issued.set(body.idempotencyKey!, cert);
        return send(201, { ...cert, status: 'valid', repeated: false });
      }
      if (req.url === '/api/integrasi/cabut') return send(200, { ok: true, status: 'dicabut' });
      return send(404, { error: 'Tidak ditemukan.' });
    });
  });
  return new Promise((resolve) => {
    server.once('error', () => resolve(null)); // port sudah dipakai (mis. server e2e lain) → pakai yang ada
    server.listen(MOCK_STUDIO_PORT, '127.0.0.1', () => resolve(server));
  });
}
