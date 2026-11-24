/**
 * Canvas-Rendering aller Seiteninhalte (gemeinsam genutzt von Editor, Seitenleiste
 * und Lasso-Export). Koordinaten: Seiteneinheiten (pt); der Aufrufer setzt die Transformation.
 */
import type { FontId, ImageObj, Page, PageObject, ShapeObj, Stroke, TextObj } from '../../shared/types';
import { penOutline, smoothCenterline } from './geometry';
import { arrowHead, isClosedKind, shapeOutline } from './shapes';

const pathCache = new WeakMap<Stroke, Path2D>();

export const FONT_FAMILIES: Record<FontId, string> = {
  sans: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "Consolas, 'Cascadia Mono', monospace",
  hand: "'Ink Free', 'Segoe Print', 'Comic Sans MS', cursive",
};
export const TEXT_PADDING = 6;
export const TEXT_LINE_HEIGHT = 1.3;

const isDashed = (s: { dashArray?: number[] | null }) => !!s.dashArray && s.dashArray.length > 0;

/** Path2D eines Strichs in Seitenkoordinaten (gecacht, da Striche unveränderlich sind). */
export function strokePath(s: Stroke, cache = true): Path2D {
  if (cache) {
    const hit = pathCache.get(s);
    if (hit) return hit;
  }
  const path = s.tool === 'highlighter' || isDashed(s) ? centerlinePath(s.points) : penPath(s);
  if (cache) pathCache.set(s, path);
  return path;
}

function penPath(s: Stroke): Path2D {
  const { circles, quads } = penOutline(smoothCenterline(s.points, s.width, s.penStyle));
  const p = new Path2D();
  for (let i = 0; i < circles.length; i += 3) {
    p.moveTo(circles[i] + circles[i + 2], circles[i + 1]);
    p.arc(circles[i], circles[i + 1], circles[i + 2], 0, Math.PI * 2, false);
  }
  for (let i = 0; i < quads.length; i += 8) {
    p.moveTo(quads[i], quads[i + 1]);
    p.lineTo(quads[i + 2], quads[i + 3]);
    p.lineTo(quads[i + 4], quads[i + 5]);
    p.lineTo(quads[i + 6], quads[i + 7]);
    p.closePath();
  }
  return p;
}

/** Geglättete Mittellinie (quadratische Kurven durch die Mittelpunkte). */
function centerlinePath(pts: number[]): Path2D {
  const p = new Path2D();
  const n = pts.length / 3;
  if (n === 0) return p;
  p.moveTo(pts[0], pts[1]);
  if (n === 1) {
    p.lineTo(pts[0] + 0.01, pts[1]);
    return p;
  }
  for (let i = 1; i < n - 1; i++) {
    const mx = (pts[i * 3] + pts[i * 3 + 3]) / 2;
    const my = (pts[i * 3 + 1] + pts[i * 3 + 4]) / 2;
    p.quadraticCurveTo(pts[i * 3], pts[i * 3 + 1], mx, my);
  }
  p.lineTo(pts[(n - 1) * 3], pts[(n - 1) * 3 + 1]);
  return p;
}

function applyDash(ctx: CanvasRenderingContext2D, dash: number[] | null | undefined, round: boolean) {
  ctx.setLineDash(dash ?? []);
  ctx.lineCap = dash && dash[0] < 0.1 ? 'round' : round ? 'round' : 'butt';
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, cache = true): void {
  const path = strokePath(s, cache);
  if (s.tool === 'highlighter' || isDashed(s)) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineJoin = 'round';
    applyDash(ctx, s.dashArray, true);
    ctx.stroke(path);
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = s.color;
    ctx.fill(path, 'nonzero');
  }
}

