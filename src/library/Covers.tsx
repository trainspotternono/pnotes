import type { NotebookMeta } from '../../shared/types';
import { isLight } from '../lib/colors';
import { pageSize } from '../lib/formats';
import { PaperBackground } from '../paper/PaperBackground';
import { PdfCanvas } from '../pdf/PdfCanvas';

type CoverInput = Pick<NotebookMeta, 'title' | 'coverColor' | 'template' | 'paperColor' | 'format' | 'orientation' | 'coverPdf'>;

/** Umschlag (einfarbig mit Rücken + Titelschild) oder – ohne Umschlag – Vorschau der ersten Seite (bei PDFs die erste PDF-Seite). */
export function NotebookCover({ nb, width }: { nb: CoverInput; width: number }) {
  const size = pageSize(nb.format, nb.orientation);
  const height = Math.round((width * size.h) / size.w);
  if (!nb.coverColor && nb.coverPdf) {
    return (
      <div className="cover cover-paper cover-pdf" style={{ width, height }}>
        <PdfCanvas pdf={nb.coverPdf} pageW={size.w} pageH={size.h} cssWidth={width} observe />
      </div>
    );
  }
  if (!nb.coverColor) {
    return (
      <div className="cover cover-paper" style={{ width, height }}>
        <PaperBackground template={nb.template} paperColor={nb.paperColor} width={size.w} height={size.h} strokeScale={2.2} style={{ width: '100%', height: '100%' }} />
      </div>
    );
  }
  const light = isLight(nb.coverColor);
  return (
    <div className={`cover${light ? ' cover-light' : ''}`} style={{ width, height, background: nb.coverColor }}>
      <div className="cover-spine" />
      <div className="cover-label">
        <span>{nb.title}</span>
      </div>
    </div>
  );
}

/** Ordner-Symbol in Ordnerfarbe. */
export function FolderGraphic({ color, width }: { color: string; width: number }) {
  const h = Math.round(width * 0.78);
  const stroke = isLight(color) ? 'rgba(18,22,26,0.12)' : 'rgba(242,243,245,0.1)'; // Slate 900 / Slate 100
  return (
    <svg width={width} height={h} viewBox="0 0 100 78" className="folder-graphic" aria-hidden>
      <path d="M6 10 a6 6 0 0 1 6-6 h24 l8 8 h44 a6 6 0 0 1 6 6 v4 H6 z" fill={color} opacity={0.72} />
      <rect x="4" y="18" width="92" height="56" rx="7" fill={color} stroke={stroke} />
      <rect x="4" y="18" width="92" height="56" rx="7" fill="url(#folderShade)" />
      <defs>
        <linearGradient id="folderShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f3f5" stopOpacity="0.18" />
          <stop offset="1" stopColor="#000" stopOpacity="0.06" />
        </linearGradient>
      </defs>
    </svg>
  );
}
