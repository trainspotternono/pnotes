/**
 * Automatischer Smoke-Test: startet die echte App (gebaute Dateien) mit einem
 * temporären Datenordner, klickt Szenarien durch, prüft Ergebnisse und speichert
 * Screenshots unter ./smoke-output. Aufruf: `npm run smoke` (alle) oder
 * `electron . --smoke=library|editor|draw`.
 */
import { shell, type BrowserWindow, type WebContents } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRAND } from '../shared/brand';
import { openDocumentPath } from './files';
import { setLoginPageOpener } from './sync';
import { startMockServer } from './sync/mock-server';
import { makeTestPdf } from './testPdf';

interface Ctx {
  win: BrowserWindow;
  wc: WebContents;
  dataDir: string;
  outDir: string;
  steps: string[];
}

type Scenario = (c: Ctx) => Promise<void>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const js = <T = unknown>(c: Ctx, code: string): Promise<T> => c.wc.executeJavaScript(code, true);

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion fehlgeschlagen: ${msg}`);
}

async function waitFor(c: Ctx, selector: string, timeout = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await js<boolean>(c, `!!document.querySelector(${JSON.stringify(selector)})`)) return;
    await sleep(50);
  }
  throw new Error(`Timeout: ${selector} erscheint nicht`);
}

async function waitUntil(c: Ctx, expr: string, what: string, timeout = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await js<boolean>(c, `!!(${expr})`)) return;
    await sleep(50);
  }
  throw new Error(`Timeout: ${what}`);
}

async function click(c: Ctx, selector: string): Promise<void> {
  await waitFor(c, selector);
  await js(c, `document.querySelector(${JSON.stringify(selector)}).click()`);
  await sleep(60);
}

async function contextMenu(c: Ctx, selector: string): Promise<void> {
  await waitFor(c, selector);
  await js(
    c,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 20 })); })()`,
  );
  await sleep(60);
}

