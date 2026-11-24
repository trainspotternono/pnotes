import type { Page, PageObject, PageRotation, PaperTemplate } from '../../shared/types';
import { newId } from '../lib/ids';
import { newPage } from '../lib/notebook';
import { apply, transformObject, transformStroke, type Mat } from '../ink/transform';

/** Reine Seitenoperationen (jede liefert ein neues Array → ein Undo-Schritt). */

/** Neue leere Seite; übernimmt die Größe der vorherigen Seite (z. B. neben PDF-Seiten). */
export function insertPage(pages: Page[], at: number, template: PaperTemplate): Page[] {
  const i = Math.max(0, Math.min(at, pages.length));
  const neighbor = pages[i - 1] ?? pages[i];
  const page = newPage(template);
  if (neighbor?.size) page.size = { ...neighbor.size };
  return [...pages.slice(0, i), page, ...pages.slice(i)];
}

/** Neue Seite mit PDF-Seite als Hintergrund (eigene Größe in pt). */
export function pdfPage(ref: { asset: string; page: number }, size: { w: number; h: number }): Page {
  return { ...newPage('blank'), size: { ...size }, pdf: { ...ref } };
}

/** Fügt fertige Seiten (z. B. importierte PDF-Seiten) an Position `at` ein. */
export function insertPages(pages: Page[], at: number, newPages: Page[]): Page[] {
  const i = Math.max(0, Math.min(at, pages.length));
  return [...pages.slice(0, i), ...newPages, ...pages.slice(i)];
}

/**
 * Tiefe Kopie einer Seite mit neuen IDs – Striche, Formen, Texte, Haftnotizen, Bilder/GIFs,
 * eingravierte Elemente, Kommentare (inkl. Antworten), Drehung und Hintergrund (Vorlage/PDF).
 */
export function clonePage(src: Page): Page {
  return {
    id: newId(),
    template: src.template,
    ...(src.size ? { size: { ...src.size } } : {}),
    ...(src.pdf ? { pdf: { ...src.pdf } } : {}),
    ...(src.hiddenPdf ? { hiddenPdf: { ...src.hiddenPdf } } : {}),
    ...(src.rotation ? { rotation: src.rotation } : {}),
    strokes: src.strokes.map((s) => ({ ...s, id: newId(), points: s.points.slice() })),
    objects: src.objects.map((o) => ({ ...structuredClone(o), id: newId() })),
    comments: src.comments.map((c) => ({ ...c, id: newId(), messages: c.messages.map((m) => ({ ...m, id: newId() })) })),
  };
}

export function duplicatePage(pages: Page[], index: number): Page[] {
  const src = pages[index];
  if (!src) return pages;
  return [...pages.slice(0, index + 1), clonePage(src), ...pages.slice(index + 1)];
}

/** Fügt kopierte Seiten (z. B. aus der Seiten-Zwischenablage, auch aus einem anderen Notizbuch) mit neuen IDs ein. */
export function pastePages(pages: Page[], at: number, copied: Page[]): Page[] {
  return insertPages(pages, at, copied.map(clonePage));
}

/**
 * Dreht eine Seite um 90° im Uhrzeigersinn. Alle Inhalte werden in die neue Lage umgerechnet
 * (x' = H − y, y' = x), die Seitengröße wird getauscht; der Hintergrund merkt sich den Winkel.
 * Dadurch stimmen Stift-/Pointer-Koordinaten nach der Drehung ohne weitere Umrechnung.
 */
export function rotatePage(pages: Page[], index: number, defaultSize: { w: number; h: number }): Page[] {
  const p = pages[index];
  if (!p) return pages;
  const { w, h } = p.size ?? defaultSize;
  const m: Mat = { a: 0, b: 1, c: -1, d: 0, e: h, f: 0 };
  const rotation = ((((p.rotation ?? 0) + 90) % 360) as PageRotation);
  const next: Page = {
    ...p,
    size: { w: h, h: w },
    rotation,
    strokes: p.strokes.map((s) => transformStroke(s, m)),
    objects: p.objects.map((o) => normalizeRotation(transformObject(o, m))),
    comments: p.comments.map((c) => {
      const [x, y] = apply(m, c.x, c.y);
      return { ...c, x, y };
    }),
  };
  if (!rotation) delete next.rotation;
  return pages.map((x, i) => (i === index ? next : x));
}

const normalizeRotation = (o: PageObject): PageObject => (o.type === 'shape' ? o : { ...o, rotation: (((o.rotation % 360) + 360) % 360) });

