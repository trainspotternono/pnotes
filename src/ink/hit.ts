/** Treffertests, Begrenzungsrahmen und Lasso-Auswahl (rein, testbar). */
import type { Page, PageObject, Stroke } from '../../shared/types';
import { strokeHit } from './erase';
import { strokeBBox } from './geometry';
import { distToShape, isClosedKind, pointInPolygon, shapeOutline } from './shapes';
import { rotatedCorners } from './transform';

export interface ItemRefs {
  strokeIds: string[];
  objectIds: string[];
}

export const emptyRefs = (): ItemRefs => ({ strokeIds: [], objectIds: [] });
export const refsCount = (r: ItemRefs) => r.strokeIds.length + r.objectIds.length;

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function objectPoints(o: PageObject): number[] {
  if (o.type === 'shape') return shapeOutline(o).pts;
  return rotatedCorners(o.cx, o.cy, o.w, o.h, o.rotation).flat();
}

function boxOf(points: number[], pad = 0, stride = 2): Box {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i + 1 < points.length; i += stride) {
    b.minX = Math.min(b.minX, points[i]);
    b.maxX = Math.max(b.maxX, points[i]);
    b.minY = Math.min(b.minY, points[i + 1]);
    b.maxY = Math.max(b.maxY, points[i + 1]);
  }
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

export function objectBox(o: PageObject): Box {
  return boxOf(objectPoints(o), o.type === 'shape' ? o.width / 2 : 0);
}

export function union(a: Box | null, b: Box): Box {
  if (!a) return b;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

/** Begrenzungsrahmen der Auswahl (null, wenn leer). */
export function refsBox(page: Page, refs: ItemRefs): Box | null {
  let box: Box | null = null;
  const sIds = new Set(refs.strokeIds);
  const oIds = new Set(refs.objectIds);
  for (const s of page.strokes) if (sIds.has(s.id)) box = union(box, strokeBBox(s));
  for (const o of page.objects) if (oIds.has(o.id)) box = union(box, objectBox(o));
  return box;
}

/** Punkt in gedrehtem Rechteck? */
function inRotatedRect(o: { cx: number; cy: number; w: number; h: number; rotation: number }, x: number, y: number, tol: number): boolean {
  const t = (-o.rotation * Math.PI) / 180;
  const dx = x - o.cx;
  const dy = y - o.cy;
  const u = dx * Math.cos(t) - dy * Math.sin(t);
  const v = dx * Math.sin(t) + dy * Math.cos(t);
  return Math.abs(u) <= o.w / 2 + tol && Math.abs(v) <= o.h / 2 + tol;
}

/** Oberstes (nicht eingraviertes) Objekt unter (x, y), optional nach Typ gefiltert. */
export function hitObject(page: Page, x: number, y: number, tol: number, types?: PageObject['type'][]): PageObject | null {
  for (let i = page.objects.length - 1; i >= 0; i--) {
    const o = page.objects[i];
    if (o.engraved) continue;
    if (types && !types.includes(o.type)) continue;
    if (o.type === 'shape') {
      if (distToShape(o, x, y) <= tol + o.width / 2) return o;
      if (o.fill && isClosedKind(o.kind) && pointInPolygon(x, y, shapeOutline(o).pts)) return o;
    } else if (inRotatedRect(o, x, y, tol)) {
      return o;
    }
  }
  return null;
}

/** Oberster (nicht eingravierter) Strich unter (x, y). */
export function hitStroke(page: Page, x: number, y: number, tol: number): Stroke | null {
  const pt = { x, y };
  for (let i = page.strokes.length - 1; i >= 0; i--) {
    const s = page.strokes[i];
    if (!s.engraved && strokeHit(s, pt, pt, tol)) return s;
  }
  return null;
}

/**
 * Oberstes Element unter (x, y) in Zeichenreihenfolge (Texte/Haftnotizen über Tinte über Formen über Bildern).
 * Für das Auswahl-Werkzeug.
 */
export function hitItem(page: Page, x: number, y: number, tol: number): ItemRefs | null {
  const text = hitObject(page, x, y, tol, ['text']);
  if (text) return { strokeIds: [], objectIds: [text.id] };
  const s = hitStroke(page, x, y, tol);
  if (s) return { strokeIds: [s.id], objectIds: [] };
  const o = hitObject(page, x, y, tol, ['shape']) ?? hitObject(page, x, y, tol, ['image']);
  return o ? { strokeIds: [], objectIds: [o.id] } : null;
}

function strokeInside(s: Stroke, poly: number[]): boolean {
  const n = s.points.length / 3;
  let inside = 0;
  for (let i = 0; i < n; i++) if (pointInPolygon(s.points[i * 3], s.points[i * 3 + 1], poly)) inside++;
  return inside / n >= 0.5;
}

/** Lasso: Striche mit ≥ 50 % Punkten innen, Formen/Texte/Bilder mit Mittelpunkt bzw. ≥ 50 % Umriss innen. */
export function lassoSelect(page: Page, poly: number[]): ItemRefs {
  if (poly.length < 6) return emptyRefs();
  const lb = boxOf(poly);
  const strokeIds = page.strokes
    .filter((s) => {
      if (s.engraved) return false;
      const b = strokeBBox(s);
      return !(b.maxX < lb.minX || b.minX > lb.maxX || b.maxY < lb.minY || b.minY > lb.maxY) && strokeInside(s, poly);
    })
    .map((s) => s.id);
  const objectIds = page.objects
    .filter((o) => {
      if (o.engraved) return false;
      if (o.type === 'shape') {
        const pts = shapeOutline(o).pts;
        let inside = 0;
        for (let i = 0; i < pts.length; i += 2) if (pointInPolygon(pts[i], pts[i + 1], poly)) inside++;
        return inside / (pts.length / 2) >= 0.5;
      }
      return pointInPolygon(o.cx, o.cy, poly);
    })
    .map((o) => o.id);
  return { strokeIds, objectIds };
}