async function setInput(c: Ctx, selector: string, value: string): Promise<void> {
  await waitFor(c, selector);
  await js(
    c,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await sleep(60);
}

const count = (c: Ctx, selector: string) =>
  js<number>(c, `document.querySelectorAll(${JSON.stringify(selector)}).length`);

async function screenshot(c: Ctx, name: string): Promise<void> {
  await sleep(250);
  const img = await c.wc.capturePage();
  const file = path.join(c.outDir, `${name}.png`);
  fs.writeFileSync(file, img.toPNG());
  c.steps.push(`Screenshot: ${file}`);
}

async function reload(c: Ctx): Promise<void> {
  const done = new Promise<void>((r) => c.wc.once('did-finish-load', () => r()));
  c.wc.reload();
  await done;
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Legt über den echten Dialog ein Notizbuch an (Editor wird danach ggf. verlassen). */
async function createNotebook(c: Ctx, title: string, template: string, leaveEditor = true) {
  await click(c, '[data-testid=new-menu]');
  await click(c, '[data-testid=ctx-new-notebook]');
  await waitFor(c, '[data-testid=new-notebook-dialog]');
  await setInput(c, '[data-testid=notebook-title]', title);
  await click(c, `[data-template=${template}]`);
  await click(c, '[data-testid=create-notebook]');
  await sleep(300);
  if (leaveEditor && (await count(c, '[data-testid=editor]')) > 0) {
    await click(c, '[data-testid=editor-back]');
    await waitFor(c, '[data-testid=library]');
  }
}

// ---------------------------------------------------------------- Szenarien

const library: Scenario = async (c) => {
  await waitFor(c, '[data-testid=library]');
  c.steps.push('Bibliothek geladen');

  await click(c, '[data-testid=new-menu]');
  await click(c, '[data-testid=ctx-new-folder]');
  await setInput(c, '[data-testid=prompt-input]', 'Uni');
  await click(c, '[data-testid=prompt-confirm]');
  assert((await count(c, '[data-testid=item-folder]')) === 1, 'Ordner „Uni“ angelegt');
  c.steps.push('Ordner angelegt');

  await createNotebook(c, 'Mathe', 'squared');
  assert((await count(c, '[data-testid=item-notebook]')) === 1, 'Notizbuch „Mathe“ angelegt');
  c.steps.push('Notizbuch im Stammordner angelegt');

  await click(c, '[data-testid=item-folder] [data-testid=item-open]');
  await waitUntil(c, `document.querySelector('[data-testid=breadcrumb]')?.textContent.includes('Uni')`, 'Breadcrumb zeigt Uni');
  await createNotebook(c, 'Physik', 'ruled');
  assert((await count(c, '[data-testid=item-notebook]')) === 1, 'Notizbuch im Ordner');
  await click(c, '[data-testid=crumb-root]');
  c.steps.push('Unterordner + Notizbuch angelegt, Breadcrumb-Navigation ok');

  await setInput(c, '[data-testid=search]', 'phy');
  await waitUntil(c, `document.querySelectorAll('[data-testid=item-notebook]').length === 1 && document.body.textContent.includes('Physik')`, 'Suche findet Physik');
  await setInput(c, '[data-testid=search]', '');
  c.steps.push('Rekursive Suche ok');

  await contextMenu(c, '[data-testid=item-notebook]');
  await click(c, '[data-testid=ctx-trash]');
  assert((await count(c, '[data-testid=item-notebook]')) === 0, 'Notizbuch im Papierkorb');
  await click(c, '[data-testid=nav-trash]');
  assert((await count(c, '[data-testid=item-notebook]')) === 1, 'Papierkorb zeigt Notizbuch');
  await contextMenu(c, '[data-testid=item-notebook]');
  await click(c, '[data-testid=ctx-restore]');
  await click(c, '[data-testid=nav-documents]');
  assert((await count(c, '[data-testid=item-notebook]')) === 1, 'Wiederhergestellt');
  c.steps.push('Papierkorb + Wiederherstellen ok');

  await contextMenu(c, '[data-testid=item-folder]');
  await click(c, '[data-testid=ctx-favorite]');
  await click(c, '[data-testid=nav-favorites]');
  assert((await count(c, '[data-testid=item-folder]')) === 1, 'Favorit sichtbar');
  await click(c, '[data-testid=nav-documents]');
  c.steps.push('Favoriten ok');

  await screenshot(c, 'm1-library-light');
  await click(c, '[data-testid=theme-dark]');
  await screenshot(c, 'm1-library-dark');
  await click(c, '[data-testid=theme-light]');

  await click(c, '[data-testid=new-menu]');
  await click(c, '[data-testid=ctx-new-notebook]');
  await screenshot(c, 'm1-new-notebook-dialog');
  await click(c, '[data-testid=dialog-cancel]');

  await sleep(900); // Autosave (debounced)
  const lib = readJsonFile<{ folders: unknown[]; notebooks: unknown[] }>(path.join(c.dataDir, 'library.json'));
  assert(lib && lib.folders.length === 1 && lib.notebooks.length === 2, 'library.json enthält 1 Ordner / 2 Notizbücher');
  await reload(c);
  await waitFor(c, '[data-testid=library]');
  await waitUntil(c, `document.querySelectorAll('[data-testid=item-notebook]').length === 1 && document.querySelectorAll('[data-testid=item-folder]').length === 1`, 'Daten nach Neustart vorhanden');
  c.steps.push('Persistenz nach Reload ok');
};

const zoomPct = async (c: Ctx) => parseInt(await js<string>(c, `document.querySelector('[data-testid=zoom-label]').textContent`), 10);

const editor: Scenario = async (c) => {
  await waitFor(c, '[data-testid=library]');
  await createNotebook(c, 'Editor-Test', 'ruled', false);
  await waitFor(c, '[data-testid=page]');
  assert((await count(c, '[data-testid=page]')) === 1, 'Neues Notizbuch hat 1 Seite');
  c.steps.push('Editor geöffnet (Liniert)');

  await click(c, '[data-testid=add-page]');
  await click(c, '[data-testid=add-page]');
  await waitUntil(c, `document.querySelectorAll('[data-testid=page]').length === 3`, '3 Seiten');
  c.steps.push('Seiten hinzugefügt (3)');

  const z0 = await zoomPct(c);
  await click(c, '[data-testid=zoom-in]');
  const z1 = await zoomPct(c);
  assert(z1 > z0, `Zoom-in erhöht Zoom (${z0}% → ${z1}%)`);
  // Strg + Mausrad über der Seite
  const r = await js<{ x: number; y: number }>(c, `(() => { const r = document.querySelector('[data-testid=stage]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  for (let i = 0; i < 3; i++) {
    c.wc.sendInputEvent({ type: 'mouseWheel', x: r.x, y: r.y, deltaX: 0, deltaY: -120, modifiers: ['control'] } as Electron.MouseWheelInputEvent);
    await sleep(80);
  }
  const z2 = await zoomPct(c);
  assert(z2 !== z1, `Strg+Mausrad ändert Zoom (${z1}% → ${z2}%)`);
  c.steps.push(`Zoom ok (${z0}% → ${z1}% → ${z2}%)`);
  await click(c, '[data-testid=zoom-fit]');

  await click(c, '[data-testid=undo]');
  await waitUntil(c, `document.querySelectorAll('[data-testid=page]').length === 2`, 'Undo entfernt Seite');
  await click(c, '[data-testid=redo]');
  await waitUntil(c, `document.querySelectorAll('[data-testid=page]').length === 3`, 'Redo stellt Seite wieder her');
  c.steps.push('Undo/Redo für Seiten ok');

  await contextMenu(c, '[data-testid=thumb]:nth-child(2)');
  await click(c, '[data-testid=ctx-template-squared]');
  await waitUntil(c, `document.querySelector('[data-page="1"] [data-paper]')?.getAttribute('data-paper') === 'squared'`, 'Vorlage gewechselt');
  c.steps.push('Vorlage pro Seite wechseln ok');

  await click(c, '[data-testid=more-menu]');
  await click(c, '[data-testid=ctx-dir-horizontal]');
  await sleep(300);
  await screenshot(c, 'm2-editor-horizontal');
  await click(c, '[data-testid=more-menu]');
  await click(c, '[data-testid=ctx-dir-vertical]');
  await screenshot(c, 'm2-editor-vertical');

  await click(c, '[data-testid=editor-back]');
  await waitFor(c, '[data-testid=library]');
  await sleep(500);
  const lib = readJsonFile<{ notebooks: { id: string; title: string; pageCount: number }[] }>(path.join(c.dataDir, 'library.json'));
  const nb = lib?.notebooks.find((n) => n.title === 'Editor-Test');
  assert(nb && nb.pageCount === 3, 'pageCount in library.json = 3');
  const content = readJsonFile<{ pages: { template: string }[] }>(path.join(c.dataDir, 'notebooks', `${nb.id}.json`));
  assert(content && content.pages.length === 3 && content.pages[1].template === 'squared', 'Notizbuch-Datei gespeichert (3 Seiten, Seite 2 kariert)');
  c.steps.push('Autosave der Seiten ok');
};

/** Echte Maus-Eingabe über Electron (erzeugt PointerEvents vom Typ "mouse"). */
async function drag(c: Ctx, pts: [number, number][]) {
  const [x0, y0] = pts[0];
  c.wc.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 });
  c.wc.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
  for (const [x, y] of pts.slice(1)) {
    c.wc.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftbuttondown'] });
    await sleep(8);
  }
  const [x1, y1] = pts[pts.length - 1];
  c.wc.sendInputEvent({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 });
  await sleep(120);
}

async function key(c: Ctx, keyCode: string, modifiers: ('control' | 'shift')[] = []) {
  c.wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  c.wc.sendInputEvent({ type: 'char', keyCode, modifiers });
  c.wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await sleep(120);
}

const strokeCount = (c: Ctx) => js<number>(c, `Number(document.querySelector('[data-testid=editor]').dataset.strokes)`);

const draw: Scenario = async (c) => {
  await waitFor(c, '[data-testid=library]');
  await createNotebook(c, 'Zeichentest', 'dotted', false);
  await waitFor(c, '[data-page="0"]');
  await sleep(300);
  const r = await js<{ x: number; y: number; w: number }>(
    c,
    `(() => { const r = document.querySelector('[data-page="0"]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; })()`,
  );
  const wave = (y: number): [number, number][] => Array.from({ length: 60 }, (_, i) => [r.x + 80 + i * 6, Math.round(r.y + y + Math.sin(i / 5) * 18)]);

  await key(c, 'p'); // Klick auf den schon aktiven Stift würde dessen Optionen (Popover) öffnen
  await drag(c, wave(100));
  await waitUntil(c, `document.querySelector('[data-testid=editor]').dataset.strokes === '1'`, 'Stift-Strich angelegt');
  c.steps.push('Stift-Strich per Maus gezeichnet');

  await key(c, 'z', ['control']);
  assert((await strokeCount(c)) === 0, 'Strg+Z entfernt den Strich');
  await key(c, 'y', ['control']);
  assert((await strokeCount(c)) === 1, 'Strg+Y stellt ihn wieder her');
  c.steps.push('Undo/Redo per Tastatur ok');

  await key(c, 'h');
  await drag(c, wave(200));
  assert((await strokeCount(c)) === 2, 'Textmarker-Strich angelegt');
  await screenshot(c, 'm3-draw');

  await key(c, 'e');
  await drag(c, Array.from({ length: 20 }, (_, i) => [r.x + 80 + 90, r.y + 60 + i * 4] as [number, number]));
  assert((await strokeCount(c)) === 1, 'Radierer (ganzer Strich) entfernt den Stift-Strich');
  c.steps.push('Radierer ok');
  await screenshot(c, 'm3-erased');

  await click(c, '[data-testid=editor-back]');
  await waitFor(c, '[data-testid=library]');
  await sleep(500);
  const lib = readJsonFile<{ notebooks: { id: string; title: string }[] }>(path.join(c.dataDir, 'library.json'));
  const nb = lib?.notebooks.find((n) => n.title === 'Zeichentest');
  assert(nb, 'Notizbuch in library.json');
  const content = readJsonFile<{ pages: { strokes: { tool: string; points: number[] }[] }[] }>(path.join(c.dataDir, 'notebooks', `${nb.id}.json`));
  const strokes = content?.pages[0].strokes ?? [];
  assert(strokes.length === 1 && strokes[0].tool === 'highlighter' && strokes[0].points.length >= 6, 'Striche lokal gespeichert (1 Textmarker)');
  c.steps.push('Striche in notebooks/<id>.json gespeichert');
};

/** Ziehen mit Halten am Ende (Zeichnen und Halten). */
async function dragHold(c: Ctx, pts: [number, number][], holdMs: number) {
  const [x0, y0] = pts[0];
  c.wc.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 });
  c.wc.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
  for (const [x, y] of pts.slice(1)) {
    c.wc.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftbuttondown'] });
    await sleep(8);
  }
  await sleep(holdMs);
  const [x1, y1] = pts[pts.length - 1];
  c.wc.sendInputEvent({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 });
  await sleep(150);
}

const editorCounts = (c: Ctx) =>
  js<{ strokes: number; objects: number }>(c, `(() => { const d = document.querySelector('[data-testid=editor]').dataset; return { strokes: +d.strokes, objects: +d.objects }; })()`);

const shapes: Scenario = async (c) => {
  await waitFor(c, '[data-testid=library]');
  await createNotebook(c, 'Formentest', 'blank', false);
  await waitFor(c, '[data-page="0"]');
  await sleep(300);
  const r = await js<{ x: number; y: number }>(c, `(() => { const r = document.querySelector('[data-page="0"]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; })()`);
  const cx = r.x + 200;
  const cy = r.y + 180;

  // Kreis mit dem Stift zeichnen und am Ende halten → Ellipse/Kreis + Form-Leiste
  await key(c, 'p');
  const circle: [number, number][] = Array.from({ length: 61 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2.03;
    return [Math.round(cx + Math.cos(a) * 60 + Math.sin(i) * 1.5), Math.round(cy + Math.sin(a) * 58)];
  });
  await dragHold(c, circle, 750);
  await waitFor(c, '[data-testid=shape-bar]');
  assert((await editorCounts(c)).objects === 1, 'Kreis eingerastet');
  c.steps.push('Hold-to-Shape: Kreis eingerastet');

  // „Als Freihand“ stellt den Originalstrich wieder her
  await click(c, '[data-testid=shape-keep-freehand]');
  const afterKeep = await editorCounts(c);
  assert(afterKeep.objects === 0 && afterKeep.strokes === 1, '„Als Freihand“ ersetzt die Form durch den Originalstrich');
  c.steps.push('„Als Freihand behalten“ ok');

  // Fünfeck mit dem Formen-Werkzeug → bleibt Freihand (keine Polygone)
  await key(c, 's');
  const pent: [number, number][] = [];
  for (let s = 0; s < 5; s++) {
    const a0 = (s / 5) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((s + 1) / 5) * Math.PI * 2 - Math.PI / 2;
    for (let i = 0; i < 15; i++) {
      const t = i / 15;
      pent.push([Math.round(cx + 260 + Math.cos(a0) * 70 * (1 - t) + Math.cos(a1) * 70 * t), Math.round(cy + Math.sin(a0) * 70 * (1 - t) + Math.sin(a1) * 70 * t)]);
    }
  }
  pent.push(pent[0]);
  await dragHold(c, pent, 0);
  const afterPent = await editorCounts(c);
  assert(afterPent.objects === 0 && afterPent.strokes === 2, `Fünfeck bleibt Freihand (Objekte ${afterPent.objects}, Striche ${afterPent.strokes})`);
  c.steps.push('Fünfeck → Freihandstrich');

  // Rechteck mit dem Formen-Werkzeug → rastet ein
  const rect: [number, number][] = [];
  const corners: [number, number][] = [[cx - 60, cy + 120], [cx + 140, cy + 120], [cx + 140, cy + 220], [cx - 60, cy + 220], [cx - 60, cy + 120]];
  for (let s = 0; s < 4; s++) for (let i = 0; i < 20; i++) rect.push([Math.round(corners[s][0] + ((corners[s + 1][0] - corners[s][0]) * i) / 20), Math.round(corners[s][1] + ((corners[s + 1][1] - corners[s][1]) * i) / 20)]);
  rect.push(corners[0]);
  await dragHold(c, rect, 0);
  assert((await editorCounts(c)).objects === 1, 'Rechteck eingerastet');
  c.steps.push('Formen-Werkzeug: Rechteck eingerastet');
  await screenshot(c, 'shapes');
};

/** Datei in ein <input type=file> setzen (wie eine Auswahl im Windows-Dateidialog), per CDP. */
async function setFile(c: Ctx, selector: string, file: string) {
  const dbg = c.wc.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  const { root } = await dbg.sendCommand('DOM.getDocument', { depth: 1 });
  const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
  assert(nodeId, `Datei-Input ${selector} gefunden`);
  await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: [file] });
}

/** Mittelpixel des farbigen Balkens oben auf einer gerenderten PDF-Seite (null = noch nicht gerendert). */
const pdfPixel = (c: Ctx, page: number) =>
  js<number[] | null>(
    c,
    `(() => { const cv = document.querySelector('[data-page="${page}"] .pdf-page canvas'); if (!cv || cv.width < 10) return null;
      const d = cv.getContext('2d').getImageData(Math.floor(cv.width * 0.5), Math.floor(cv.height * 0.13), 1, 1).data; return [cv.width, cv.height, d[0], d[1], d[2]]; })()`,
  );

const pdf: Scenario = async (c) => {
  const file = path.join(c.outDir, 'pNotes-Testdokument.pdf');
  fs.writeFileSync(file, makeTestPdf(3));
  await waitFor(c, '[data-testid=library]');

  // 1) PDF als neues Notizbuch, nur Seiten 1 und 3
  await setFile(c, '[data-testid=library-pdf-file]', file);
  await waitFor(c, '[data-testid=pdf-import-dialog]');
  await waitUntil(c, `document.querySelectorAll('[data-testid=pdf-cell]').length === 3`, 'Dialog zeigt 3 PDF-Seiten', 15000);
  await setInput(c, '[data-testid=pdf-range]', '1, 3');
  await waitUntil(c, `document.querySelectorAll('[data-testid=pdf-cell].on').length === 2`, 'Bereich „1, 3“ wählt 2 Seiten');
  await screenshot(c, 'pdf-import-dialog');
  await click(c, '[data-testid=pdf-import-confirm]');
  await waitFor(c, '[data-testid=editor]', 10000);
  await waitUntil(c, `document.querySelectorAll('.page-sheet.is-pdf').length === 2`, '2 PDF-Seiten im Notizbuch');
  c.steps.push('PDF als Notizbuch importiert (Seiten 1 und 3)');

  // 2) pdf.js hat gerendert: Pixel im blauen Balken der ersten Seite
  let px: number[] | null = null;
  for (let i = 0; i < 100 && !px; i++) {
    px = await pdfPixel(c, 0);
    if (!px) await sleep(100);
  }
  assert(px, 'PDF-Seite wurde gerendert');
  assert(px[4] > 150 && px[2] < 100, `Seite 1 zeigt den blauen PDF-Balken (RGB ${px.slice(2).join(',')}, ${px[0]}×${px[1]} px)`);
  c.steps.push(`pdf.js-Rendering ok (${px[0]}×${px[1]} px, Balken RGB ${px.slice(2).join(',')})`);

  // 3) Auf der PDF-Seite markieren
  const r = await js<{ x: number; y: number; w: number }>(c, `(() => { const r = document.querySelector('[data-page="0"]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; })()`);
  await key(c, 'h');
  await drag(c, Array.from({ length: 30 }, (_, i) => [r.x + 60 + i * 12, r.y + Math.round(r.w * 0.34)] as [number, number]));
  assert((await strokeCount(c)) === 1, 'Textmarker auf PDF-Seite');
  await screenshot(c, 'pdf-editor');
  c.steps.push('Textmarker auf PDF-Seite gezeichnet');

  // 4) PDF-Seiten in das bestehende Notizbuch einfügen (alle, am Ende)
  await setFile(c, '[data-testid=pdf-file]', file);
  await waitFor(c, '[data-testid=pdf-import-dialog]');
  await waitUntil(c, `document.querySelectorAll('[data-testid=pdf-cell].on').length === 3`, 'Alle 3 Seiten vorausgewählt', 15000);
  await click(c, '[data-testid=pdf-position] [data-value=end]');
  await click(c, '[data-testid=pdf-import-confirm]');
  await waitUntil(c, `document.querySelectorAll('.page-sheet.is-pdf').length === 5`, '5 PDF-Seiten nach dem Einfügen');
  c.steps.push('PDF-Seiten am Ende eingefügt (2 + 3 = 5)');

  // 5) Gespeichert: Seiten verweisen auf das Asset, PDF liegt einmal im Asset-Ordner
  await click(c, '[data-testid=editor-back]');
  await waitFor(c, '[data-testid=library]');
  await sleep(600);
  const lib = readJsonFile<{ notebooks: { id: string; title: string; coverPdf?: { asset: string } }[] }>(path.join(c.dataDir, 'library.json'));
  const nb = lib?.notebooks.find((n) => n.title === 'pNotes-Testdokument');
  assert(nb?.coverPdf?.asset, 'Notizbuch mit PDF-Cover in library.json');
  const content = readJsonFile<{ pages: { pdf?: { asset: string; page: number }; size?: { w: number }; strokes: unknown[] }[] }>(path.join(c.dataDir, 'notebooks', `${nb.id}.json`));
  assert(content?.pages.map((p) => p.pdf?.page).join(',') === '1,3,1,2,3', `Seitenreihenfolge ${content?.pages.map((p) => p.pdf?.page).join(',')}`);
  assert(content.pages[0].strokes.length === 1, 'Textmarker an PDF-Seite 1 gespeichert');
  assert(Math.round(content.pages[3].size!.w) === 842, 'Querformat-Seite behält ihre Größe');
  const assets = fs.readdirSync(path.join(c.dataDir, 'assets'));
  assert(assets.length === 1 && assets[0] === `${nb.coverPdf.asset}.pdf`, `genau eine PDF im Asset-Ordner (${assets.join(', ')})`);
  c.steps.push(`Gespeichert: notebooks/${nb.id}.json → assets/${assets[0]}`);
  await waitUntil(c, `!!document.querySelector('.cover-pdf canvas') && document.querySelector('.cover-pdf canvas').width > 10`, 'PDF-Cover in der Bibliothek gerendert', 10000);
  await screenshot(c, 'pdf-library');
};

/** Nextcloud-SSO (Login Flow v2) gegen den Mock: Login-Name ≠ Benutzer-ID, danach echter Sync und Trennen (Widerruf). */
const sso: Scenario = async (c) => {
  const server = await startMockServer({ user: 'u-7f3a', loginName: 'anna@example.com', password: 'ssoAp-pPass-word0-12345-abcde' });
  let opened = '';
  // „Browser“: Anmeldeseite laden, kurz warten (App pollt bereits), dann „Zugriff gewähren“
  setLoginPageOpener(async (url) => {
    opened = url;
    setTimeout(() => {
      void fetch(url)
        .then(() => sleep(2500))
        .then(() => fetch(url.replace('/flow/', '/grant/'), { method: 'POST' }));
    }, 0);
  });
  try {
    await createNotebook(c, 'SSO-Test', 'ruled');
    await click(c, '[data-testid=sync-indicator]');
    await click(c, '[data-testid=sync-setup]');
    await waitFor(c, '[data-testid=sync-settings]');
    assert((await count(c, '[data-testid=sync-password]')) === 0, 'Passwortfeld standardmäßig ausgeblendet');
    await setInput(c, '[data-testid=sync-url]', server.url);
    await click(c, '[data-testid=sso-login]');
    await waitFor(c, '[data-testid=sso-cancel]');
    await screenshot(c, 'sso-waiting');
    assert(opened.startsWith(`${server.url}/login/v2/flow/`), `Anmeldeseite geöffnet (${opened})`);
    await waitUntil(c, `!document.querySelector('[data-testid=sync-settings]')`, 'Dialog schließt nach Anmeldung', 15000);
    c.steps.push('SSO: Anmeldung im (simulierten) Browser abgeschlossen');
    await waitUntil(c, `document.querySelector('[data-testid=sync-indicator]').classList.contains('sync-idle')`, 'Sync erfolgreich', 15000);
    const cfg = readJsonFile<{ username: string; loginName?: string; authMethod?: string; passwordEnc?: string }>(path.join(path.dirname(c.dataDir), 'sync-config.json'));
    assert(cfg?.authMethod === 'sso' && cfg.username === 'u-7f3a' && cfg.loginName === 'anna@example.com', `sync-config.json (${JSON.stringify({ ...cfg, passwordEnc: cfg?.passwordEnc ? '…' : null })})`);
    assert(cfg.passwordEnc && !cfg.passwordEnc.includes('ssoAp'), 'App-Passwort verschlüsselt gespeichert');
    assert([...server.files.keys()].some((k) => k.startsWith('/pNotes-Sync/notebooks/')), 'Notizbuch auf den Server hochgeladen');
    c.steps.push(`SSO: als u-7f3a (Login anna@example.com) verbunden, ${[...server.files.keys()].filter((k) => k.includes('/notebooks/')).length} Notizbuch hochgeladen`);

    await click(c, '[data-testid=sync-indicator]');
    await click(c, '[data-testid=sync-popover] .btn-ghost');
    await waitFor(c, '[data-testid=sso-box]');
    await screenshot(c, 'sso-connected');
    await click(c, '[data-testid=sync-clear]');
    await waitUntil(c, `document.querySelector('[data-testid=sync-indicator]').classList.contains('sync-off')`, 'Sync getrennt');
    await sleep(300);
    assert(server.revoked === 1, 'App-Passwort beim Trennen widerrufen');
    c.steps.push('SSO: Trennen widerruft das App-Passwort auf dem Server');
  } finally {
    setLoginPageOpener((url) => shell.openExternal(url));
    await server.close();
  }
};

// ---------------------------------------------------------------- Neue Funktionen

/** Echte Stift-Eingabe (PointerEvent.pointerType === 'pen') über das Chrome DevTools Protocol – wie ein HP-Stift. */
async function pen(c: Ctx, type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number, y: number, pressed: boolean, button: 'left' | 'right' = 'left') {
  const dbg = c.wc.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: type === 'mouseMoved' && !pressed ? 'none' : button,
    buttons: pressed ? (button === 'left' ? 1 : 2) : 0,
    clickCount: type === 'mouseMoved' ? 0 : 1,
    pointerType: 'pen',
    force: pressed ? 0.6 : 0,
  });
}

