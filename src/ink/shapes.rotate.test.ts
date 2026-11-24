import { describe, expect, it } from 'vitest';
import type { ShapeObj } from '../../shared/types';
import { transformObject, rotateAbout, translate, scaleAbout } from './transform';
import { rotateKnob, rotateShapePoints, shapeAngle, shapeCenter } from './shapes';
import { COLOR_SLOTS, DEFAULT_TOOLS, PEN_COLORS, loadTools, withPaletteColors } from './tools';

const ellipse = (): ShapeObj => ({ id: 'e', type: 'shape', kind: 'ellipse', points: [100, 100, 160, 100, 100, 130], color: '#000', width: 2, fill: null });
const axes = (p: number[]) => [Math.hypot(p[2] - p[0], p[3] - p[1]), Math.hypot(p[4] - p[0], p[5] - p[1])];

describe('Ellipse drehen', () => {
  it('Drehung um den Mittelpunkt: Halbachsen bleiben, Winkel ändert sich', () => {
    const e = ellipse();
    const r = rotateShapePoints(e, Math.PI / 6);
    expect(r.slice(0, 2)).toEqual([100, 100]);
    axes(r).forEach((v, i) => expect(v).toBeCloseTo(axes(e.points)[i], 6));
    expect(shapeAngle({ kind: 'ellipse', points: r })).toBe(30);
  });

  it('Winkel bleibt beim Verschieben und Skalieren erhalten (Modell = Halbachsen-Vektoren)', () => {
    const rotated: ShapeObj = { ...ellipse(), points: rotateShapePoints(ellipse(), (40 * Math.PI) / 180) };
    const moved = transformObject(rotated, translate(50, -20)) as ShapeObj;
    const scaled = transformObject(moved, scaleAbout(2, 0, 0)) as ShapeObj;
    expect(shapeAngle(moved)).toBe(40);
    expect(shapeAngle(scaled)).toBe(40);
    expect(axes(scaled.points)[0]).toBeCloseTo(120, 6);
    // Auswahl-Drehung (Drehgriff im Auswahlmodus) addiert sich
    const turned = transformObject(scaled, rotateAbout((20 * Math.PI) / 180, 0, 0)) as ShapeObj;
    expect(shapeAngle(turned)).toBe(60);
  });

  it('Drehgriff liegt außerhalb der Form auf der Seite der zweiten Halbachse', () => {
    const k = rotateKnob(ellipse(), 28)!;
    expect(k.base).toEqual([100, 70]);
    expect(k.knob[0]).toBeCloseTo(100);
    expect(k.knob[1]).toBeCloseTo(42);
    expect(rotateKnob({ kind: 'line', points: [0, 0, 10, 0] }, 28)).toBeNull();
    expect(shapeCenter({ kind: 'rect', points: [0, 0, 10, 0, 10, 20, 0, 20] })).toEqual([5, 10]);
  });
});

describe('Stiftfarben', () => {
  it('Stiftfarben = 13 Farben (9 Kit-Farben + 4 Schreibfarben, ohne Weiß), keine doppelt', () => {
    expect(DEFAULT_TOOLS.pen.colors.length).toBe(8);
    expect(new Set(PEN_COLORS.map((c) => c.toLowerCase())).size).toBe(PEN_COLORS.length);
  });
  it('gespeicherte Farben (gleiche Version) werden übernommen und mit Palettenfarben ergänzt', () => {
    const t = loadTools({ pen: { ...DEFAULT_TOOLS.pen, colors: ['#ff0000', '#1f4fbf', '#000000', '#00ff00', '#123456'], colorIndex: 4 } } as never);
    expect(t.pen.colors).toHaveLength(COLOR_SLOTS.pen);
    expect(t.pen.colors.slice(0, 5)).toEqual(['#ff0000', '#1f4fbf', '#000000', '#00ff00', '#123456']);
    expect(t.pen.colorIndex).toBe(4);
  });
  it('Einstellungen einer älteren Version: Farben → Palette, alles andere bleibt', () => {
    const old = { pen: { ...DEFAULT_TOOLS.pen, colors: ['#ffffff', '#1f4fbf'], colorIndex: 1, style: 'brush' as const, widthIndex: 2 }, text: { ...DEFAULT_TOOLS.text, color: '#ffffff', size: 24 }, fingerDraws: true };
    const t = loadTools(withPaletteColors(old as never));
    expect(t.pen.colors).toEqual(PEN_COLORS);
    expect([t.pen.style, t.pen.widthIndex, t.pen.colorIndex]).toEqual(['brush', 2, 0]);
    expect([t.text.color, t.text.size]).toEqual(['#12161A', 24]);
    expect(t.fingerDraws).toBe(true);
  });
});
