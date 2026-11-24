/**
 * Seitenlayout und Koordinaten-Umrechnung des Editors (rein, testbar).
 * Dokumentkoordinaten = pt. Bildschirm = CSS-px relativ zum Viewport.
 */
export type ScrollDirection = 'vertical' | 'horizontal';

export const PAGE_GAP = 24; // pt
export const PAGE_PADDING = 40; // pt
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 6;

export interface PageRect {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  pages: PageRect[];
  /** Gesamtgröße aller Seiten inkl. Abständen (ohne Rand), pt */
  width: number;
  height: number;
  direction: ScrollDirection;
}

/**
 * Seitenlayout mit individueller Größe je Seite (z. B. importierte PDF-Seiten).
 * Vertikal: Seiten untereinander, horizontal zentriert; horizontal: nebeneinander, vertikal zentriert.
 */
export function computeLayout(sizes: { w: number; h: number }[], direction: ScrollDirection): Layout {
  const pages: PageRect[] = [];
  const maxW = Math.max(0, ...sizes.map((s) => s.w));
  const maxH = Math.max(0, ...sizes.map((s) => s.h));
  let pos = 0;
  sizes.forEach(({ w, h }, i) => {
    pages.push(direction === 'vertical' ? { index: i, x: (maxW - w) / 2, y: pos, w, h } : { index: i, x: pos, y: (maxH - h) / 2, w, h });
    pos += (direction === 'vertical' ? h : w) + PAGE_GAP;
  });
  const span = Math.max(0, pos - PAGE_GAP);
  return direction === 'vertical' ? { pages, width: maxW, height: span, direction } : { pages, width: span, height: maxH, direction };
}

export interface ViewMetrics {
  zoom: number;
  viewportW: number;
  viewportH: number;
}

/** Versatz des Dokumentursprungs im Scrollinhalt (zentriert, wenn kleiner als der Viewport). */
export function contentOffset(layout: Layout, m: ViewMetrics): { x: number; y: number; scrollW: number; scrollH: number } {
  const pad = PAGE_PADDING * m.zoom;
  const w = layout.width * m.zoom;
  const h = layout.height * m.zoom;
  const x = Math.max(pad, (m.viewportW - w) / 2);
  const y = Math.max(pad, (m.viewportH - h) / 2);
  return { x, y, scrollW: Math.max(m.viewportW, w + 2 * x), scrollH: Math.max(m.viewportH, h + 2 * y) };
}

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Viewport-Punkt → Dokumentpunkt. */
export function screenToDoc(layout: Layout, m: ViewMetrics, scroll: { left: number; top: number }, sx: number, sy: number) {
  const o = contentOffset(layout, m);
  return { x: (scroll.left + sx - o.x) / m.zoom, y: (scroll.top + sy - o.y) / m.zoom };
}

/** Scrollposition, damit der Dokumentpunkt (dx, dy) nach dem Zoomen unter (sx, sy) bleibt. */
export function scrollForAnchor(layout: Layout, m: ViewMetrics, dx: number, dy: number, sx: number, sy: number) {
  const o = contentOffset(layout, m);
  return { left: dx * m.zoom + o.x - sx, top: dy * m.zoom + o.y - sy };
}

/** Seite unter einem Dokumentpunkt (oder null). */
export function pageAt(layout: Layout, x: number, y: number): PageRect | null {
  for (const p of layout.pages) {
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return p;
  }
  return null;
}

/** Seite, die der Mitte des sichtbaren Bereichs am nächsten liegt. */
export function nearestPage(layout: Layout, x: number, y: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (const p of layout.pages) {
    const cx = Math.max(p.x, Math.min(x, p.x + p.w));
    const cy = Math.max(p.y, Math.min(y, p.y + p.h));
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p.index;
    }
  }
  return best;
}

/** Sichtbare Seiten (Dokument-Rechteck des Viewports, mit Vorlauf). */
export function visiblePages(layout: Layout, view: { x: number; y: number; w: number; h: number }, margin = 0): PageRect[] {
  return layout.pages.filter(
    (p) => p.x + p.w >= view.x - margin && p.x <= view.x + view.w + margin && p.y + p.h >= view.y - margin && p.y <= view.y + view.h + margin,
  );
}

/** Zoom, bei dem die Seitenbreite (bzw. ganze Seite) in den Viewport passt. */
export function fitZoom(w: number, h: number, viewportW: number, viewportH: number, mode: 'width' | 'page'): number {
  const zw = viewportW / (w + 2 * PAGE_PADDING);
  if (mode === 'width') return clampZoom(zw);
  return clampZoom(Math.min(zw, viewportH / (h + 2 * PAGE_PADDING)));
}
