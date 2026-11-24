/**
 * Formenerkennung („Zeichnen und Halten“) und Formgeometrie (rein, testbar).
 * Eingabe: Freihandpunkte [x, y, …]. Ausgabe: geometrisch saubere Form.
 */
import type { ShapeKind, ShapeObj } from '../../shared/types';

export interface Recognized {
  kind: ShapeKind;
  points: number[];
}

type P = [number, number];

const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function toPts(xy: number[], stride: number): P[] {
  const out: P[] = [];
  for (let i = 0; i + 1 < xy.length; i += stride) out.push([xy[i], xy[i + 1]]);
  return out;
}

function pathLength(pts: P[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

function bboxDiag(pts: P[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

function distToSegment(p: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Gleichmäßig entlang der Bogenlänge neu abtasten. */
export function resample(pts: P[], n: number): P[] {
  const L = pathLength(pts);
  if (L === 0 || pts.length < 2) return pts.slice();
  const step = L / (n - 1);
  const out: P[] = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length && out.length < n; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let d = dist(a, b);
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d;
      const q: P = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(q);
      a = q;
      d = dist(a, b);
      acc = 0;
    }
    acc += d;
  }
  while (out.length < n) out.push(pts[pts.length - 1]);
  return out;
}

/** Ramer-Douglas-Peucker (offener Linienzug). */
export function rdp(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

function angleAt(prev: P, cur: P, next: P): number {
  const a1 = Math.atan2(prev[1] - cur[1], prev[0] - cur[0]);
  const a2 = Math.atan2(next[1] - cur[1], next[0] - cur[0]);
  let d = Math.abs(a1 - a2);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return (d * 180) / Math.PI;
}

/** Eckpunkte eines geschlossenen Zugs (RDP ab dem vom Schwerpunkt entferntesten Punkt). */
function closedVertices(pts: P[], eps: number): P[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let start = 0;
  let best = -1;
  pts.forEach((p, i) => {
    const d = Math.hypot(p[0] - cx, p[1] - cy);
    if (d > best) {
      best = d;
      start = i;
    }
  });
  const loop = [...pts.slice(start), ...pts.slice(0, start), pts[start]];
  let v = rdp(loop, eps).slice(0, -1);
  const minEdge = eps * 1.8; // ≈ 10 % der Diagonale
  let changed = true;
  while (changed && v.length > 3) {
    changed = false;
    // fast gerade Ecken (> 155°) entfernen
    for (let i = 0; i < v.length; i++) {
      const ang = angleAt(v[(i - 1 + v.length) % v.length], v[i], v[(i + 1) % v.length]);
      if (ang > 155) {
        v = v.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
    if (changed || v.length <= 3) continue;
    // sehr kurze Kanten (Lücke/Überschießen am Schlusspunkt) zu einer Ecke zusammenführen
    let shortest = -1;
    let len = Infinity;
    for (let i = 0; i < v.length; i++) {
      const d = dist(v[i], v[(i + 1) % v.length]);
      if (d < len) {
        len = d;
        shortest = i;
      }
    }
    if (len < minEdge) {
      const a = v[shortest];
      const b = v[(shortest + 1) % v.length];
      const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const removed = (shortest + 1) % v.length;
      v = v.map((p, j) => (j === shortest ? mid : p)).filter((_, j) => j !== removed);
      changed = true;
    }
  }
  return v;
}

const flat = (pts: P[]) => pts.flatMap((p) => [p[0], p[1]]);

function snapAngle(a: P, b: P, tolDeg = 5): P {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const deg = (ang * 180) / Math.PI;
  const snapped = Math.round(deg / 45) * 45;
  if (Math.abs(deg - snapped) > tolDeg) return b;
  const len = dist(a, b);
  const r = (snapped * Math.PI) / 180;
  return [a[0] + Math.cos(r) * len, a[1] + Math.sin(r) * len];
}

interface EllipseFit {
  cx: number;
  cy: number;
  a: number;
  b: number;
  angle: number;
  error: number;
}

/** Ellipse über Hauptachsen (Kovarianz) und Ausdehnung; Fehler = mittlere relative Radialabweichung. */
function fitEllipse(pts: P[]): EllipseFit {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [x, y] of pts) {
    const u = (x - mx) * cos + (y - my) * sin;
    const v = -(x - mx) * sin + (y - my) * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const a = (maxU - minU) / 2 || 1;
  const b = (maxV - minV) / 2 || 1;
  const cu = (maxU + minU) / 2;
  const cv = (maxV + minV) / 2;
  const cx = mx + cu * cos - cv * sin;
  const cy = my + cu * sin + cv * cos;
  let err = 0;
  for (const [x, y] of pts) {
    const u = (x - cx) * cos + (y - cy) * sin;
    const v = -(x - cx) * sin + (y - cy) * cos;
    err += Math.abs(Math.hypot(u / a, v / b) - 1);
  }
  return { cx, cy, a, b, angle, error: err / n };
}

// ------------------------------------------------------------ Ellipse aus Bogenstücken (Kegelschnitt-Fit)

/** Geometrische Ellipse: Mittelpunkt, Halbachsen a ≥ b, Winkel der Halbachse a. */
interface Ell {
  cx: number;
  cy: number;
  a: number;
  b: number;
  angle: number;
}

/** Determinante / Inverse 3×3 (zeilenweise als 9er-Array). */
function det3(m: number[]): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}
function inv3(m: number[]): number[] | null {
  const d = det3(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  return [
    (m[4] * m[8] - m[5] * m[7]) / d, (m[2] * m[7] - m[1] * m[8]) / d, (m[1] * m[5] - m[2] * m[4]) / d,
    (m[5] * m[6] - m[3] * m[8]) / d, (m[0] * m[8] - m[2] * m[6]) / d, (m[2] * m[3] - m[0] * m[5]) / d,
    (m[3] * m[7] - m[4] * m[6]) / d, (m[1] * m[6] - m[0] * m[7]) / d, (m[0] * m[4] - m[1] * m[3]) / d,
  ];
}
const mul3 = (a: number[], b: number[]) =>
  Array.from({ length: 9 }, (_, k) => {
    const i = Math.floor(k / 3);
    const j = k % 3;
    return a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  });
const tr3 = (m: number[]) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** Reelle Nullstellen von x³ + p2·x² + p1·x + p0. */
function cubicRoots(p2: number, p1: number, p0: number): number[] {
  const q = (3 * p1 - p2 * p2) / 9;
  const r = (9 * p2 * p1 - 27 * p0 - 2 * p2 * p2 * p2) / 54;
  const disc = q * q * q + r * r;
  const shift = -p2 / 3;
  if (disc > 0) {
    const s = Math.cbrt(r + Math.sqrt(disc));
    const t = Math.cbrt(r - Math.sqrt(disc));
    return [shift + s + t];
  }
  const th = Math.acos(Math.max(-1, Math.min(1, r / Math.sqrt(-q * q * q || 1e-300))));
  const m = 2 * Math.sqrt(-q);
  return [shift + m * Math.cos(th / 3), shift + m * Math.cos((th + 2 * Math.PI) / 3), shift + m * Math.cos((th + 4 * Math.PI) / 3)];
}

/**
 * Direkter Least-Squares-Ellipsenfit (Fitzgibbon, numerisch stabile Form nach Halíř & Flusser).
 * Liefert auch bei nur teilweise gezeichneten Ellipsen (Bogen ≥ ~⅔) Mittelpunkt, Achsen und Winkel.
 */
function fitConic(pts: P[]): Ell | null {
  const n = pts.length;
  if (n < 6) return null;
  // Normieren (Mittelwert 0, mittlerer Abstand 1) für numerische Stabilität
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  const sc = Math.sqrt(pts.reduce((s, p) => s + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / n) || 1;
  const S1 = new Array(9).fill(0);
  const S2 = new Array(9).fill(0);
  const S3 = new Array(9).fill(0);
  for (const [px, py] of pts) {
    const x = (px - mx) / sc;
    const y = (py - my) / sc;
    const d1 = [x * x, x * y, y * y];
    const d2 = [x, y, 1];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        S1[i * 3 + j] += d1[i] * d1[j];
        S2[i * 3 + j] += d1[i] * d2[j];
        S3[i * 3 + j] += d2[i] * d2[j];
      }
  }
  const S3i = inv3(S3);
  if (!S3i) return null;
  const T = mul3(S3i, tr3(S2)).map((v) => -v);
  const M = S1.map((v, k) => v + mul3(S2, T)[k]);
  // M ← C1⁻¹·M mit C1 = [[0,0,2],[0,-1,0],[2,0,0]]
  const R = [M[6] / 2, M[7] / 2, M[8] / 2, -M[3], -M[4], -M[5], M[0] / 2, M[1] / 2, M[2] / 2];
  // charakteristisches Polynom λ³ − tr·λ² + c1·λ − det
  const trace = R[0] + R[4] + R[8];
  const c1 = R[0] * R[4] - R[1] * R[3] + R[0] * R[8] - R[2] * R[6] + R[4] * R[8] - R[5] * R[7];
  let best: number[] | null = null;
  for (const lam of cubicRoots(-trace, c1, -det3(R))) {
    const r0 = [R[0] - lam, R[1], R[2]];
    const r1 = [R[3], R[4] - lam, R[5]];
    const r2 = [R[6], R[7], R[8] - lam];
    const cross = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const cands = [cross(r0, r1), cross(r0, r2), cross(r1, r2)];
    const v = cands.reduce((a, b) => (Math.hypot(...b) > Math.hypot(...a) ? b : a));
    if (4 * v[0] * v[2] - v[1] * v[1] > 0) best = v;
  }
  if (!best) return null;
  const a1 = best;
  const a2 = [T[0] * a1[0] + T[1] * a1[1] + T[2] * a1[2], T[3] * a1[0] + T[4] * a1[1] + T[5] * a1[2], T[6] * a1[0] + T[7] * a1[1] + T[8] * a1[2]];
  const [A, B, C] = a1;
  const [Dc, E, F] = a2;
  const den = B * B - 4 * A * C;
  if (den >= 0) return null;
  const ux = (2 * C * Dc - B * E) / den;
  const uy = (2 * A * E - B * Dc) / den;
  const K = -(A * ux * ux + B * ux * uy + C * uy * uy + Dc * ux + E * uy + F);
  // Hauptachsen über die Eigenwerte der quadratischen Form [[A, B/2], [B/2, C]]
  const h = Math.hypot((A - C) / 2, B / 2);
  const lBig = (A + C) / 2 + h;
  const lSmall = (A + C) / 2 - h;
  if (K / lBig <= 0 || K / lSmall <= 0) return null;
  const minor = Math.sqrt(K / lBig);
  const major = Math.sqrt(K / lSmall);
  const phiMinor = 0.5 * Math.atan2(B, A - C);
  return { cx: mx + ux * sc, cy: my + uy * sc, a: major * sc, b: minor * sc, angle: phiMinor + Math.PI / 2 };
}

/**
 * Abweichung der Punkte von einer Ellipse: mittlerer (≈ geometrischer) Abstand relativ zur mittleren Halbachse,
 * und die Winkelabdeckung (Grad) der Punkte um den Mittelpunkt.
 */
function ellipseResidual(pts: P[], e: Ell): { error: number; coverage: number } {
  const cos = Math.cos(e.angle);
  const sin = Math.sin(e.angle);
  let err = 0;
  const ts: number[] = [];
  for (const [x, y] of pts) {
    const u = (x - e.cx) * cos + (y - e.cy) * sin;
    const v = -(x - e.cx) * sin + (y - e.cy) * cos;
    const rho = Math.hypot(u / e.a, v / e.b);
    const t = Math.atan2(v / e.b, u / e.a);
    // ≈ geometrischer Abstand: radiale Abweichung × Abstand Mittelpunkt ↔ Ellipsenpunkt beim Parameter t
    err += Math.abs(rho - 1) * Math.hypot(e.a * Math.cos(t), e.b * Math.sin(t));
    ts.push(((t * 180) / Math.PI + 360) % 360);
  }
  ts.sort((p, q) => p - q);
  let gap = 360 - ts[ts.length - 1] + ts[0];
  for (let i = 1; i < ts.length; i++) gap = Math.max(gap, ts[i] - ts[i - 1]);
  return { error: err / pts.length / ((e.a + e.b) / 2), coverage: 360 - gap };
}

/** Gleitender Mittelwert (offener Zug), dämpft Zittern vor der Krümmungsanalyse. */
function smooth(pts: P[], w = 2): P[] {
  return pts.map((_, i) => {
    let sx = 0, sy = 0, c = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(pts.length - 1, i + w); j++) {
      sx += pts[j][0];
      sy += pts[j][1];
      c++;
    }
    return [sx / c, sy / c] as P;
  });
}

/**
 * Richtungsänderungen entlang eines Zugs: Summe (signiert/absolut), größte Knickstelle über 2 Schritte (Grad)
 * und Anteil fast gerader Schritte (Vielecke haben gerade Seiten zwischen den Ecken, Kreise/Ellipsen nicht).
 */
function turning(pts: P[]): { signed: number; abs: number; sharpest: number; flatFrac: number } {
  const turns: number[] = [];
  for (let i = 1; i + 1 < pts.length; i++) {
    const a1 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    const a2 = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    turns.push((d * 180) / Math.PI);
  }
  let sharpest = 0;
  for (let i = 0; i + 1 < turns.length; i++) sharpest = Math.max(sharpest, Math.abs(turns[i] + turns[i + 1]));
  const abs = turns.reduce((s, t) => s + Math.abs(t), 0);
  const mean = abs / (turns.length || 1);
  const flatFrac = turns.filter((t) => Math.abs(t) < 0.25 * mean).length / (turns.length || 1);
  return { signed: turns.reduce((s, t) => s + t, 0), abs, sharpest, flatFrac };
}

/** Kreis-/Ellipsen-Ergebnis: Kreis bei fast gleichen Achsen, sonst Ellipse (Winkel nahe 0°/90° einrasten). */
function ellipseShape(e: Ell): Recognized {
  let { a, b, angle } = e;
  if (b > a) [a, b, angle] = [b, a, angle + Math.PI / 2];
  if (b / a >= SHAPE_THRESHOLDS.circleRatio) {
    a = b = (a + b) / 2;
    angle = 0;
  } else {
    const deg = ((((angle * 180) / Math.PI) % 90) + 90) % 90;
    if (deg < 8 || deg > 82) angle = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
  }
  const ux = e.cx + Math.cos(angle) * a;
  const uy = e.cy + Math.sin(angle) * a;
  const vx = e.cx - Math.sin(angle) * b;
  const vy = e.cy + Math.cos(angle) * b;
  return { kind: 'ellipse', points: [e.cx, e.cy, ux, uy, vx, vy] };
}

/**
 * Nicht ganz geschlossener Kreis / Ellipse: gleichmäßig in eine Richtung gekrümmt, insgesamt mindestens
 * ≈ ⅔ Umlauf (Halbkreise und Bögen bleiben Freihand), keine Ecken, eng an einer Ellipse → wird vervollständigt.
 */
function recognizeArc(raw: P[], D: number): Recognized | null {
  const T = SHAPE_THRESHOLDS;
  const pts = resample(raw, 72);
  const tr = turning(resample(smooth(pts, 2), 32));
  const sweep = Math.abs(tr.signed);
  // grobe Vorauswahl über die Drehung (unterschätzt durch Glättung an den Enden); genau entscheidet die Abdeckung
  if (sweep < T.arcMinSweep || sweep > T.arcMaxSweep) return null;
  if (sweep / tr.abs < T.arcConsistency || tr.sharpest > T.arcMaxCorner || tr.flatFrac > T.arcMaxFlat) return null;
  const e = fitConic(pts);
  if (!e) return null;
  const major = Math.max(e.a, e.b);
  const minor = Math.min(e.a, e.b);
  if (minor / major < 0.2 || 2 * major > 1.6 * D || 2 * minor < 0.25 * D) return null;
  const res = ellipseResidual(pts, e);
  if (res.coverage < T.arcMinCoverage || res.error > T.arcError) return null;
  return ellipseShape(e);
}

/** Messwerte der Bogen-Erkennung (zum Abstimmen der Schwellenwerte). */
export function arcMetrics(xy: number[], stride = 3) {
  const raw = toPts(xy, stride);
  const pts = resample(raw, 72);
  const tr = turning(resample(smooth(pts, 2), 32));
  const e = fitConic(pts);
  const res = e ? ellipseResidual(pts, e) : null;
  return {
    sweep: Math.round(Math.abs(tr.signed)),
    consistency: +(Math.abs(tr.signed) / tr.abs).toFixed(2),
    sharpest: Math.round(tr.sharpest),
    flat: +tr.flatFrac.toFixed(2),
    axes: e ? [Math.round(Math.max(e.a, e.b)), Math.round(Math.min(e.a, e.b))] : null,
    diag: Math.round(bboxDiag(raw)),
    coverage: res ? Math.round(res.coverage) : null,
    error: res ? +res.error.toFixed(3) : null,
  };
}

/** Mittlerer Abstand der Punkte zu einem geschlossenen Eckpunktzug. */
function meanDistToPolygon(pts: P[], poly: P[]): number {
  const fp = flat(poly);
  return pts.reduce((s, p) => s + distToShape({ kind: 'polygon', points: fp }, p[0], p[1]), 0) / pts.length;
}

/** Wert am Quantil q (0..1) einer sortierten Liste. */
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

interface RectFit {
  corners: P[];
  w: number;
  h: number;
  /** mittlerer Abstand zum Rechteck, relativ zur mittleren Seitenlänge */
  error: number;
}

/**
 * Ausgerichtetes Rechteck: dominante Kantenrichtung (Winkel mod 90°, gewichtet nach Länge),
 * dann Ausdehnung im gedrehten Rahmen (2.–98. Perzentil, robust gegen Überzeichnen an den Ecken).
 * Funktioniert auch bei abgerundeten Ecken.
 */
function fitRect(pts: P[]): RectFit {
  let sx = 0;
  let sy = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const len = Math.hypot(dx, dy);
    if (!len) continue;
    const a = Math.atan2(dy, dx) * 4;
    sx += Math.cos(a) * len;
    sy += Math.sin(a) * len;
  }
  let theta = Math.atan2(sy, sx) / 4;
  if (Math.abs(theta) < (8 * Math.PI) / 180) theta = 0;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const rot = pts.map(([x, y]): P => [x * cos + y * sin, -x * sin + y * cos]);
  const xs = rot.map((p) => p[0]).sort((a, b) => a - b);
  const ys = rot.map((p) => p[1]).sort((a, b) => a - b);
  let x0 = quantile(xs, 0.02);
  let x1 = quantile(xs, 0.98);
  let y0 = quantile(ys, 0.02);
  let y1 = quantile(ys, 0.98);
  const back = (p: P): P => [p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos];
  const w = x1 - x0;
  const h = y1 - y0;
  const corners = [back([x0, y0]), back([x1, y0]), back([x1, y1]), back([x0, y1])];
  const error = w > 0 && h > 0 ? meanDistToPolygon(pts, corners) / ((w + h) / 2) : Infinity;
  if (w > 0 && h > 0 && Math.abs(w - h) / Math.max(w, h) <= SQUARE_TOLERANCE) {
    // Quadrat: gleiche Seitenlängen um den Mittelpunkt
    const s = (w + h) / 2;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    x0 = mx - s / 2;
    x1 = mx + s / 2;
    y0 = my - s / 2;
    y1 = my + s / 2;
    return { corners: [back([x0, y0]), back([x1, y0]), back([x1, y1]), back([x0, y1])], w: s, h: s, error };
  }
  return { corners, w, h, error };
}

/** Schwellenwerte der Formenerkennung (bewusst streng: im Zweifel bleibt der Strich Freihand). */
export const SHAPE_THRESHOLDS = {
  /** Abstand Start↔Ende relativ zur Diagonale, ab dem ein Strich als geschlossen gilt */
  closeGap: 0.16,
  /** größere Lücke erlaubt, wenn sie höchstens diesen Anteil der Strichlänge ausmacht */
  closeGapLoose: 0.5,
  closeGapOfLength: 0.22,
  /** Linie: maximale Abweichung von der Sehne (relativ) und Umweg-Faktor */
  lineDeviation: 0.045,
  lineDetour: 1.12,
  /** Dreieck: mittlerer Abstand zu den 3 Seiten (relativ), Mindestwinkel */
  triangleError: 0.05,
  triangleMinAngle: 14,
  /** Rechteck: mittlerer Abstand zum Rechteck (relativ) und Vorsprung vor der Ellipse */
  rectError: 0.045,
  /** wie oben, wenn 4 klare rechte Winkel erkannt wurden (starkes Indiz → etwas mehr Toleranz) */
  rectErrorWithCorners: 0.07,
  rectVsEllipse: 0.75,
  /** Rechteck mit 4 Ecken: erlaubte Abweichung jedes Winkels von 90° */
  rectAngleTolerance: 15,
  /** Abgerundetes Rechteck (ohne 4 klare Ecken): strengerer Abstand zum Rechteck */
  roundedRectError: 0.025,
  /** …oder etwas lockerer, wenn das Rechteck mindestens um diesen Faktor besser passt als die Ellipse */
  roundedRectErrorLoose: 0.042,
  roundedRectVsEllipse: 2.6,
  /** Vieleck gilt als „klar eckig“, wenn es mindestens so viel besser passt als die Ellipse */
  polygonVsEllipse: 0.65,
  /** Ellipse: mittlere relative Radialabweichung */
  ellipseError: 0.085,
  /** Kreis statt Ellipse ab diesem Achsenverhältnis */
  circleRatio: 0.88,
  /** Offener Bogen → Kreis/Ellipse: gemessene Gesamtdrehung in Grad (Vorauswahl; bis knapp 1¼ Umläufe) */
  arcMinSweep: 195,
  arcMaxSweep: 470,
  /** Krümmung fast nur in eine Richtung, kein scharfer Knick (Grad über 2 Schritte), kaum gerade Abschnitte */
  arcConsistency: 0.8,
  arcMaxCorner: 80,
  arcMaxFlat: 0.22,
  /** Punkte müssen ≥ so viel Grad der Ellipse abdecken (≈ ⅔ Umlauf) und eng anliegen (mittlerer Abstand / mittlere Halbachse) */
  arcMinCoverage: 238,
  arcError: 0.032,
};
const SQUARE_TOLERANCE = 0.1;

/**
 * Erkennt eine Grundform aus Freihandpunkten (Stride 2 oder 3).
 * Whitelist: Linie, Pfeil (offen); Dreieck, Quadrat, Rechteck (auch mit abgerundeten Ecken),
 * Kreis, Ellipse (geschlossen). Alles andere – Vielecke mit 5+ Ecken, unregelmäßige Vierecke,
 * Zickzack – liefert null und bleibt ein normaler Freihandstrich.
 */
export function recognizeShape(xy: number[], stride = 3): Recognized | null {
  const T = SHAPE_THRESHOLDS;
  const raw = toPts(xy, stride);
  if (raw.length < 3) return null;
  const L = pathLength(raw);
  const D = bboxDiag(raw);
  if (L < 10 || D < 8) return null;
  const start = raw[0];
  const end = raw[raw.length - 1];
  const gap = dist(start, end);
  // Geschlossen: kleine Lücke – oder beim schnellen Zeichnen eine größere Lücke, die aber im Verhältnis zur
  // Strichlänge klein bleibt (≈ 85 % eines Kreises/Quadrats). Halbkreise und Bögen bleiben offen.
  const closed = (gap < Math.max(T.closeGap * D, 6) && L > 1.8 * D) || (gap < T.closeGapLoose * D && gap < T.closeGapOfLength * L && L > 1.6 * D);

  // ---------------------------------------------------------- offen: nur Linie oder Pfeil
  if (!closed) {
    const chord = gap;
    const maxDev = Math.max(...raw.map((p) => distToSegment(p, start, end)));
    if (maxDev < Math.max(2.5, T.lineDeviation * chord) && L < chord * T.lineDetour) {
      const b = snapAngle(start, end);
      return { kind: 'line', points: [start[0], start[1], b[0], b[1]] };
    }
    return recognizeArc(raw, D) ?? recognizeArrow(raw, L, D);
  }

  // ---------------------------------------------------------- geschlossen
  const pts = resample(raw, 72);
  const verts = closedVertices(pts, Math.max(2.5, 0.055 * D));
  const k = verts.length;
  const ell = fitEllipse(pts);
  const rect = fitRect(pts);

  // Dreieck: genau 3 deutliche Ecken, Seiten liegen eng an den Punkten
  if (k === 3) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const size = (Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys)) / 2;
    const triErr = meanDistToPolygon(pts, verts) / size;
    const minAngle = Math.min(...verts.map((v, i) => angleAt(verts[(i + 2) % 3], v, verts[(i + 1) % 3])));
    if (triErr < T.triangleError && minAngle >= T.triangleMinAngle) return { kind: 'triangle', points: flat(verts) };
  }

  // Quadrat/Rechteck: passt deutlich besser als eine Ellipse und hat rechte Winkel.
  // Mit 4 erkannten Ecken müssen alle Winkel nahe 90° liegen (Trapez/Raute fallen raus);
  // abgerundete Rechtecke (mehr Eckpunkte) müssen dafür sehr eng am Rechteck liegen.
  const degenerate = Math.min(rect.w, rect.h) < 0.08 * Math.max(rect.w, rect.h);
  const clearlyRectangular = rect.error < T.roundedRectErrorLoose && rect.error * T.roundedRectVsEllipse < ell.error;
  const rightAngles =
    k === 4
      ? verts.every((v, i) => Math.abs(angleAt(verts[(i + 3) % 4], v, verts[(i + 1) % 4]) - 90) <= T.rectAngleTolerance)
      : rect.error < T.roundedRectError || clearlyRectangular;
  const rectLimit = k === 4 ? T.rectErrorWithCorners : T.rectError;
  if (!degenerate && rightAngles && rect.error < rectLimit && rect.error < ell.error * T.rectVsEllipse) {
    return { kind: 'rect', points: flat(rect.corners) };
  }

  // Deutliche Vielecke (5–8 Ecken, die klar besser passen als jede Ellipse) sind nicht erlaubt → Freihand.
  // Vorher: glatter Bogen mit Lücke (z. B. Ellipse ⅚ gezeichnet) – die Eckensuche sieht dort Scheinecken.
  if (k >= 5 && k <= 8 && meanDistToPolygon(pts, verts) / ((ell.a + ell.b) / 2) < ell.error * T.polygonVsEllipse) return recognizeArc(raw, D);

  // Kreis/Ellipse: gleichmäßige Rundung. Geometrie vom Fit, der enger anliegt (Kegelschnitt-Fit ist bei Lücken,
  // Überschießen und eiförmigen Strichen meist genauer als die Ausdehnung).
  if (ell.error < T.ellipseError && rect.error >= ell.error * 0.9) {
    const box: Ell = { cx: ell.cx, cy: ell.cy, a: ell.a, b: ell.b, angle: ell.angle };
    const con = fitConic(pts);
    // rundliches Vieleck (gerade Seiten zwischen Ecken) und nur lose an der Ellipse → bleibt Freihand
    const tr = turning(resample(smooth(pts, 2), 32));
    if (tr.flatFrac > T.arcMaxFlat && (!con || ellipseResidual(pts, con).error > T.arcError)) return null;
    const better = con && ellipseResidual(pts, con).error < ellipseResidual(pts, box).error && Math.max(con.a, con.b) < 1.3 * Math.max(box.a, box.b);
    return ellipseShape(better ? con : box);
  }
  // Geschlossen erkannt, aber die Ellipse über die Ausdehnung passt nicht (z. B. größere Lücke) → als Bogen prüfen
  return recognizeArc(raw, D);
}

/** Messwerte eines geschlossenen Strichs (zum Abstimmen der Schwellenwerte). */
export function shapeMetrics(xy: number[], stride = 3) {
  const raw = toPts(xy, stride);
  const pts = resample(raw, 72);
  const D = bboxDiag(raw);
  const verts = closedVertices(pts, Math.max(2.5, 0.055 * D));
  const ell = fitEllipse(pts);
  const rect = fitRect(pts);
  return {
    corners: verts.length,
    ellipseError: +ell.error.toFixed(4),
    rectError: +rect.error.toFixed(4),
    polygonError: +(meanDistToPolygon(pts, verts) / ((ell.a + ell.b) / 2)).toFixed(4),
    rectAngles: verts.length === 4 ? verts.map((v, i) => Math.round(angleAt(verts[(i + 3) % 4], v, verts[(i + 1) % 4]))) : null,
  };
}

/**
 * Pfeil: gerader Schaft A→B (≥ 50 % der Strichlänge), danach eine klare Spitze bei B –
 * ein oder zwei Schenkel, die um 12°–70° zum Schaft zurückknicken und kurz sind.
 */
function recognizeArrow(raw: P[], L: number, D: number): Recognized | null {
  const verts = rdp(resample(raw, 96), Math.max(2.5, 0.04 * D));
  if (verts.length < 3 || verts.length > 5) return null;
  const A = verts[0];
  const B = verts[1];
  const C = verts[2];
  const shaft = dist(A, B);
  if (shaft < 0.5 * L || shaft < 0.5 * D) return null;
  // Erste Ankunft an der Schaftspitze (bei zweiseitigen Spitzen kehrt der Strich zu B zurück)
  const tol = Math.max(3, 0.04 * shaft);
  let iB = raw.findIndex((p) => dist(p, B) <= tol);
  if (iB < 0) return null;
  // innerhalb der Toleranz den nächsten Punkt dieser ersten Annäherung nehmen
  while (iB + 1 < raw.length && dist(raw[iB + 1], B) < dist(raw[iB], B)) iB++;
  const shaftPts = raw.slice(0, iB + 1);
  if (Math.max(...shaftPts.map((p) => distToSegment(p, A, B))) > Math.max(3, 0.06 * shaft)) return null;
  const head = raw.slice(iB);
  const headLen = pathLength(head);
  if (headLen < 0.1 * shaft || headLen > 1.1 * shaft) return null;
  if (!head.every((p) => dist(p, B) < 0.45 * shaft)) return null;
  const barb = angleAt(A, B, C);
  if (barb < 12 || barb > 70) return null;
  const b = snapAngle(A, B);
  return { kind: 'arrow', points: [A[0], A[1], b[0], b[1]] };
}

// ------------------------------------------------------------ Geometrie

export const isClosedKind = (k: ShapeKind) => k === 'ellipse' || k === 'rect' || k === 'triangle' || k === 'polygon';

/** Umriss als Punktzug (Ellipse wird fein abgetastet). */
export function shapeOutline(sh: Pick<ShapeObj, 'kind' | 'points'>): { pts: number[]; closed: boolean } {
  if (sh.kind === 'ellipse') {
    const [cx, cy, ux, uy, vx, vy] = sh.points;
    const u = [ux - cx, uy - cy];
    const v = [vx - cx, vy - cy];
    const out: number[] = [];
    const n = 72;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      out.push(cx + u[0] * Math.cos(t) + v[0] * Math.sin(t), cy + u[1] * Math.cos(t) + v[1] * Math.sin(t));
    }
    return { pts: out, closed: true };
  }
  return { pts: sh.points.slice(), closed: isClosedKind(sh.kind) };
}

/** Pfeilspitze: zwei Schenkel am Endpunkt. */
export function arrowHead(sh: Pick<ShapeObj, 'points' | 'width'>): number[] {
  const [x1, y1, x2, y2] = sh.points;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.min(Math.hypot(x2 - x1, y2 - y1) * 0.4, Math.max(10, sh.width * 5));
  const spread = (28 * Math.PI) / 180;
  return [
    x2 - len * Math.cos(ang - spread), y2 - len * Math.sin(ang - spread),
    x2, y2,
    x2 - len * Math.cos(ang + spread), y2 - len * Math.sin(ang + spread),
  ];
}

/** Ankerpunkte zum Nachbearbeiten (Endpunkte bzw. Ecken bzw. Ellipsen-Achsenenden). */
export function shapeAnchors(sh: Pick<ShapeObj, 'kind' | 'points'>): P[] {
  if (sh.kind === 'ellipse') {
    const [cx, cy, ux, uy, vx, vy] = sh.points;
    return [
      [ux, uy],
      [vx, vy],
      [2 * cx - ux, 2 * cy - uy],
      [2 * cx - vx, 2 * cy - vy],
    ];
  }
  return toPts(sh.points, 2);
}

/** Drehpunkt (Mittelpunkt) einer Form: Ellipsenmitte bzw. Schwerpunkt der Ecken. */
export function shapeCenter(sh: Pick<ShapeObj, 'kind' | 'points'>): P {
  if (sh.kind === 'ellipse') return [sh.points[0], sh.points[1]];
  const a = toPts(sh.points, 2);
  return [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length];
}

/**
 * Drehgriff geschlossener Formen (Ellipse, Rechteck, Dreieck, Vieleck): liegt `offset` (Seitenkoordinaten)
 * jenseits der „Oberkante“ – bei der Ellipse hinter dem Ende der zweiten Halbachse, sonst hinter der ersten Kante.
 */
export function rotateKnob(sh: Pick<ShapeObj, 'kind' | 'points'>, offset: number): { knob: P; base: P } | null {
  if (!isClosedKind(sh.kind)) return null;
  const c = shapeCenter(sh);
  let base: P;
  if (sh.kind === 'ellipse') base = [2 * c[0] - sh.points[4], 2 * c[1] - sh.points[5]];
  else {
    const a = toPts(sh.points, 2);
    base = [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2];
  }
  const d = Math.hypot(base[0] - c[0], base[1] - c[1]) || 1;
  return { base, knob: [base[0] + ((base[0] - c[0]) / d) * offset, base[1] + ((base[1] - c[1]) / d) * offset] };
}

/** Dreht die Formpunkte um `theta` (Bogenmaß) um den Formmittelpunkt. */
export function rotateShapePoints(sh: Pick<ShapeObj, 'kind' | 'points'>, theta: number): number[] {
  const [cx, cy] = shapeCenter(sh);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return sh.points.map((v, i, arr) => {
    if (i % 2) {
      const x = arr[i - 1] - cx;
      return cy + x * sin + (v - cy) * cos;
    }
    const y = arr[i + 1] - cy;
    return cx + (v - cx) * cos - y * sin;
  });
}

/** Drehwinkel einer Form in Grad (Ellipse: erste Halbachse; Vieleck: erste Kante), 0…359. */
export function shapeAngle(sh: Pick<ShapeObj, 'kind' | 'points'>): number {
  // Ellipse [cx, cy, ux, uy, …] und Vieleck [x0, y0, x1, y1, …]: jeweils Richtung Punkt 0 → Punkt 1
  const p = sh.points;
  const a = Math.atan2(p[3] - p[1], p[2] - p[0]);
  return Math.round((((a * 180) / Math.PI) % 360) + 360) % 360;
}

/** Verschiebt Anker i auf (x, y) und liefert die neuen Formpunkte. */
export function moveAnchor(sh: Pick<ShapeObj, 'kind' | 'points'>, i: number, x: number, y: number): number[] {
  const p = sh.points.slice();
  if (sh.kind === 'ellipse') {
    const [cx, cy] = p;
    if (i === 0) [p[2], p[3]] = [x, y];
    else if (i === 1) [p[4], p[5]] = [x, y];
    else if (i === 2) [p[2], p[3]] = [2 * cx - x, 2 * cy - y];
    else if (i === 3) [p[4], p[5]] = [2 * cx - x, 2 * cy - y];
    return p;
  }
  p[i * 2] = x;
  p[i * 2 + 1] = y;
  return p;
}

/** Skaliert eine Form um ihren Schwerpunkt bzw. verlängert Linien zum Zeiger (nach dem Einrasten). */
export function adjustSnapped(base: Recognized, hold: P, pointer: P): number[] {
  if (base.kind === 'line' || base.kind === 'arrow') {
    const b = snapAngle([base.points[0], base.points[1]], pointer);
    return [base.points[0], base.points[1], b[0], b[1]];
  }
  const anchors = shapeAnchors(base);
  const cx = base.kind === 'ellipse' ? base.points[0] : anchors.reduce((s, a) => s + a[0], 0) / anchors.length;
  const cy = base.kind === 'ellipse' ? base.points[1] : anchors.reduce((s, a) => s + a[1], 0) / anchors.length;
  const d0 = Math.hypot(hold[0] - cx, hold[1] - cy);
  if (d0 < 1) return base.points;
  const s = Math.max(0.1, Math.hypot(pointer[0] - cx, pointer[1] - cy) / d0);
  return base.points.map((v, i) => (i % 2 === 0 ? cx + (v - cx) * s : cy + (v - cy) * s));
}

export function pointInPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Abstand Punkt ↔ Formumriss (für Treffer und Radierer). */
export function distToShape(sh: Pick<ShapeObj, 'kind' | 'points'>, x: number, y: number): number {
  const { pts, closed } = shapeOutline(sh);
  let best = Infinity;
  const n = pts.length / 2;
  for (let i = 0; i < n - (closed ? 0 : 1); i++) {
    const a: P = [pts[i * 2], pts[i * 2 + 1]];
    const j = (i + 1) % n;
    const b: P = [pts[j * 2], pts[j * 2 + 1]];
    best = Math.min(best, distToSegment([x, y], a, b));
  }
  return best;
}
