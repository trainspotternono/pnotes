/**
 * Reine (unveränderliche) Operationen auf der Bibliothek. Keine Seiteneffekte,
 * daher direkt testbar (library.test.ts).
 */
import type { Folder, LibraryData, NotebookMeta } from '../../shared/types';
import { tk } from '../i18n';

export type ItemKind = 'folder' | 'notebook';
export type Item = { kind: 'folder'; folder: Folder } | { kind: 'notebook'; notebook: NotebookMeta };
export type SortKey = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc';

/** Beschriftungen = Übersetzungsschlüssel (beim Anzeigen mit t() übersetzen). */
export const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'date-desc', label: tk('Neueste zuerst') },
  { id: 'date-asc', label: tk('Älteste zuerst') },
  { id: 'name-asc', label: tk('Name (A–Z)') },
  { id: 'name-desc', label: tk('Name (Z–A)') },
];

export const emptyLibrary = (): LibraryData => ({ version: 1, folders: [], notebooks: [] });

export const itemId = (i: Item) => (i.kind === 'folder' ? i.folder.id : i.notebook.id);
export const itemName = (i: Item) => (i.kind === 'folder' ? i.folder.name : i.notebook.title);
export const itemUpdated = (i: Item) => (i.kind === 'folder' ? i.folder.updatedAt : i.notebook.updatedAt);

/** Normalisiert geladene Daten (fehlende Felder aus älteren Versionen). */
export function normalizeLibrary(raw: LibraryData | null): LibraryData {
  if (!raw || raw.version !== 1) return emptyLibrary();
  return {
    version: 1,
    folders: (raw.folders ?? []).map((f) => ({ ...f, favorite: f.favorite ?? false, trashedAt: f.trashedAt ?? null })),
    notebooks: (raw.notebooks ?? []).map((n) => ({
      ...n,
      favorite: n.favorite ?? false,
      trashedAt: n.trashedAt ?? null,
      openedAt: n.openedAt ?? null,
      pageCount: n.pageCount ?? 1,
      paperColor: n.paperColor ?? 'white',
    })),
  };
}

// ------------------------------------------------------------------ Abfragen

export function getFolder(lib: LibraryData, id: string | null): Folder | undefined {
  return id ? lib.folders.find((f) => f.id === id) : undefined;
}

export function getNotebook(lib: LibraryData, id: string): NotebookMeta | undefined {
  return lib.notebooks.find((n) => n.id === id);
}

/** Pfad vom Stamm bis zum Ordner (für die Breadcrumb). */
export function folderPath(lib: LibraryData, folderId: string | null): Folder[] {
  const path: Folder[] = [];
  const seen = new Set<string>();
  let cur = getFolder(lib, folderId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = getFolder(lib, cur.parentId);
  }
  return path;
}

/** true, wenn `folderId` gleich `ancestorId` ist oder darunter liegt. */
export function isWithin(lib: LibraryData, folderId: string | null, ancestorId: string): boolean {
  return folderPath(lib, folderId).some((f) => f.id === ancestorId);
}

/** Liegt das Element (oder einer seiner Elternordner) im Papierkorb? */
export function isTrashed(lib: LibraryData, kind: ItemKind, id: string): boolean {
  if (kind === 'notebook') {
    const n = getNotebook(lib, id);
    if (!n) return false;
    return n.trashedAt !== null || folderPath(lib, n.folderId).some((f) => f.trashedAt !== null);
  }
  const f = getFolder(lib, id);
  if (!f) return false;
  return folderPath(lib, f.id).some((x) => x.trashedAt !== null);
}

function compare(sort: SortKey) {
  return (a: Item, b: Item) => {
    switch (sort) {
      case 'date-desc':
        return itemUpdated(b) - itemUpdated(a);
      case 'date-asc':
        return itemUpdated(a) - itemUpdated(b);
      case 'name-asc':
        return itemName(a).localeCompare(itemName(b), 'de', { numeric: true, sensitivity: 'base' });
      case 'name-desc':
        return itemName(b).localeCompare(itemName(a), 'de', { numeric: true, sensitivity: 'base' });
    }
  };
}

/** Ordner immer vor Notizbüchern, innerhalb der Gruppen nach `sort`. */
export function sortItems(items: Item[], sort: SortKey): Item[] {
  const cmp = compare(sort);
  return [...items].sort((a, b) => (a.kind === b.kind ? cmp(a, b) : a.kind === 'folder' ? -1 : 1));
}

