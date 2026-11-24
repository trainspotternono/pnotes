import { describe, expect, it } from 'vitest';
import type { Folder, NotebookMeta } from '../../shared/types';
import * as L from './library';

const folder = (id: string, parentId: string | null = null, extra: Partial<Folder> = {}): Folder => ({
  id, name: id, parentId, color: '#000', favorite: false, createdAt: 1, updatedAt: 1, trashedAt: null, ...extra,
});
const nb = (id: string, folderId: string | null = null, extra: Partial<NotebookMeta> = {}): NotebookMeta => ({
  id, title: id, folderId, coverColor: '#123456', template: 'ruled', paperColor: 'white', format: 'A4',
  orientation: 'portrait', favorite: false, pageCount: 1, createdAt: 1, updatedAt: 1, openedAt: null, trashedAt: null, ...extra,
});

function sample() {
  let lib = L.emptyLibrary();
  lib = L.addFolder(lib, folder('uni'));
  lib = L.addFolder(lib, folder('mathe', 'uni'));
  lib = L.addNotebook(lib, nb('Analysis', 'mathe', { updatedAt: 5 }));
  lib = L.addNotebook(lib, nb('Tagebuch', null, { updatedAt: 9 }));
  lib = L.addNotebook(lib, nb('Einkauf', null, { updatedAt: 2 }));
  return lib;
}

describe('Bibliothek', () => {
  it('listet Ordner vor Notizbüchern und sortiert', () => {
    const lib = sample();
    expect(L.listFolder(lib, null, 'date-desc').map(L.itemName)).toEqual(['uni', 'Tagebuch', 'Einkauf']);
    expect(L.listFolder(lib, null, 'name-asc').map(L.itemName)).toEqual(['uni', 'Einkauf', 'Tagebuch']);
  });

  it('sucht rekursiv', () => {
    expect(L.listFolder(sample(), null, 'name-asc', 'ana').map(L.itemName)).toEqual(['Analysis']);
  });

  it('liefert den Breadcrumb-Pfad', () => {
    expect(L.folderPath(sample(), 'mathe').map((f) => f.id)).toEqual(['uni', 'mathe']);
  });

  it('verhindert Ordnerzyklen beim Bewegen', () => {
    const lib = sample();
    expect(L.move(lib, 'folder', 'uni', 'mathe', 2)).toBe(lib);
    expect(L.getFolder(L.move(lib, 'folder', 'mathe', null, 2), 'mathe')?.parentId).toBeNull();
  });

  it('Papierkorb: Ordner nimmt Inhalt mit, Wiederherstellen und endgültig löschen', () => {
    let lib = L.trash(sample(), 'folder', 'uni', 10);
    expect(L.isTrashed(lib, 'notebook', 'Analysis')).toBe(true);
    expect(L.listFolder(lib, null, 'name-asc').map(L.itemName)).toEqual(['Einkauf', 'Tagebuch']);
    expect(L.listTrash(lib, 'name-asc').map(L.itemName)).toEqual(['uni']);
    expect(L.listFolder(lib, null, 'name-asc', 'analysis')).toHaveLength(0);

    const restored = L.restore(lib, 'folder', 'uni');
    expect(L.isTrashed(restored, 'notebook', 'Analysis')).toBe(false);

    const { lib: after, deletedNotebookIds } = L.emptyTrash(lib);
    expect(deletedNotebookIds).toEqual(['Analysis']);
    expect(after.folders).toHaveLength(0);
    lib = after;
    expect(lib.notebooks.map((n) => n.id).sort()).toEqual(['Einkauf', 'Tagebuch']);
  });

  it('stellt in den Stamm wieder her, wenn der Elternordner gelöscht ist', () => {
    let lib = L.trash(sample(), 'notebook', 'Analysis', 3);
    lib = L.trash(lib, 'folder', 'mathe', 4);
    lib = L.restore(lib, 'notebook', 'Analysis');
    expect(L.getNotebook(lib, 'Analysis')?.folderId).toBeNull();
  });

  it('erzeugt eindeutige Namen und erkennt belegte Titel', () => {
    const lib = sample();
    expect(L.isTitleTaken(lib, null, ' tagebuch ')).toBe(true);
    expect(L.isTitleTaken(lib, 'uni', 'Tagebuch')).toBe(false);
    const taken = new Set(['Neu', 'Neu (2)']);
    expect(L.uniqueName('Neu', (n) => taken.has(n))).toBe('Neu (3)');
  });

  it('Favoriten und Zuletzt', () => {
    let lib = L.toggleFavorite(sample(), 'notebook', 'Einkauf');
    expect(L.listFavorites(lib, 'name-asc').map(L.itemName)).toEqual(['Einkauf']);
    lib = L.patchNotebook(lib, 'Einkauf', { openedAt: 100 });
    expect(L.listRecent(lib).map(L.itemName)[0]).toBe('Einkauf');
  });
});
