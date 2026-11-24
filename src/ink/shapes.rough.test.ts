/**
 * Grob gezeichnete Grundformen (stärkeres Zittern, größere Lücken/Überschießer, runde Ecken, schief)
 * und die Unterscheidung Kreis ↔ Ellipse sowie Quadrat ↔ Rechteck.
 */
import { describe, expect, it } from 'vitest';
import { recognizeShape, shapeMetrics, type Recognized } from './shapes';

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
const sym = () => rnd() - 0.5;
type Pt = [number, number];

function polyline(v0: Pt[], per: number): Pt[] {
  const v = [...v0, v0[0]];
  const out: Pt[] = [];
  for (let i = 0; i < v.length - 1; i++) for (let s = 0; s < per; s++) out.push([v[i][0] + ((v[i + 1][0] - v[i][0]) * s) / per, v[i][1] + ((v[i + 1][1] - v[i][1]) * s) / per]);
  out.push(v[v.length - 1]);
  return out;
}
/** Abgerundete Ecken: Ecken durch Viertelkreise ersetzen. */
function rounded(w: number, h: number, r: number, per = 24): Pt[] {
  const out: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (i / 8) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    for (let i = 1; i < per; i++) out.push([x0 + ((x1 - x0) * i) / per, y0 + ((y1 - y0) * i) / per]);
  };
  corner(w - r, r, -Math.PI / 2);
  edge(w, r, w, h - r);
  corner(w - r, h - r, 0);
  edge(w - r, h, r, h);
  corner(r, h - r, Math.PI / 2);
  edge(0, h - r, 0, r);
  corner(r, r, Math.PI);
  edge(r, 0, w - r, 0);
  out.push(out[0]);
  return out;
}
/** Grobe Handzeichnung: schief, deutliches Zittern, Wackeln, Lücke oder Überschießen bis ~12 %. */
function rough(pts: Pt[]): number[] {
  const rot = sym() * 0.6;
  const s = 0.7 + rnd() * 1.3;
  const amp = 1.5 + rnd() * 3;
  let p = pts.map(([x, y]): Pt => [(x * Math.cos(rot) - y * Math.sin(rot)) * s, (x * Math.sin(rot) + y * Math.cos(rot)) * s]);
  const wob = 2 + rnd() * 8;
  p = p.map(([x, y], i): Pt => [x + sym() * amp + Math.sin(i / 6) * wob * 0.35, y + sym() * amp + Math.cos(i / 8) * wob * 0.35]);
  const extra = Math.round(sym() * 0.24 * p.length);
  p = extra > 0 ? [...p, ...p.slice(1, 1 + extra)] : p.slice(0, p.length + extra);
  return p.flatMap(([x, y]) => [x, y, 0.5]);
}
const ring = (rx: number, ry: number, start: number): Pt[] => Array.from({ length: 81 }, (_, i) => [Math.cos(start + (i / 80) * 2 * Math.PI) * rx, Math.sin(start + (i / 80) * 2 * Math.PI) * ry]);

/** Kreis = Ellipse mit (nahezu) gleichen Halbachsen; Quadrat = Rechteck mit gleichen Seiten. */
function classify(r: Recognized | null): string {
  if (!r) return 'freihand';
  if (r.kind === 'ellipse') {
    const [cx, cy, ux, uy, vx, vy] = r.points;
    const a = Math.hypot(ux - cx, uy - cy);
    const b = Math.hypot(vx - cx, vy - cy);
    return Math.abs(a - b) < 0.01 * Math.max(a, b) ? 'kreis' : 'ellipse';
  }
  if (r.kind === 'rect') {
    const p = r.points;
    const w = Math.hypot(p[2] - p[0], p[3] - p[1]);
    const h = Math.hypot(p[4] - p[2], p[5] - p[3]);
    return Math.abs(w - h) < 0.01 * Math.max(w, h) ? 'quadrat' : 'rechteck';
  }
  return r.kind;
}

const cases: { name: string; expect: string; min: number; gen: () => number[] }[] = [
  { name: 'Kreis grob', expect: 'kreis', min: 37, gen: () => rough(ring(60, 60 * (0.9 + rnd() * 0.1), rnd() * 6)) },
  { name: 'Ellipse 2:1 grob', expect: 'ellipse', min: 37, gen: () => rough(ring(100, 45 + rnd() * 10, rnd() * 6)) },
  { name: 'Quadrat grob', expect: 'quadrat', min: 37, gen: () => rough(polyline([[0, 0], [110, 0], [110, 105 + rnd() * 10], [0, 110]], 26)) },
  { name: 'Quadrat mit runden Ecken', expect: 'quadrat', min: 36, gen: () => rough(rounded(120, 120, 10 + rnd() * 12)) },
  { name: 'Rechteck 2:1 grob', expect: 'rechteck', min: 37, gen: () => rough(polyline([[0, 0], [190, 0], [190, 95], [0, 95]], 28)) },
  { name: 'Rechteck mit runden Ecken', expect: 'rechteck', min: 36, gen: () => rough(rounded(200, 110, 10 + rnd() * 12)) },
];

describe('Formenerkennung – grobe Zeichnungen, Kreis/Quadrat priorisiert', () => {
  for (const c of cases) {
    it(`${c.name} → ${c.expect} (≥ ${c.min}/40)`, () => {
      const got: Record<string, number> = {};
      const misses: string[] = [];
      for (let i = 0; i < 40; i++) {
        const xy = c.gen();
        const k = classify(recognizeShape(xy));
        got[k] = (got[k] ?? 0) + 1;
        if (k !== c.expect && misses.length < 3) misses.push(`${k} ${JSON.stringify(shapeMetrics(xy))}`);
      }
      expect(got[c.expect] ?? 0, `${c.name}: ${JSON.stringify(got)}\n${misses.join('\n')}`).toBeGreaterThanOrEqual(c.min);
    });
  }
});
