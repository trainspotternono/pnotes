import { memo, useEffect, useRef, useState } from 'react';
import type { Page } from '../../shared/types';
import { drawPageContent, onImageLoaded } from '../ink/render';
import { pageIsEmpty } from './pages';

/** Inhalts-Vorschau einer Seite für die Seitenleiste (gleiche Zeichenroutinen wie im Editor). */
export const InkThumb = memo(function InkThumb({ page, pageW, pageH, width, height }: { page: Page; pageW: number; pageH: number; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => onImageLoaded(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const id = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform((width / pageW) * dpr, 0, 0, (height / pageH) * dpr, 0, 0);
      drawPageContent(ctx, page);
    });
    return () => cancelAnimationFrame(id);
  }, [page, pageW, pageH, width, height, tick]);
  if (pageIsEmpty(page)) return null;
  return <canvas ref={ref} style={{ width, height }} aria-hidden />;
});
