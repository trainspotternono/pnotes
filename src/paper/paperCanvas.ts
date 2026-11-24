/** Papiervorlage auf Canvas zeichnen (Export) – gleiche Geometrie und Farben wie die SVG-Vorlage. */
import type { PaperColor, PaperTemplate } from '../../shared/types';
import { PAPER_STYLES, TEMPLATE_GEOMETRY } from './PaperBackground';

/** Zeichnet die Vorlage in Seitenkoordinaten (0..w, 0..h); der Aufrufer setzt Maßstab/Drehung. */
export function drawPaper(ctx: CanvasRenderingContext2D, template: PaperTemplate, paperColor: PaperColor, w: number, h: number, withBackground = true) {
  const s = PAPER_STYLES[paperColor];
  ctx.save();
  if (withBackground) {
    ctx.fillStyle = s.bg;
    ctx.fillRect(0, 0, w, h);
  }
  if (template === 'ruled') {
    const g = TEMPLATE_GEOMETRY.ruled;
    ctx.strokeStyle = s.line;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let y = g.top; y <= h - g.bottom; y += g.spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.strokeStyle = s.margin;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(g.margin, 0);
    ctx.lineTo(g.margin, h);
    ctx.stroke();
  } else if (template === 'squared') {
    const sp = TEMPLATE_GEOMETRY.squared.spacing;
    const ox = (w % sp) / 2;
    const oy = (h % sp) / 2;
    ctx.strokeStyle = s.line;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = ox; x <= w; x += sp) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = oy; y <= h; y += sp) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  } else if (template === 'dotted') {
    const { spacing: sp, radius } = TEMPLATE_GEOMETRY.dotted;
    const ox = (w % sp) / 2;
    const oy = (h % sp) / 2;
    ctx.fillStyle = s.dot;
    ctx.beginPath();
    for (let x = ox; x <= w; x += sp) {
      for (let y = oy; y <= h; y += sp) {
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
  ctx.restore();
}
