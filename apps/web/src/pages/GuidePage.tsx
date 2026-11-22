import { APP_URL, CONTACT, GUIDES, GUIDE_VERSION, type Guide, type GuideSection } from '../guide/content';
import { Link } from '../lib/router';
import { PageTitle } from '../components/common';
import { Icon } from '../components/Icon';

const pdfName = (g: Guide) => g.pdf.split('/').pop() ?? 'panduan.pdf';

function DownloadPdf({ guide, secondary = false }: { guide: Guide; secondary?: boolean }) {
  return (
    <a className={`btn${secondary ? ' btn-secondary' : ''}`} href={guide.pdf} download={pdfName(guide)}>
      <Icon name="file" /> Unduh PDF <span className="visually-hidden">{guide.title}</span>
    </a>
  );
}

/** Halaman /panduan: pilihan panduan peserta & pengelola. */
export function GuideIndexPage() {
  return (
    <div className="stack">
      <div className="page-title-block">
        <p className="eyebrow">Bantuan</p>
        <PageTitle>Panduan penggunaan</PageTitle>
        <p>Langkah demi langkah memakai PatraDesa Belajar. Baca langsung di sini atau unduh PDF (A4) untuk dicetak dan dibagikan.</p>
      </div>
      <div className="two-col">
        {Object.values(GUIDES).map((g) => (
          <section key={g.slug} className="card stack" aria-labelledby={`panduan-${g.slug}`}>
            <div className="guide-card-head">
              <span className="icon-tile" aria-hidden="true">
                <Icon name={g.slug === 'admin' ? 'shield' : 'user'} />
              </span>
              <h2 id={`panduan-${g.slug}`} style={{ margin: 0 }}>
                {g.title}
              </h2>
            </div>
            <p style={{ margin: 0 }}>{g.subtitle}.</p>
            <p className="muted" style={{ margin: 0 }}>
              {g.audience} {g.sections.length} bagian, dilengkapi tangkapan layar.
            </p>
            <div className="btn-row">
              <Link className="btn btn-secondary" href={`/panduan/${g.slug}`}>
                Baca panduan <span className="visually-hidden">{g.title}</span>
              </Link>
              <DownloadPdf guide={g} />
            </div>
          </section>
        ))}
        <ContactCard />
      </div>
    </div>
  );
}

function Section({ s, n }: { s: GuideSection; n: number }) {
  return (
    <section className="card guide-section stack" id={s.id} aria-labelledby={`${s.id}-judul`}>
      <h2 id={`${s.id}-judul`} className="guide-h2">
        <span className="guide-num" aria-hidden="true">
          {n}
        </span>
        {s.title}
      </h2>
      {s.intro && <p style={{ margin: 0 }}>{s.intro}</p>}
      {s.steps && (
        <ol className="guide-steps">
          {s.steps.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
      )}
      {s.points && (
        <ul className="guide-points">
          {s.points.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {s.warning && (
        <div className="alert alert-warning" style={{ margin: 0 }}>
          <strong>Perhatian: </strong>
          {s.warning}
        </div>
      )}
      {s.tips && (
        <div className="alert alert-success" style={{ margin: 0 }}>
          <strong>Tips</strong>
          {s.tips.map((x) => (
            <p key={x} style={{ margin: '0.25rem 0 0' }}>
              {x}
            </p>
          ))}
        </div>
      )}
      {s.faq && (
        <div className="stack guide-faq">
          {s.faq.map((f) => (
            <details key={f.q} className="card card-soft">
              <summary>{f.q}</summary>
              <p style={{ margin: '0.5rem 0 0' }}>{f.a}</p>
            </details>
          ))}
        </div>
      )}
      {s.image && (
        <figure className="guide-figure">
          <img src={`/panduan/img/${s.image.file}`} alt={s.image.alt} width={1280} height={800} loading="lazy" decoding="async" />
          <figcaption>{s.image.caption}</figcaption>
        </figure>
      )}
    </section>
  );
}

function ContactCard() {
  return (
    <section className="card stack" aria-labelledby="kontak-judul">
      <h2 id="kontak-judul">Bantuan &amp; kontak</h2>
      <p style={{ margin: 0 }}>Ada pertanyaan atau kendala? Hubungi tim {CONTACT.org}. Sertakan nama, kelas, dan tangkapan layar kendala.</p>
      <dl className="cert-facts">
        <div>
          <dt>Email</dt>
          <dd>
            <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
          </dd>
        </div>
        <div>
          <dt>WhatsApp</dt>
          <dd>
            <a href={CONTACT.whatsappUrl} target="_blank" rel="noopener">
              {CONTACT.whatsapp}
              <span className="visually-hidden"> (tab baru)</span>
            </a>
          </dd>
        </div>
        <div>
          <dt>Situs</dt>
          <dd>
            <a href={CONTACT.websiteUrl} target="_blank" rel="noopener">
              {CONTACT.website}
              <span className="visually-hidden"> (tab baru)</span>
            </a>
          </dd>
        </div>
        <div>
          <dt>Instagram</dt>
          <dd>
            <a href={CONTACT.instagramUrl} target="_blank" rel="noopener">
              {CONTACT.instagram}
              <span className="visually-hidden"> (tab baru)</span>
            </a>
          </dd>
        </div>
      </dl>
      <p className="muted" style={{ margin: 0 }}>
        {CONTACT.location} · {APP_URL.replace(/^https:\/\//, '')}
      </p>
    </section>
  );
}

/** Halaman /panduan/:slug — isi lengkap satu panduan (sama dengan PDF). */
export function GuideDetailPage({ slug }: { slug: string }) {
  const guide = (GUIDES as Record<string, Guide | undefined>)[slug];
  if (!guide) {
    return (
      <div className="stack">
        <PageTitle>Panduan tidak ditemukan</PageTitle>
        <p>
          <Link href="/panduan">Kembali ke daftar panduan</Link>
        </p>
      </div>
    );
  }
  return (
    <div className="stack">
      <p style={{ margin: 0 }}>
        <Link href="/panduan">← Semua panduan</Link>
      </p>
      <header className="card guide-hero stack">
        <p className="eyebrow" style={{ margin: 0 }}>
          PatraDesa Belajar
        </p>
        <PageTitle>{guide.title}</PageTitle>
        <p style={{ margin: 0 }}>{guide.subtitle}.</p>
        <p className="muted" style={{ margin: 0 }}>
          {guide.audience} {GUIDE_VERSION}.
        </p>
        <div>
          <DownloadPdf guide={guide} />
        </div>
      </header>
      <div className="guide-layout">
        <nav className="card guide-toc" aria-label={`Daftar isi ${guide.title}`}>
          <h2>Daftar isi</h2>
          <ol>
            {guide.sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
            <li>
              <a href="#kontak-judul">Bantuan &amp; kontak</a>
            </li>
          </ol>
        </nav>
        <div className="stack">
          {guide.sections.map((s, i) => (
            <Section key={s.id} s={s} n={i + 1} />
          ))}
          <ContactCard />
        </div>
      </div>
    </div>
  );
}