async function penDrag(c: Ctx, pts: [number, number][], during?: (i: number) => Promise<void>) {
  await pen(c, 'mouseMoved', pts[0][0], pts[0][1], false);
  await pen(c, 'mousePressed', pts[0][0], pts[0][1], true);
  for (let i = 1; i < pts.length; i++) {
    await pen(c, 'mouseMoved', pts[i][0], pts[i][1], true);
    if (during) await during(i);
    await sleep(8);
  }
  const last = pts[pts.length - 1];
  await pen(c, 'mouseReleased', last[0], last[1], false);
  await sleep(150);
}

async function touch(c: Ctx, type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) {
  const dbg = c.wc.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 7, radiusX: 18, radiusY: 18 }] });
}

/**
 * Animiertes GIF (S×S px, 2 Bilder: rot / blau, je 100 ms, Endlosschleife) – von Hand kodiert.
 * LZW ohne Kompression: nach je 2 Pixeln ein Clear-Code, damit die Codebreite konstant 3 Bit bleibt.
 */
function makeAnimatedGif(S = 32): Buffer {
  const lzwFill = (index: number): number[] => {
    const codes: number[] = [];
    for (let i = 0; i < S * S; i += 2) codes.push(4, index, ...(i + 1 < S * S ? [index] : []));
    codes.push(5);
    const bytes: number[] = [];
    let acc = 0;
    let bits = 0;
    for (const c of codes) {
      acc |= c << bits;
      bits += 3;
      while (bits >= 8) {
        bytes.push(acc & 0xff);
        acc >>= 8;
        bits -= 8;
      }
    }
    if (bits) bytes.push(acc & 0xff);
    const blocks: number[] = [];
    for (let i = 0; i < bytes.length; i += 255) {
      const chunk = bytes.slice(i, i + 255);
      blocks.push(chunk.length, ...chunk);
    }
    return [0x02, ...blocks, 0x00];
  };
  const frame = (index: number) => [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0, 0, 0, 0, S, 0, S, 0, 0x00, ...lzwFill(index)];
  return Buffer.from([
    ...Buffer.from('GIF89a', 'ascii'), S, 0, S, 0, 0x80, 0, 0,
    0xff, 0x00, 0x00, 0x00, 0x00, 0xff,
    0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'), 0x03, 0x01, 0x00, 0x00, 0x00,
    ...frame(0),
    ...frame(1),
    0x3b,
  ]);
}

const pageRect = (c: Ctx, i = 0) =>
  js<{ x: number; y: number; w: number; h: number }>(
    c,
    `(() => { const r = document.querySelector('[data-page="${i}"]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()`,
  );

