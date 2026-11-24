/**
 * Ähnlichkeitstransformationen (Verschieben, gleichmäßig Skalieren, Drehen) für alle
 * Seitenobjekte. Matrix in Canvas-Konvention: x' = a·x + c·y + e, y' = b·x + d·y + f.
 */
import type { ImageObj, PageObject, ShapeObj, Stroke, TextObj } from '../../shared/types';

export interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** m2 ∘ m1 (erst m1, dann m2) */
export function compose(m2: Mat, m1: Mat): Mat {
  return {
    a: m2.a * m1.a + m2.c * m1.b,
    b: m2.b * m1.a + m2.d * m1.b,
    c: m2.a * m1.c + m2.c * m1.d,
    d: m2.b * m1.c + m2.d * m1.d,
    e: m2.a * m1.e + m2.c * m1.f + m2.e,
    f: m2.b * m1.e + m2.d * m1.f + m2.f,
  };
}

export const translate = (dx: number, dy: number): Mat => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });

export function scaleAbout(s: number, ox: number, oy: number): Mat {
  return { a: s, b: 0, c: 0, d: s, e: ox - s * ox, f: oy - s * oy };
}

export function rotateAbout(theta: number, ox: number, oy: number): Mat {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return { a: cos, b: sin, c: -sin, d: cos, e: ox - cos * ox + sin * oy, f: oy - sin * ox - cos * oy };
}

export const apply = (m: Mat, x: number, y: number): [number, number] => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
export const scaleOf = (m: Mat) => Math.hypot(m.a, m.b);
export const angleOf = (m: Mat) => Math.atan2(m.b, m.a);
export const isIdentity = (m: Mat) =>
  Math.abs(m.a - 1) < 1e-9 && Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9 && Math.abs(m.d - 1) < 1e-9 && Math.abs(m.e) < 1e-9 && Math.abs(m.f) < 1e-9;

function mapPairs(m: Mat, pts: number[], stride: number): number[] {
  const out = pts.slice();
  for (let i = 0; i + 1 < pts.length; i += stride) {
    const [x, y] = apply(m, pts[i], pts[i + 1]);
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

export function transformStroke(s: Stroke, m: Mat): Stroke {
  const k = scaleOf(m);
  return {
    ...s,
    points: mapPairs(m, s.points, 3),
    width: s.width * k,
    dashArray: s.dashArray ? s.dashArray.map((v) => v * k) : s.dashArray,
  };
}

export function transformObject(o: PageObject, m: Mat): PageObject {
  const k = scaleOf(m);
  if (o.type === 'shape') {
    const sh: ShapeObj = { ...o, points: mapPairs(m, o.points, 2), width: o.width * k, dashArray: o.dashArray ? o.dashArray.map((v) => v * k) : o.dashArray };
    return sh;
  }
  const [cx, cy] = apply(m, o.cx, o.cy);
  const rotation = o.rotation + (angleOf(m) * 180) / Math.PI;
  if (o.type === 'text') {
    const t: TextObj = { ...o, cx, cy, w: o.w * k, h: o.h * k, size: o.size * k, rotation };
    return t;
  }
  const im: ImageObj = { ...o, cx, cy, w: o.w * k, h: o.h * k, rotation };
  return im;
}

/** Ecken eines gedrehten Rechtecks (Mittelpunkt, Größe, Grad). */
export function rotatedCorners(cx: number, cy: number, w: number, h: number, deg: number): [number, number][] {
  const t = (deg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos] as [number, number]);
}

/** Gedrehter Rahmen (für Auswahl-Anzeige). */
export interface Frame {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Bogenmaß */
  angle: number;
}

export function transformFrame(f: Frame, m: Mat): Frame {
  const [cx, cy] = apply(m, f.cx, f.cy);
  const k = scaleOf(m);
  return { cx, cy, w: f.w * k, h: f.h * k, angle: f.angle + angleOf(m) };
}

export function frameCorners(f: Frame): [number, number][] {
  return rotatedCorners(f.cx, f.cy, f.w, f.h, (f.angle * 180) / Math.PI);
}
