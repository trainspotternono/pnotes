import { describe, expect, it } from 'vitest';
import { adjustSnapped, moveAnchor, recognizeShape, shapeAnchors } from './shapes';
import { apply, compose, rotateAbout, scaleAbout, transformObject, translate } from './transform';
import type { ShapeObj, TextObj } from '../../shared/types';

// Deterministisches „Zittern“ wie bei Handzeichnung
let seed = 1;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647 - 0.5;
};
const jitter = (pts: [number, number][], amp: number) => pts.flatMap(([x, y]) => [x + rnd() * amp, y + rnd() * amp, 0.5]);

function polyline(vertices: [number, number][], perSeg = 20, close = false): [number, number][] {
  const v = close ? [...vertices, vertices[0]] : vertices;
  const out: [number, number][] = [];
  for (let i = 0; i < v.length - 1; i++) {
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg;
      out.push([v[i][0] + (v[i + 1][0] - v[i][0]) * t, v[i][1] + (v[i + 1][1] - v[i][1]) * t]);
    }
  }
  out.push(v[v.length - 1]);
  return out;
}

describe('Formenerkennung', () => {
  it('Linie (mit Winkel-Einrasten auf waagrecht)', () => {
    const r = recognizeShape(jitter(polyline([[10, 100], [210, 104]], 60), 1.5));
    expect(r?.kind).toBe('line');
    expect(r!.points[3]).toBeCloseTo(r!.points[1], 5);
  });

  it('Pfeil', () => {
    const r = recognizeShape(jitter(polyline([[0, 0], [200, 0], [175, -18]], 40), 1));
    expect(r?.kind).toBe('arrow');
    expect(r!.points[2]).toBeGreaterThan(190);
  });

  it('Kreis', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * Math.PI * 2;
      pts.push([100 + Math.cos(t) * 50, 100 + Math.sin(t) * 50]);
    }
    const r = recognizeShape(jitter(pts, 3));
    expect(r?.kind).toBe('ellipse');
    const [cx, cy, ux, uy, vx, vy] = r!.points;
    expect(Math.hypot(ux - cx, uy - cy)).toBeCloseTo(Math.hypot(vx - cx, vy - cy), 5);
    expect(cx).toBeGreaterThan(95);
    expect(cx).toBeLessThan(105);
  });

  it('Ellipse', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * Math.PI * 2;
      pts.push([100 + Math.cos(t) * 90, 100 + Math.sin(t) * 40]);
    }
    expect(recognizeShape(jitter(pts, 2))?.kind).toBe('ellipse');
  });

  it('Rechteck wird achsparallel', () => {
    const r = recognizeShape(jitter(polyline([[0, 0], [160, 3], [158, 90], [2, 88]], 25, true), 2));
    expect(r?.kind).toBe('rect');
    const p = r!.points;
    expect(p[1]).toBeCloseTo(p[3], 5); // obere Kante waagrecht
  });

  it('Quadrat', () => {
    const r = recognizeShape(jitter(polyline([[0, 0], [100, 0], [102, 96], [0, 100]], 25, true), 1.5));
    expect(r?.kind).toBe('rect');
    const p = r!.points;
    expect(Math.abs(p[2] - p[0])).toBeCloseTo(Math.abs(p[5] - p[3]), 5);
  });

  it('Dreieck', () => {
    expect(recognizeShape(jitter(polyline([[0, 100], [60, 0], [120, 100]], 30, true), 1.5))?.kind).toBe('triangle');
  });

  it('zweiseitiger Pfeil (Schaft, Schenkel hin und zurück, zweiter Schenkel)', () => {
    const r = recognizeShape(jitter(polyline([[0, 0], [220, 0], [195, -20], [220, 0], [195, 20]], 30), 1));
    expect(r?.kind).toBe('arrow');
  });

  it('abgerundetes Rechteck rastet als Rechteck ein', () => {
    const pts: [number, number][] = [];
    const [w, h, rad] = [180, 100, 18];
    const corners: [number, number, number][] = [[w - rad, rad, -90], [w - rad, h - rad, 0], [rad, h - rad, 90], [rad, rad, 180]];
    for (const [cx, cy, a0] of corners) {
      for (let i = 0; i <= 8; i++) {
        const a = ((a0 + (i / 8) * 90) * Math.PI) / 180;
        pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
      }
    }
    pts.push(pts[0]);
    const r = recognizeShape(jitter(polyline(pts, 3), 1.5));
    expect(r?.kind).toBe('rect');
    const p = r!.points;
    expect(Math.abs(p[2] - p[0])).toBeGreaterThan(170); // Breite
    expect(Math.abs(p[5] - p[3])).toBeGreaterThan(90); // Höhe
  });

  it('schmales Rechteck und „fast quadratisch“ → Rechteck bzw. Quadrat', () => {
    const thin = recognizeShape(jitter(polyline([[0, 0], [240, 2], [239, 40], [1, 38]], 25, true), 1.5));
    expect(thin?.kind).toBe('rect');
    expect(Math.abs(thin!.points[2] - thin!.points[0])).not.toBeCloseTo(Math.abs(thin!.points[5] - thin!.points[3]), 0);
    const nearSquare = recognizeShape(jitter(polyline([[0, 0], [100, 0], [100, 94], [0, 94]], 25, true), 1.5))!;
    expect(Math.abs(nearSquare.points[2] - nearSquare.points[0])).toBeCloseTo(Math.abs(nearSquare.points[5] - nearSquare.points[3]), 5);
    const rect = recognizeShape(jitter(polyline([[0, 0], [100, 0], [100, 80], [0, 80]], 25, true), 1.5))!;
    expect(Math.abs(rect.points[2] - rect.points[0]) - Math.abs(rect.points[5] - rect.points[3])).toBeGreaterThan(10); // 5:4 bleibt Rechteck
  });

  it('wackeliger Kreis bleibt Kreis', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 90; i++) {
      const t = (i / 90) * Math.PI * 2.05;
      const r = 60 + Math.sin(t * 3) * 2.5;
      pts.push([100 + Math.cos(t) * r, 100 + Math.sin(t) * r]);
    }
    expect(recognizeShape(jitter(pts, 2))?.kind).toBe('ellipse');
  });
});

