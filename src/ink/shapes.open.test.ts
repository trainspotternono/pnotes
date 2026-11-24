/**
 * Nicht ganz geschlossene Kreise/Ellipsen (Lücke bis ≈ ⅓ des Umfangs), Überschießen, Spiraleffekt, Endhaken –
 * und Gegenproben, die Freihand bleiben müssen (Halbkreis, Bogen, Welle, U-Form, Haken, starke Spirale).
 * Je Fall 40 simulierte Handzeichnungen (Zittern, Wackeln, zufällige Größe, Startwinkel und Richtung).
 */
import { describe, expect, it } from 'vitest';
import { arcMetrics, recognizeShape, type Recognized } from './shapes';

let seed = 23;
const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
const sym = () => rnd() - 0.5;
type Pt = [number, number];

/** Bogen von `sweep` Grad; r(t) darf sich ändern (Spirale), Startwinkel/Richtung zufällig. */
function arc(rx: number, ry: number, sweepDeg: number, rScale: (t: number) => number = () => 1, n = 90): Pt[] {
  const start = rnd() * Math.PI * 2;
  const dir = rnd() < 0.5 ? 1 : -1;
  const sweep = (sweepDeg * Math.PI) / 180;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const a = start + dir * t * sweep;
    const k = rScale(t);
    return [Math.cos(a) * rx * k, Math.sin(a) * ry * k] as Pt;
  });
}

/** Regelmäßiges n-Eck (Radius 70), nur `sides` Seiten gezeichnet (Rest = Lücke). */
function openPolygon(n: number, sides: number, per = 18): Pt[] {
  const v = Array.from({ length: n + 1 }, (_, i): Pt => [Math.cos((i / n) * 2 * Math.PI) * 70, Math.sin((i / n) * 2 * Math.PI) * 70]);
  const out: Pt[] = [];
  const steps = Math.round(sides * per);
  for (let k = 0; k <= steps; k++) {
    const i = Math.min(n - 1, Math.floor(k / per));
    const s = (k - i * per) / per;
    out.push([v[i][0] + (v[i + 1][0] - v[i][0]) * s, v[i][1] + (v[i + 1][1] - v[i][1]) * s]);
  }
  return out;
}

/** Handzeichnung: Drehung, Größe, Zittern, Wackeln. */
function hand(pts: Pt[], amp0 = 1): number[] {
  const rot = rnd() * Math.PI * 2;
  const s = 0.6 + rnd() * 1.4;
  const amp = (0.8 + rnd() * 2.2) * amp0;
  const wob = rnd() * 6;
  return pts
    .map(([x, y]): Pt => [(x * Math.cos(rot) - y * Math.sin(rot)) * s, (x * Math.sin(rot) + y * Math.cos(rot)) * s])
    .map(([x, y], i): Pt => [x + sym() * amp + Math.sin(i / 7) * wob * 0.3, y + sym() * amp + Math.cos(i / 9) * wob * 0.3])
    .flatMap(([x, y]) => [x, y, 0.5]);
}

function classify(r: Recognized | null): string {
  if (!r) return 'freihand';
  if (r.kind === 'ellipse') {
    const [cx, cy, ux, uy, vx, vy] = r.points;
    const a = Math.hypot(ux - cx, uy - cy);
    const b = Math.hypot(vx - cx, vy - cy);
    return Math.abs(a - b) < 0.01 * Math.max(a, b) ? 'kreis' : 'ellipse';
  }
  return r.kind;
}