/** Unverdrehte Größe des Hintergrunds (Vorlage/PDF) einer Seite. */
export function baseSize(p: Page, defaultSize: { w: number; h: number }): { w: number; h: number } {
  const s = p.size ?? defaultSize;
  return p.rotation === 90 || p.rotation === 270 ? { w: s.h, h: s.w } : s;
}

/** Die letzte Seite wird nicht gelöscht, sondern geleert. */
export function deletePage(pages: Page[], index: number): Page[] {
  if (!pages[index]) return pages;
  if (pages.length === 1) return clearPage(pages, 0);
  return pages.filter((_, i) => i !== index);
}

export function movePage(pages: Page[], index: number, to: number): Page[] {
  if (!pages[index] || to < 0 || to >= pages.length || to === index) return pages;
  const next = [...pages];
  const [p] = next.splice(index, 1);
  next.splice(to, 0, p);
  return next;
}

/**
 * Vorlage einer Seite wechseln. Auf einer PDF-Seite wird der PDF-Hintergrund dabei ausgeblendet
 * (nicht gelöscht) und kann mit `restorePdfBackground` zurückgeholt werden.
 */
export function setPageTemplate(pages: Page[], index: number, template: PaperTemplate): Page[] {
  const p = pages[index];
  if (!p || (p.template === template && !p.pdf)) return pages;
  return pages.map((x, i) => {
    if (i !== index) return x;
    const { pdf, ...rest } = x;
    return pdf ? { ...rest, template, hiddenPdf: pdf } : { ...rest, template };
  });
}

/** Ausgeblendeten PDF-Hintergrund wieder anzeigen. */
export function restorePdfBackground(pages: Page[], index: number): Page[] {
  const p = pages[index];
  if (!p?.hiddenPdf) return pages;
  return pages.map((x, i) => {
    if (i !== index) return x;
    const { hiddenPdf, ...rest } = x;
    return { ...rest, pdf: hiddenPdf };
  });
}

/** Inhaltsarten, die „Seite leeren“ einzeln entfernen kann. */
export type ClearCategory = 'ink' | 'shapes' | 'texts' | 'stickies' | 'images' | 'comments';
export const CLEAR_CATEGORIES: ClearCategory[] = ['ink', 'shapes', 'texts', 'stickies', 'images', 'comments'];

/** Zu welcher Kategorie gehört ein Objekt? */
export function objectCategory(o: PageObject): ClearCategory {
  if (o.type === 'shape') return 'shapes';
  if (o.type === 'image') return 'images';
  return o.sticky ? 'stickies' : 'texts';
}

/** Anzahl je Kategorie (für den Dialog). */
export function countPageContent(p: Page): Record<ClearCategory, number> {
  const c: Record<ClearCategory, number> = { ink: p.strokes.length, shapes: 0, texts: 0, stickies: 0, images: 0, comments: p.comments.length };
  for (const o of p.objects) c[objectCategory(o)]++;
  return c;
}

/**
 * „Seite leeren“: entfernt die gewählten Inhaltsarten (Standard: alles – Handschrift, Formen, Texte,
 * Haftnotizen, Bilder/Sticker/GIFs, Kommentare inkl. Antworten, auch eingravierte Elemente).
 * Hintergrund (Vorlage/PDF), Größe und Drehung bleiben.
 */
export function clearPage(pages: Page[], index: number, cats: Iterable<ClearCategory> = CLEAR_CATEGORIES): Page[] {
  const p = pages[index];
  if (!p) return pages;
  const set = new Set(cats);
  const strokes = set.has('ink') ? [] : p.strokes;
  const objects = p.objects.some((o) => set.has(objectCategory(o))) ? p.objects.filter((o) => !set.has(objectCategory(o))) : p.objects;
  const comments = set.has('comments') ? [] : p.comments;
  const changed = (strokes !== p.strokes && p.strokes.length > 0) || objects !== p.objects || (comments !== p.comments && p.comments.length > 0);
  if (!changed) return pages;
  return pages.map((x, i) => (i === index ? { ...x, strokes, objects, comments } : x));
}

/** Keine Tinte/Objekte (Kommentare zählen hier nicht – für Vorschaubilder/Export). */
export const pageIsEmpty = (p: Page) => p.strokes.length === 0 && p.objects.length === 0;
/** Gar nichts auf der Seite, auch keine Kommentare. */
export const pageHasContent = (p: Page) => !pageIsEmpty(p) || p.comments.length > 0;