export function drawShape(ctx: CanvasRenderingContext2D, sh: Pick<ShapeObj, 'kind' | 'points' | 'color' | 'width' | 'fill' | 'dashArray'>): void {
  const { pts, closed } = shapeOutline(sh);
  const p = new Path2D();
  p.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
  if (closed) p.closePath();
  if (sh.fill && isClosedKind(sh.kind)) {
    ctx.fillStyle = sh.fill;
    ctx.fill(p);
  }
  ctx.strokeStyle = sh.color;
  ctx.lineWidth = sh.width;
  ctx.lineJoin = 'round';
  applyDash(ctx, sh.dashArray, true);
  ctx.stroke(p);
  ctx.setLineDash([]);
  if (sh.kind === 'arrow') {
    const h = arrowHead(sh);
    const hp = new Path2D();
    hp.moveTo(h[0], h[1]);
    hp.lineTo(h[2], h[3]);
    hp.lineTo(h[4], h[5]);
    ctx.lineCap = 'round';
    ctx.stroke(hp);
  }
}

// ------------------------------------------------------------------ Text

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

export const fontString = (t: Pick<TextObj, 'font' | 'size'>) => `${t.size}px ${FONT_FAMILIES[t.font]}`;

/** Innenabstand: Haftnotizen haben mehr Rand (wirkt wie Papier). */
export const STICKY_PADDING = 14;
export const textPadding = (t: { sticky?: boolean }) => (t.sticky ? STICKY_PADDING : TEXT_PADDING);

