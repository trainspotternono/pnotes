import { memo, useEffect, useRef, useState } from 'react';
import { FileWarning } from 'lucide-react';
import type { PdfPageRef } from '../../shared/types';
import { bestCached, renderPdfPage, scaleBucket } from './pdf';

/**
 * Zeigt eine PDF-Seite. Gerendert wird nur, wenn `active` (sichtbar) – bzw. bei `observe`
 * sobald das Element in den sichtbaren Bereich kommt (Seitenleiste, Dialoge). Während eine
 * schärfere Stufe lädt, bleibt die bisherige sichtbar.
 */
export const PdfCanvas = memo(function PdfCanvas({
  pdf,
  pageW,
  pageH,
  cssWidth,
  active = true,
  observe = false,
  className,
}: {
  pdf: PdfPageRef;
  /** Seitengröße in pt */
  pageW: number;
  pageH: number;
  /** angezeigte Breite in CSS-px (bestimmt die Render-Auflösung) */
  cssWidth: number;
  active?: boolean;
  observe?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(!observe);
  const [error, setError] = useState<string | null>(null);
  const scale = scaleBucket(cssWidth, pageW, pageH);

  useEffect(() => {
    if (!observe || !ref.current) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [observe]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !active || !visible) return;
    const show = (src: HTMLCanvasElement) => {
      if (c.width !== src.width || c.height !== src.height) {
        c.width = src.width;
        c.height = src.height;
      }
      c.getContext('2d')!.drawImage(src, 0, 0);
    };
    const placeholder = bestCached(pdf.asset, pdf.page);
    if (placeholder) show(placeholder);
    const ctrl = new AbortController();
    renderPdfPage(pdf.asset, pdf.page, scale, ctrl.signal)
      .then((src) => {
        if (!ctrl.signal.aborted) {
          show(src);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (err?.name !== 'AbortError' && !/cancel/i.test(err?.message ?? '') && !ctrl.signal.aborted) setError(err.message);
      });
    return () => ctrl.abort();
  }, [pdf.asset, pdf.page, scale, active, visible]);

  return (
    <div className={`pdf-page ${className ?? ''}`} data-pdf-page={pdf.page}>
      <canvas ref={ref} />
      {error && (
        <div className="pdf-error" title={error}>
          <FileWarning size={22} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
});
