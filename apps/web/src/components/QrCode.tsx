import qrcode from 'qrcode-generator';

/** QR sebagai SVG murni React (tanpa innerHTML). Satu <path> agar ringan dan tajam saat dicetak. */
export function QrCode({ value, size = 128, label }: { value: string; size?: number; label: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount();
  const margin = 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  }
  const total = n + margin * 2;
  return (
    <svg className="qr" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${total} ${total}`} shapeRendering="crispEdges">
      <rect width={total} height={total} fill="#ffffff" />
      <path d={d} fill="#1b2620" />
    </svg>
  );
}
