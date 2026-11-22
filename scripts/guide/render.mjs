// Render panduan (apps/web/src/guide/content.ts) menjadi HTML cetak A4 potret untuk dijadikan PDF oleh Playwright.
// Semua gambar, logo, dan font disematkan sebagai data URI agar PDF mandiri.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dataUri = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;

export function assets() {
  const font = (w) => join(root, 'node_modules', '@fontsource', 'plus-jakarta-sans', 'files', `plus-jakarta-sans-latin-${w}-normal.woff2`);
  return {
    logo: dataUri(join(root, 'apps', 'web', 'public', 'logo-patradesa.png'), 'image/png'),
    font700: dataUri(font(700), 'font/woff2'),
    font800: dataUri(font(800), 'font/woff2'),
  };
}

function image(img, imgDir) {
  const file = join(imgDir, img.file);
  if (!existsSync(file)) return '';
  return `<figure><img src="${dataUri(file, 'image/jpeg')}" alt="${esc(img.alt)}"><figcaption>${esc(img.caption)}</figcaption></figure>`;
}

function section(s, n, imgDir) {
  const parts = [`<section class="sec"><h2><span class="num">${n}</span>${esc(s.title)}</h2>`];
  if (s.intro) parts.push(`<p class="intro">${esc(s.intro)}</p>`);
  if (s.steps) parts.push(`<ol class="steps">${s.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`);
  if (s.points) parts.push(`<ul class="points">${s.points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
  if (s.warning) parts.push(`<div class="box warn"><strong>Perhatian</strong><p>${esc(s.warning)}</p></div>`);
  if (s.tips) parts.push(`<div class="box tip"><strong>Tips</strong>${s.tips.map((x) => `<p>${esc(x)}</p>`).join('')}</div>`);
  if (s.faq) parts.push(`<dl class="faq">${s.faq.map((f) => `<div><dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd></div>`).join('')}</dl>`);
  if (s.image) parts.push(image(s.image, imgDir));
  parts.push('</section>');
  return parts.join('');
}

export function renderGuideHtml({ guide, contact, version, appUrl, imgDir }) {
  const a = assets();
  const toc = guide.sections.map((s, i) => `<li><span class="num">${i + 1}</span>${esc(s.title)}</li>`).join('');
  const body = guide.sections.map((s, i) => section(s, i + 1, imgDir)).join('');
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(guide.title)} — PatraDesa Belajar</title>
<style>
@font-face { font-family: 'PJS'; src: url(${a.font700}) format('woff2'); font-weight: 700; }
@font-face { font-family: 'PJS'; src: url(${a.font800}) format('woff2'); font-weight: 800; }
@page { size: A4 portrait; margin: 22mm 16mm 20mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: 'Segoe UI', system-ui, Roboto, Arial, sans-serif; font-size: 10.5pt; line-height: 1.55; color: #1b2620; }
h1, h2, h3, .brand { font-family: 'PJS', 'Segoe UI', sans-serif; color: #334e0f; letter-spacing: -0.01em; }
.cover { height: 247mm; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; }
.cover-top img { height: 18mm; }
.cover-mid { border-left: 5px solid #dd9933; padding-left: 9mm; }
.cover-mid .kicker { font-family: 'PJS'; font-weight: 800; color: #a15d00; letter-spacing: .16em; text-transform: uppercase; font-size: 9pt; margin: 0 0 4mm; }
.cover-mid h1 { font-size: 30pt; line-height: 1.1; margin: 0 0 4mm; }
.cover-mid .sub { font-size: 13pt; color: #334e0f; margin: 0 0 5mm; }
.cover-mid .aud { color: #5d6b63; margin: 0; }
.cover-band { background: #2c470b; color: #fff; border-radius: 6mm; padding: 8mm 9mm; }
.cover-band h3 { color: #fff; margin: 0 0 3mm; font-size: 12pt; }
.cover-band .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 8mm; font-size: 10pt; }
.cover-band .grid span { color: #e3e9dc; display: block; font-size: 8.5pt; }
.cover-band .ver { margin: 5mm 0 0; color: #e3e9dc; font-size: 9pt; }
.toc { page-break-after: always; }
.toc h2 { font-size: 18pt; margin: 0 0 6mm; }
.toc ol { list-style: none; padding: 0; margin: 0; columns: 1; }
.toc li { display: flex; gap: 4mm; align-items: baseline; padding: 2.2mm 0; border-bottom: 1px solid #e7e3d8; font-size: 11pt; }
.num { display: inline-grid; place-items: center; min-width: 7mm; height: 7mm; border-radius: 50%; background: #334e0f; color: #fff; font-family: 'PJS'; font-weight: 800; font-size: 9pt; margin-right: 3mm; }
.toc .num { background: #f0f5e9; color: #334e0f; margin-right: 0; }
.sec { break-inside: auto; margin: 0 0 8mm; }
.sec h2 { display: flex; align-items: center; font-size: 15pt; margin: 0 0 3mm; padding-bottom: 2mm; border-bottom: 2px solid #f0f5e9; break-after: avoid; }
.intro { margin: 0 0 3mm; }
ol.steps { counter-reset: st; list-style: none; padding: 0; margin: 0 0 3mm; }
ol.steps li { counter-increment: st; position: relative; padding: 1.2mm 0 1.2mm 10mm; break-inside: avoid; }
ol.steps li::before { content: counter(st); position: absolute; left: 0; top: 1.2mm; width: 6.5mm; height: 6.5mm; border-radius: 50%; border: 1.5px solid #334e0f; color: #334e0f; font-family: 'PJS'; font-weight: 800; font-size: 8.5pt; display: grid; place-items: center; }
ul.points { margin: 0 0 3mm; padding-left: 6mm; }
ul.points li { margin: 0 0 1.4mm; break-inside: avoid; }
ul.points li::marker { color: #669b1f; }
.box { border-radius: 3mm; padding: 3mm 4mm; margin: 0 0 3mm; break-inside: avoid; }
.box strong { font-family: 'PJS'; font-weight: 800; font-size: 9.5pt; }
.box p { margin: 1mm 0 0; }
.tip { background: #f0f5e9; border-left: 4px solid #669b1f; }
.tip strong { color: #334e0f; }
.warn { background: #fdf1dc; border-left: 4px solid #dd9933; }
.warn strong { color: #9a5800; }
.faq { margin: 0; }
.faq div { border: 1px solid #e7e3d8; border-radius: 3mm; padding: 3mm 4mm; margin: 0 0 2.5mm; break-inside: avoid; }
.faq dt { font-weight: 700; color: #334e0f; margin: 0 0 1mm; }
.faq dd { margin: 0; }
figure { margin: 2mm 0 0; break-inside: avoid; }
figure img { display: block; width: 100%; max-height: 105mm; object-fit: contain; object-position: left top; border: 1px solid #e7e3d8; border-radius: 2.5mm; }
figcaption { font-size: 8.5pt; color: #5d6b63; margin-top: 1.5mm; }
.contact { break-before: page; }
.contact h2 { font-size: 18pt; margin: 0 0 4mm; }
.contact .card { border: 1px solid #e7e3d8; border-radius: 4mm; padding: 6mm; }
.contact table { border-collapse: collapse; width: 100%; font-size: 11pt; }
.contact td { padding: 2.5mm 0; border-bottom: 1px solid #f0f5e9; vertical-align: top; }
.contact td:first-child { width: 38mm; color: #5d6b63; }
.contact a { color: #334e0f; font-weight: 700; text-decoration: none; }
.contact .logo { height: 14mm; margin: 0 0 5mm; }
</style></head><body>
<div class="cover">
  <div class="cover-top"><img src="${a.logo}" alt="Patra Desa"></div>
  <div class="cover-mid">
    <p class="kicker">PatraDesa Belajar</p>
    <h1>${esc(guide.title)}</h1>
    <p class="sub">${esc(guide.subtitle)}</p>
    <p class="aud">${esc(guide.audience)}</p>
  </div>
  <div class="cover-band">
    <h3>${esc(contact.org)} — ${esc(contact.tagline)}</h3>
    <div class="grid">
      <div><span>Aplikasi</span>${esc(appUrl.replace(/^https:\/\//, ''))}</div>
      <div><span>Email</span>${esc(contact.email)}</div>
      <div><span>WhatsApp</span>${esc(contact.whatsapp)}</div>
      <div><span>Situs &amp; Instagram</span>${esc(contact.website)} · ${esc(contact.instagram)}</div>
    </div>
    <p class="ver">${esc(version)} · ${esc(contact.location)}</p>
  </div>
</div>
<div class="toc"><h2>Daftar isi</h2><ol>${toc}<li><span class="num">✉</span>Bantuan &amp; kontak</li></ol></div>
${body}
<section class="contact">
  <img class="logo" src="${a.logo}" alt="Patra Desa">
  <h2>Bantuan &amp; kontak</h2>
  <p>Ada pertanyaan, kendala teknis, atau usulan materi? Hubungi tim ${esc(contact.org)}. Sebutkan nama, kelas, dan tangkapan layar kendala agar kami dapat membantu lebih cepat.</p>
  <div class="card"><table>
    <tr><td>Email</td><td><a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a></td></tr>
    <tr><td>WhatsApp</td><td><a href="${esc(contact.whatsappUrl)}">${esc(contact.whatsapp)}</a></td></tr>
    <tr><td>Aplikasi belajar</td><td><a href="${esc(appUrl)}">${esc(appUrl.replace(/^https:\/\//, ''))}</a></td></tr>
    <tr><td>Cek sertifikat</td><td><a href="https://sertifikat.patradesa.id/v">sertifikat.patradesa.id/v</a></td></tr>
    <tr><td>Situs</td><td><a href="${esc(contact.websiteUrl)}">${esc(contact.website)}</a></td></tr>
    <tr><td>Instagram</td><td><a href="${esc(contact.instagramUrl)}">${esc(contact.instagram)}</a></td></tr>
    <tr><td>Lokasi</td><td>${esc(contact.location)}</td></tr>
  </table></div>
</section>
</body></html>`;
}

/** Header & footer setiap halaman (Chromium page.pdf). Gaya harus inline; ukuran font eksplisit. */
export function headerFooter({ guide, contact }) {
  const a = assets();
  const base = 'font-family: Segoe UI, Arial, sans-serif; font-size: 7.5pt; color: #5d6b63; width: 100%; padding: 0 16mm; display: flex; align-items: center; justify-content: space-between;';
  return {
    headerTemplate: `<div style="${base}"><img src="${a.logo}" style="height: 7mm;"><span style="color:#334e0f; font-weight:700;">PatraDesa Belajar · ${esc(guide.title)}</span></div>`,
    footerTemplate: `<div style="${base} border-top: 0.5pt solid #e7e3d8; padding-top: 2mm; margin: 0 16mm; width: calc(100% - 32mm); padding-left: 0; padding-right: 0;"><span>${esc(contact.org)} · ${esc(contact.email)} · WA ${esc(contact.whatsapp)} · ${esc(contact.website)}</span><span>Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span></div>`,
  };
}