const features: Scenario = async (c) => {
  await waitFor(c, '[data-testid=library]');
  await createNotebook(c, 'Funktionstest', 'ruled', false);
  await waitFor(c, '[data-page="0"]');
  await sleep(900); // Start-Zoom (Seitenbreite) abwarten
  await js(c, `window.__ptr = []; document.addEventListener('pointerdown', (e) => window.__ptr.push(e.pointerType + ':' + e.button), true)`);
  let r = await pageRect(c);
  // alle Testpunkte im sichtbaren Bereich (Fenster 1280×800)
  const vis = (y: number) => Math.min(y, 760 - r.y);
  const wave = (y: number): [number, number][] => Array.from({ length: 50 }, (_, i) => [r.x + 80 + i * 6, Math.round(r.y + y + Math.sin(i / 5) * 14)]);

  // 1) Zwei Striche
  await key(c, 'p'); // (Klick auf den schon aktiven Stift würde dessen Optionen öffnen)
  await drag(c, wave(60));
  await drag(c, wave(230));
  assert((await strokeCount(c)) === 2, '2 Striche gezeichnet');

  // 2) Auswahlmodus (oberer Knopf) + HP-Stift: Antippen wählt den Strich
  await click(c, '[data-testid=tool-select]');
  assert((await js<string>(c, `document.querySelector('[data-testid=editor]').dataset.tool`)) === 'select', 'Auswahlmodus aktiv');
  const [px, py] = wave(60)[10];
  await penDrag(c, [[px, py]]);
  await waitFor(c, '[data-testid=selection-bar]');
  assert((await js<string[]>(c, 'window.__ptr')).includes('pen:0'), 'Stift-Pointer (pointerType "pen") kommt an');
  const label = await js<string>(c, `document.querySelector('[data-testid=sel-engrave]').textContent`);
  assert(label.includes('Handschrift eingravieren'), `Einbetten-Knopf: „${label}“`);
  c.steps.push('HP-Stift (pointerType pen): Strich im Auswahlmodus angetippt → ausgewählt');

  // 3) Mit dem Stift verschieben – währenddessen liegt der Handballen auf (Touch) → darf nicht scrollen
  const scroll0 = await js<number>(c, `document.querySelector('[data-testid=stage]').scrollTop`);
  const path1: [number, number][] = Array.from({ length: 16 }, (_, i) => [px, py + i * 5]);
  await penDrag(c, path1, async (i) => {
    if (i === 3) await touch(c, 'touchStart', r.x + 520, r.y + vis(520));
    if (i > 3 && i < 12) await touch(c, 'touchMove', r.x + 520, r.y + vis(520) - (i - 3) * 25);
    if (i === 12) await touch(c, 'touchEnd', 0, 0);
  });
  const scroll1 = await js<number>(c, `document.querySelector('[data-testid=stage]').scrollTop`);
  assert(scroll1 === scroll0, `Handballen während Stift-Geste scrollt nicht (${scroll0} → ${scroll1})`);
  assert((await count(c, '[data-testid=selection-bar]')) === 1, 'Auswahl bleibt nach dem Verschieben');
  c.steps.push('Stift-Verschieben ok, Handballen-Touch ignoriert');

  // 4) Handschrift eingravieren → Radierer kann sie nicht mehr löschen
  await click(c, '[data-testid=sel-engrave]');
  await waitUntil(c, `!document.querySelector('[data-testid=selection-bar]')`, 'Auswahl nach dem Eingravieren aufgehoben');
  await key(c, 'e');
  await drag(c, Array.from({ length: 30 }, (_, i) => [px, r.y + 40 + i * 5] as [number, number]));
  assert((await strokeCount(c)) === 2, 'Eingravierter Strich übersteht den Radierer');
  const [qx] = wave(230)[30];
  await drag(c, Array.from({ length: 16 }, (_, i) => [qx, r.y + 200 + i * 4] as [number, number]));
  assert((await strokeCount(c)) === 1, 'Normaler Strich wird radiert');
  // Eingraviertes ist nicht mehr auswählbar (Rahmen über den beschriebenen Bereich)
  await key(c, 'v');
  await drag(c, [[r.x + 20, r.y + 20], [r.x + 200, r.y + 150], [r.x + r.w - 20, r.y + 300]]);
  assert((await count(c, '[data-testid=selection-bar]')) === 0, 'Eingraviertes lässt sich nicht auswählen');
  c.steps.push('Eingravieren: nicht radierbar, nicht auswählbar');

  // 5) Haftnotiz
  await key(c, 'n');
  await drag(c, [[r.x + r.w - 60, r.y + vis(360)]]); // rechter Rand (das GIF landet später in der Seitenmitte)
  await waitFor(c, '[data-testid=text-editor].sticky-editor');
  await setInput(c, '[data-testid=text-editor]', 'Haftnotiz-Test');
  await js(c, `document.querySelector('[data-testid=text-editor]')?.blur()`); // Fokus verlassen beendet die Bearbeitung
  await waitUntil(c, `Number(document.querySelector('[data-testid=editor]').dataset.objects) === 1`, 'Haftnotiz angelegt');
  c.steps.push('Haftnotiz angelegt und beschriftet');

  // 6) Text + „Text einbetten“
  await click(c, '[data-testid=tool-text]');
  await drag(c, [[r.x + 90, r.y + vis(400)]]);
  await waitFor(c, '[data-testid=text-editor]');
  await setInput(c, '[data-testid=text-editor]', 'Eingebetteter Text');
  await click(c, '[data-testid=text-engrave]');
  await waitUntil(c, `Number(document.querySelector('[data-testid=editor]').dataset.objects) === 2`, 'Text angelegt');
  c.steps.push('Text über „Text einbetten“ eingraviert');

  // 7) Animiertes GIF als Objekt
  const gifFile = path.join(c.outDir, 'animiert.gif');
  fs.writeFileSync(gifFile, makeAnimatedGif());
  await click(c, '[data-testid=tool-image]');
  await setFile(c, '[data-testid=image-file]', gifFile);
  await waitUntil(c, `Number(document.querySelector('[data-testid=editor]').dataset.objects) === 3`, 'GIF eingefügt');
  // Läuft die Animation? Pixel in der Mitte des GIFs auf der Tinten-Ebene über die Zeit abtasten (rot ↔ blau)
  await key(c, 'Escape');
  const seen = await js<string[]>(
    c,
    `(async () => {
      const z = Number(document.querySelector('.stage').dataset.zoom);
      const page = document.querySelector('[data-page="0"]').getBoundingClientRect();
      const ink = document.querySelector('[data-testid=ink]');
      const ir = ink.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const x = Math.round((page.x - ir.x + (page.width / z / 2) * z) * dpr);
      const y = Math.round((page.y - ir.y + Math.min(page.height / z / 2, 260) * z) * dpr);
      const out = new Set();
      for (let i = 0; i < 16; i++) {
        const d = ink.getContext('2d').getImageData(x, y, 1, 1).data;
        if (d[3] > 200) out.add(d[0] > 200 && d[2] < 80 ? 'rot' : d[2] > 200 && d[0] < 80 ? 'blau' : 'andere(' + d.join('/') + ')');
        await new Promise((r) => setTimeout(r, 45));
      }
      return [...out];
    })()`,
  );
  assert(seen.includes('rot') && seen.includes('blau'), `GIF animiert auf der Seite (gesehen: ${seen.join(', ') || 'nichts'})`);
  c.steps.push(`Animiertes GIF eingefügt – Animation läuft (Farben: ${seen.join(' ↔ ')})`);
  await screenshot(c, 'features-page');

  // 8) Seite drehen (oberer Knopf)
  await click(c, '[data-testid=rotate-page]');
  await waitUntil(c, `document.querySelector('[data-page="0"]').dataset.rotation === '90'`, 'Seite um 90° gedreht');
  await sleep(300);
  r = await pageRect(c);
  assert(r.w > r.h, `gedrehte Seite ist quer (${r.w}×${r.h})`);
  await screenshot(c, 'features-rotated');
  c.steps.push(`Seite gedreht (90°, ${r.w}×${r.h} px)`);

  // 9) Seite kopieren + einfügen, Vorlage der Kopie wechseln
  await contextMenu(c, '[data-testid=thumb]');
  await click(c, '[data-testid=ctx-page-copy]');
  await contextMenu(c, '[data-testid=thumb]');
  await click(c, '[data-testid=ctx-page-paste]');
  await waitUntil(c, `document.querySelectorAll('[data-testid=page]').length === 2`, 'Kopierte Seite eingefügt');
  await contextMenu(c, '[data-testid=thumb]:nth-child(2)');
  await click(c, '[data-testid=ctx-template-squared]');
  await waitUntil(c, `document.querySelector('[data-page="1"] [data-paper]')?.getAttribute('data-paper') === 'squared'`, 'Vorlage der Kopie gewechselt');
  c.steps.push('Seite kopiert/eingefügt (inkl. Drehung) und Vorlage gewechselt');

  // 10) Export: PDF, PNG (alle Seiten), .noahpalle
  const exportDir = path.join(path.dirname(c.dataDir), 'exports');
  const doExport = async (fmt: string) => {
    await click(c, '[data-testid=export-open]');
    await waitFor(c, '[data-testid=export-dialog]');
    await click(c, `[data-testid=export-${fmt}]`);
    if (fmt === 'pdf') await screenshot(c, 'features-export-dialog');
    await click(c, '[data-testid=export-confirm]');
    await waitUntil(c, `!document.querySelector('[data-testid=export-dialog]')`, `Export ${fmt} abgeschlossen`, 30000);
  };
  await doExport('pdf');
  const pdfOut = fs.readFileSync(path.join(exportDir, 'Funktionstest.pdf'));
  assert(pdfOut.subarray(0, 5).toString('latin1') === '%PDF-' && pdfOut.length > 2000, `PDF exportiert (${pdfOut.length} Bytes)`);
  await doExport('png');
  const pngs = fs.readdirSync(exportDir).filter((f) => f.endsWith('.png'));
  assert(pngs.length === 2, `2 PNG-Seiten exportiert (${pngs.join(', ')})`);
  await doExport('noahpalle');
  const docFile = path.join(exportDir, 'Funktionstest.pnotes');
  const docBytes = fs.readFileSync(docFile);
  assert(docBytes.subarray(0, 2).toString('latin1') === 'PK' && docBytes.subarray(30, 38).toString('latin1') === 'mimetype', `.noahpalle-Container (${docBytes.length} Bytes)`);
  c.steps.push(`Export: PDF ${Math.round(pdfOut.length / 1024)} KB, ${pngs.length} PNG, .noahpalle ${Math.round(docBytes.length / 1024)} KB → ${exportDir}`);

  // 11) Gespeicherter Stand
  await click(c, '[data-testid=editor-back]');
  await waitFor(c, '[data-testid=library]');
  await sleep(600);
  const lib = readJsonFile<{ notebooks: { id: string; title: string }[] }>(path.join(c.dataDir, 'library.json'));
  const nb = lib?.notebooks.find((n) => n.title === 'Funktionstest');
  assert(nb, 'Notizbuch in library.json');
  type P = { rotation?: number; template: string; strokes: { engraved?: boolean }[]; objects: { type: string; sticky?: boolean; engraved?: boolean; animated?: boolean; text?: string }[] };
  const content = readJsonFile<{ pages: P[] }>(path.join(c.dataDir, 'notebooks', `${nb.id}.json`));
  const p0 = content!.pages[0];
  assert(content!.pages.length === 2 && p0.rotation === 90 && content!.pages[1].rotation === 90, 'Drehung pro Seite gespeichert (auch in der Kopie)');
  assert(p0.strokes.length === 1 && p0.strokes[0].engraved === true, 'eingravierter Strich gespeichert');
  assert(p0.objects.some((o) => o.sticky && o.text === 'Haftnotiz-Test'), 'Haftnotiz gespeichert');
  assert(p0.objects.some((o) => o.type === 'text' && !o.sticky && o.engraved && o.text === 'Eingebetteter Text'), 'eingebetteter Text gespeichert');
  assert(p0.objects.some((o) => o.type === 'image' && o.animated), 'animiertes GIF gespeichert');
  assert(content!.pages[1].template === 'squared', 'Vorlage der Kopie gespeichert');
  c.steps.push('Gespeichert: Drehung, Gravuren, Haftnotiz, GIF, Vorlage');

  // 12) .noahpalle wieder öffnen (wie Doppelklick im Explorer)
  openDocumentPath(c.win, docFile);
  await waitFor(c, '[data-testid=editor]', 10000);
  await waitUntil(c, `document.querySelector('[data-testid=editor]').dataset.pages === '2' && document.querySelector('[data-testid=editor]').dataset.objects === '6'`, '.noahpalle geöffnet: 2 Seiten, 6 Objekte', 10000);
  await waitUntil(c, `document.querySelector('[data-page="0"]').dataset.rotation === '90'`, 'Drehung nach dem Öffnen erhalten');
  await screenshot(c, 'features-reopened');
  c.steps.push('.noahpalle per Doppelklick-Pfad geöffnet: Seiten, Drehung und Objekte vollständig');
  await click(c, '[data-testid=editor-back]');
  await waitFor(c, '[data-testid=library]');

  // 13) Ordnerverwaltung in der Seitenleiste
  await click(c, '[data-testid=side-new-folder]');
  await setInput(c, '[data-testid=prompt-input]', 'Projekte');
  await click(c, '[data-testid=prompt-confirm]');
  await waitFor(c, '[data-testid=side-folder]');
  await contextMenu(c, '[data-testid=side-folder]');
  await click(c, '[data-testid=ctx-side-color]');
  await click(c, '.swatch[aria-label="#9B2421"]');
  await contextMenu(c, '[data-testid=side-folder]');
  await click(c, '[data-testid=ctx-side-new-subfolder]');
  await setInput(c, '[data-testid=prompt-input]', 'Unterordner');
  await click(c, '[data-testid=prompt-confirm]');
  await sleep(600);
  const lib2 = readJsonFile<{ folders: { id: string; name: string; color: string; parentId: string | null }[] }>(path.join(c.dataDir, 'library.json'));
  const proj = lib2?.folders.find((f) => f.name === 'Projekte');
  assert(proj?.color === '#9B2421', 'Ordnerfarbe gespeichert');
  assert(lib2?.folders.some((f) => f.name === 'Unterordner' && f.parentId === proj.id), 'Unterordner angelegt');
  await screenshot(c, 'features-library');
  c.steps.push('Ordner: anlegen, Farbe, Unterordner über die Seitenleiste');
};

