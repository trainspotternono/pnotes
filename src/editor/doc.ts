/**
 * Reine Dokument-Operationen auf Seiteninhalten (Striche, Objekte, Kommentare).
 * Jede Funktion liefert ein neues Seiten-Array (oder dasselbe, wenn nichts passiert),
 * damit Undo/Redo und Autosave lückenlos funktionieren.
 */
import type { CommentThread, Page, PageObject, Stroke } from '../../shared/types';
import { inkOn } from '../lib/palette';
import { newId } from '../lib/ids';
import type { ItemRefs } from '../ink/hit';
import { transformObject, transformStroke, type Mat } from '../ink/transform';

export function updatePage(pages: Page[], index: number, fn: (p: Page) => Page): Page[] {
  const p = pages[index];
  if (!p) return pages;
  const next = fn(p);
  return next === p ? pages : pages.map((x, i) => (i === index ? next : x));
}

export const addStroke = (pages: Page[], index: number, s: Stroke) => updatePage(pages, index, (p) => ({ ...p, strokes: [...p.strokes, s] }));

export const addObjects = (pages: Page[], index: number, objs: PageObject[]) =>
  objs.length ? updatePage(pages, index, (p) => ({ ...p, objects: [...p.objects, ...objs] })) : pages;

export function updateObject<T extends PageObject>(pages: Page[], index: number, id: string, fn: (o: T) => T): Page[] {
  return updatePage(pages, index, (p) => {
    let changed = false;
    const objects = p.objects.map((o) => {
      if (o.id !== id) return o;
      const n = fn(o as T);
      if (n !== o) changed = true;
      return n;
    });
    return changed ? { ...p, objects } : p;
  });
}

export function removeObject(pages: Page[], index: number, id: string): Page[] {
  return updatePage(pages, index, (p) => (p.objects.some((o) => o.id === id) ? { ...p, objects: p.objects.filter((o) => o.id !== id) } : p));
}

export function removeItems(pages: Page[], index: number, refs: ItemRefs): Page[] {
  const s = new Set(refs.strokeIds);
  const o = new Set(refs.objectIds);
  return updatePage(pages, index, (p) => ({ ...p, strokes: p.strokes.filter((x) => !s.has(x.id)), objects: p.objects.filter((x) => !o.has(x.id)) }));
}

/** Transformiert die ausgewählten Elemente – immer ausgehend von `base` (Stand vor der Geste). */
export function transformItems(pages: Page[], base: Page, index: number, refs: ItemRefs, m: Mat): Page[] {
  const s = new Set(refs.strokeIds);
  const o = new Set(refs.objectIds);
  return updatePage(pages, index, (p) => ({
    ...p,
    strokes: base.strokes.map((x) => (s.has(x.id) ? transformStroke(x, m) : x)),
    objects: base.objects.map((x) => (o.has(x.id) ? transformObject(x, m) : x)),
  }));
}

/** Farbe der Auswahl ändern (Text: Schriftfarbe, Form: Linie; Füllung behält ihre Deckkraft). */
export function recolorItems(pages: Page[], index: number, refs: ItemRefs, color: string): Page[] {
  const s = new Set(refs.strokeIds);
  const o = new Set(refs.objectIds);
  return updatePage(pages, index, (p) => ({
    ...p,
    strokes: p.strokes.map((x) => (s.has(x.id) ? { ...x, color } : x)),
    objects: p.objects.map((x) => {
      if (!o.has(x.id)) return x;
      if (x.type === 'shape') return { ...x, color, fill: x.fill ? withAlpha(color, 0.3) : null };
      // Haftnotiz: Farbe = Notizfarbe; Schrift bleibt lesbar
      if (x.type === 'text' && x.sticky) return { ...x, background: color, color: inkOn(color) };
      if (x.type === 'text') return { ...x, color };
      return x;
    }),
  }));
}

/**
 * „Einbetten / Eingravieren“: Elemente werden fest Teil der Seitenebene – danach nicht mehr
 * auswählbar, verschiebbar, editierbar und nicht radierbar (nur „Seite leeren“ oder Rückgängig).
 */
