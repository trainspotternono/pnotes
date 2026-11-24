/**
 * PDF-Export mit pdf-lib.
 *  - Importierte PDF-Seiten werden als Original eingebettet (Vektor/Text bleiben erhalten, Seitendrehung
 *    wird übernommen); Anmerkungen liegen als hochaufgelöste transparente Ebene darüber.
 *  - Vorlagen-Seiten (Blanko/Liniert/…) werden komplett gerastert (Papier + Inhalt).
 *  - Optional: Haftnotizen, Kommentar-Pins + Anhang mit allen Kommentaren.
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Page, PaperColor } from '../../shared/types';
import { api } from '../lib/api';
import { canvasToBytes, commentNumbering, renderPageToCanvas } from './renderPage';
import { pageIsEmpty } from '../editor/pages';
import { locale, t } from '../i18n';

const tr = t;

export interface PdfExportOptions {
  title: string;
  stickies: boolean;
  comments: boolean;
  /** Pixel pro pt für gerasterte Ebenen (3 ≈ 216 dpi) */
  scale?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Zeichen, die die Standardschrift (WinAnsi) darstellen kann; alles andere wird ersetzt. */
const winAnsiSafe = (s: string) => s.replace(/[^ -~ -ÿ€–—‘’‚“”„…•\n]/g, '?');

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of winAnsiSafe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (font.widthOfTextAtSize(test, size) <= maxW || !line.trim()) line = test;
      else {
        out.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    out.push(line);
  }
  return out;
}

/** Platzierung eines eingebetteten PDF-Blatts (PDF-Koordinaten, y nach oben) für eine Drehung im Uhrzeigersinn. */
export function placement(rot: number, bw: number, bh: number): { x: number; y: number; rotate: number } {
  switch (((rot % 360) + 360) % 360) {
    case 90:
      return { x: 0, y: bw, rotate: -90 };
    case 180:
      return { x: bw, y: bh, rotate: -180 };
    case 270:
      return { x: bh, y: 0, rotate: -270 };
    default:
      return { x: 0, y: 0, rotate: 0 };
  }
}

export async function exportPdf(pages: Page[], defaultSize: { w: number; h: number }, paperColor: PaperColor, opts: PdfExportOptions): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle(opts.title);
  out.setCreator('pNotes');
  out.setProducer('pNotes (pdf-lib)');
  const scale = opts.scale ?? 3;
  const numbers = opts.comments ? commentNumbering(pages) : undefined;
  const sources = new Map<string, Promise<PDFDocument | null>>();
  const source = (asset: string) => {
    let p = sources.get(asset);
    if (!p) {
      p = api.assetGet(asset, 'pdf').then((b) => (b ? PDFDocument.load(b, { ignoreEncryption: true }) : null)).catch(() => null);
      sources.set(asset, p);
    }
    return p;
  };

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const size = page.size ?? defaultSize;
    const pg = out.addPage([size.w, size.h]);
    let vectorBackground = false;
    if (page.pdf) {
      const src = await source(page.pdf.asset);
      if (src && page.pdf.page <= src.getPageCount()) {
        const srcPage = src.getPage(page.pdf.page - 1);
        const [emb] = await out.embedPdf(src, [page.pdf.page - 1]);
        const total = (srcPage.getRotation().angle + (page.rotation ?? 0)) % 360;
        const pl = placement(total, emb.width, emb.height);
        // An die Seitengröße anpassen (pdf.js-Viewport vs. MediaBox können minimal abweichen)
        const odd = total === 90 || total === 270;
        const sx = size.w / (odd ? emb.height : emb.width);
        const sy = size.h / (odd ? emb.width : emb.height);
        pg.drawPage(emb, { x: pl.x * sx, y: pl.y * sy, width: emb.width * (odd ? sy : sx), height: emb.height * (odd ? sx : sy), rotate: degrees(pl.rotate) });
        vectorBackground = true;
      }
    }
    const hasOverlay = !vectorBackground || !pageIsEmpty(page) || (numbers && page.comments.length > 0);
    if (hasOverlay) {
      const canvas = await renderPageToCanvas(page, defaultSize, paperColor, { scale, background: !vectorBackground, stickies: opts.stickies, commentNumbers: numbers });
      // Vollflächige Rasterseiten als JPEG (klein), transparente Anmerkungsebenen als PNG
      const img = vectorBackground ? await out.embedPng(await canvasToBytes(canvas, 'image/png')) : await out.embedJpg(await canvasToBytes(canvas, 'image/jpeg', 0.92));
      pg.drawImage(img, { x: 0, y: 0, width: size.w, height: size.h });
    }
    opts.onProgress?.(i + 1, pages.length);
  }

  if (numbers && numbers.size > 0) await appendComments(out, pages, numbers);
  return out.save();
}

/** Anhang: alle Kommentare mit Seitenzahl, Status und Antworten. */
async function appendComments(out: PDFDocument, pages: Page[], numbers: Map<string, number>) {
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  const M = 56;
  let pg: PDFPage = out.addPage([W, H]);
  let y = H - M;
  const line = (text: string, f: PDFFont, size: number, color = rgb(18 / 255, 22 / 255, 26 / 255), indent = 0) => {
    for (const l of wrap(text, f, size, W - 2 * M - indent)) {
      if (y < M + size) {
        pg = out.addPage([W, H]);
        y = H - M;
      }
      pg.drawText(l, { x: M + indent, y, size, font: f, color });
      y -= size * 1.35;
    }
  };
  line(t('Kommentare'), bold, 18);
  y -= 6;
  const fmt = new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  pages.forEach((p, pi) => {
    for (const th of p.comments) {
      y -= 6;
      line(`#${numbers.get(th.id)} · ${tr('Seite {n}', { n: pi + 1 })}${th.resolved ? ` · ${tr('erledigt')}` : ''}`, bold, 11, rgb(217 / 255, 38 / 255, 50 / 255));
      th.messages.forEach((m, mi) => {
        line(`${mi === 0 ? '' : '> '}${m.text}`, font, 10.5, rgb(18 / 255, 22 / 255, 26 / 255), mi === 0 ? 0 : 14);
        line(fmt.format(m.createdAt) + (m.editedAt ? ` (${tr('bearbeitet')})` : ''), font, 8, rgb(110 / 255, 119 / 255, 129 / 255), mi === 0 ? 0 : 14);
      });
    }
  });
}
