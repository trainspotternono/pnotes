/**
 * Rendert eine Notizbuchseite für den Export auf ein Canvas: Hintergrund (Vorlage oder PDF,
 * inkl. Seitendrehung), eingravierte Elemente, Tinte, Formen, Texte, Bilder (GIF: erstes Bild),
 * optional Haftnotizen und nummerierte Kommentar-Pins.
 */
import type { Page, PaperColor } from '../../shared/types';
import { drawPageContent } from '../ink/render';
import { drawPaper } from '../paper/paperCanvas';
import { renderPdfPage } from '../pdf/pdf';
import { baseSize } from '../editor/pages';
import { t } from '../i18n';
import { PALETTE, PDF_PAPER } from '../lib/palette';

export interface RenderOpts {
  /** Pixel pro pt */
  scale: number;
  /** Hintergrund (Vorlage/PDF) mitzeichnen */
  background: boolean;
  /** Haftnotizen mitzeichnen */
  stickies: boolean;
  /** Kommentar-Pins: Nummer je Thread-ID (fehlt = keine Pins) */
  commentNumbers?: Map<string, number>;
}

export const MAX_EXPORT_EDGE = 4096;

/** Maßstab so begrenzen, dass keine Kante MAX_EXPORT_EDGE überschreitet. */
export const clampScale = (scale: number, w: number, h: number) => Math.min(scale, MAX_EXPORT_EDGE / Math.max(w, h));

/** Zeichnet den Hintergrund einer Seite (gedreht) in Seitenkoordinaten 0..w × 0..h. */
async function drawBackground(ctx: CanvasRenderingContext2D, page: Page, size: { w: number; h: number }, paperColor: PaperColor, scale: number) {
  const base = baseSize(page, size);
  const rot = page.rotation ?? 0;
  ctx.save();
  ctx.translate(size.w / 2, size.h / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.translate(-base.w / 2, -base.h / 2);
  if (page.pdf) {
    // Papier der importierten PDF selbst (Dokumentinhalt, keine Theme-Farbe)
    ctx.fillStyle = PDF_PAPER;
    ctx.fillRect(0, 0, base.w, base.h);
    try {
      const src = await renderPdfPage(page.pdf.asset, page.pdf.page, clampScale(scale, base.w, base.h), new AbortController().signal);
      ctx.drawImage(src, 0, 0, base.w, base.h);
    } catch {
      /* fehlende PDF: weiße Seite */
    }
  } else {
    drawPaper(ctx, page.template, paperColor, base.w, base.h);
  }
  ctx.restore();
}

function drawPins(ctx: CanvasRenderingContext2D, page: Page, numbers: Map<string, number>) {
  for (const t of page.comments) {
    const n = numbers.get(t.id);
    if (n === undefined) continue;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.fillStyle = t.resolved ? PALETTE.slate500 : PALETTE.crimson;
    ctx.strokeStyle = PALETTE.slate100;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PALETTE.slate100;
    ctx.font = "bold 9px 'Segoe UI', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 0, 0.5);
    ctx.restore();
  }
}

export async function renderPageToCanvas(page: Page, defaultSize: { w: number; h: number }, paperColor: PaperColor, opts: RenderOpts): Promise<HTMLCanvasElement> {
  const size = page.size ?? defaultSize;
  const k = clampScale(opts.scale, size.w, size.h);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(size.w * k));
  c.height = Math.max(1, Math.round(size.h * k));
  const ctx = c.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  if (opts.background) await drawBackground(ctx, page, size, paperColor, k);
  // Textmarker auf hellem Grund wie im Editor (multiply), auf dunklem Papier normal
  const hl = document.createElement('canvas');
  hl.width = c.width;
  hl.height = c.height;
  const hctx = hl.getContext('2d')!;
  hctx.setTransform(k, 0, 0, k, 0, 0);
  const ink = document.createElement('canvas');
  ink.width = c.width;
  ink.height = c.height;
  const ictx = ink.getContext('2d')!;
  ictx.setTransform(k, 0, 0, k, 0, 0);
  drawPageContent(ictx, page, { hl: hctx, skipSticky: !opts.stickies });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.45;
  ctx.globalCompositeOperation = opts.background && paperColor !== 'dark' ? 'multiply' : 'source-over';
  ctx.drawImage(hl, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(ink, 0, 0);
  if (opts.commentNumbers) {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawPins(ctx, page, opts.commentNumbers);
  }
  return c;
}

export const canvasToBytes = (c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg' = 'image/png', quality?: number) =>
  new Promise<Uint8Array>((resolve, reject) =>
    c.toBlob(
      (b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error(t('Bild konnte nicht erzeugt werden')))),
      type,
      quality,
    ),
  );

/** Nummerierung der Kommentare wie im Editor (fortlaufend über alle Seiten). */
export function commentNumbering(pages: Page[]): Map<string, number> {
  const m = new Map<string, number>();
  let n = 0;
  for (const p of pages) for (const t of p.comments) m.set(t.id, ++n);
  return m;
}