/** Zeilenumbruch (Wörter, sonst Zeichen) für die Textbreite. */
export function layoutText(t: Pick<TextObj, 'text' | 'font' | 'size' | 'w' | 'sticky'>, ctx: CanvasRenderingContext2D = measurer()): string[] {
  ctx.font = fontString(t);
  const maxW = Math.max(10, t.w - 2 * textPadding(t));
  const lines: string[] = [];
  for (const para of t.text.split('\n')) {
    if (!para) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (ctx.measureText(test).width <= maxW || !line) {
        if (ctx.measureText(test).width > maxW && !line) {
          // sehr langes Wort: zeichenweise umbrechen
          let chunk = '';
          for (const ch of word) {
            if (ctx.measureText(chunk + ch).width > maxW && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = test;
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Benötigte Höhe einer Textbox für ihren Inhalt. */
export function measureTextHeight(t: Pick<TextObj, 'text' | 'font' | 'size' | 'w' | 'sticky'>): number {
  return Math.max(1, layoutText(t).length) * t.size * TEXT_LINE_HEIGHT + 2 * textPadding(t);
}

/** Haftnotiz: Papier mit weichem Schatten und umgeknickter Ecke unten rechts. */
function drawStickyPaper(ctx: CanvasRenderingContext2D, t: TextObj) {
  const w = t.w;
  const h = t.h;
  const fold = Math.min(w, h) * 0.12;
  const paper = new Path2D();
  paper.moveTo(-w / 2, -h / 2);
  paper.lineTo(w / 2, -h / 2);
  paper.lineTo(w / 2, h / 2 - fold);
  paper.lineTo(w / 2 - fold, h / 2);
  paper.lineTo(-w / 2, h / 2);
  paper.closePath();
  ctx.save();
  ctx.shadowColor = 'rgba(40, 30, 10, 0.28)';
  ctx.shadowBlur = Math.max(4, w * 0.04);
  ctx.shadowOffsetY = Math.max(1.5, w * 0.012);
  ctx.fillStyle = t.background ?? '#ffe97a';
  ctx.fill(paper);
  ctx.restore();
  // Klebestreifen oben (etwas dunkler)
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  ctx.fillRect(-w / 2, -h / 2, w, Math.min(h * 0.1, 16));
  // Eselsohr
  ctx.beginPath();
  ctx.moveTo(w / 2, h / 2 - fold);
  ctx.lineTo(w / 2 - fold, h / 2 - fold);
  ctx.lineTo(w / 2 - fold, h / 2);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fill();
}

export function drawText(ctx: CanvasRenderingContext2D, t: TextObj): void {
  ctx.save();
  ctx.translate(t.cx, t.cy);
  ctx.rotate((t.rotation * Math.PI) / 180);
  const pad = textPadding(t);
  if (t.sticky) {
    drawStickyPaper(ctx, t);
  } else if (t.background) {
    ctx.fillStyle = t.background;
    roundRect(ctx, -t.w / 2, -t.h / 2, t.w, t.h, Math.min(6, t.h / 4));
    ctx.fill();
  }
  ctx.fillStyle = t.color;
  ctx.font = fontString(t);
  ctx.textBaseline = 'top';
  ctx.textAlign = t.align;
  const lines = layoutText(t, ctx);
  const x = t.align === 'left' ? -t.w / 2 + pad : t.align === 'right' ? t.w / 2 - pad : 0;
  let y = -t.h / 2 + pad + (t.size * (TEXT_LINE_HEIGHT - 1)) / 2;
  for (const line of lines) {
    ctx.fillText(line, x, y);
    y += t.size * TEXT_LINE_HEIGHT;
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ------------------------------------------------------------------ Bilder

const images = new Map<string, HTMLImageElement>();
const imageListeners = new Set<() => void>();

/** Benachrichtigt, wenn ein Bild fertig geladen ist (zum Neuzeichnen). */
export function onImageLoaded(cb: () => void): () => void {
  imageListeners.add(cb);
  return () => imageListeners.delete(cb);
}

function getImage(src: string): HTMLImageElement | null {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => imageListeners.forEach((l) => l());
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

// ------------------------------------------------------------------ Animierte GIFs
//
// Canvas zeigt von animierten <img> nur das erste Bild (HTML-Spezifikation). Darum werden GIFs
// mit WebCodecs (ImageDecoder) einmal in Einzelbilder zerlegt und je nach Uhrzeit das passende
// Bild gezeichnet. Da jedes Bild in Seitenkoordinaten gezeichnet wird, zoomt die Animation scharf mit.

interface Frame {
  bmp: ImageBitmap;
  /** Ende des Bildes in ms ab Animationsbeginn */
  until: number;
}
interface Anim {
  frames: Frame[];
  total: number;
  w: number;
  h: number;
}
const anims = new Map<string, Anim | 'loading' | 'static'>();
/** Obergrenze der dekodierten Pixel pro GIF (≈ 240 MB RGBA); größere GIFs bleiben statisch */
const MAX_ANIM_PIXELS = 60_000_000;
const MAX_FRAMES = 600;

interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(o: { frameIndex: number }): Promise<{ image: { duration: number | null; close(): void } & CanvasImageSource }>;
  close(): void;
}
type ImageDecoderCtor = new (init: { data: ArrayBuffer | ReadableStream; type: string }) => ImageDecoderLike;

async function decodeGif(src: string): Promise<Anim | null> {
  const Ctor = (globalThis as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  if (!Ctor) return null;
  const data = await (await fetch(src)).arrayBuffer();
  const dec = new Ctor({ data, type: 'image/gif' });
  try {
    await dec.tracks.ready;
    const count = Math.min(MAX_FRAMES, dec.tracks.selectedTrack?.frameCount ?? 0);
    if (count < 2) return null;
    const frames: Frame[] = [];
    let t = 0;
    let pixels = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const bmp = await createImageBitmap(image);
      // GIF-Verzögerung (µs); Browser behandeln < 20 ms als 100 ms
      const ms = image.duration ? image.duration / 1000 : 100;
      image.close();
      t += ms < 20 ? 100 : ms;
      frames.push({ bmp, until: t });
      pixels += bmp.width * bmp.height;
      if (pixels > MAX_ANIM_PIXELS) {
        frames.forEach((f) => f.bmp.close());
        return null;
      }
    }
    return { frames, total: t, w: frames[0].bmp.width, h: frames[0].bmp.height };
  } finally {
    dec.close();
  }
}

function getAnim(src: string): Anim | null {
  const a = anims.get(src);
  if (a === undefined) {
    anims.set(src, 'loading');
    decodeGif(src)
      .then((r) => {
        anims.set(src, r ?? 'static');
        imageListeners.forEach((l) => l());
      })
      .catch(() => anims.set(src, 'static'));
    return null;
  }
  return typeof a === 'object' ? a : null;
}

/** Bild der Animation zum Zeitpunkt `now` (ms). */
function animFrame(a: Anim, now: number): ImageBitmap {
  const t = now % a.total;
  for (const f of a.frames) if (t < f.until) return f.bmp;
  return a.frames[a.frames.length - 1].bmp;
}

/** true, wenn die Seite ein animiertes GIF enthält, dessen Einzelbilder bereitstehen (→ Neuzeichnen per Animation). */
export function pageHasAnimation(page: Page): boolean {
  return page.objects.some((o) => o.type === 'image' && o.animated && !!getAnim(o.src));
}

export function drawImageObj(ctx: CanvasRenderingContext2D, im: ImageObj, now = performance.now()): void {
  const anim = im.animated ? getAnim(im.src) : null;
  const img = anim ? null : getImage(im.src);
  ctx.save();
  ctx.translate(im.cx, im.cy);
  ctx.rotate((im.rotation * Math.PI) / 180);
  if (anim) {
    const c = im.crop;
    ctx.drawImage(animFrame(anim, now), c.x * anim.w, c.y * anim.h, c.w * anim.w, c.h * anim.h, -im.w / 2, -im.h / 2, im.w, im.h);
  } else if (img) {
    const c = im.crop;
    ctx.drawImage(img, c.x * img.naturalWidth, c.y * img.naturalHeight, c.w * img.naturalWidth, c.h * img.naturalHeight, -im.w / 2, -im.h / 2, im.w, im.h);
  } else {
    ctx.fillStyle = 'rgba(128,128,128,0.15)';
    ctx.fillRect(-im.w / 2, -im.h / 2, im.w, im.h);
  }
  ctx.restore();
}

export function drawObject(ctx: CanvasRenderingContext2D, o: PageObject): void {
  if (o.type === 'shape') drawShape(ctx, o);
  else if (o.type === 'text') drawText(ctx, o);
  else drawImageObj(ctx, o);
}

/**
 * Zeichnet eine ganze Seite. Eingravierte Elemente bilden die unterste Ebene (Teil der Seite),
 * darüber die normalen Elemente. Reihenfolge je Ebene: Textmarker (eigene Ebene, falls `hl`
 * gesetzt), Bilder, Formen, Stift-Tinte, Texte, Haftnotizen.
 */
export function drawPageContent(
  ink: CanvasRenderingContext2D,
  page: Page,
  opts: {
    hl?: CanvasRenderingContext2D;
    hidden?: Set<string>;
    only?: { strokes: Set<string>; objects: Set<string> };
    highlighterAlpha?: number;
    /** Export ohne Haftnotizen */
    skipSticky?: boolean;
  } = {},
): void {
  const visibleStroke = (s: Stroke) => !opts.hidden?.has(s.id) && (!opts.only || opts.only.strokes.has(s.id));
  const visibleObj = (o: PageObject) =>
    !opts.hidden?.has(o.id) && (!opts.only || opts.only.objects.has(o.id)) && !(opts.skipSticky && o.type === 'text' && o.sticky);
  const hl = opts.hl ?? ink;
  for (const engraved of [true, false]) {
    const layer = (x: { engraved?: boolean }) => !!x.engraved === engraved;
    if (!opts.hl) ink.globalAlpha = opts.highlighterAlpha ?? 0.42;
    for (const s of page.strokes) if (s.tool === 'highlighter' && layer(s) && visibleStroke(s)) drawStroke(hl, s);
    ink.globalAlpha = 1;
    for (const o of page.objects) if (o.type === 'image' && layer(o) && visibleObj(o)) drawObject(ink, o);
    for (const o of page.objects) if (o.type === 'shape' && layer(o) && visibleObj(o)) drawObject(ink, o);
    for (const s of page.strokes) if (s.tool !== 'highlighter' && layer(s) && visibleStroke(s)) drawStroke(ink, s);
    for (const o of page.objects) if (o.type === 'text' && !o.sticky && layer(o) && visibleObj(o)) drawObject(ink, o);
    for (const o of page.objects) if (o.type === 'text' && o.sticky && layer(o) && visibleObj(o)) drawObject(ink, o);
  }
}
