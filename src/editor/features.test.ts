/** Tests für Seitendrehung, Seiten kopieren, Vorlagenwechsel mit PDF, Eingravieren, Auswahl und Export. */
import { describe, expect, it } from 'vitest';
import type { ImageObj, Page, Stroke, TextObj } from '../../shared/types';
import { erasePrecise, eraseShapes, eraseWhole } from '../ink/erase';
import { hitItem, lassoSelect } from '../ink/hit';
import { marqueeSelect } from '../tools/selection';
import { placement } from '../export/pdfExport';
import { looksLikeNoahpalle, packNoahpalle, unpackNoahpalle } from '../export/noahpalle';
import { BRAND, DOC_TYPES } from '../../shared/brand';
import * as D from './doc';
import * as P from './pages';

const A4 = { w: 595, h: 842 };
const stroke = (id: string, pts: number[], extra: Partial<Stroke> = {}): Stroke => ({ id, tool: 'pen', color: '#000', width: 2, points: pts, ...extra });
const text = (id: string, extra: Partial<TextObj> = {}): TextObj => ({
  id, type: 'text', cx: 100, cy: 100, w: 120, h: 30, rotation: 0, text: 'Hallo', font: 'sans', size: 16, color: '#000', background: null, align: 'left', ...extra,
});
const page = (extra: Partial<Page> = {}): Page => ({ id: 'p1', template: 'ruled', strokes: [], objects: [], comments: [], ...extra });

describe('Seite drehen', () => {
  it('dreht Inhalte, Kommentare und Größe im Uhrzeigersinn', () => {
    const p = page({
      strokes: [stroke('s', [10, 20, 0.5, 30, 40, 0.5])],
      objects: [text('t', { cx: 100, cy: 50 })],
      comments: [{ id: 'c', x: 0, y: 0, createdAt: 1, resolved: false, messages: [] }],
    });
    const [r] = P.rotatePage([p], 0, A4);
    expect(r.size).toEqual({ w: 842, h: 595 });
    expect(r.rotation).toBe(90);
    // (x, y) → (H − y, x)
    expect(r.strokes[0].points.slice(0, 2).map((v) => Math.round(v))).toEqual([822, 10]);
    const t = r.objects[0] as TextObj;
    expect([Math.round(t.cx), Math.round(t.cy), Math.round(t.rotation)]).toEqual([792, 100, 90]);
    expect([r.comments[0].x, r.comments[0].y]).toEqual([842, 0]);
  });

  it('4× drehen ergibt wieder den Ausgangszustand', () => {
    let pages = [page({ strokes: [stroke('s', [10, 20, 0.5, 30, 40, 0.5])], objects: [text('t')] })];
    for (let i = 0; i < 4; i++) pages = P.rotatePage(pages, 0, A4);
    const r = pages[0];
    expect(r.rotation).toBeUndefined();
    expect(r.size).toEqual(A4);
    expect(r.strokes[0].points.map((v) => Math.round(v * 1000) / 1000)).toEqual([10, 20, 0.5, 30, 40, 0.5]);
    expect(Math.round((r.objects[0] as TextObj).rotation)).toBe(0);
  });

  it('baseSize liefert die unverdrehte Hintergrundgröße', () => {
    const [r] = P.rotatePage([page()], 0, A4);
    expect(P.baseSize(r, A4)).toEqual(A4);
  });
});

describe('Seiten kopieren / duplizieren', () => {
  it('klont alles mit neuen IDs – inkl. Kommentaren, Haftnotizen und Drehung', () => {
    const src = page({
      rotation: 180,
      strokes: [stroke('s', [1, 1, 1])],
      objects: [text('n', { sticky: true, background: '#ffe97a' })],
      comments: [{ id: 'c', x: 5, y: 5, createdAt: 1, resolved: false, messages: [{ id: 'm', text: 'Hi', createdAt: 1, editedAt: null }] }],
    });
    const out = P.pastePages([page({ id: 'x' })], 1, [src]);
    expect(out).toHaveLength(2);
    const c = out[1];
    expect(c.id).not.toBe('p1');
    expect(c.strokes[0].id).not.toBe('s');
    expect((c.objects[0] as TextObj).sticky).toBe(true);
    expect(c.comments[0].id).not.toBe('c');
    expect(c.comments[0].messages[0].text).toBe('Hi');
    expect(c.rotation).toBe(180);
    // Unabhängig vom Original
    c.strokes[0].points[0] = 99;
    expect(src.strokes[0].points[0]).toBe(1);
  });
});

