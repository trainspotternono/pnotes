/**
 * PDF-Rendering mit pdf.js (lokal, Worker im eigenen Thread).
 *  - Dokumente werden pro Asset einmal geladen und gecacht
 *  - Seiten werden erst gerendert, wenn sie sichtbar sind (Warteschlange, max. 2 parallel,
 *    neueste Anfrage zuerst), abbrechbar beim Wegscrollen
 *  - Auflösung in √2-Stufen (beim Zoomen wird nicht bei jedem Schritt neu gerendert),
 *    begrenzt auf 4096 px Kantenlänge; LRU-Cache mit Pixelbudget
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api } from '../lib/api';
import { t } from '../i18n';
import { PDF_PAPER } from '../lib/palette';

/** pdf.js wird erst bei der ersten PDF nachgeladen (schneller App-Start). */
let lib: Promise<typeof import('pdfjs-dist')> | null = null;
function pdfjsLib() {
  if (!lib) {
    lib = import('pdfjs-dist').then((m) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl;
      return m;
    });
  }
  return lib;
}

/** Ressourcen (Schrift-Maps, Standardschriften, WASM-Decoder) liegen lokal unter ./pdfjs/ */
const resource = (dir: string) => new URL(`./pdfjs/${dir}/`, document.baseURI).href;

const docs = new Map<string, Promise<PDFDocumentProxy>>();

async function open(data: Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await pdfjsLib();
  return pdfjs.getDocument({
    data,
    cMapUrl: resource('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: resource('standard_fonts'),
    wasmUrl: resource('wasm'),
  }).promise;
}

/** Lädt eine gespeicherte PDF (Asset) – einmal pro Sitzung. */
export function loadPdf(asset: string): Promise<PDFDocumentProxy> {
  let p = docs.get(asset);
  if (!p) {
    p = api.assetGet(asset, 'pdf').then((bytes) => {
      if (!bytes) throw new Error(t('PDF-Datei fehlt im Speicherort (evtl. noch nicht synchronisiert).'));
      return open(bytes);
    });
    p.catch(() => docs.delete(asset));
    docs.set(asset, p);
  }
  return p;
}

/** Öffnet eine noch nicht gespeicherte PDF (Import-Vorschau). pdf.js übernimmt den Puffer, daher Kopie. */
export function openPdfBytes(key: string, bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const p = open(bytes.slice());
  docs.set(key, p);
  p.catch(() => docs.delete(key));
  return p;
}

/** Nach dem Speichern: Vorschau-Dokument unter der endgültigen Asset-ID weiterverwenden. */
export function aliasPdf(fromKey: string, asset: string) {
  const p = docs.get(fromKey);
  if (p && !docs.has(asset)) docs.set(asset, p);
  docs.delete(fromKey);
}

export function closePdf(key: string) {
  const p = docs.get(key);
  docs.delete(key);
  void p?.then((d) => d.destroy()).catch(() => undefined);
}

/** Seitengrößen in pt (PDF-Einheiten = pt), inkl. Seitendrehung. */
export async function pageSizes(doc: PDFDocumentProxy): Promise<{ w: number; h: number }[]> {
  const out: { w: number; h: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    out.push({ w: Math.round(vp.width * 100) / 100, h: Math.round(vp.height * 100) / 100 });
  }
  return out;
}

// ------------------------------------------------------------ Render-Stufen & Cache

export const MAX_RENDER_EDGE = 4096;

/** Render-Maßstab: nächste √2-Stufe ≥ Bedarf, begrenzt auf MAX_RENDER_EDGE. */
export function scaleBucket(cssWidth: number, pageW: number, pageH: number, dpr = window.devicePixelRatio || 1): number {
  const need = Math.max(0.1, (cssWidth * dpr) / pageW);
  const bucket = Math.pow(Math.SQRT2, Math.ceil(Math.log(need) / Math.log(Math.SQRT2)));
  const cap = MAX_RENDER_EDGE / Math.max(pageW, pageH);
  return Math.min(bucket, cap);
}

const MAX_CACHE_PIXELS = 48_000_000; // ≈ 190 MB RGBA
const cache = new Map<string, HTMLCanvasElement>();
let cachePixels = 0;

function cachePut(key: string, c: HTMLCanvasElement) {
  cache.set(key, c);
  cachePixels += c.width * c.height;
  for (const [k, v] of cache) {
    if (cachePixels <= MAX_CACHE_PIXELS || k === key) break;
    cache.delete(k);
    cachePixels -= v.width * v.height;
  }
}

function cacheGet(key: string): HTMLCanvasElement | undefined {
  const c = cache.get(key);
  if (c) {
    cache.delete(key); // LRU: ans Ende
    cache.set(key, c);
  }
  return c;
}

/** Beste bereits gerenderte Stufe einer Seite (als Platzhalter während die bessere lädt). */
export function bestCached(asset: string, page: number): HTMLCanvasElement | undefined {
  let best: HTMLCanvasElement | undefined;
  const prefix = `${asset}:${page}:`;
  for (const [k, v] of cache) if (k.startsWith(prefix) && (!best || v.width > best.width)) best = v;
  return best;
}

// ------------------------------------------------------------ Warteschlange

interface Job {
  key: string;
  start: () => Promise<void>;
}
const queue: Job[] = [];
let active = 0;
const CONCURRENCY = 2;
const inflight = new Map<string, { promise: Promise<HTMLCanvasElement>; waiters: number; cancel: () => void }>();

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const job = queue.pop()!; // LIFO: zuletzt sichtbar gewordene Seite zuerst
    active++;
    void job.start().finally(() => {
      active--;
      pump();
    });
  }
}

