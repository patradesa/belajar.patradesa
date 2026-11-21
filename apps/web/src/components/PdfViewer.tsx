/**
 * PDF privat lewat Worker (cookie sesi same-origin). Viewer native browser; tanpa pdf.js.
 * Di ponsel (Android sering tidak merender PDF dalam iframe) cukup tautan buka/unduh.
 */
export default function PdfViewer({ url, title }: { url: string; title: string }) {
  return (
    <div className="stack">
      <p>
        <a className="btn btn-secondary" href={url} target="_blank" rel="noopener">
          Buka PDF di tab baru
        </a>
      </p>
      <iframe className="pdf-frame" src={url} title={`Dokumen PDF: ${title}`} loading="lazy" />
    </div>
  );
}
