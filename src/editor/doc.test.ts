import { describe, expect, it } from 'vitest';
import type { Page, ShapeObj, Stroke, TextObj } from '../../shared/types';
import { hitObject, lassoSelect, refsBox } from '../ink/hit';
import { scaleAbout, translate } from '../ink/transform';
import * as D from './doc';

const stroke = (id: string, x: number, y: number): Stroke => ({ id, tool: 'pen', color: '#000', width: 2, points: [x, y, 0.5, x + 10, y, 0.5, x + 20, y + 2, 0.5] });
const rect: ShapeObj = { id: 'r', type: 'shape', kind: 'rect', points: [100, 100, 200, 100, 200, 160, 100, 160], color: '#000', width: 2, fill: 'rgba(0,0,0,0.3)' };
const text: TextObj = { id: 't', type: 'text', cx: 300, cy: 300, w: 100, h: 30, rotation: 0, text: 'Hallo', font: 'sans', size: 14, color: '#000', background: null, align: 'left' };
const page = (): Page => ({ id: 'p', template: 'blank', strokes: [stroke('a', 10, 10), stroke('b', 400, 400)], objects: [rect, text], comments: [] });

describe('Treffer & Lasso', () => {
  it('trifft gefüllte Form innen und Text im Rahmen', () => {
    expect(hitObject(page(), 150, 130, 2)?.id).toBe('r');
    expect(hitObject(page(), 340, 310, 2)?.id).toBe('t');
    expect(hitObject(page(), 50, 300, 2)).toBeNull();
  });

  it('Lasso wählt Striche und Objekte innerhalb aus', () => {
    const poly = [0, 0, 260, 0, 260, 200, 0, 200];
    const r = lassoSelect(page(), poly);
    expect(r.strokeIds).toEqual(['a']);
    expect(r.objectIds).toEqual(['r']);
    const box = refsBox(page(), r)!;
    expect(box.minX).toBeLessThan(11);
    expect(box.maxX).toBeGreaterThan(200);
  });
});

describe('Dokument-Operationen', () => {
  it('Transformieren, Umfärben, Entfernen, Einfügen', () => {
    const pages = [page()];
    const refs = { strokeIds: ['a'], objectIds: ['r', 't'] };
    const moved = D.transformItems(pages, pages[0], 0, refs, translate(5, 0));
    expect(moved[0].strokes[0].points[0]).toBe(15);
    expect((moved[0].objects[1] as TextObj).cx).toBe(305);
    expect(moved[0].strokes[1]).toBe(pages[0].strokes[1]); // unveränderte Elemente werden geteilt

    const colored = D.recolorItems(pages, 0, refs, '#ff0000');
    expect(colored[0].strokes[0].color).toBe('#ff0000');
    expect((colored[0].objects[0] as ShapeObj).fill).toBe('rgba(255, 0, 0, 0.3)');

    const removed = D.removeItems(pages, 0, refs);
    expect(removed[0].strokes.map((s) => s.id)).toEqual(['b']);
    expect(removed[0].objects).toHaveLength(0);

    const { pages: pasted, refs: newRefs } = D.pasteItems(pages, 0, D.copyItems(pages[0], refs), scaleAbout(2, 0, 0));
    expect(pasted[0].strokes).toHaveLength(3);
    expect(newRefs.objectIds).toHaveLength(2);
    expect(newRefs.objectIds[0]).not.toBe('r');
  });

  it('Kommentar-Thread: anlegen, antworten, bearbeiten, erledigen, löschen', () => {
    let pages = [page()];
    const r = D.addThread(pages, 0, 50, 60, 'Erster', 1);
    pages = r.pages;
    pages = D.addReply(pages, 0, r.id, 'Antwort', 2);
    const t = () => pages[0].comments[0];
    expect(t().messages).toHaveLength(2);
    pages = D.editMessage(pages, 0, r.id, t().messages[1].id, 'Geändert', 3);
    expect(t().messages[1]).toMatchObject({ text: 'Geändert', editedAt: 3 });
    pages = D.setResolved(pages, 0, r.id, true);
    expect(t().resolved).toBe(true);
    pages = D.deleteMessage(pages, 0, r.id, t().messages[1].id);
    expect(t().messages).toHaveLength(1);
    pages = D.deleteMessage(pages, 0, r.id, t().messages[0].id);
    expect(pages[0].comments).toHaveLength(0); // letzte Nachricht → Thread weg
    const r2 = D.addThread(pages, 0, 1, 1, 'x', 4);
    expect(D.deleteThread(r2.pages, 0, r2.id)[0].comments).toHaveLength(0);
  });
});
