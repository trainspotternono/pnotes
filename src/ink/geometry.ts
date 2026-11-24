/**
 * Strich-Geometrie (rein, ohne DOM): Druck → Breite, Glättung, Outline als
 * Vereinigung von Kreisen + Verbindungsvierecken (artefaktfrei bei variabler Breite).
 */
import type { LineStyle, PenStyle, Stroke } from '../../shared/types';

export const POINT_STRIDE = 3; // x, y, pressure

/**
 * Breitenfaktor aus Druck (0..1). Druck 0.5 ergibt die Grundbreite.
 *   ballpoint: konstante Breite
 *   fountain:  druckempfindlich (0.35×–1.65×)
 *   brush:     stark druckempfindlich (0.1×–2.3×), dazu Verjüngung an den Enden
 */
export function widthFactor(pressure: number, style: PenStyle | undefined): number {
  const p = Math.min(1, Math.max(0, pressure));
  if (style === 'ballpoint') return 1;
  if (style === 'brush') return 0.1 + 2.2 * Math.pow(p, 1.4);
  return 0.35 + 1.3 * p;
}

/** Strichmuster für Linienstile, relativ zur Linienbreite (Werte in pt). */
export function dashArrayFor(style: LineStyle | undefined, width: number): number[] | null {
  if (style === 'dashed') return [Math.max(3, width * 3), Math.max(2.5, width * 2.2)];
  if (style === 'dotted') return [0.01, Math.max(2.5, width * 2)];
  return null;
}

export function pointCount(points: number[]): number {
  return Math.floor(points.length / POINT_STRIDE);
}

/**
 * Glättet den Druck (EMA) und unterteilt Segmente per Catmull-Rom, sodass der
 * Strich auch bei starkem Zoom rund wirkt. Ergebnis: flaches [x, y, w]-Array.
 */
export function smoothCenterline(points: number[], baseWidth: number, style: PenStyle | undefined, maxStep = 1.2): number[] {
  const n = pointCount(points);
  if (n === 0) return [];
  const xs: number[] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  let ema = points[2];
  for (let i = 0; i < n; i++) {
    const p = points[i * 3 + 2];
    ema = i === 0 ? p : ema * 0.6 + p * 0.4;
    xs.push(points[i * 3]);
    ys.push(points[i * 3 + 1]);
    ws.push(baseWidth * widthFactor(ema, style));
  }
  if (n === 1) return [xs[0], ys[0], ws[0]];
  if (style === 'brush') {
    // Pinsel: weiche Verjüngung an Anfang und Ende
    const taper = Math.min(8, Math.floor(n / 3));
    for (let i = 0; i < taper; i++) {
      const k = 0.25 + (0.75 * (i + 1)) / (taper + 1);
      ws[i] *= k;
      ws[n - 1 - i] *= k;
    }
  }

  const out: number[] = [xs[0], ys[0], ws[0]];
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(0, i - 1);
    const i3 = Math.min(n - 1, i + 2);
    const len = Math.hypot(xs[i + 1] - xs[i], ys[i + 1] - ys[i]);
    const steps = Math.max(1, Math.min(24, Math.ceil(len / maxStep)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push(catmull(xs[i0], xs[i], xs[i + 1], xs[i3], t), catmull(ys[i0], ys[i], ys[i + 1], ys[i3], t), ws[i] + (ws[i + 1] - ws[i]) * t);
    }
  }
  return out;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export interface PenOutline {
  /** [x, y, r, …] */
  circles: number[];
  /** je 8 Werte: 4 Eckpunkte, im Uhrzeigersinn (gleiche Orientierung wie die Kreise) */
  quads: number[];
}

export function penOutline(centerline: number[]): PenOutline {
  const circles: number[] = [];
  const quads: number[] = [];
  const n = centerline.length / 3;
  for (let i = 0; i < n; i++) {
    const x = centerline[i * 3];
    const y = centerline[i * 3 + 1];
    const r = Math.max(0.15, centerline[i * 3 + 2] / 2);
    circles.push(x, y, r);
    if (i === 0) continue;
    const px = centerline[(i - 1) * 3];
    const py = centerline[(i - 1) * 3 + 1];
    const pr = Math.max(0.15, centerline[(i - 1) * 3 + 2] / 2);
    const dx = x - px;
    const dy = y - py;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = -dy / len;
    const ny = dx / len;
    const q = [px + nx * pr, py + ny * pr, x + nx * r, y + ny * r, x - nx * r, y - ny * r, px - nx * pr, py - ny * pr];
    if (signedArea(q) < 0) {
      quads.push(q[6], q[7], q[4], q[5], q[2], q[3], q[0], q[1]);
    } else {
      quads.push(...q);
    }
  }
  return { circles, quads };
}

/** Shoelace-Fläche (y nach unten): positiv = im Uhrzeigersinn auf dem Bildschirm, wie canvas.arc(…, false). */
export function signedArea(q: number[]): number {
  let a = 0;
  for (let i = 0; i < q.length; i += 2) {
    const j = (i + 2) % q.length;
    a += q[i] * q[j + 1] - q[j] * q[i + 1];
  }
  return a / 2;
}

/**
 * Nach dem Zeichnen: sehr dichte Punkte ausdünnen (< minDist) und lange Segmente
 * auffüllen (> maxDist), damit der Präzisionsradierer überall greifen kann.
 */
export function normalizePoints(points: number[], minDist = 0.35, maxDist = 2.5): number[] {
  const n = pointCount(points);
  if (n === 0) return [];
  const out = [points[0], points[1], points[2]];
  for (let i = 1; i < n; i++) {
    const x = points[i * 3];
    const y = points[i * 3 + 1];
    const p = points[i * 3 + 2];
    const lx = out[out.length - 3];
    const ly = out[out.length - 2];
    const lp = out[out.length - 1];
    const d = Math.hypot(x - lx, y - ly);
    if (d < minDist && i < n - 1) continue;
    if (d > maxDist) {
      const steps = Math.ceil(d / maxDist);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        out.push(lx + (x - lx) * t, ly + (y - ly) * t, lp + (p - lp) * t);
      }
    }
    out.push(x, y, p);
  }
  if (pointCount(out) === 1) out.push(out[0] + 0.01, out[1], out[2]); // Tippen = Punkt
  return out;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const bboxCache = new WeakMap<Stroke, BBox>();

/** Bounding-Box inkl. halber maximaler Strichbreite (gecacht pro unveränderlichem Strich). */
export function strokeBBox(s: Stroke): BBox {
  let b = bboxCache.get(s);
  if (b) return b;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < s.points.length; i += 3) {
    minX = Math.min(minX, s.points[i]);
    maxX = Math.max(maxX, s.points[i]);
    minY = Math.min(minY, s.points[i + 1]);
    maxY = Math.max(maxY, s.points[i + 1]);
  }
  const pad = maxHalfWidth(s);
  b = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  bboxCache.set(s, b);
  return b;
}

export function maxHalfWidth(s: Stroke): number {
  return s.tool === 'highlighter' ? s.width / 2 : (s.width * widthFactor(1, s.penStyle)) / 2;
}