export function engraveItems(pages: Page[], index: number, refs: ItemRefs): Page[] {
  const s = new Set(refs.strokeIds);
  const o = new Set(refs.objectIds);
  if (s.size + o.size === 0) return pages;
  return updatePage(pages, index, (p) => ({
    ...p,
    strokes: p.strokes.map((x) => (s.has(x.id) && !x.engraved ? { ...x, engraved: true } : x)),
    objects: p.objects.map((x) => (o.has(x.id) && !x.engraved ? { ...x, engraved: true } : x)),
  }));
}

export const countEngraved = (p: Page) => p.strokes.filter((s) => s.engraved).length + p.objects.filter((o) => o.engraved).length;

export interface ClipboardItems {
  strokes: Stroke[];
  objects: PageObject[];
}

export function copyItems(page: Page, refs: ItemRefs): ClipboardItems {
  const s = new Set(refs.strokeIds);
  const o = new Set(refs.objectIds);
  return { strokes: page.strokes.filter((x) => s.has(x.id)), objects: page.objects.filter((x) => o.has(x.id)) };
}

/** Fügt Elemente (mit neuen IDs, optional transformiert) ein und liefert die neuen Referenzen. */
export function pasteItems(pages: Page[], index: number, items: ClipboardItems, m: Mat): { pages: Page[]; refs: ItemRefs } {
  const strokes = items.strokes.map((x) => ({ ...transformStroke(x, m), id: newId() }));
  const objects = items.objects.map((x) => ({ ...transformObject(x, m), id: newId() }));
  return {
    pages: updatePage(pages, index, (p) => ({ ...p, strokes: [...p.strokes, ...strokes], objects: [...p.objects, ...objects] })),
    refs: { strokeIds: strokes.map((x) => x.id), objectIds: objects.map((x) => x.id) },
  };
}

/** Hex (#rrggbb) → rgba-String mit Deckkraft. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

// ------------------------------------------------------------------ Kommentare

function updateThread(pages: Page[], index: number, threadId: string, fn: (t: CommentThread) => CommentThread | null): Page[] {
  return updatePage(pages, index, (p) => {
    const t = p.comments.find((c) => c.id === threadId);
    if (!t) return p;
    const n = fn(t);
    return { ...p, comments: n ? p.comments.map((c) => (c.id === threadId ? n : c)) : p.comments.filter((c) => c.id !== threadId) };
  });
}

export function addThread(pages: Page[], index: number, x: number, y: number, text: string, now: number): { pages: Page[]; id: string } {
  const id = newId();
  const thread: CommentThread = { id, x, y, createdAt: now, resolved: false, messages: [{ id: newId(), text, createdAt: now, editedAt: null }] };
  return { pages: updatePage(pages, index, (p) => ({ ...p, comments: [...p.comments, thread] })), id };
}

export const addReply = (pages: Page[], index: number, threadId: string, text: string, now: number) =>
  updateThread(pages, index, threadId, (t) => ({ ...t, messages: [...t.messages, { id: newId(), text, createdAt: now, editedAt: null }] }));

export const editMessage = (pages: Page[], index: number, threadId: string, messageId: string, text: string, now: number) =>
  updateThread(pages, index, threadId, (t) => ({
    ...t,
    messages: t.messages.map((m) => (m.id === messageId && m.text !== text ? { ...m, text, editedAt: now } : m)),
  }));

/** Löscht eine Antwort; wird die letzte Nachricht gelöscht, verschwindet der ganze Thread. */
export const deleteMessage = (pages: Page[], index: number, threadId: string, messageId: string) =>
  updateThread(pages, index, threadId, (t) => {
    const messages = t.messages.filter((m) => m.id !== messageId);
    return messages.length ? { ...t, messages } : null;
  });

export const setResolved = (pages: Page[], index: number, threadId: string, resolved: boolean) =>
  updateThread(pages, index, threadId, (t) => (t.resolved === resolved ? t : { ...t, resolved }));

export const deleteThread = (pages: Page[], index: number, threadId: string) => updateThread(pages, index, threadId, () => null);

export const moveThread = (pages: Page[], index: number, threadId: string, x: number, y: number) =>
  updateThread(pages, index, threadId, (t) => ({ ...t, x, y }));
