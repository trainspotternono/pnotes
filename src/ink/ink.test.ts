import { describe, expect, it } from 'vitest';
import type { Stroke } from '../../shared/types';
import { erasePrecise, eraseWhole, distSegSeg, strokeHit } from './erase';
import { normalizePoints, penOutline, signedArea, smoothCenterline, widthFactor } from './geometry';

const line = (id: string, x0: number, x1: number, y: number, tool: Stroke['tool'] = 'pen'): Stroke => {
  const pts: number[] = [];
  for (let x = x0; x <= x1; x += 2) pts.push(x, y, 0.5);
  return { id, tool, color: '#000', width: 2, points: pts, penStyle: 'ballpoint' };
};

describe('Druck und Breite', () => {
  it('Druck 0.5 ergibt die Grundbreite, mehr Druck = breiter', () => {
    expect(widthFactor(0.5, 'fountain')).toBeCloseTo(1);
    expect(widthFactor(0.5, 'ballpoint')).toBeCloseTo(1);
    expect(widthFactor(1, 'fountain')).toBeGreaterThan(widthFactor(0.2, 'fountain'));
    expect(widthFactor(1, 'fountain') - widthFactor(0, 'fountain')).toBeGreaterThan(widthFactor(1, 'ballpoint') - widthFactor(0, 'ballpoint'));
  });

  it('Glättung unterteilt lange Segmente und behält Endpunkte', () => {
    const c = smoothCenterline([0, 0, 0.5, 10, 0, 0.5], 2, 'ballpoint', 1);
    expect(c.length / 3).toBe(11);
    expect(c[c.length - 3]).toBeCloseTo(10);
  });

  it('Outline-Vierecke haben dieselbe Orientierung wie die Kreise', () => {
    const o = penOutline(smoothCenterline([0, 0, 0.2, 10, 5, 0.9, 20, -3, 0.5], 3, 'fountain'));
    for (let i = 0; i < o.quads.length; i += 8) expect(signedArea(o.quads.slice(i, i + 8))).toBeGreaterThanOrEqual(0);
  });

  it('normalizePoints füllt Lücken und macht aus einem Tippen einen Punkt', () => {
    const n = normalizePoints([0, 0, 0.5, 10, 0, 0.5], 0.35, 2.5);
    expect(n.length / 3).toBe(5);
    expect(normalizePoints([3, 3, 0.5]).length / 3).toBe(2);
  });
});

describe('Radierer', () => {
  it('Segmentabstand', () => {
    expect(distSegSeg(0, 0, 10, 0, 5, -5, 5, 5)).toBe(0);
    expect(distSegSeg(0, 0, 10, 0, 0, 3, 10, 3)).toBeCloseTo(3);
  });

  it('Objekt-Radierer entfernt getroffene Striche, auch bei schneller Bewegung (Segment)', () => {
    const strokes = [line('a', 0, 100, 10), line('b', 0, 100, 50)];
    expect(strokeHit(strokes[0], { x: 50, y: -20 }, { x: 50, y: 40 }, 2)).toBe(true);
    const r = eraseWhole(strokes, { x: 50, y: -20 }, { x: 50, y: 30 }, 2);
    expect(r.map((s) => s.id)).toEqual(['b']);
    expect(eraseWhole(strokes, { x: 500, y: 500 }, { x: 501, y: 501 }, 2)).toBe(strokes);
  });

  it('„Nur Textmarker löschen“ lässt Stift-Striche stehen', () => {
    const strokes = [line('p', 0, 100, 10), line('h', 0, 100, 10, 'highlighter')];
    expect(eraseWhole(strokes, { x: 50, y: 0 }, { x: 50, y: 20 }, 3, { highlighterOnly: true }).map((s) => s.id)).toEqual(['p']);
  });

  it('Präzisions-Radierer teilt einen Strich in zwei', () => {
    const strokes = [line('a', 0, 100, 10)];
    const r = erasePrecise(strokes, { x: 50, y: 0 }, { x: 50, y: 20 }, 4);
    expect(r).toHaveLength(2);
    const maxX0 = Math.max(...r[0].points.filter((_, i) => i % 3 === 0));
    const minX1 = Math.min(...r[1].points.filter((_, i) => i % 3 === 0));
    expect(maxX0).toBeLessThan(47);
    expect(minX1).toBeGreaterThan(53);
  });
});