const matches = (name: string, q: string) => name.toLocaleLowerCase('de').includes(q.toLocaleLowerCase('de'));

/** Inhalt eines Ordners; mit Suchbegriff rekursiv über die ganze (nicht gelöschte) Bibliothek. */
export function listFolder(lib: LibraryData, folderId: string | null, sort: SortKey, search = ''): Item[] {
  const q = search.trim();
  let items: Item[];
  if (q) {
    items = [
      ...lib.folders.filter((f) => !isTrashed(lib, 'folder', f.id) && matches(f.name, q)).map((folder) => ({ kind: 'folder' as const, folder })),
      ...lib.notebooks.filter((n) => !isTrashed(lib, 'notebook', n.id) && matches(n.title, q)).map((notebook) => ({ kind: 'notebook' as const, notebook })),
    ];
  } else {
    items = [
      ...lib.folders.filter((f) => f.parentId === folderId && f.trashedAt === null).map((folder) => ({ kind: 'folder' as const, folder })),
      ...lib.notebooks.filter((n) => n.folderId === folderId && n.trashedAt === null).map((notebook) => ({ kind: 'notebook' as const, notebook })),
    ];
  }
  return sortItems(items, sort);
}

export function listRecent(lib: LibraryData, limit = 24): Item[] {
  return lib.notebooks
    .filter((n) => !isTrashed(lib, 'notebook', n.id))
    .sort((a, b) => Math.max(b.openedAt ?? 0, b.updatedAt) - Math.max(a.openedAt ?? 0, a.updatedAt))
    .slice(0, limit)
    .map((notebook) => ({ kind: 'notebook' as const, notebook }));
}

export function listFavorites(lib: LibraryData, sort: SortKey): Item[] {
  return sortItems(
    [
      ...lib.folders.filter((f) => f.favorite && !isTrashed(lib, 'folder', f.id)).map((folder) => ({ kind: 'folder' as const, folder })),
      ...lib.notebooks.filter((n) => n.favorite && !isTrashed(lib, 'notebook', n.id)).map((notebook) => ({ kind: 'notebook' as const, notebook })),
    ],
    sort,
  );
}

/** Nur die „Wurzeln“ im Papierkorb (Inhalte gelöschter Ordner werden mit dem Ordner gezeigt). */
export function listTrash(lib: LibraryData, sort: SortKey): Item[] {
  const parentTrashed = (parentId: string | null) => folderPath(lib, parentId).some((f) => f.trashedAt !== null);
  return sortItems(
    [
      ...lib.folders.filter((f) => f.trashedAt !== null && !parentTrashed(f.parentId)).map((folder) => ({ kind: 'folder' as const, folder })),
      ...lib.notebooks.filter((n) => n.trashedAt !== null && !parentTrashed(n.folderId)).map((notebook) => ({ kind: 'notebook' as const, notebook })),
    ],
    sort,
  );
}

export function countInside(lib: LibraryData, folderId: string): { folders: number; notebooks: number } {
  return {
    folders: lib.folders.filter((f) => f.parentId === folderId && f.trashedAt === null).length,
    notebooks: lib.notebooks.filter((n) => n.folderId === folderId && n.trashedAt === null).length,
  };
}

export function isTitleTaken(lib: LibraryData, folderId: string | null, title: string, exceptId?: string): boolean {
  const t = title.trim().toLocaleLowerCase('de');
  return lib.notebooks.some((n) => n.id !== exceptId && n.folderId === folderId && n.trashedAt === null && n.title.trim().toLocaleLowerCase('de') === t);
}

/** „Name“, „Name (2)“, „Name (3)“ … */
export function uniqueName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base;
  const stem = base.replace(/\s\(\d+\)$/, '');
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${stem} (${i})`;
    if (!taken(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})`;
}

// --------------------------------------------------------------- Änderungen

export function addFolder(lib: LibraryData, folder: Folder): LibraryData {
  return { ...lib, folders: [...lib.folders, folder] };
}

export function addNotebook(lib: LibraryData, nb: NotebookMeta): LibraryData {
  return { ...lib, notebooks: [...lib.notebooks, nb] };
}

function patchFolder(lib: LibraryData, id: string, patch: Partial<Folder>): LibraryData {
  return { ...lib, folders: lib.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) };
}

