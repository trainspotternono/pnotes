import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { Page } from '../../shared/types';
import { visiblePages, type Layout } from '../editor/layout';
import type { WetItem } from '../tools/types';
import { drawPageContent, drawShape, drawStroke, onImageLoaded, pageHasAnimation } from './render';

export interface Viewport {
  layout: Layout;
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface InkLayerHandle {
  setViewport(v: Viewport): void;
  drawWet(w: WetItem | null): void;
  /** Mehrere gleichzeitig entstehende Striche (Multi-Touch) */
  drawWetAll(items: WetItem[]): void;
}

export function sizeCanvas(c: HTMLCanvasElement, v: Viewport, dpr: number) {
  const w = Math.max(1, Math.round(v.width * dpr));
  const h = Math.max(1, Math.round(v.height * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
    c.style.width = `${v.width}px`;
    c.style.height = `${v.height}px`;
  }
}

/** Setzt die Transformation Seite → Bildschirm und schneidet auf die Seite zu. */
export function pageTransform(ctx: CanvasRenderingContext2D, v: Viewport, pageIndex: number, dpr: number, clip = true) {
  const p = v.layout.pages[pageIndex];
  const k = dpr * v.zoom;
  ctx.setTransform(k, 0, 0, k, dpr * (v.offsetX + p.x * v.zoom - v.scrollLeft), dpr * (v.offsetY + p.y * v.zoom - v.scrollTop));
  if (clip) {
    ctx.beginPath();
    ctx.rect(0, 0, p.w, p.h);
    ctx.clip();
  }
}

export const viewDocRect = (v: Viewport) => ({ x: (v.scrollLeft - v.offsetX) / v.zoom, y: (v.scrollTop - v.offsetY) / v.zoom, w: v.width / v.zoom, h: v.height / v.zoom });

/**
 * Drei bildschirmgroße Canvas-Ebenen über der Bühne:
 *   hl  – Textmarker (multiply + Deckkraft: überlappende Striche dunkeln nicht nach)
 *   ink – Bilder, Formen, Stift, Texte
 *   wet – der gerade entstehende Strich bzw. die eingerastete Form (desynchronized = geringe Latenz)
 */
export const InkLayer = forwardRef<InkLayerHandle, { pages: Page[]; hidden: Set<string>; darkPaper: boolean }>(function InkLayer({ pages, hidden, darkPaper }, ref) {
  const hlRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const wetRef = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef<Viewport | null>(null);
  const state = useRef({ pages, hidden });
  const frame = useRef<number | null>(null);
  const wetCtx = useRef<CanvasRenderingContext2D | null>(null);
  state.current = { pages, hidden };

  const render = useCallback(() => {
    frame.current = null;
    const v = vpRef.current;
    const hl = hlRef.current;
    const ink = inkRef.current;
    if (!v || !hl || !ink) return;
    const dpr = window.devicePixelRatio || 1;
    sizeCanvas(hl, v, dpr);
    sizeCanvas(ink, v, dpr);
    if (wetRef.current) sizeCanvas(wetRef.current, v, dpr);
    const hctx = hl.getContext('2d')!;
    const ictx = ink.getContext('2d')!;
    for (const ctx of [hctx, ictx]) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, hl.width, hl.height);
    }
    let animating = false;
    for (const rect of visiblePages(v.layout, viewDocRect(v))) {
      const page = state.current.pages[rect.index];
      if (!page || (page.strokes.length === 0 && page.objects.length === 0)) continue;
      hctx.save();
      ictx.save();
      pageTransform(hctx, v, rect.index, dpr);
      pageTransform(ictx, v, rect.index, dpr);
      drawPageContent(ictx, page, { hl: hctx, hidden: state.current.hidden });
      hctx.restore();
      ictx.restore();
      if (pageHasAnimation(page)) animating = true;
    }
    // Sichtbare animierte GIFs: weiterzeichnen (~30 fps), sonst ruht die Ebene
    if (animating && anim.current === null) {
      anim.current = window.setTimeout(() => {
        anim.current = null;
        if (frame.current === null) frame.current = requestAnimationFrame(renderRef.current);
      }, 33);
    }
  }, []);
  const anim = useRef<number | null>(null);
  const renderRef = useRef(render);
  renderRef.current = render;

  const schedule = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(render);
  }, [render]);

  useEffect(() => {
    schedule();
  }, [pages, hidden, schedule]);

  useEffect(() => {
    const off = onImageLoaded(schedule);
    return () => {
      off();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (anim.current !== null) window.clearTimeout(anim.current);
    };
  }, [schedule]);

  useImperativeHandle(
    ref,
    () => ({
      setViewport(v) {
        vpRef.current = v;
        // Synchron zeichnen, damit Inhalte beim Scrollen/Zoomen nicht hinter den Seiten herhinken.
        render();
      },
      drawWet(w) {
        drawWetAll(w ? [w] : []);
      },
      drawWetAll,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [render],
  );

  function drawWetAll(items: WetItem[]) {
    const c = wetRef.current;
    const v = vpRef.current;
    if (!c || !v) return;
    const dpr = window.devicePixelRatio || 1;
    sizeCanvas(c, v, dpr);
    if (!wetCtx.current) wetCtx.current = c.getContext('2d', { desynchronized: true }) ?? c.getContext('2d');
    const ctx = wetCtx.current!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    for (const w of items) {
      if (!v.layout.pages[w.pageIndex]) continue;
      ctx.save();
      pageTransform(ctx, v, w.pageIndex, dpr);
      if (w.stroke) {
        ctx.globalAlpha = w.stroke.tool === 'highlighter' ? 0.45 : 1;
        drawStroke(ctx, w.stroke, false);
      } else if (w.shape) {
        drawShape(ctx, w.shape);
      }
      ctx.restore();
    }
  }

  return (
    <>
      <canvas ref={hlRef} className={`ink-layer hl${darkPaper ? ' on-dark' : ''}`} data-testid="ink-hl" />
      <canvas ref={inkRef} className="ink-layer ink" data-testid="ink" />
      <canvas ref={wetRef} className="ink-layer wet" />
    </>
  );
});