// ---------------------------------------------------------------- Touch-Display (IR-Multi-Touch, zwei Seiten)

type TouchPt = { id: number; x: number; y: number; r?: number };

/** Mehrere gleichzeitige Touch-Kontakte mit Kontaktgröße (radiusX/Y → PointerEvent width/height), wie ein IR-Rahmen. */
async function multiTouch(c: Ctx, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: TouchPt[]) {
  const dbg = c.wc.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Input.dispatchTouchEvent', {
    type,
    touchPoints: pts.map((p) => ({ id: p.id, x: p.x, y: p.y, radiusX: p.r ?? 3, radiusY: p.r ?? 3, force: 0.5 })),
  });
}

/** Ein oder mehrere Finger gleichzeitig entlang ihrer Pfade bewegen. */
async function touchPaths(c: Ctx, paths: { id: number; r?: number; pts: [number, number][] }[], during?: (i: number) => Promise<void>) {
  const n = Math.max(...paths.map((p) => p.pts.length));
  const at = (i: number) => paths.map((p) => ({ id: p.id, r: p.r, x: p.pts[Math.min(i, p.pts.length - 1)][0], y: p.pts[Math.min(i, p.pts.length - 1)][1] }));
  await multiTouch(c, 'touchStart', at(0));
  for (let i = 1; i < n; i++) {
    await multiTouch(c, 'touchMove', at(i));
    if (during) await during(i);
    await sleep(10);
  }
  await multiTouch(c, 'touchEnd', []);
  await sleep(200);
}

