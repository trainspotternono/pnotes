/**
 * Radierer (rein): „Gesamter Strich“ (Objekt-Radierer) und „Präzision“ (zerteilt Striche).
 * Der Radierer wird als Segment a→b (letzte bis aktuelle Position) mit Radius r getestet,
 * damit schnelle Bewegungen keine Lücken lassen.
 */
import type { PageObject, Stroke } from '../../shared/types';
import { newId } from '../lib/ids';
import { maxHalfWidth, pointCount, strokeBBox, widthFactor } from './geometry';
import { distToShape } from './shapes';

/** Radierer auf Formen: getroffene Formen werden ganz entfernt (Texte/Bilder bleiben). */
export function eraseShapes(objects: PageObject[], a: Pt, b: Pt, r: number): PageObject[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(len / Math.max(1, r)));
  let changed = false;
  const out = objects.filter((o) => {
    if (o.type !== 'shape' || o.engraved) return true;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (distToShape(o, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) <= r + o.width / 2) {
        changed = true;
        return false;
      }
    }
    return true;
  });
  return changed ? out : objects;
}

export interface Pt {
  x: number;
  y: number;
}

export interface EraseOptions {
  highlighterOnly?: boolean;
}

/** Abstand Punkt p ↔ Segment ab. */
export function distPointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function segmentsIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Minimaler Abstand zweier Segmente ab und cd. */
export function distSegSeg(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distPointSeg(ax, ay, cx, cy, dx, dy),
    distPointSeg(bx, by, cx, cy, dx, dy),
    distPointSeg(cx, cy, ax, ay, bx, by),
    distPointSeg(dx, dy, ax, ay, bx, by),
  );
}

const halfWidthAt = (s: Stroke, i: number) =>
  s.tool === 'highlighter' ? s.width / 2 : (s.width * widthFactor(s.points[i * 3 + 2], s.penStyle)) / 2;

function bboxNear(s: Stroke, a: Pt, b: Pt, r: number): boolean {
  const bb = strokeBBox(s);
  return !(Math.max(a.x, b.x) + r < bb.minX || Math.min(a.x, b.x) - r > bb.maxX || Math.max(a.y, b.y) + r < bb.minY || Math.min(a.y, b.y) - r > bb.maxY);
}

/** Eingravierte Striche sind für den Radierer tabu (nur „Seite leeren“ oder Rückgängig entfernt sie). */
const eligible = (s: Stroke, o: EraseOptions) => !s.engraved && (!o.highlighterOnly || s.tool === 'highlighter');

/** Trifft der Radierer den Strich? */
export function strokeHit(s: Stroke, a: Pt, b: Pt, r: number): boolean {
  if (!bboxNear(s, a, b, r)) return false;
  const n = pointCount(s.points);
  const P = s.points;
  if (n === 1) return distPointSeg(P[0], P[1], a.x, a.y, b.x, b.y) <= r + halfWidthAt(s, 0);
  for (let i = 0; i < n - 1; i++) {
    const hw = Math.max(halfWidthAt(s, i), halfWidthAt(s, i + 1));
    if (distSegSeg(P[i * 3], P[i * 3 + 1], P[i * 3 + 3], P[i * 3 + 4], a.x, a.y, b.x, b.y) <= r + hw) return true;
  }
  return false;
}

/** Objekt-Radierer: entfernt getroffene Striche ganz. Gibt dasselbe Array zurück, wenn nichts passiert. */
export function eraseWhole(strokes: Stroke[], a: Pt, b: Pt, r: number, o: EraseOptions = {}): Stroke[] {
  let changed = false;
  const out = strokes.filter((s) => {
    const hit = eligible(s, o) && strokeHit(s, a, b, r);
    if (hit) changed = true;
    return !hit;
  });
  return changed ? out : strokes;
}

/** Präzisions-Radierer: entfernt nur Punkte im Radiererbereich und teilt Striche auf. */
export function erasePrecise(strokes: Stroke[], a: Pt, b: Pt, r: number, o: EraseOptions = {}): Stroke[] {
  let changed = false;
  const out: Stroke[] = [];
  for (const s of strokes) {
    if (!eligible(s, o) || !bboxNear(s, a, b, r + maxHalfWidth(s))) {
      out.push(s);
      continue;
    }
    const n = pointCount(s.points);
    const keep: boolean[] = new Array(n);
    let removed = 0;
    for (let i = 0; i < n; i++) {
      const hit = distPointSeg(s.points[i * 3], s.points[i * 3 + 1], a.x, a.y, b.x, b.y) <= r + halfWidthAt(s, i) * 0.5;
      keep[i] = !hit;
      if (hit) removed++;
    }
    if (removed === 0) {
      out.push(s);
      continue;
    }
    changed = true;
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 6) out.push({ ...s, id: newId(), points: run });
      run = [];
    };
    for (let i = 0; i < n; i++) {
      if (keep[i]) run.push(s.points[i * 3], s.points[i * 3 + 1], s.points[i * 3 + 2]);
      else flush();
    }
    flush();
  }
  return changed ? out : strokes;
}
