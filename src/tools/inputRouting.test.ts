import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOLS, activeColor, activeWidth, type ToolState } from '../ink/tools';
import * as H from '../editor/history';
import { applyPreset, classifyContact, routeInput, sideOf, type RouteInfo } from './inputRouting';

const rect = { left: 0, width: 1000 };
const info = (p: Partial<RouteInfo> = {}): RouteInfo => ({ pointerType: 'touch', width: 6, height: 6, clientX: 200, stylusEraser: false, stylusBarrel: false, ...p });
const withTouch = (p: Partial<ToolState['touch']> = {}, extra: Partial<ToolState> = {}): ToolState => ({ ...DEFAULT_TOOLS, fingerDraws: true, ...extra, touch: { ...DEFAULT_TOOLS.touch, ...p } });

describe('Kontaktklassen', () => {
  it('fein / dick / Handfläche nach Kontaktgröße', () => {
    const t = withTouch({ tipDetect: true, tipThreshold: 12, palmThreshold: 48 });
    expect(classifyContact({ pointerType: 'touch', width: 5, height: 6 }, t)).toBe('fine');
    expect(classifyContact({ pointerType: 'touch', width: 8, height: 14 }, t)).toBe('thick');
    expect(classifyContact({ pointerType: 'touch', width: 60, height: 70 }, t)).toBe('palm');
    // ohne Spitzen-Erkennung bleibt alles „fein“ (Handfläche wird trotzdem erkannt)
    expect(classifyContact({ pointerType: 'touch', width: 14, height: 14 }, withTouch({ tipDetect: false }))).toBe('fine');
    // Stift/Maus werden nie klassifiziert
    expect(classifyContact({ pointerType: 'pen', width: 80, height: 80 }, t)).toBe('fine');
  });
  it('Display-Hälfte', () => {
    expect(sideOf(100, rect)).toBe('left');
    expect(sideOf(700, rect)).toBe('right');
  });
});

describe('routeInput', () => {
  it('Zwei-Seiten-Modus: linke/rechte Hälfte mit eigener Voreinstellung', () => {
    const t = withTouch({}, { dual: { enabled: true, left: { tool: 'pen', color: '#111111', width: 2 }, right: { tool: 'highlighter', color: '#ffe55f', width: 14 } } });
    const l = routeInput(t, info({ clientX: 100 }), rect)!;
    const r = routeInput(t, info({ clientX: 900 }), rect)!;
    expect([l.tool, l.side, activeColor(l.tools.pen), activeWidth(l.tools.pen)]).toEqual(['pen', 'left', '#111111', 2]);
    expect([r.tool, r.side, activeColor(r.tools.highlighter), activeWidth(r.tools.highlighter)]).toEqual(['highlighter', 'right', '#ffe55f', 14]);
  });

  it('Zwei-Seiten-Modus greift nur in Zeichenwerkzeugen (Auswahl bleibt Auswahl)', () => {
    const t = withTouch({}, { tool: 'select', dual: { ...DEFAULT_TOOLS.dual, enabled: true } });
    expect(routeInput(t, info(), rect)!.tool).toBe('select');
  });

  it('dicke Spitze: dicker Strich, Textmarker oder Radierer', () => {
    const thick = info({ width: 16, height: 16 });
    const base = { tipDetect: true, tipThreshold: 12 };
    const a = routeInput(withTouch({ ...base, thickAction: 'thick', thickFactor: 3 }), thick, rect)!;
    expect(activeWidth(a.tools.pen)).toBeCloseTo(activeWidth(DEFAULT_TOOLS.pen) * 3);
    const b = routeInput(withTouch({ ...base, thickAction: 'highlighter' }), thick, rect)!;
    expect(b.tool).toBe('highlighter');
    expect(activeColor(b.tools.highlighter)).toBe(activeColor(DEFAULT_TOOLS.pen));
    expect(routeInput(withTouch({ ...base, thickAction: 'eraser' }), thick, rect)!.tool).toBe('eraser');
    expect(a.cls).toBe('thick');
  });

  it('Handfläche radiert in Kontaktgröße oder wird ignoriert', () => {
    const palm = info({ width: 80, height: 90 });
    const r = routeInput(withTouch({ palmAction: 'eraser' }), palm, rect)!;
    expect(r.tool).toBe('eraser');
    expect(r.tools.eraser.sizes[r.tools.eraser.sizeIndex]).toBe(45);
    expect(routeInput(withTouch({ palmAction: 'ignore' }), palm, rect)).toBeNull();
  });

  it('Stift-Radiertaste und Seitentaste haben Vorrang', () => {
    const t = withTouch({}, { dual: { ...DEFAULT_TOOLS.dual, enabled: true } });
    expect(routeInput(t, info({ pointerType: 'pen', stylusEraser: true }), rect)!.tool).toBe('eraser');
    expect(routeInput(t, info({ pointerType: 'pen', stylusBarrel: true }), rect)!.tool).toBe('select');
  });

  it('Radierer-Voreinstellung setzt den Radius', () => {
    const t = applyPreset(DEFAULT_TOOLS, { tool: 'eraser', color: '#000', width: 28 });
    expect(t.tool).toBe('eraser');
    expect(t.eraser.sizes[t.eraser.sizeIndex]).toBe(28);
  });
});

describe('Undo bei parallelen Gesten', () => {
  it('zwei Transaktionen mit gleichem Ausgangsstand ergeben einen Undo-Schritt', () => {
    let h = H.createHistory('A');
    h = H.replace(h, 'AB');
    h = H.commitFrom(h, 'A');
    h = H.replace(h, 'ABC');
    h = H.commitFrom(h, 'A');
    expect(h.past).toEqual(['A']);
    expect(H.undo(h).present).toBe('A');
  });
});