describe('Vorlage wechseln (inkl. PDF)', () => {
  it('blendet den PDF-Hintergrund aus und kann ihn wiederherstellen', () => {
    const pdf = { asset: 'a'.repeat(40), page: 2 };
    const [t] = P.setPageTemplate([page({ pdf })], 0, 'squared');
    expect(t.pdf).toBeUndefined();
    expect(t.hiddenPdf).toEqual(pdf);
    expect(t.template).toBe('squared');
    const [r] = P.restorePdfBackground([t], 0);
    expect(r.pdf).toEqual(pdf);
    expect(r.hiddenPdf).toBeUndefined();
  });
});

describe('Einbetten / Eingravieren', () => {
  const base = () => [
    page({
      strokes: [stroke('s1', [10, 10, 0.5, 50, 10, 0.5]), stroke('s2', [10, 60, 0.5, 50, 60, 0.5])],
      objects: [text('t1', { cx: 30, cy: 120 }), { id: 'sh', type: 'shape', kind: 'line', points: [0, 200, 100, 200], color: '#000', width: 2, fill: null }],
    }),
  ];

  it('eingravierte Striche/Formen übersteht der Radierer', () => {
    const pages = D.engraveItems(base(), 0, { strokeIds: ['s1'], objectIds: ['sh'] });
    const p = pages[0];
    const a = { x: 0, y: 10 };
    const b = { x: 60, y: 10 };
    expect(eraseWhole(p.strokes, a, b, 5).map((s) => s.id)).toEqual(['s1', 's2']);
    expect(erasePrecise(p.strokes, a, b, 5)).toBe(p.strokes);
    expect(eraseShapes(p.objects, { x: 0, y: 200 }, { x: 100, y: 200 }, 5)).toBe(p.objects);
    // nicht eingraviert → wird radiert
    expect(eraseWhole(p.strokes, { x: 0, y: 60 }, { x: 60, y: 60 }, 5).map((s) => s.id)).toEqual(['s1']);
  });

  it('eingravierte Elemente sind nicht mehr auswählbar', () => {
    const p = D.engraveItems(base(), 0, { strokeIds: ['s1'], objectIds: ['t1'] })[0];
    expect(hitItem(p, 30, 10, 4)).toBeNull();
    expect(hitItem(p, 30, 120, 4)).toBeNull();
    expect(hitItem(p, 30, 60, 4)).toEqual({ strokeIds: ['s2'], objectIds: [] });
    const all = [0, 0, 300, 0, 300, 300, 0, 300];
    expect(lassoSelect(p, all)).toEqual({ strokeIds: ['s2'], objectIds: ['sh'] });
    expect(marqueeSelect(p, all)).toEqual({ strokeIds: ['s2'], objectIds: ['sh'] });
    expect(D.countEngraved(p)).toBe(2);
  });

  it('„Seite leeren“ entfernt auch Eingraviertes', () => {
    const pages = D.engraveItems(base(), 0, { strokeIds: ['s1', 's2'], objectIds: ['t1'] });
    expect(P.pageIsEmpty(P.clearPage(pages, 0)[0])).toBe(true);
  });
});