const touchScenario: Scenario = async (c) => {
  await waitFor(c, '[data-testid=library]');
  await createNotebook(c, 'Touch-Display', 'blank', false);
  await waitFor(c, '[data-page="0"]');
  await sleep(900);
  await key(c, 'p');

  // Touch-Einstellungen: Finger/IR-Stift zeichnen, Zwei-Seiten-Modus, Touch-Monitor
  await click(c, '[data-testid=touch-settings]');
  await waitFor(c, '[data-testid=touch-popover]');
  await click(c, '[data-testid=touch-mode] [data-value=draw]');
  await click(c, '[data-testid=dual-toggle]');
  await click(c, '[data-testid=touch-monitor-toggle]');
  await screenshot(c, 'touch-settings');
  await key(c, 'Escape');
  await js(c, `document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`); // Popover schließen
  await waitUntil(c, `!document.querySelector('[data-testid=touch-popover]')`, 'Popover geschlossen');
  assert((await js<string>(c, `document.querySelector('[data-testid=editor]').dataset.dual`)) === '1', 'Zwei-Seiten-Modus aktiv');
  await waitFor(c, '[data-testid=touch-monitor]');
  await waitFor(c, '[data-testid=dual-divider]');

  const stage = await js<{ x: number; y: number; w: number; h: number }>(
    c,
    `(() => { const r = document.querySelector('[data-testid=stage]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()`,
  );
  const r = await pageRect(c);
  const midX = stage.x + stage.w / 2;
  const line = (x0: number, y: number, len = 40): [number, number][] => Array.from({ length: len }, (_, i) => [Math.round(x0 + i * 5), Math.round(y + Math.sin(i / 4) * 10)]);

  // 1) Zwei Personen gleichzeitig: links und rechts der Mitte (je eigene Voreinstellung)
  let rows: { type: string; id: string; w: string; h: string; side: string }[] = [];
  await touchPaths(
    c,
    [
      { id: 1, pts: line(Math.max(r.x + 40, midX - 330), r.y + 120) },
      { id: 2, pts: line(midX + 60, r.y + 120) },
    ],
    async (i) => {
      if (i === 20) {
        await sleep(60);
        rows = await js(
          c,
          `[...document.querySelectorAll('[data-testid=touch-monitor-rows] tr[data-pointer-id]')].map((tr) => ({ type: tr.dataset.pointerType, id: tr.dataset.pointerId, w: tr.dataset.w, h: tr.dataset.h, side: tr.dataset.side }))`,
        );
        await screenshot(c, 'touch-multitouch-monitor');
      }
    },
  );
  assert(rows.length === 2 && rows.every((x) => x.type === 'touch'), `Touch-Monitor zeigt 2 gleichzeitige Touch-Kontakte (${JSON.stringify(rows)})`);
  assert(rows.some((x) => x.side === 'left') && rows.some((x) => x.side === 'right'), 'Monitor ordnet linke/rechte Hälfte zu');
  await waitUntil(c, `document.querySelector('[data-testid=editor]').dataset.strokes === '2'`, 'zwei gleichzeitige Striche (Multi-Touch)');
  c.steps.push(`Multi-Touch: 2 gleichzeitige Striche; Monitor: ${rows.map((x) => `#${x.id} ${x.type} ${x.w}×${x.h} ${x.side}`).join(', ')}`);

  // 2) Zwei Finger nah beieinander, gleichzeitig = Zoom (keine Striche)
  const z0 = Number(await js<string>(c, `document.querySelector('.stage').dataset.zoom`));
  await touchPaths(c, [
    { id: 3, pts: Array.from({ length: 15 }, (_, i) => [midX - 60 - i * 8, r.y + 330] as [number, number]) },
    { id: 4, pts: Array.from({ length: 15 }, (_, i) => [midX + 60 + i * 8, r.y + 330] as [number, number]) },
  ]);
  const z1 = Number(await js<string>(c, `document.querySelector('.stage').dataset.zoom`));
  assert(z1 > z0 * 1.2, `Zwei-Finger-Geste zoomt (${z0} → ${z1})`);
  assert((await strokeCount(c)) === 2, 'Zoom-Geste erzeugt keine Striche');
  c.steps.push(`Zwei-Finger-Zoom im Zeichenmodus: ${z0.toFixed(2)} → ${z1.toFixed(2)}, keine Striche`);
  await click(c, '[data-testid=zoom-fit]');
  await sleep(400);

  // 3) Spitzen-Erkennung: feine vs. dicke Spitze (über Kontaktgröße)
  await click(c, '[data-testid=touch-settings]');
  await click(c, '[data-testid=touch-tip-detect]');
  await js(c, `document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await waitUntil(c, `!document.querySelector('[data-testid=touch-popover]')`, 'Popover geschlossen');
  const r2 = await pageRect(c);
  await touchPaths(c, [{ id: 5, r: 3, pts: line(r2.x + 60, r2.y + 260, 30) }]);
  await touchPaths(c, [{ id: 6, r: 10, pts: line(r2.x + 60, r2.y + 330, 30) }]);
  assert((await strokeCount(c)) === 4, 'feiner + dicker Strich');
  await sleep(1000); // Autosave
  {
    const l = readJsonFile<{ notebooks: { id: string; title: string }[] }>(path.join(c.dataDir, 'library.json'));
    const id = l!.notebooks.find((n) => n.title === 'Touch-Display')!.id;
    const st = readJsonFile<{ pages: { strokes: { width: number }[] }[] }>(path.join(c.dataDir, 'notebooks', `${id}.json`))!.pages[0].strokes;
    assert(st.length === 4 && Math.abs(st[2].width - 2) < 0.01 && Math.abs(st[3].width - 6) < 0.01, `fein 2 pt / dick 6 pt (3×) – gespeichert: ${st.map((x) => x.width).join(', ')}`);
    c.steps.push(`Spitzen-Erkennung: feine Spitze ${st[2].width} pt, dicke Spitze ${st[3].width} pt`);
  }

  // 4) Handfläche radiert (großer Kontakt) – über den dicken Strich wischen
  await touchPaths(c, [{ id: 7, r: 40, pts: Array.from({ length: 20 }, (_, i) => [r2.x + 120 + i * 4, r2.y + 350 + i] as [number, number]) }]);
  const afterPalm = await strokeCount(c);
  assert(afterPalm === 3, `Handfläche radiert den dicken Strich (${afterPalm} Striche übrig)`);
  c.steps.push(`Spitzen: fein/dick erkannt, Handfläche radiert (→ ${afterPalm} Striche)`);

  // 5) Kalibrierung: 5× fein, 5× dick tippen → Schwelle übernehmen
  await click(c, '[data-testid=touch-settings]');
  await click(c, '[data-testid=touch-calibrate]');
  await waitFor(c, '[data-testid=calibrate-dialog]');
  const area = await js<{ x: number; y: number }>(c, `(() => { const r = document.querySelector('[data-testid=calibrate-area]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  for (const rad of [2, 2, 2, 2, 2, 9, 9, 9, 9, 9]) {
    await multiTouch(c, 'touchStart', [{ id: 9, x: area.x, y: area.y, r: rad }]);
    await multiTouch(c, 'touchEnd', []);
    await sleep(60);
  }
  await waitUntil(c, `!document.querySelector('[data-testid=calibrate-apply]').disabled`, 'Kalibrierung unterscheidet die Spitzen');
  const calText = await js<string>(c, `document.querySelector('[data-testid=calibrate-dialog] .modal-text').textContent`);
  await screenshot(c, 'touch-calibrate');
  await click(c, '[data-testid=calibrate-apply]');
  c.steps.push(`Kalibrierung: ${calText.trim()}`);

  // 6) Gespeicherte Striche: Farben je Seite, dicke Spitze breiter
  await click(c, '[data-testid=editor-back]');
  await waitFor(c, '[data-testid=library]');
  await sleep(600);
  const lib = readJsonFile<{ notebooks: { id: string; title: string }[] }>(path.join(c.dataDir, 'library.json'));
  const nb = lib!.notebooks.find((n) => n.title === 'Touch-Display')!;
  const content = readJsonFile<{ pages: { strokes: { color: string; width: number; points: number[] }[] }[] }>(path.join(c.dataDir, 'notebooks', `${nb.id}.json`));
  const s = content!.pages[0].strokes;
  assert(s[0].color === '#12161A' && s[1].color === '#D92632', `linke/rechte Seite mit eigener Farbe (${s[0].color}, ${s[1].color})`);
  const fine = s[2];
  assert(fine && Math.abs(fine.width - 2) < 0.01, `feine Spitze = Breite der Voreinstellung (${fine?.width})`);
  c.steps.push(`Gespeichert: links ${s[0].color}, rechts ${s[1].color}, fein ${fine.width} pt (dicker Strich per Handfläche wegradiert)`);
};

// ---------------------------------------------------------------- Sprache, 10 Farben, Ellipse drehen, Menübreite

const i18nScenario: Scenario = async (c) => {
  await waitFor(c, '[data-testid=library]');
  const text = (sel: string) => js<string>(c, `document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);

  // 1) Sprache umschalten (Einstellungen in der Seitenleiste)
  await click(c, '[data-testid=open-settings]');
  await waitFor(c, '[data-testid=settings-dialog]');
  await click(c, '[data-testid=lang-en]');
  await waitUntil(c, `document.querySelector('[data-testid=new-menu]').textContent.includes('New')`, 'Englisch: „New“');
  assert((await text('[data-testid=nav-trash]')).includes('Trash'), 'Englisch: Papierkorb → Trash');
  assert((await js<string>(c, 'document.documentElement.lang')) === 'en', 'html lang = en');
  await screenshot(c, 'i18n-settings-en');
  await click(c, '[data-testid=lang-fr]');
  await waitUntil(c, `document.querySelector('[data-testid=new-menu]').textContent.includes('Nouveau')`, 'Französisch: „Nouveau“');
  await click(c, '[data-testid=lang-es]');
  await waitUntil(c, `document.querySelector('[data-testid=new-menu]').textContent.includes('Nuevo')`, 'Spanisch: „Nuevo“');
  await click(c, '[data-testid=lang-it]');
  await waitUntil(c, `document.querySelector('[data-testid=new-menu]').textContent.includes('Nuovo')`, 'Italienisch: „Nuovo“');
  await click(c, '[data-testid=lang-en]');
  await click(c, '[data-testid=settings-close]');
  // dauerhaft gespeichert: nach Neuladen weiter Englisch
  await reload(c);
  await waitFor(c, '[data-testid=library]');
  assert((await text('[data-testid=new-menu]')).includes('New'), 'Sprache bleibt nach Neustart (Englisch)');
  c.steps.push('Sprache: DE → EN → FR → ES → IT → EN, nach Neustart gespeichert');

  // 2) Editor auf Englisch + 10 Stiftfarben
  await click(c, '[data-testid=new-menu]');
  await click(c, '[data-testid=ctx-new-notebook]');
  await waitFor(c, '[data-testid=new-notebook-dialog]');
  await setInput(c, '[data-testid=notebook-title]', 'Language & Shapes');
  await click(c, '[data-template=blank]');
  await click(c, '[data-testid=create-notebook]');
  await waitFor(c, '[data-page="0"]');
  await sleep(900);
  assert((await text('[data-testid=tool-select]')).includes('Select'), 'Editor englisch: „Select“');
  assert((await text('[data-testid=page-indicator]')).includes('Page 1 of 1'), `Seitenanzeige englisch (${await text('[data-testid=page-indicator]')})`);
  await key(c, 'p');
  const slots = await count(c, '[aria-label=Colors] [data-testid^=color-]');
  assert(slots === 8, `genau 8 Stiftfarben in der Werkzeugleiste oben (${slots})`);
  const TOP8 = ['#12161A', '#1D4ED8', '#D92632', '#15803D', '#6D28D9', '#D97706', '#A81B25', '#1F242A'];
  const slotColors = await js<string[]>(c, `[...document.querySelectorAll('[aria-label=Colors] [data-testid^=color-]')].map((b) => getComputedStyle(b).getPropertyValue('--slot').trim().toUpperCase())`);
  assert(!slotColors.some((x) => x === '#FFFFFF' || x === '#FFF'), `kein Weiß in der Stiftauswahl (${slotColors.join(' ')})`);
  assert(TOP8.every((k) => slotColors.includes(k)), `Werkzeugleiste = 8 Palettenfarben (${slotColors.join(' ')})`);
  await click(c, '[data-testid=color-7]');
  assert((await js<boolean>(c, `document.querySelector('[data-testid=color-7]').classList.contains('active')`)), 'Farbe 8 ist beim Klick aktiv');
  const r = await pageRect(c);
  await drag(c, Array.from({ length: 30 }, (_, i) => [r.x + 80 + i * 6, r.y + 90] as [number, number]));
  await screenshot(c, 'i18n-editor-en-colors');
  c.steps.push(`Stiftfarben oben = 8 (${slotColors.join(' ')}), Farbe 8 übernommen`);

  // 3) Formen-Werkzeug: Ellipse zeichnen → erkannt → mit der Formleiste drehen
  await key(c, 's');
  const cx = r.x + 300;
  const cy = r.y + 300;
  await drag(c, Array.from({ length: 73 }, (_, i) => [Math.round(cx + Math.cos((i / 72) * Math.PI * 2) * 130), Math.round(cy + Math.sin((i / 72) * Math.PI * 2) * 60)] as [number, number]));
  await waitFor(c, '[data-testid=shape-bar]');
  assert((await text('[data-testid=shape-bar] .float-label')) === 'Ellipse', `Ellipse erkannt (${await text('[data-testid=shape-bar] .float-label')})`);
  const a0 = parseInt(await text('[data-testid=shape-angle]'), 10);
  await click(c, '[data-testid=shape-rotate-cw]');
  await click(c, '[data-testid=shape-rotate-cw]');
  const a1 = parseInt(await text('[data-testid=shape-angle]'), 10);
  assert((a1 - a0 + 360) % 360 === 30, `Ellipse um 30° gedreht (${a0}° → ${a1}°)`);
  await screenshot(c, 'i18n-ellipse-rotated');
  c.steps.push(`Ellipse erkannt und gedreht: ${a0}° → ${a1}°`);

  // 4) Drei-Punkte-Menü: breit genug, jeder Eintrag einzeilig, keine Überlappung (auf Deutsch – längste Texte)
  await click(c, '[data-testid=shape-done]');
  await js(c, `localStorage.setItem('pw.lang', 'de')`);
  await reload(c);
  await waitFor(c, '[data-testid=library]');
  await click(c, '[data-testid=item-notebook] [data-testid=item-open]');
  await waitFor(c, '[data-page="0"]');
  await sleep(600);
  await click(c, '[data-testid=more-menu]');
  await waitFor(c, '.menu');
  const layout = await js<{ width: number; items: { label: string; h: number; top: number; bottom: number; lines: number }[] }>(
    c,
    `(() => { const m = document.querySelector('.menu'); return { width: m.getBoundingClientRect().width, items: [...m.querySelectorAll('.menu-item')].map((b) => { const r = b.getBoundingClientRect(); const l = b.querySelector('.menu-label'); const lh = parseFloat(getComputedStyle(l).lineHeight) || 18; return { label: l.textContent, h: r.height, top: r.top, bottom: r.bottom, lines: Math.round(l.getBoundingClientRect().height / lh) }; }) }; })()`,
  );
  await screenshot(c, 'i18n-more-menu');
  assert(layout.width >= 280, `Menü mindestens 280 px breit (${Math.round(layout.width)})`);
  const multi = layout.items.filter((i) => i.lines > 1);
  assert(multi.length === 0, `alle Einträge einzeilig (${multi.map((i) => i.label).join(', ')})`);
  for (let i = 1; i < layout.items.length; i++) assert(layout.items[i].top >= layout.items[i - 1].bottom - 0.5, `keine Überlappung: „${layout.items[i - 1].label}“ / „${layout.items[i].label}“`);
  for (const lbl of ['PDF-Seiten einfügen …', 'Exportieren (PDF, PNG, .pnotes) …', 'Kopierte Seite danach einfügen', 'Seite drehen (90° im Uhrzeigersinn)']) {
    assert(layout.items.some((i) => i.label === lbl), `Menüeintrag „${lbl}“ vorhanden`);
  }
  c.steps.push(`Drei-Punkte-Menü: ${Math.round(layout.width)} px breit, ${layout.items.length} Einträge, alle einzeilig, ohne Überlappung`);
  await key(c, 'Escape');
};

/** Nachlauf-Scrollen nach Touch-Wisch + Anzeige der Stift-Radiertaste. */
const glideScenario: Scenario = async (c) => {
  // Werkzeug-Standard (vorherige Szenarien schalten z. B. „Mit Finger zeichnen“ ein)
  await js(c, `['pw.tools.v3', 'pw.tools.v2', 'pw.tools.v1'].forEach((k) => localStorage.removeItem(k))`);
  await reload(c);
  await waitFor(c, '[data-testid=library]');
  await createNotebook(c, 'Nachlauf', 'ruled', false);
  await waitFor(c, '[data-page="0"]');
  for (let i = 0; i < 4; i++) await click(c, '[data-testid=toolbar-add-page]');
  await waitUntil(c, `document.querySelector('[data-testid=editor]').dataset.pages === '5'`, '5 Seiten');
  await sleep(600);
  const top = () => js<number>(c, `Math.round(document.querySelector('[data-testid=stage]').scrollTop)`);
  const toTop = async () => {
    await js(c, `document.querySelector('[data-testid=stage]').scrollTop = 0`);
    await sleep(250);
  };
  const flick = async (holdBeforeRelease = 0) => {
    await touch(c, 'touchStart', 640, 650);
    for (let i = 1; i <= 8; i++) {
      await touch(c, 'touchMove', 640, 650 - i * 35);
      await sleep(10);
    }
    if (holdBeforeRelease) await sleep(holdBeforeRelease);
    await touch(c, 'touchEnd', 0, 0);
  };

  // 1) Schneller Wisch: läuft nach dem Loslassen weiter …
  await toTop();
  await flick();
  const atRelease = await top();
  await sleep(350);
  const later = await top();
  assert(later > atRelease + 60, `Ansicht läuft nach dem Loslassen weiter (${atRelease} → ${later})`);
  // … und bremst bis zum Stillstand ab
  await sleep(2500);
  const s1 = await top();
  await sleep(300);
  const s2 = await top();
  assert(s1 === s2, `Nachlauf kommt zum Stillstand (${s1} / ${s2})`);
  c.steps.push(`Touch-Wisch: Loslassen bei ${atRelease}px, nach 350 ms ${later}px, Stillstand bei ${s2}px`);

  // 2) Finger vor dem Loslassen angehalten → kein Nachlauf
  await toTop();
  await flick(200);
  const held0 = await top();
  await sleep(400);
  assert((await top()) === held0, 'Angehalten und losgelassen → kein Nachlauf');

  // 3) Antippen während des Nachlaufs stoppt sofort
  await toTop();
  await flick();
  await sleep(80);
  await touch(c, 'touchStart', 640, 400);
  const stop0 = await top();
  await sleep(300);
  const stop1 = await top();
  await touch(c, 'touchEnd', 0, 0);
  assert(Math.abs(stop1 - stop0) <= 1, `Antippen stoppt den Nachlauf (${stop0} → ${stop1})`);
  c.steps.push('Kein Nachlauf nach Anhalten; Antippen stoppt den Nachlauf');

  // 4) Stift-Radiertaste: Radierer wird angezeigt, solange der Knopf gedrückt ist
  await toTop();
  const r = await pageRect(c);
  await key(c, 'p');
  const line: [number, number][] = Array.from({ length: 40 }, (_, i) => [r.x + 100 + i * 8, r.y + 150]);
  await drag(c, line);
  assert((await strokeCount(c)) === 1, '1 Strich gezeichnet');
  const penEv = (type: string, x: number, y: number, button: number, buttons: number) =>
    js(
      c,
      `document.querySelector('[data-testid=stage]').dispatchEvent(new PointerEvent('${type}', { pointerType: 'pen', pointerId: 77, isPrimary: true, bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y}, button: ${button}, buttons: ${buttons}, pressure: ${buttons ? 0.5 : 0} }))`,
    );
  const ed = (k: string) => js<string>(c, `document.querySelector('[data-testid=editor]').dataset.${k}`);
  const x0 = r.x + 260;
  await penEv('pointermove', x0, r.y + 90, -1, 0);
  assert((await ed('stylus')) === '', 'Ohne Knopf: keine Radierer-Anzeige');
  await penEv('pointerdown', x0, r.y + 110, 5, 32);
  await sleep(60);
  assert((await ed('stylus')) === 'eraser', 'Radiertaste gedrückt → Modus „Radierer“');
  assert((await ed('tool')) === 'pen', 'gewähltes Werkzeug bleibt der Stift');
  assert(await js<boolean>(c, `document.querySelector('[data-testid=tool-eraser]').classList.contains('stylus-temp')`), 'Werkzeugleiste hebt den Radierer hervor');
  assert(await js<boolean>(c, `document.querySelector('[data-testid=stylus-indicator]').classList.contains('show')`), 'Radierer-Kreis an der Stiftspitze sichtbar');
  assert((await js<string>(c, `document.querySelector('[data-testid=stage]').style.cursor`)).includes('245'), 'Cursor = Radierer-Kreis');
  for (let i = 1; i <= 8; i++) await penEv('pointermove', x0, r.y + 110 + i * 10, -1, 32);
  await sleep(60);
  await screenshot(c, 'stylus-eraser');
  await penEv('pointerup', x0, r.y + 190, 5, 0);
  await sleep(100);
  assert((await strokeCount(c)) === 0, 'Strich mit der Radiertaste gelöscht');
  await sleep(900);
  assert((await ed('stylus')) === '', 'Knopf losgelassen → Anzeige verschwindet wieder');
  assert(!(await js<boolean>(c, `document.querySelector('[data-testid=tool-eraser]').classList.contains('stylus-temp')`)), 'Werkzeugleiste zeigt wieder den Stift');
  c.steps.push('Stift-Radiertaste: Radierer-Kreis + Hervorhebung, Strich gelöscht, danach wieder Stift');
};

/** „Seite leeren“: Handschrift, Haftnotiz, Bild und Kommentar – wahlweise teilweise oder komplett entfernen. */
const clearPageScenario: Scenario = async (c) => {
  await js(c, `['pw.tools.v3', 'pw.tools.v2', 'pw.tools.v1', 'pw.clearCats'].forEach((k) => localStorage.removeItem(k))`);
  await reload(c);
  await waitFor(c, '[data-testid=library]');
  await createNotebook(c, 'Leeren', 'ruled', false);
  await waitFor(c, '[data-page="0"]');
  await sleep(700);
  const r = await pageRect(c);
  const ds = () => js<{ strokes: number; objects: number; comments: number }>(c, `(() => { const d = document.querySelector('[data-testid=editor]').dataset; return { strokes: +d.strokes, objects: +d.objects, comments: +d.comments }; })()`);

  // Inhalte anlegen: Strich, Haftnotiz, Bild, Kommentar
  await key(c, 'p');
  await drag(c, Array.from({ length: 30 }, (_, i): [number, number] => [r.x + 80 + i * 8, r.y + 120]));
  await key(c, 'n');
  await drag(c, [[r.x + r.w - 140, r.y + 300]]);
  await waitFor(c, '[data-testid=text-editor].sticky-editor');
  await setInput(c, '[data-testid=text-editor]', 'Notiz');
  await js(c, `document.querySelector('[data-testid=text-editor]')?.blur()`);
  await sleep(200);
  const img = path.join(c.outDir, 'clear-test.gif');
  fs.writeFileSync(img, makeAnimatedGif());
  await click(c, '[data-testid=tool-image]');
  await setFile(c, '[data-testid=image-file]', img);
  await waitUntil(c, `Number(document.querySelector('[data-testid=editor]').dataset.objects) === 2`, 'Bild eingefügt');
  await click(c, '[data-testid=tool-comment]');
  await drag(c, [[r.x + 120, r.y + 420]]);
  await waitFor(c, '[data-testid=new-comment-input]');
  await setInput(c, '[data-testid=new-comment-input]', 'Kommentar zum Leeren');
  await click(c, '[data-testid=new-comment-submit]');
  await waitUntil(c, `Number(document.querySelector('[data-testid=editor]').dataset.comments) === 1`, 'Kommentar angelegt');
  let d = await ds();
  assert(d.strokes === 1 && d.objects === 2 && d.comments === 1, `Ausgangslage: ${JSON.stringify(d)}`);

  // 1) Über „Mehr“ öffnen, nur Kommentare + Bilder entfernen
  await click(c, '[data-testid=more-menu]');
  await click(c, '[data-testid=ctx-page-clear]');
  await waitFor(c, '[data-testid=clear-page-dialog]');
  const counts = await js<string[]>(c, `[...document.querySelectorAll('.clear-count')].map((e) => e.textContent)`);
  assert(counts.join(',') === '1,0,0,1,1,1', `Anzahlen im Dialog: ${counts.join(',')}`);
  assert((await js<string>(c, `document.querySelector('[data-testid=clear-page-confirm]').textContent`)).includes('4'), 'Standard: alle 4 Elemente');
  await screenshot(c, 'clear-page-dialog');
  await click(c, '[data-testid=clear-ink]');
  await click(c, '[data-testid=clear-stickies]');
  assert((await js<string>(c, `document.querySelector('[data-testid=clear-page-confirm]').textContent`)).includes('2'), 'Abgewählt: 2 Elemente');
  await click(c, '[data-testid=clear-page-confirm]');
  await sleep(200);
  d = await ds();
  assert(d.strokes === 1 && d.objects === 1 && d.comments === 0, `Nur Kommentare + Bilder entfernt: ${JSON.stringify(d)}`);
  c.steps.push('Seite leeren (Auswahl): Kommentar + Bild entfernt, Strich + Haftnotiz bleiben');

  // 2) Rückgängig holt alles zurück
  await key(c, 'z', ['control']);
  await sleep(200);
  d = await ds();
  assert(d.strokes === 1 && d.objects === 2 && d.comments === 1, `Rückgängig stellt alles wieder her: ${JSON.stringify(d)}`);

  // 3) Über den Radierer-Optionen öffnen; Auswahl ist gemerkt → „Alle“ → komplett leeren
  await key(c, 'e');
  await click(c, '[data-testid=tool-eraser]');
  await click(c, '[data-testid=clear-page]');
  await waitFor(c, '[data-testid=clear-page-dialog]');
  assert(!(await js<boolean>(c, `document.querySelector('[data-testid=clear-ink]').classList.contains('selected')`)), 'letzte Auswahl gemerkt');
  await click(c, '[data-testid=clear-toggle-all]');
  await click(c, '[data-testid=clear-page-confirm]');
  await sleep(200);
  d = await ds();
  assert(d.strokes === 0 && d.objects === 0 && d.comments === 0, `Seite komplett leer: ${JSON.stringify(d)}`);
  c.steps.push('Seite leeren (alles): Strich, Haftnotiz, Bild und Kommentar entfernt; Rückgängig funktioniert');
};

/** pNotes-Branding + Color Kit in Hell und Dunkel (berechnete CSS-Werte im echten Fenster). */
const brandScenario: Scenario = async (c) => {
  await waitFor(c, '[data-testid=library]');
  assert(c.win.getTitle() === 'pNotes', `Fenstertitel „${c.win.getTitle()}“`);
  assert((await js<string>(c, `document.querySelector('.sidebar-brand').textContent.trim()`)) === 'pNotes', 'Seitenleiste zeigt „pNotes“');
  const css = (v: string) => js<string>(c, `getComputedStyle(document.documentElement).getPropertyValue('${v}').trim().toLowerCase()`);
  const bg = (sel: string) => js<string>(c, `getComputedStyle(document.querySelector('${sel}')).backgroundColor`);
  await click(c, '[data-testid=theme-light]');
  assert((await css('--accent')) === '#d92632', `Hell: Akzent Crimson (${await css('--accent')})`);
  assert((await css('--accent-hover')) === '#a81b25', 'Hell: Hover Crimson Dark');
  assert((await bg('.sidebar')) === 'rgb(225, 228, 232)', `Hell: Sidebar Slate 200 (${await bg('.sidebar')})`);
  await screenshot(c, 'pnotes-library-light');
  await click(c, '[data-testid=theme-dark]');
  await sleep(100);
  assert((await css('--accent')) === '#d92632', 'Dunkel: Akzent Crimson');
  assert((await bg('.sidebar')) === 'rgb(31, 36, 42)', `Dunkel: Sidebar Slate 800 (${await bg('.sidebar')})`);
  assert((await css('--bg-base')) === '#12161a', 'Dunkel: App-Hintergrund Slate 900');
  assert((await css('--bg-layer')) === '#32383f', 'Dunkel: Karten Slate 700');
  await screenshot(c, 'pnotes-library-dark');
  await createNotebook(c, 'Farbtest', 'ruled', false);
  await waitFor(c, '[data-page="0"]');
  await sleep(500);
  await screenshot(c, 'pnotes-editor-dark');
  await click(c, '[data-testid=editor-back]');
  await waitFor(c, '[data-testid=library]');
  await click(c, '[data-testid=theme-light]');
  // Weiß darf nirgends als berechnete Hintergrund- oder Textfarbe der Oberfläche auftauchen
  const whites = await js<string[]>(
    c,
    `[...document.querySelectorAll('body *')].filter((e) => { const s = getComputedStyle(e); return s.backgroundColor === 'rgb(255, 255, 255)' || s.color === 'rgb(255, 255, 255)'; }).map((e) => e.className || e.tagName).slice(0, 5)`,
  );
  assert(whites.length === 0, `kein #FFFFFF in der Oberfläche (${whites.join(', ')})`);
  c.steps.push('pNotes: Titel, Branding und Color Kit (Hell/Dunkel) geprüft, kein Weiß in der Oberfläche');
};

/** Nicht ganz geschlossener Kreis/Ellipse wird vervollständigt; Halbkreis bleibt Freihand. */
const openCircleScenario: Scenario = async (c) => {
  await waitFor(c, '[data-testid=library]');
  await createNotebook(c, 'Offene Kreise', 'blank', false);
  await waitFor(c, '[data-page="0"]');
  await sleep(500);
  const r = await pageRect(c);
  const arcPts = (cx: number, cy: number, rx: number, ry: number, from: number, sweep: number, n = 60): [number, number][] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = ((from + (i / n) * sweep) * Math.PI) / 180;
      return [Math.round(cx + Math.cos(a) * rx + Math.sin(i * 1.3) * 1.2), Math.round(cy + Math.sin(a) * ry + Math.cos(i * 1.9) * 1.2)];
    });
  // Formobjekte aus dem gespeicherten Notizbuch lesen (unabhängig von der Darstellung)
  const saved = async () => {
    await sleep(900); // Autosave
    const lib = readJsonFile<{ notebooks: { id: string; title: string }[] }>(path.join(c.dataDir, 'library.json'));
    const nb = lib!.notebooks.find((n) => n.title === 'Offene Kreise')!;
    const content = readJsonFile<{ pages: { strokes: unknown[]; objects: { type: string; kind?: string; points?: number[] }[] }[] }>(path.join(c.dataDir, 'notebooks', `${nb.id}.json`));
    return content!.pages[0];
  };

  // 1) Stift + Halten: Kreis nur zu ¾ gezeichnet (270°) → Kreis
  await key(c, 'p');
  const cx = r.x + 180;
  const cy = r.y + 170;
  await dragHold(c, arcPts(cx, cy, 70, 70, 30, 270), 750);
  await waitFor(c, '[data-testid=shape-bar]');
  let pg = await saved();
  const circle = pg.objects.find((o) => o.type === 'shape');
  assert(circle?.kind === 'ellipse', `¾-Kreis (Stift + Halten) → Kreis (${JSON.stringify(pg.objects.map((o) => o.kind))})`);
  const [ccx, ccy, ux, uy, vx, vy] = circle!.points!;
  const ra = Math.hypot(ux - ccx, uy - ccy);
  const rb = Math.hypot(vx - ccx, vy - ccy);
  assert(Math.abs(ra - rb) < 0.5, `als echter Kreis eingerastet (Halbachsen ${ra.toFixed(1)} / ${rb.toFixed(1)})`);
  c.steps.push(`¾-Kreis → Kreis (Radius ${ra.toFixed(0)} pt, vollständig geschlossen)`);
  await key(c, 'Escape');

  // 2) Formen-Werkzeug: Ellipse 2:1 mit Lücke (285°) → Ellipse
  await key(c, 's');
  await dragHold(c, arcPts(r.x + 470, cy, 120, 55, 120, 285, 70), 0);
  pg = await saved();
  const ell = pg.objects.filter((o) => o.type === 'shape')[1];
  assert(ell?.kind === 'ellipse', `offene Ellipse (Formen-Werkzeug) → Ellipse (${JSON.stringify(pg.objects.map((o) => o.kind))})`);
  const [ex, ey, eux, euy, evx, evy] = ell!.points!;
  const ea = Math.hypot(eux - ex, euy - ey);
  const eb = Math.hypot(evx - ex, evy - ey);
  assert(ea / eb > 1.6, `Ellipse bleibt länglich (${ea.toFixed(0)} × ${eb.toFixed(0)})`);
  c.steps.push(`offene Ellipse → Ellipse ${ea.toFixed(0)} × ${eb.toFixed(0)} pt`);

  // 3) Halbkreis mit dem Formen-Werkzeug → bleibt Freihand
  const before = pg.strokes.length;
  await dragHold(c, arcPts(cx, r.y + 400, 70, 70, 180, 180), 0);
  pg = await saved();
  assert(pg.objects.filter((o) => o.type === 'shape').length === 2 && pg.strokes.length === before + 1, 'Halbkreis bleibt Freihandstrich');
  c.steps.push('Halbkreis → Freihand (kein Kreis)');
  await screenshot(c, 'open-circles');
};
/** <select> setzen (React-kompatibel). */
async function selectValue(c: Ctx, selector: string, value: string) {
  await js(
    c,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); })()`,
  );
}

/** Neue Papierformate (A3, US Legal) + Sync über einen Cloud-Ordner (Google Drive / iCloud / eigener Ordner). */
const cloudSyncScenario: Scenario = async (c) => {
  await waitFor(c, '[data-testid=library]');
  const libJson = () => readJsonFile<{ notebooks: { id: string; title: string; format: string; orientation: string }[] }>(path.join(c.dataDir, 'library.json'))!;

  // 1) Notizbücher in A3 (quer) und US Legal
  for (const [title, fmt, orient] of [['Plakat A3', 'A3', 'landscape'], ['US Legal', 'Legal', 'portrait']] as const) {
    await click(c, '[data-testid=new-menu]');
    await click(c, '[data-testid=ctx-new-notebook]');
    await waitFor(c, '[data-testid=new-notebook-dialog]');
    await setInput(c, '[data-testid=notebook-title]', title);
    const options = await js<string[]>(c, `[...document.querySelectorAll('[data-testid=format] option')].map((o) => o.value)`);
    assert(options.length === 11 && options.includes('A3') && options.includes('Tabloid'), `11 Formate zur Auswahl (${options.join(', ')})`);
    await selectValue(c, '[data-testid=format]', fmt);
    // Dialog merkt sich die letzte Ausrichtung → immer ausdrücklich wählen
    await click(c, `[data-testid=orientation] button:nth-child(${orient === 'landscape' ? 2 : 1})`);
    if (title === 'Plakat A3') await screenshot(c, 'format-a3-dialog');
    await click(c, '[data-testid=create-notebook]');
    await waitFor(c, '[data-page="0"]');
    await sleep(400);
    const ratio = await js<number>(c, `(() => { const r = document.querySelector('[data-page="0"]').getBoundingClientRect(); return r.width / r.height; })()`);
    const want = fmt === 'A3' ? 420 / 297 : 8.5 / 14;
    assert(Math.abs(ratio - want) < 0.01, `${title}: Seitenverhältnis ${ratio.toFixed(3)} (erwartet ${want.toFixed(3)})`);
    await click(c, '[data-testid=editor-back]');
    await waitFor(c, '[data-testid=library]');
  }
  await sleep(500);
  const nbs = libJson().notebooks;
  assert(nbs.find((n) => n.title === 'Plakat A3')?.format === 'A3' && nbs.find((n) => n.title === 'US Legal')?.format === 'Legal', 'Format in library.json gespeichert');
  c.steps.push('Papierformate: A3 quer und US Legal angelegt, Seitenverhältnisse korrekt');

  // 2) Sync-Dialog: Anbieter „Google Drive“, Ordner = simuliertes Google-Drive-Verzeichnis
  const drive = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-gdrive-'));
  await click(c, '[data-testid=open-sync-settings]');
  await waitFor(c, '[data-testid=sync-settings]');
  for (const p of ['nextcloud', 'gdrive', 'icloud', 'folder', 'webdav']) assert((await count(c, `[data-testid=sync-provider-${p}]`)) === 1, `Anbieter ${p} wählbar`);
  await click(c, '[data-testid=sync-provider-gdrive]');
  await waitUntil(c, `!!document.querySelector('[data-testid=sync-suggestions]')`, 'Cloud-Ordner gesucht');
  await setInput(c, '[data-testid=sync-local-path]', drive);
  await click(c, '[data-testid=sync-test]');
  await waitFor(c, '[data-testid=sync-test-result].ok', 10000);
  await screenshot(c, 'sync-gdrive');
  await click(c, '[data-testid=sync-save-run]');
  const nbDir = path.join(drive, BRAND.syncFolder, 'notebooks');
  await waitUntil(c, `document.querySelector('[data-testid=sync-indicator]')?.classList.contains('sync-idle')`, 'Sync abgeschlossen', 15000);
  const files = fs.existsSync(nbDir) ? fs.readdirSync(nbDir) : [];
  // (im Gesamtlauf liegen auch Notizbücher früherer Szenarien in der Bibliothek)
  const ids = libJson().notebooks.map((n) => `${n.id}.json`);
  assert(ids.length >= 2 && ids.every((f) => files.includes(f)), `alle ${ids.length} Notizbücher im Google-Drive-Ordner (${files.length} Dateien)`);
  c.steps.push(`Google-Drive-Sync: ${files.length} Notizbücher nach ${nbDir}`);

  // 3) Anzeige nennt das Ziel; zweites „Gerät“ legt im Ordner ein Notizbuch ab → kommt beim nächsten Sync an
  await click(c, '[data-testid=sync-indicator]');
  await waitFor(c, '[data-testid=sync-target]');
  const line = await js<string>(c, `document.querySelector('[data-testid=sync-target]').textContent`);
  assert(line.includes('Google Drive') && line.includes(drive), `Statusanzeige nennt Google Drive + Pfad (${line})`);
  const other = JSON.parse(fs.readFileSync(path.join(nbDir, ids[0]), 'utf8'));
  other.meta = { ...other.meta, id: 'vomanderengeraet', title: 'Vom anderen PC' };
  other.content = { ...other.content, id: 'vomanderengeraet' };
  fs.writeFileSync(path.join(nbDir, 'vomanderengeraet.json'), JSON.stringify(other));
  await click(c, '[data-testid=sync-now]');
  await waitUntil(c, `[...document.querySelectorAll('[data-testid=item-notebook]')].some((e) => e.textContent.includes('Vom anderen PC'))`, 'Notizbuch vom anderen Gerät angekommen', 15000);
  c.steps.push('Notizbuch eines anderen Geräts aus dem Google-Drive-Ordner übernommen');
  await key(c, 'Escape');
  fs.rmSync(drive, { recursive: true, force: true });
};

const scenarios: Record<string, Scenario> = { library, editor, draw, shapes, pdf, sso, features, touch: touchScenario, i18n: i18nScenario, glide: glideScenario, clearpage: clearPageScenario, brand: brandScenario, opencircle: openCircleScenario, cloudsync: cloudSyncScenario };

export function registerScenario(name: string, fn: Scenario) {
  scenarios[name] = fn;
}

export const smokeHelpers = { js, waitFor, waitUntil, click, contextMenu, setInput, count, screenshot, reload, readJsonFile, createNotebook, assert, sleep };
export type SmokeCtx = Ctx;

export async function runSmoke(win: BrowserWindow, scenario: string, dataDir: string): Promise<number> {
  // --smoke-out=<Ordner> (z. B. für die Portable-EXE, die in einen temporären Ordner entpackt)
  const outArg = process.argv.find((a) => a.startsWith('--smoke-out='))?.slice('--smoke-out='.length);
  const outDir = path.resolve(outArg || process.env.PORTABLE_EXECUTABLE_DIR || process.cwd(), outArg ? '.' : 'smoke-output');
  fs.mkdirSync(outDir, { recursive: true });
  const c: Ctx = { win, wc: win.webContents, dataDir, outDir, steps: [] };
  const errors: string[] = [];

  c.wc.on('console-message', (...a: unknown[]) => {
    const ev = a[0] as { level?: string | number; message?: string };
    const level = ev?.level ?? a[1];
    const message = ev?.message ?? (a[2] as string);
    if (level === 'error' || level === 3) errors.push(String(message));
  });
  c.wc.on('render-process-gone', (_e, d) => errors.push(`Renderer beendet: ${d.reason}`));
  c.wc.on('preload-error', (_e, p, err) => errors.push(`Preload-Fehler ${p}: ${err.message}`));

  if (c.wc.isLoading()) await new Promise<void>((r) => c.wc.once('did-finish-load', () => r()));
  // Szenarien prüfen deutsche Texte → Sprache fest auf Deutsch (unabhängig von der Systemsprache)
  await js(c, `localStorage.setItem('pw.lang', 'de')`);

  const names = scenario === 'all' ? Object.keys(scenarios) : [scenario];
  const results: { name: string; ok: boolean; error?: string }[] = [];
  for (const name of names) {
    const fn = scenarios[name];
    if (!fn) {
      results.push({ name, ok: false, error: 'Unbekanntes Szenario' });
      continue;
    }
    try {
      await reload(c);
      await Promise.race([fn(c), sleep(90_000).then(() => Promise.reject(new Error('Szenario-Timeout')))]);
      results.push({ name, ok: true });
    } catch (err) {
      await screenshot(c, `FAILED-${name}`).catch(() => undefined);
      results.push({ name, ok: false, error: (err as Error).message });
    }
  }

  const ok = results.every((r) => r.ok) && errors.length === 0;
  const report = { ok, results, consoleErrors: errors, steps: c.steps, dataDir };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n=== pNotes Smoke-Test: ${ok ? 'OK' : 'FEHLER'} ===`);
  for (const r of results) console.log(`${r.ok ? '✔' : '✘'} ${r.name}${r.error ? ` — ${r.error}` : ''}`);
  for (const s of c.steps) console.log(`  · ${s}`);
  if (errors.length) console.log(`Konsolenfehler:\n  ${errors.join('\n  ')}`);
  return ok ? 0 : 1;
}
