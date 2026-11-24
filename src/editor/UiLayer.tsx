/**
 * Interaktions-Ebene (Canvas über der Tinte): Lasso-Pfad, Auswahlrahmen mit Griffen,
 * Ankerpunkte der bearbeiteten Form und der Laserpointer (mit Ausblend-Animation).
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { Page } from '../../shared/types';
import { pageTransform, sizeCanvas, type Viewport } from '../ink/InkLayer';
import { rotateKnob, shapeAnchors } from '../ink/shapes';
import { PALETTE } from '../lib/palette';
import { ROTATE_KNOB_PX } from '../tools/shapeEdit';
import { LASER_DOT_FADE_MS, LASER_TRAIL_MS } from '../tools/misc';
import { selectionHandles } from '../tools/selection';
import type { LaserState } from '../tools/types';
import type { UiStore } from './store';

export interface UiLayerHandle {
  setViewport(v: Viewport): void;
  redraw(): void;
}

const ACCENT = PALETTE.crimson;
const HANDLE_FILL = PALETTE.slate100;

export const UiLayer = forwardRef<UiLayerHandle, { pages: Page[]; store: UiStore; laser: LaserState; laserColor: string }>(function UiLayer(
  { pages, store, laser, laserColor },
  ref,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef<Viewport | null>(null);
  const pagesRef = useRef(pages);
  const colorRef = useRef(laserColor);
  const frame = useRef<number | null>(null);
  pagesRef.current = pages;
  colorRef.current = laserColor;

  const draw = useCallback(() => {
    frame.current = null;
    const c = canvas.current;
    const v = vpRef.current;
    if (!c || !v) return;
    const dpr = window.devicePixelRatio || 1;
    sizeCanvas(c, v, dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const ui = store.get();
    const px = 1 / v.zoom; // 1 Bildschirm-px in Seiteneinheiten

    // Lasso
    if (ui.lasso && ui.lasso.points.length >= 4 && v.layout.pages[ui.lasso.pageIndex]) {
      ctx.save();
      pageTransform(ctx, v, ui.lasso.pageIndex, dpr, false);
      const pts = ui.lasso.points;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(217,38,50,0.07)';
      ctx.fill();
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = ACCENT;
      ctx.stroke();
      ctx.restore();
    }

    // Auswahl
    if (ui.selection && v.layout.pages[ui.selection.pageIndex]) {
      const f = ui.selection.frame;
      const h = selectionHandles(f, v.zoom);
      ctx.save();
      pageTransform(ctx, v, ui.selection.pageIndex, dpr, false);
      ctx.beginPath();
      h.corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = ACCENT;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(h.topMid[0], h.topMid[1]);
      ctx.lineTo(h.rotate[0], h.rotate[1]);
      ctx.stroke();
      for (const [x, y] of [...h.corners, h.rotate]) {
        ctx.beginPath();
        ctx.arc(x, y, 6 * px, 0, Math.PI * 2);
        ctx.fillStyle = HANDLE_FILL;
        ctx.fill();
        ctx.lineWidth = 2 * px;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Ankerpunkte der Form
    if (ui.shapeEdit && v.layout.pages[ui.shapeEdit.pageIndex]) {
      const sh = pagesRef.current[ui.shapeEdit.pageIndex]?.objects.find((o) => o.id === ui.shapeEdit!.id);
      if (sh && sh.type === 'shape') {
        ctx.save();
        pageTransform(ctx, v, ui.shapeEdit.pageIndex, dpr, false);
        // Drehgriff (geschlossene Formen)
        const rk = rotateKnob(sh, ROTATE_KNOB_PX * px);
        if (rk) {
          ctx.beginPath();
          ctx.moveTo(rk.base[0], rk.base[1]);
          ctx.lineTo(rk.knob[0], rk.knob[1]);
          ctx.setLineDash([3 * px, 3 * px]);
          ctx.lineWidth = 1.5 * px;
          ctx.strokeStyle = ACCENT;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(rk.knob[0], rk.knob[1], 7 * px, 0, Math.PI * 2);
          ctx.fillStyle = ACCENT;
          ctx.fill();
          // kleiner Drehpfeil im Griff
          ctx.beginPath();
          ctx.arc(rk.knob[0], rk.knob[1], 3.6 * px, -Math.PI * 0.9, Math.PI * 0.4);
          ctx.strokeStyle = HANDLE_FILL;
          ctx.lineWidth = 1.4 * px;
          ctx.stroke();
        }
        for (const [x, y] of shapeAnchors(sh)) {
          ctx.beginPath();
          ctx.arc(x, y, 7 * px, 0, Math.PI * 2);
          ctx.fillStyle = HANDLE_FILL;
          ctx.fill();
          ctx.lineWidth = 2.5 * px;
          ctx.strokeStyle = ACCENT;
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Laserpointer (verblasst automatisch)
    const now = performance.now();
    laser.points = laser.points.filter((p) => now - p.t < LASER_TRAIL_MS);
    const color = colorRef.current;
    let animate = laser.active || laser.points.length > 0;
    if (laser.points.length > 1) {
      for (let i = 1; i < laser.points.length; i++) {
        const a = laser.points[i - 1];
        const b = laser.points[i];
        if (a.seg !== b.seg || a.pageIndex !== b.pageIndex || !v.layout.pages[b.pageIndex]) continue;
        const age = (now - b.t) / LASER_TRAIL_MS;
        ctx.save();
        pageTransform(ctx, v, b.pageIndex, dpr, false);
        ctx.globalAlpha = Math.max(0, 1 - age);
        ctx.strokeStyle = color;
        ctx.lineCap = 'round';
        ctx.shadowColor = color;
        ctx.shadowBlur = 10 * dpr;
        ctx.lineWidth = 4 * px;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.restore();
      }
    }
    const dot = laser.dot;
    if (dot && v.layout.pages[dot.pageIndex]) {
      const fade = laser.active ? 1 : Math.max(0, 1 - (now - laser.releasedAt) / LASER_DOT_FADE_MS);
      if (fade > 0) {
        animate = true;
        ctx.save();
        pageTransform(ctx, v, dot.pageIndex, dpr, false);
        ctx.globalAlpha = fade;
        ctx.shadowColor = color;
        ctx.shadowBlur = 16 * dpr;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 6 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(242,243,245,0.85)';
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 2.2 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else laser.dot = null;
    }
    if (animate) frame.current = requestAnimationFrame(draw);
  }, [store, laser]);

  const redraw = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => store.subscribe(redraw), [store, redraw]);
  useEffect(() => redraw(), [pages, redraw]);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setViewport(v) {
        vpRef.current = v;
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        draw();
      },
      redraw,
    }),
    [draw, redraw],
  );

  return <canvas ref={canvas} className="ink-layer ui" />;
});