describe('Auswahl-Werkzeug', () => {
  it('trifft Text vor Strich vor Form', () => {
    const p = page({
      strokes: [stroke('s', [0, 100, 0.5, 200, 100, 0.5])],
      objects: [
        { id: 'sh', type: 'shape', kind: 'line', points: [0, 100, 200, 100], color: '#000', width: 2, fill: null },
        text('t', { cx: 100, cy: 100, w: 40, h: 20 }),
      ],
    });
    expect(hitItem(p, 100, 100, 3)?.objectIds).toEqual(['t']);
    expect(hitItem(p, 10, 100, 3)?.strokeIds).toEqual(['s']);
  });
  it('Haftnotiz umfärben setzt Notizfarbe und lesbare Schrift', () => {
    const p = page({ objects: [text('n', { sticky: true, background: '#E1E4E8', color: '#12161A' })] });
    const r = D.recolorItems([p], 0, { strokeIds: [], objectIds: ['n'] }, '#12161A')[0].objects[0] as TextObj;
    expect(r.background).toBe('#12161A');
    expect(r.color).toBe('#F2F3F5'); // Slate 100 statt Weiß
    const light = D.recolorItems([p], 0, { strokeIds: [], objectIds: ['n'] }, '#F2F3F5')[0].objects[0] as TextObj;
    expect(light.color).toBe('#12161A');
  });
});

describe('PDF-Export: Platzierung gedrehter PDF-Seiten', () => {
  it('liefert Ursprung und Winkel je Drehung', () => {
    expect(placement(0, 100, 200)).toEqual({ x: 0, y: 0, rotate: 0 });
    expect(placement(90, 100, 200)).toEqual({ x: 0, y: 100, rotate: -90 });
    expect(placement(180, 100, 200)).toEqual({ x: 100, y: 200, rotate: -180 });
    expect(placement(270, 100, 200)).toEqual({ x: 200, y: 0, rotate: -270 });
  });
});

describe('Dokumentformat (.pnotes, liest auch .noahpalle)', () => {
  const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const pdfBytes = new TextEncoder().encode('%PDF-1.4 test');
  const pdfId = 'b'.repeat(40);

  it('Roundtrip: Seiten, Drehung, Gravuren, Haftnotizen, GIFs, PDF und Kommentare bleiben erhalten', async () => {
    const im: ImageObj = { id: 'g', type: 'image', cx: 50, cy: 50, w: 20, h: 20, rotation: 0, src: gif, naturalW: 1, naturalH: 1, crop: { x: 0, y: 0, w: 1, h: 1 }, animated: true };
    const pages: Page[] = [
      page({
        rotation: 90,
        size: { w: 842, h: 595 },
        pdf: { asset: pdfId, page: 1 },
        strokes: [stroke('s', [1, 2, 0.5], { engraved: true })],
        objects: [im, { ...im, id: 'g2' }, text('n', { sticky: true, background: '#ffe97a' })],
        comments: [{ id: 'c', x: 1, y: 1, createdAt: 1, resolved: true, messages: [{ id: 'm', text: 'Prüfen', createdAt: 1, editedAt: null }] }],
      }),
    ];
    const stored = new Map<string, Uint8Array>([[pdfId, pdfBytes]]);
    const io = { getPdf: async (id: string) => stored.get(id) ?? null, putPdf: async () => pdfId };
    const bytes = await packNoahpalle({ title: 'Test', format: 'A4', orientation: 'portrait', paperColor: 'white', template: 'ruled', coverColor: '#305BB0' }, pages, io);
    expect(looksLikeNoahpalle(bytes)).toBe(true);

    const doc = await unpackNoahpalle(bytes, io);
    expect(doc.manifest.format).toBe(BRAND.doc.manifest);
    expect(doc.manifest.title).toBe('Test');
    // gleiche GIF nur einmal im Container
    expect(doc.manifest.assets.filter((a) => a.type === 'image/gif')).toHaveLength(1);
    const p = doc.pages[0];
    expect(p.rotation).toBe(90);
    expect(p.pdf).toEqual({ asset: pdfId, page: 1 });
    expect(p.strokes[0].engraved).toBe(true);
    expect((p.objects[0] as ImageObj).src).toBe(gif);
    expect((p.objects[0] as ImageObj).animated).toBe(true);
    expect((p.objects[2] as TextObj).sticky).toBe(true);
    expect(p.comments[0].messages[0].text).toBe('Prüfen');
  });

  it('liest auch das jeweils andere Format (.noahpalle ↔ .pnotes)', async () => {
    const io = { getPdf: async () => null, putPdf: async () => pdfId };
    const { zipSync, strToU8 } = await import('fflate');
    for (const d of Object.values(DOC_TYPES)) {
      const bytes = zipSync({
        mimetype: [strToU8(d.mime), { level: 0 }],
        'manifest.json': strToU8(JSON.stringify({ format: d.manifest, formatVersion: 1, title: d.label, notebook: {}, assets: [] })),
        'document.json': strToU8(JSON.stringify({ version: 1, pages: [page()] })),
      });
      expect(looksLikeNoahpalle(bytes)).toBe(true);
      const doc = await unpackNoahpalle(bytes, io);
      expect([doc.manifest.title, doc.pages.length]).toEqual([d.label, 1]);
    }
    // mimetype des einen, Kennung des anderen Formats → abgelehnt
    const mixed = zipSync({ mimetype: strToU8(DOC_TYPES.pnotes.mime), 'manifest.json': strToU8('{"format":"noahpalle","formatVersion":1}'), 'document.json': strToU8('{"pages":[]}') });
    await expect(unpackNoahpalle(mixed, io)).rejects.toThrow(/gültige/);
  });

  it('lehnt fremde Dateien und neuere Formatversionen ab', async () => {
    const io = { getPdf: async () => null, putPdf: async () => pdfId };
    await expect(unpackNoahpalle(new TextEncoder().encode('kein zip'), io)).rejects.toThrow(/gültige/);
    const { zipSync, strToU8 } = await import('fflate');
    const future = zipSync({
      mimetype: strToU8('application/vnd.papierwerk.noahpalle+zip'),
      'manifest.json': strToU8(JSON.stringify({ format: 'noahpalle', formatVersion: 99 })),
      'document.json': strToU8('{"pages":[]}'),
    });
    await expect(unpackNoahpalle(future, io)).rejects.toThrow(/neueren pNotes-Version/);
  });
});

