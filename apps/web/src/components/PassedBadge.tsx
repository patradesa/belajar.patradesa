/** Tanda kelulusan kelas: segel oranye bercentang + "Lulus - Sertifikat Terbit". */
export function PassedBadge({ certificateIssued }: { certificateIssued: boolean }) {
  return (
    <p className="passed-badge">
      <svg className="passed-seal" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="var(--color-passed-icon)"
          d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
        />
        <path d="m8.5 12.2 2.4 2.4 4.6-4.8" fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{certificateIssued ? 'Lulus - Sertifikat Terbit' : 'Lulus - Sertifikat diproses'}</span>
    </p>
  );
}