describe('Formenerkennung – nicht erlaubte oder unklare Striche bleiben Freihand', () => {
  const regular = (n: number, r = 80, phase = -Math.PI / 2): [number, number][] =>
    Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2 + phase;
      return [100 + Math.cos(t) * r, 100 + Math.sin(t) * r] as [number, number];
    });

  it('Fünfeck und Sechseck', () => {
    expect(recognizeShape(jitter(polyline(regular(5), 25, true), 1))).toBeNull();
    expect(recognizeShape(jitter(polyline(regular(6), 25, true), 1))).toBeNull();
  });

  it('Stern', () => {
    const star: [number, number][] = Array.from({ length: 10 }, (_, i) => {
      const t = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 35 : 85;
      return [100 + Math.cos(t) * r, 100 + Math.sin(t) * r];
    });
    expect(recognizeShape(jitter(polyline(star, 15, true), 1))).toBeNull();
  });

  it('unregelmäßiges Viereck (Trapez / Raute)', () => {
    expect(recognizeShape(jitter(polyline([[40, 0], [160, 0], [200, 100], [0, 100]], 25, true), 1))).toBeNull();
    expect(recognizeShape(jitter(polyline([[100, 0], [200, 60], [100, 120], [0, 60]], 25, true), 1))).toBeNull();
  });

  it('Zickzack, Bogen und Gekritzel (offen)', () => {
    expect(recognizeShape(jitter(polyline([[0, 0], [40, 40], [80, 0], [120, 40], [160, 0], [200, 40]], 15), 1))).toBeNull();
    const arc: [number, number][] = Array.from({ length: 40 }, (_, i) => [100 + Math.cos((i / 40) * Math.PI) * 80, 100 - Math.sin((i / 40) * Math.PI) * 80]);
    expect(recognizeShape(jitter(arc, 1))).toBeNull();
    expect(recognizeShape(jitter(polyline([[0, 0], [50, 40], [10, 80], [70, 20], [5, 5], [90, 90]], 10), 1))).toBeNull();
  });

  it('Haken (Linie mit langem Knick) ist kein Pfeil', () => {
    expect(recognizeShape(jitter(polyline([[0, 0], [150, 0], [150, 120]], 30), 1))).toBeNull();
  });
});

describe('Anker und Nachbearbeitung', () => {
  it('Linienendpunkt verschieben und nach Einrasten verlängern', () => {
    const line = { kind: 'line' as const, points: [0, 0, 100, 0] };
    expect(moveAnchor(line, 1, 50, 50)).toEqual([0, 0, 50, 50]);
    const adj = adjustSnapped(line, [100, 0], [200, 1]);
    expect(adj[2]).toBeCloseTo(200, 1);
    expect(adj[3]).toBeCloseTo(0, 6);
  });
  it('Ellipsenanker ändern die Halbachse symmetrisch', () => {
    const e = { kind: 'ellipse' as const, points: [0, 0, 10, 0, 0, 5] };
    expect(shapeAnchors(e)).toHaveLength(4);
    expect(moveAnchor(e, 2, -20, 0)).toEqual([0, 0, 20, 0, 0, 5]);
  });
});

describe('Transformationen', () => {
  it('Komposition: drehen und zurückdrehen ergibt Identität', () => {
    const m = compose(rotateAbout(-1, 5, 5), rotateAbout(1, 5, 5));
    const [x, y] = apply(m, 17, -3);
    expect(x).toBeCloseTo(17);
    expect(y).toBeCloseTo(-3);
  });
  it('Form und Text skalieren mit Breite/Schriftgröße', () => {
    const sh: ShapeObj = { id: 's', type: 'shape', kind: 'line', points: [0, 0, 10, 0], color: '#000', width: 2, fill: null };
    const m = compose(translate(5, 0), scaleAbout(2, 0, 0));
    const r = transformObject(sh, m) as ShapeObj;
    expect(r.points).toEqual([5, 0, 25, 0]);
    expect(r.width).toBe(4);
    const t: TextObj = { id: 't', type: 'text', cx: 0, cy: 0, w: 100, h: 20, rotation: 0, text: 'x', font: 'sans', size: 12, color: '#000', background: null, align: 'left' };
    const rt = transformObject(t, rotateAbout(Math.PI / 2, 0, 0)) as TextObj;
    expect(rt.rotation).toBeCloseTo(90);
    expect(rt.size).toBeCloseTo(12);
  });
});