describe('Seite leeren (Auswahl der Inhaltsarten)', () => {
  const full = () =>
    page({
      pdf: { asset: 'a'.repeat(40), page: 2 },
      strokes: [stroke('s1', [0, 0, 0.5, 9, 9, 0.5]), stroke('s2', [5, 5, 0.5, 9, 9, 0.5], { tool: 'highlighter', engraved: true })],
      objects: [
        { id: 'sh', type: 'shape', kind: 'line', points: [0, 0, 50, 50], color: '#000', width: 2, fill: null },
        text('t1'),
        text('n1', { sticky: true, background: '#f5e663' }),
        { id: 'im', type: 'image', cx: 50, cy: 50, w: 40, h: 40, rotation: 0, src: 'data:,', naturalW: 1, naturalH: 1, crop: { x: 0, y: 0, w: 1, h: 1 } } as ImageObj,
      ],
      comments: [{ id: 'c1', x: 1, y: 1, createdAt: 1, resolved: false, messages: [{ id: 'm', text: 'Hi', createdAt: 1, editedAt: null }] }],
    });

  it('zählt je Kategorie', () => {
    expect(P.countPageContent(full())).toEqual({ ink: 2, shapes: 1, texts: 1, stickies: 1, images: 1, comments: 1 });
  });

  it('Standard: entfernt alles inkl. Kommentare und Eingraviertem, Hintergrund bleibt', () => {
    const [r] = P.clearPage([full()], 0);
    expect(P.pageHasContent(r)).toBe(false);
    expect(r.pdf?.page).toBe(2);
  });

  it('nur ausgewählte Arten', () => {
    const [r] = P.clearPage([full()], 0, ['comments', 'images', 'stickies']);
    expect(r.comments).toEqual([]);
    expect(r.objects.map((o) => o.id)).toEqual(['sh', 't1']);
    expect(r.strokes).toHaveLength(2);
    const [r2] = P.clearPage([full()], 0, ['ink']);
    expect(r2.strokes).toEqual([]);
    expect(r2.objects).toHaveLength(4);
    expect(r2.comments).toHaveLength(1);
  });

  it('nichts zu tun → gleiches Array (kein Undo-Schritt)', () => {
    const pages = [page({ comments: [] })];
    expect(P.clearPage(pages, 0)).toBe(pages);
    const pages2 = [full()];
    expect(P.clearPage(pages2, 0, [])).toBe(pages2);
  });
});
