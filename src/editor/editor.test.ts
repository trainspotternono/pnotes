import { describe, expect, it } from 'vitest';
import type { Page } from '../../shared/types';
import * as H from './history';
import * as Ly from './layout';
import * as P from './pages';

describe('Seitenoperationen', () => {
  const pages: Page[] = [
    { id: 'a', template: 'blank', strokes: [], objects: [], comments: [] },
    { id: 'b', template: 'ruled', strokes: [{ id: 's', tool: 'pen', color: '#000', width: 2, points: [0, 0, 0.5, 1, 1, 0.5] }], objects: [], comments: [] },
  ];
  it('einfügen, duplizieren, verschieben, löschen', () => {
    expect(P.insertPage(pages, 1, 'dotted').map((p) => p.template)).toEqual(['blank', 'dotted', 'ruled']);
    const dup = P.duplicatePage(pages, 1);
    expect(dup).toHaveLength(3);
    expect(dup[2].strokes[0].id).not.toBe('s');
    expect(P.movePage(pages, 0, 1).map((p) => p.id)).toEqual(['b', 'a']);
    expect(P.deletePage(pages, 0).map((p) => p.id)).toEqual(['b']);
  });
  it('letzte Seite wird geleert statt gelöscht; Vorlage wechseln', () => {
    const single = [pages[1]];
    const r = P.deletePage(single, 0);
    expect(r).toHaveLength(1);
    expect(r[0].strokes).toHaveLength(0);
    expect(P.setPageTemplate(pages, 0, 'squared')[0].template).toBe('squared');
    expect(P.setPageTemplate(pages, 0, 'blank')).toBe(pages);
  });
});

describe('History', () => {
  it('undo/redo und Verwerfen der Zukunft', () => {
    let h = H.createHistory(1);
    h = H.push(h, 2);
    h = H.push(h, 3);
    h = H.undo(h);
    expect(h.present).toBe(2);
    h = H.redo(h);
    expect(h.present).toBe(3);
    h = H.undo(H.undo(h));
    expect(h.present).toBe(1);
    h = H.push(h, 9);
    expect(h.future).toEqual([]);
    expect(H.redo(h)).toBe(h);
  });

  it('Transaktion: Live-Ersetzungen ergeben einen Undo-Schritt', () => {
    let h = H.createHistory('a');
    const base = h.present;
    h = H.replace(h, 'b');
    h = H.replace(h, 'c');
    h = H.commitFrom(h, base);
    expect(h.past).toEqual(['a']);
    expect(H.undo(h).present).toBe('a');
  });

  it('begrenzt die Länge', () => {
    let h = H.createHistory(0);
    for (let i = 1; i <= H.HISTORY_LIMIT + 50; i++) h = H.push(h, i);
    expect(h.past.length).toBe(H.HISTORY_LIMIT);
  });
});

describe('Layout', () => {
  const same = (n: number) => Array.from({ length: n }, () => ({ w: 100, h: 200 }));
  const L = Ly.computeLayout(same(3), 'vertical');

  it('stapelt Seiten vertikal und horizontal', () => {
    expect(L.pages[2].y).toBe(2 * (200 + Ly.PAGE_GAP));
    expect(L.height).toBe(3 * 200 + 2 * Ly.PAGE_GAP);
    const H2 = Ly.computeLayout(same(3), 'horizontal');
    expect(H2.pages[1].x).toBe(100 + Ly.PAGE_GAP);
    expect(H2.width).toBe(3 * 100 + 2 * Ly.PAGE_GAP);
  });

  it('unterschiedliche Seitengrößen (PDF) werden zentriert gestapelt', () => {
    const M = Ly.computeLayout([{ w: 100, h: 200 }, { w: 300, h: 150 }, { w: 200, h: 100 }], 'vertical');
    expect(M.width).toBe(300);
    expect(M.pages[0].x).toBe(100);
    expect(M.pages[1].x).toBe(0);
    expect(M.pages[2].y).toBe(200 + Ly.PAGE_GAP + 150 + Ly.PAGE_GAP);
    expect(M.height).toBe(450 + 2 * Ly.PAGE_GAP);
    const Hz = Ly.computeLayout([{ w: 100, h: 200 }, { w: 300, h: 100 }], 'horizontal');
    expect(Hz.pages[1].y).toBe(50);
  });

  it('Zoom-Anker hält den Dokumentpunkt unter dem Cursor', () => {
    const m1 = { zoom: 1, viewportW: 800, viewportH: 600 };
    const scroll = { left: 0, top: 120 };
    const p = Ly.screenToDoc(L, m1, scroll, 400, 300);
    const m2 = { ...m1, zoom: 2.5 };
    const s2 = Ly.scrollForAnchor(L, m2, p.x, p.y, 400, 300);
    const back = Ly.screenToDoc(L, m2, s2, 400, 300);
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it('findet Seiten und sichtbaren Bereich', () => {
    expect(Ly.pageAt(L, 50, 250)?.index).toBe(1);
    expect(Ly.pageAt(L, 50, 210)).toBeNull(); // Lücke
    expect(Ly.nearestPage(L, 50, 450)).toBe(2);
    expect(Ly.visiblePages(L, { x: 0, y: 0, w: 100, h: 230 }).map((p) => p.index)).toEqual([0, 1]);
  });

  it('begrenzt Zoom', () => {
    expect(Ly.clampZoom(100)).toBe(Ly.MAX_ZOOM);
    expect(Ly.clampZoom(0)).toBe(Ly.MIN_ZOOM);
  });
});