/**
 * Rendert eine PDF-Seite im gegebenen Maßstab (gecacht, dedupliziert).
 * Abbruch über `signal`: hängt niemand mehr an der Anfrage, wird das Rendern gestoppt.
 */
export function renderPdfPage(asset: string, page: number, scale: number, signal: AbortSignal): Promise<HTMLCanvasElement> {
  const key = `${asset}:${page}:${scale.toFixed(4)}`;
  const hit = cacheGet(key);
  if (hit) return Promise.resolve(hit);
  let entry = inflight.get(key);
  if (!entry) {
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    let queued: Job | null = null;
    const promise = new Promise<HTMLCanvasElement>((resolve, reject) => {
      queued = {
        key,
        start: async () => {
          if (cancelled) return reject(new DOMException('abgebrochen', 'AbortError'));
          try {
            const doc = await loadPdf(asset);
            const p = await doc.getPage(page);
            const viewport = p.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));
            const ctx = canvas.getContext('2d', { alpha: false })!;
            ctx.fillStyle = PDF_PAPER; // Papier der PDF selbst (Dokumentinhalt)
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            const t = p.render({ canvasContext: ctx, viewport, canvas });
            task = t;
            await t.promise;
            if (cancelled) throw new DOMException('abgebrochen', 'AbortError');
            cachePut(key, canvas);
            resolve(canvas);
          } catch (err) {
            reject(err);
          } finally {
            inflight.delete(key);
          }
        },
      };
      queue.push(queued);
      pump();
    });
    entry = {
      promise,
      waiters: 0,
      cancel: () => {
        cancelled = true;
        task?.cancel();
        const i = queued ? queue.indexOf(queued) : -1;
        if (i >= 0) {
          queue.splice(i, 1);
          inflight.delete(key);
        }
      },
    };
    entry.promise.catch(() => undefined);
    inflight.set(key, entry);
  }
  const e = entry;
  e.waiters++;
  signal.addEventListener(
    'abort',
    () => {
      e.waiters--;
      if (e.waiters <= 0) e.cancel();
    },
    { once: true },
  );
  return e.promise;
}
