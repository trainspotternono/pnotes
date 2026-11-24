import { describe, expect, it } from 'vitest';
import { recognizeShape, shapeMetrics } from './shapes';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
const sym = () => rnd() - 0.5;
type Pt = [number, number];

function polyline(v0: Pt[], per: number, close: boolean): Pt[] {
  const v = close ? [...v0, v0[0]] : v0;
  const out: Pt[] = [];
  for (let i = 0; i < v.length - 1; i++) for (let s = 0; s < per; s++) out.push([v[i][0] + ((v[i + 1][0] - v[i][0]) * s) / per, v[i][1] + ((v[i + 1][1] - v[i][1]) * s) / per]);
  out.push(v[v.length - 1]);
  return out;
}
/** Handzeichnungs-Simulation: Drehung, Skalierung, Zittern, Wackeln, Über-/Unterschießen am Ende. */
function hand(pts: Pt[], close: boolean): number[] {
  const rot = sym() * 0.5;
  const s = 0.6 + rnd() * 1.4;
  const amp = 0.8 + rnd() * 2.2;
  let p = pts.map(([x, y]): Pt => [(x * Math.cos(rot) - y * Math.sin(rot)) * s, (x * Math.sin(rot) + y * Math.cos(rot)) * s]);
  const wob = rnd() * 6;
  p = p.map(([x, y], i): Pt => [x + sym() * amp + Math.sin(i / 7) * wob * 0.3, y + sym() * amp + Math.cos(i / 9) * wob * 0.3]);
  if (close) {
    const extra = Math.floor(sym() * 8); // >0 überschießen, <0 Lücke
    p = extra > 0 ? [...p, ...p.slice(1, 1 + extra)] : p.slice(0, p.length + extra);
  }
  return p.flatMap(([x, y]) => [x, y, 0.5]);
}
const ring = (rx: number, ry: number, start: number): Pt[] => Array.from({ length: 81 }, (_, i) => [Math.cos(start + (i / 80) * 2 * Math.PI) * rx, Math.sin(start + (i / 80) * 2 * Math.PI) * ry]);
const regular = (n: number, r: number): Pt[] => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * 2 * Math.PI - Math.PI / 2) * r, Math.sin((i / n) * 2 * Math.PI - Math.PI / 2) * r]);

const cases: { name: string; expect: string | null; gen: () => number[] }[] = [
  { name: 'Linie', expect: 'line', gen: () => hand(polyline([[0, 0], [180 + rnd() * 100, sym() * 60]], 60, false), false) },
  { name: 'Pfeil einseitig', expect: 'arrow', gen: () => hand(polyline([[0, 0], [200, 0], [175, -22]], 40, false), false) },
  { name: 'Pfeil zweiseitig', expect: 'arrow', gen: () => hand(polyline([[0, 0], [200, 0], [176, -20], [200, 0], [176, 20]], 30, false), false) },
  { name: 'Kreis', expect: 'ellipse', gen: () => hand(ring(60, 60, rnd() * 6), true) },
  { name: 'Ellipse', expect: 'ellipse', gen: () => hand(ring(100, 45 + rnd() * 15, rnd() * 6), true) },
  { name: 'Dreieck', expect: 'triangle', gen: () => hand(polyline([[0, 100], [50 + sym() * 40, 0], [120, 100 + sym() * 20]], 30, true), true) },
  { name: 'Quadrat', expect: 'rect', gen: () => hand(polyline([[0, 0], [110, 0], [110, 110], [0, 110]], 28, true), true) },
  { name: 'Rechteck', expect: 'rect', gen: () => hand(polyline([[0, 0], [180, 0], [180, 90], [0, 90]], 30, true), true) },
  { name: 'Fünfeck', expect: null, gen: () => hand(polyline(regular(5, 80), 25, true), true) },
  { name: 'Sechseck', expect: null, gen: () => hand(polyline(regular(6, 80), 22, true), true) },
  { name: 'Trapez', expect: null, gen: () => hand(polyline([[45, 0], [155, 0], [200, 100], [0, 100]], 25, true), true) },
  { name: 'Raute', expect: null, gen: () => hand(polyline([[100, 0], [200, 60], [100, 120], [0, 60]], 25, true), true) },
  { name: 'Zickzack', expect: null, gen: () => hand(polyline([[0, 0], [40, 40], [80, 0], [120, 40], [160, 0], [200, 40]], 15, false), false) },
  { name: 'Haken', expect: null, gen: () => hand(polyline([[0, 0], [150, 0], [150, 110]], 30, false), false) },
];

/**
 * Regressionstest der Formenerkennung über 40 simulierte Handzeichnungen je Form:
 * Grundformen müssen in ≥ 95 % einrasten, nicht erlaubte Formen dürfen nie einrasten.
 */
describe('Formenerkennung – Robustheit über 40 Varianten je Form', () => {
  for (const c of cases) {
    it(`${c.name} → ${c.expect ?? 'Freihand'}`, () => {
      const got: Record<string, number> = {};
      const misses: string[] = [];
      for (let i = 0; i < 40; i++) {
        const xy = c.gen();
        const k = recognizeShape(xy)?.kind ?? 'freihand';
        got[k] = (got[k] ?? 0) + 1;
        if (k !== (c.expect ?? 'freihand') && misses.length < 3) misses.push(`${k} ${JSON.stringify(shapeMetrics(xy))}`);
      }
      const hits = got[c.expect ?? 'freihand'] ?? 0;
      const required = c.expect === null ? 40 : 38;
      expect(hits, `${c.name}: ${JSON.stringify(got)}\n${misses.join('\n')}`).toBeGreaterThanOrEqual(required);
    });
  }
});
