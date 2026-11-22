/* global Response */
// PatraDesa Belajar — pintu domain belajar.patradesa.id (Cloudflare Pages, mode _worker.js).
// DNS patradesa.id dikelola serverorange, sehingga domain dipasang di Pages (CNAME) dan setiap
// permintaan diteruskan apa adanya ke Worker "belajar-patradesa" lewat service binding LMS
// (jalur internal Cloudflare; URL, header, cookie, dan IP peserta tetap utuh).
export default {
  async fetch(request, env) {
    if (!env.LMS) {
      return new Response('Konfigurasi belum lengkap: service binding LMS belum dipasang.', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return env.LMS.fetch(request);
  },
};