const R = () => 50 + rnd() * 30;
const cases: { name: string; expect: string; min: number; gen: () => number[] }[] = [
  // --------------------------------------------------- sollen Kreis/Ellipse werden
  { name: 'Kreis 330° (kleine Lücke)', expect: 'kreis', min: 39, gen: () => { const r = R(); return hand(arc(r, r, 330)); } },
  { name: 'Kreis 300°', expect: 'kreis', min: 38, gen: () => { const r = R(); return hand(arc(r, r, 300)); } },
  { name: 'Kreis 270° (Viertel fehlt)', expect: 'kreis', min: 37, gen: () => { const r = R(); return hand(arc(r, r, 270)); } },
  { name: 'Kreis 250°', expect: 'kreis', min: 34, gen: () => { const r = R(); return hand(arc(r, r, 250)); } },
  { name: 'Kreis etwas oval gezeichnet (b/a 0.9), 290°', expect: 'kreis', min: 36, gen: () => { const r = R(); return hand(arc(r, r * (0.9 + rnd() * 0.1), 290)); } },
  { name: 'Ellipse 2:1, 300°', expect: 'ellipse', min: 37, gen: () => { const r = R() * 1.4; return hand(arc(r, r * (0.45 + rnd() * 0.1), 300)); } },
  { name: 'Ellipse 2:1, 270°', expect: 'ellipse', min: 34, gen: () => { const r = R() * 1.4; return hand(arc(r, r * (0.45 + rnd() * 0.1), 270)); } },
  { name: 'Kreis mit Überschießen (400°)', expect: 'kreis', min: 38, gen: () => { const r = R(); return hand(arc(r, r, 400, undefined, 110)); } },
  { name: 'Kreis, Ende läuft nach innen (Spirale 12 %), 330°', expect: 'kreis', min: 36, gen: () => { const r = R(); return hand(arc(r, r, 330, (t) => 1 - 0.12 * t)); } },
  { name: 'Kreis, Ende läuft nach außen (Spirale 10 %), 345°', expect: 'kreis', min: 36, gen: () => { const r = R(); return hand(arc(r, r, 345, (t) => 1 + 0.1 * t)); } },
  { name: 'Kreis grob gezittert, 300°', expect: 'kreis', min: 34, gen: () => { const r = R(); return hand(arc(r, r, 300), 1.8); } },
  // --------------------------------------------------- müssen Freihand bleiben
  { name: 'Halbkreis (180°)', expect: 'freihand', min: 40, gen: () => { const r = R(); return hand(arc(r, r, 180)); } },
  { name: 'Bogen 210°', expect: 'freihand', min: 40, gen: () => { const r = R(); return hand(arc(r, r, 210)); } },
  { name: 'Starke Spirale (2 Umläufe, Radius 100 % → 35 %)', expect: 'freihand', min: 40, gen: () => { const r = R(); return hand(arc(r, r, 720, (t) => 1 - 0.65 * t, 160)); } },
  {
    name: 'Welle (S-Kurve)',
    expect: 'freihand',
    min: 40,
    gen: () => hand(Array.from({ length: 90 }, (_, i): Pt => [i * 2.4, Math.sin((i / 89) * Math.PI * 2) * 40])),
  },
  { name: 'Sechseck mit Lücke (5 von 6 Seiten)', expect: 'freihand', min: 40, gen: () => hand(openPolygon(6, 5)) },
  { name: 'Fünfeck mit Lücke (4½ von 5 Seiten)', expect: 'freihand', min: 40, gen: () => hand(openPolygon(5, 4.5)) },
  { name: 'Achteck mit Lücke (7 von 8 Seiten)', expect: 'freihand', min: 38, gen: () => hand(openPolygon(8, 7)) },
  { name: 'Quadrat mit Lücke (3½ Seiten) wird kein Kreis', expect: 'not-circle', min: 40, gen: () => hand(openPolygon(4, 3.5)) },
  {
    name: 'U-Form (offenes Rechteck, 3 Seiten)',
    expect: 'freihand',
    min: 40,
    gen: () => {
      const v: Pt[] = [[0, 0], [0, 120], [100, 120], [100, 0]];
      const out: Pt[] = [];
      for (let i = 0; i < 3; i++) for (let s = 0; s < 30; s++) out.push([v[i][0] + ((v[i + 1][0] - v[i][0]) * s) / 30, v[i][1] + ((v[i + 1][1] - v[i][1]) * s) / 30]);
      return hand(out);
    },
  },
];

describe('Vervollständigter Kreis/Ellipse sitzt genau', () => {
  const sample = (cx: number, cy: number, rx: number, ry: number, from: number, sweep: number) =>
    Array.from({ length: 80 }, (_, i) => {
      const a = ((from + (i / 79) * sweep) * Math.PI) / 180;
      return [cx + Math.cos(a) * rx + Math.sin(i * 1.7) * 0.8, cy + Math.sin(a) * ry + Math.cos(i * 2.3) * 0.8, 0.5];
    }).flat();

  it('Kreis 270° → Mittelpunkt und Radius auf ±3 %', () => {
    const r = recognizeShape(sample(300, 200, 80, 80, 20, 270))!;
    expect(r.kind).toBe('ellipse');
    const [cx, cy, ux, uy, vx, vy] = r.points;
    expect(Math.hypot(cx - 300, cy - 200)).toBeLessThan(0.03 * 80);
    expect(Math.abs(Math.hypot(ux - cx, uy - cy) - 80)).toBeLessThan(0.03 * 80);
    expect(Math.abs(Math.hypot(vx - cx, vy - cy) - 80)).toBeLessThan(0.03 * 80);
  });

  it('Ellipse 2:1 mit 280° → Achsen auf ±5 %, waagrecht eingerastet', () => {
    const r = recognizeShape(sample(250, 180, 120, 60, 100, 280))!;
    expect(r.kind).toBe('ellipse');
    const [cx, cy, ux, uy, vx, vy] = r.points;
    expect(Math.hypot(cx - 250, cy - 180)).toBeLessThan(0.05 * 60);
    expect(Math.abs(Math.hypot(ux - cx, uy - cy) - 120)).toBeLessThan(0.05 * 120);
    expect(Math.abs(Math.hypot(vx - cx, vy - cy) - 60)).toBeLessThan(0.05 * 60);
    expect(Math.abs(uy - cy)).toBeLessThan(0.5); // Hauptachse exakt waagrecht
  });
});

describe('Formenerkennung – nicht ganz geschlossene Kreise und Gegenproben', () => {
  for (const c of cases) {
    it(`${c.name} → ${c.expect} (≥ ${c.min}/40)`, () => {
      const got: Record<string, number> = {};
      const misses: string[] = [];
      for (let i = 0; i < 40; i++) {
        const xy = c.gen();
        let k = classify(recognizeShape(xy));
        if (c.expect === 'not-circle' && k !== 'kreis' && k !== 'ellipse') k = 'not-circle';
        got[k] = (got[k] ?? 0) + 1;
        if (k !== c.expect && misses.length < 4) misses.push(`${k} ${JSON.stringify(arcMetrics(xy))}`);
      }
      expect(got[c.expect] ?? 0, `${c.name}: ${JSON.stringify(got)}\n${misses.join('\n')}`).toBeGreaterThanOrEqual(c.min);
    });
  }
});