export function patchNotebook(lib: LibraryData, id: string, patch: Partial<NotebookMeta>): LibraryData {
  return { ...lib, notebooks: lib.notebooks.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

export function rename(lib: LibraryData, kind: ItemKind, id: string, name: string, now: number): LibraryData {
  const clean = name.trim();
  if (!clean) return lib;
  return kind === 'folder' ? patchFolder(lib, id, { name: clean, updatedAt: now }) : patchNotebook(lib, id, { title: clean, updatedAt: now });
}

export function setColor(lib: LibraryData, kind: ItemKind, id: string, color: string | null, now: number): LibraryData {
  return kind === 'folder'
    ? patchFolder(lib, id, { color: color ?? '#80C1FF', updatedAt: now })
    : patchNotebook(lib, id, { coverColor: color, updatedAt: now });
}

export function toggleFavorite(lib: LibraryData, kind: ItemKind, id: string): LibraryData {
  if (kind === 'folder') {
    const f = getFolder(lib, id);
    return f ? patchFolder(lib, id, { favorite: !f.favorite }) : lib;
  }
  const n = getNotebook(lib, id);
  return n ? patchNotebook(lib, id, { favorite: !n.favorite }) : lib;
}

/** Bewegen; ein Ordner kann nicht in sich selbst oder einen Unterordner verschoben werden. */
export function move(lib: LibraryData, kind: ItemKind, id: string, target: string | null, now: number): LibraryData {
  if (target !== null && !getFolder(lib, target)) return lib;
  if (kind === 'folder') {
    if (target !== null && isWithin(lib, target, id)) return lib;
    return patchFolder(lib, id, { parentId: target, updatedAt: now });
  }
  return patchNotebook(lib, id, { folderId: target, updatedAt: now });
}

export function trash(lib: LibraryData, kind: ItemKind, id: string, now: number): LibraryData {
  return kind === 'folder' ? patchFolder(lib, id, { trashedAt: now }) : patchNotebook(lib, id, { trashedAt: now });
}

/** Wiederherstellen; liegt der Elternordner noch im Papierkorb oder fehlt er, landet das Element im Stamm. */
export function restore(lib: LibraryData, kind: ItemKind, id: string): LibraryData {
  if (kind === 'folder') {
    const f = getFolder(lib, id);
    if (!f) return lib;
    const parentOk = f.parentId === null || (getFolder(lib, f.parentId) && !isTrashed(lib, 'folder', f.parentId));
    return patchFolder(lib, id, { trashedAt: null, parentId: parentOk ? f.parentId : null });
  }
  const n = getNotebook(lib, id);
  if (!n) return lib;
  const parentOk = n.folderId === null || (getFolder(lib, n.folderId) && !isTrashed(lib, 'folder', n.folderId));
  return patchNotebook(lib, id, { trashedAt: null, folderId: parentOk ? n.folderId : null });
}

/** Endgültig löschen. Liefert die IDs der Notizbuch-Dateien, die entfernt werden müssen. */
export function removeForever(lib: LibraryData, kind: ItemKind, id: string): { lib: LibraryData; deletedNotebookIds: string[] } {
  if (kind === 'notebook') {
    return { lib: { ...lib, notebooks: lib.notebooks.filter((n) => n.id !== id) }, deletedNotebookIds: [id] };
  }
  const doomedFolders = new Set(lib.folders.filter((f) => isWithin(lib, f.id, id)).map((f) => f.id));
  const doomedNotebooks = lib.notebooks.filter((n) => n.folderId !== null && doomedFolders.has(n.folderId)).map((n) => n.id);
  return {
    lib: {
      ...lib,
      folders: lib.folders.filter((f) => !doomedFolders.has(f.id)),
      notebooks: lib.notebooks.filter((n) => !doomedNotebooks.includes(n.id)),
    },
    deletedNotebookIds: doomedNotebooks,
  };
}

export function emptyTrash(lib: LibraryData): { lib: LibraryData; deletedNotebookIds: string[] } {
  let cur = lib;
  const deleted: string[] = [];
  for (const item of listTrash(lib, 'date-desc')) {
    const r = removeForever(cur, item.kind, itemId(item));
    cur = r.lib;
    deleted.push(...r.deletedNotebookIds);
  }
  return { lib: cur, deletedNotebookIds: deleted };
}
