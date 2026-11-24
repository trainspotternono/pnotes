/**
 * Integrationstests: echte HTTP-Anfragen gegen den Nextcloud-ähnlichen WebDAV-Mock,
 * zwei „Geräte“ (A und B) mit eigener lokaler Ablage.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Folder, LibraryData, NotebookContent, NotebookMeta } from '../../shared/types';
import { Storage } from '../storage';
import { makeTestPdf } from '../testPdf';
import { SyncEngine, conflictTitle } from './engine';
import { startMockServer, type MockServer } from './mock-server';
import { WebDavClient, davRootUrl, normalizeDavUrl, parseMultistatus, testConnection, testWebDav, type FetchFn } from './webdav';

const fetchFn: FetchFn = async (url, init) => {
  const r = await fetch(url, init);
  return { status: r.status, headers: r.headers, text: () => r.text(), arrayBuffer: () => r.arrayBuffer() };
};

const PASS = 'demo-demo-demo-demo-demo';
let server: MockServer;
let dirs: string[] = [];

function device(): { store: Storage; engine: () => SyncEngine } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-sync-'));
  dirs.push(dir);
  const store = new Storage(dir);
  const dav = new WebDavClient(davRootUrl(server.url, 'demo'), 'demo', PASS, fetchFn);
  return { store, engine: () => new SyncEngine(dav, store, '/pNotes-Sync', 'test-target') };
}

const folder = (id: string, name: string, extra: Partial<Folder> = {}): Folder => ({
  id, name, parentId: null, color: '#80C1FF', favorite: false, createdAt: 1, updatedAt: 1, trashedAt: null, ...extra,
});
const meta = (id: string, title: string, extra: Partial<NotebookMeta> = {}): NotebookMeta => ({
  id, title, folderId: null, coverColor: '#305BB0', template: 'ruled', paperColor: 'white', format: 'A4', orientation: 'portrait',
  favorite: false, pageCount: 1, createdAt: 1, updatedAt: 1, openedAt: null, trashedAt: null, ...extra,
});
const content = (id: string, note: string): NotebookContent => ({
  version: 1,
  id,
  pages: [
    {
      id: 'p1',
      template: 'ruled',
      strokes: [{ id: 's1', tool: 'pen', color: '#000', width: 2, points: [0, 0, 0.5, 10, 10, 0.5], dash: 'dashed', dashArray: [6, 4.4] }],
      objects: [{ id: 'i1', type: 'image', cx: 50, cy: 50, w: 20, h: 20, rotation: 0, src: 'data:image/png;base64,iVBORw0KGgo=', naturalW: 1, naturalH: 1, crop: { x: 0, y: 0, w: 1, h: 1 } }],
      comments: [{ id: 'c1', x: 5, y: 5, createdAt: 1, resolved: false, messages: [{ id: 'm1', text: note, createdAt: 1, editedAt: null }] }],
    },
  ],
});

async function seed(store: Storage, lib: LibraryData, contents: NotebookContent[]) {
  await store.saveLibrary(lib);
  for (const c of contents) await store.saveNotebook(c);
}

beforeEach(async () => {
  server = await startMockServer();
  dirs = [];
});
afterEach(async () => {
  await server.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('WebDAV-Client', () => {
  it('parst Multistatus mit verschiedenen Namespace-Präfixen', () => {
    const xml = `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/remote.php/dav/files/demo/A%20B/x.json</D:href><D:propstat><D:prop><D:resourcetype/><D:getetag>&quot;abc&quot;</D:getetag><D:getlastmodified>Sun, 22 Nov 2026 10:00:00 GMT</D:getlastmodified></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
    const [e] = parseMultistatus(xml);
    expect(e.name).toBe('x.json');
    expect(e.etag).toBe('"abc"');
    expect(e.isCollection).toBe(false);
    expect(e.lastModified).toBe(Date.parse('Sun, 22 Nov 2026 10:00:00 GMT'));
  });

  it('Verbindungstest: Erfolg, falsches Passwort, falsche URL', async () => {
    const ok = await testConnection(server.url, 'demo', PASS, '/pNotes-Sync', fetchFn);
    expect(ok.ok).toBe(true);
    expect(ok.details.join(' ')).toContain('Nextcloud (Mock)');
    expect(ok.details.join(' ')).toContain('wird beim ersten Sync angelegt');
    const bad = await testConnection(server.url, 'demo', 'falsch', '/pNotes-Sync', fetchFn);
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('401');
    const down = await testConnection('http://127.0.0.1:1', 'demo', PASS, '/x', fetchFn);
    expect(down.ok).toBe(false);
    expect(down.message).toMatch(/abgelehnt|Netzwerk/);
  });
});

describe('Sync-Engine', () => {
  it('überträgt Ordner, Notizbücher, Bilder und Kommentare von A nach B', async () => {
    const A = device();
    const B = device();
    await seed(A.store, { version: 1, folders: [folder('f1', 'Uni')], notebooks: [meta('n1', 'Mathe', { folderId: 'f1', openedAt: 99 })] }, [content('n1', 'Bitte prüfen')]);

    const ra = await A.engine().run();
    expect(ra.ok).toBe(true);
    expect(ra.uploaded).toBe(2);
    expect([...server.files.keys()].sort()).toContain('/pNotes-Sync/notebooks/n1.json');

    const rb = await B.engine().run();
    expect(rb.downloaded).toBe(2);
    expect(rb.changedLocal).toBe(true);
    const libB = await B.store.loadLibrary();
    expect(libB?.folders[0].name).toBe('Uni');
    expect(libB?.notebooks[0]).toMatchObject({ title: 'Mathe', folderId: 'f1', openedAt: null });
    const cB = await B.store.loadNotebook('n1');
    expect(cB?.pages[0].comments[0].messages[0].text).toBe('Bitte prüfen');
    expect(cB?.pages[0].objects[0]).toMatchObject({ type: 'image' });
    expect(cB?.pages[0].strokes[0].dashArray).toEqual([6, 4.4]);

    // Zweiter Lauf ändert nichts
    const again = await A.engine().run();
    expect(again.uploaded + again.downloaded).toBe(0);
    // Öffnen (openedAt) ist gerätelokal und löst keinen Upload aus
    const libA = (await A.store.loadLibrary())!;
    await A.store.saveLibrary({ ...libA, notebooks: libA.notebooks.map((n) => ({ ...n, openedAt: 12345 })) });
    expect((await A.engine().run()).uploaded).toBe(0);
  });

  it('lädt nur lokal geänderte Notizbücher hoch und übernimmt entfernte Änderungen', async () => {
    const A = device();
    const B = device();
    await seed(A.store, { version: 1, folders: [], notebooks: [meta('n1', 'Mathe')] }, [content('n1', 'v1')]);
    await A.engine().run();
    await B.engine().run();

    await A.store.saveNotebook(content('n1', 'v2 von A'));
    const ra = await A.engine().run();
    expect(ra.uploaded).toBe(1);
    const rb = await B.engine().run();
    expect(rb.downloaded).toBe(1);
    expect((await B.store.loadNotebook('n1'))?.pages[0].comments[0].messages[0].text).toBe('v2 von A');
  });

  it('Konflikt: beidseitig geändert → Konfliktkopie, nichts wird überschrieben', async () => {
    const A = device();
    const B = device();
    await seed(A.store, { version: 1, folders: [], notebooks: [meta('n1', 'Mathe')] }, [content('n1', 'Basis')]);
    await A.engine().run();
    await B.engine().run();

    await A.store.saveNotebook(content('n1', 'Änderung A'));
    await B.store.saveNotebook(content('n1', 'Änderung B'));
    await A.engine().run(); // A gewinnt den Server
    const fixed = Date.UTC(2026, 10, 22, 13, 5);
    const dav = new WebDavClient(davRootUrl(server.url, 'demo'), 'demo', PASS, fetchFn);
    const rb = await new SyncEngine(dav, B.store, '/pNotes-Sync', 'test-target', () => fixed).run();
    expect(rb.conflicts).toHaveLength(1);

    const libB = (await B.store.loadLibrary())!;
    expect(libB.notebooks.map((n) => n.title).sort()).toEqual(['Mathe', conflictTitle('Mathe', fixed)].sort());
    const copy = libB.notebooks.find((n) => n.title.includes('Konflikt'))!;
    expect(copy.title).toMatch(/^Mathe \(Konflikt \d{4}-\d{2}-\d{2} \d{2}-\d{2}\)$/);
    expect((await B.store.loadNotebook(copy.id))?.pages[0].comments[0].messages[0].text).toBe('Änderung B');
    expect((await B.store.loadNotebook('n1'))?.pages[0].comments[0].messages[0].text).toBe('Änderung A');

    // A bekommt die Konfliktkopie ebenfalls
    const ra = await A.engine().run();
    expect(ra.downloaded).toBe(1);
    expect((await A.store.loadLibrary())!.notebooks).toHaveLength(2);
  });

  it('Lösch-Propagation in beide Richtungen nur nach Bestätigung', async () => {
    const A = device();
    const B = device();
    await seed(A.store, { version: 1, folders: [folder('f1', 'Archiv')], notebooks: [meta('n1', 'Alt', { folderId: 'f1' }), meta('n2', 'Bleibt')] }, [content('n1', 'x'), content('n2', 'y')]);
    await A.engine().run();
    await B.engine().run();

    // A löscht Ordner + Notizbuch endgültig
    const libA = (await A.store.loadLibrary())!;
    await A.store.saveLibrary({ ...libA, folders: [], notebooks: libA.notebooks.filter((n) => n.id !== 'n1') });
    await A.store.deleteNotebook('n1');
    const ra = await A.engine().run();
    expect(ra.pendingDeletions.map((d) => `${d.where}:${d.title}`).sort()).toEqual(['remote:Alt', 'remote:Archiv']);
    expect(server.files.has('/pNotes-Sync/notebooks/n1.json')).toBe(true); // noch nicht gelöscht!

    const del = await A.engine().resolveDeletions(ra.pendingDeletions.map((d) => ({ key: d.key, delete: true })));
    expect(del.deletedRemote).toBe(2);
    expect(server.files.has('/pNotes-Sync/notebooks/n1.json')).toBe(false);

    // B erfährt davon: Löschung auf Nextcloud → lokal löschen nach Bestätigung
    const rb = await B.engine().run();
    expect(rb.pendingDeletions.map((d) => `${d.where}:${d.title}`).sort()).toEqual(['local:Alt', 'local:Archiv']);
    const delB = await B.engine().resolveDeletions(rb.pendingDeletions.map((d) => ({ key: d.key, delete: true })));
    expect(delB.deletedLocal).toBe(2);
    const libB = (await B.store.loadLibrary())!;
    expect(libB.notebooks.map((n) => n.title)).toEqual(['Bleibt']);
    expect(libB.folders).toHaveLength(0);
  });

  it('„Nicht löschen“ stellt den Stand auf beiden Seiten wieder her', async () => {
    const A = device();
    await seed(A.store, { version: 1, folders: [], notebooks: [meta('n1', 'Wichtig')] }, [content('n1', 'x')]);
    await A.engine().run();
    await A.store.saveLibrary({ version: 1, folders: [], notebooks: [] });
    await A.store.deleteNotebook('n1');
    const r = await A.engine().run();
    expect(r.pendingDeletions).toHaveLength(1);
    const keep = await A.engine().resolveDeletions([{ key: r.pendingDeletions[0].key, delete: false }]);
    expect(keep.downloaded).toBe(1);
    expect((await A.store.loadLibrary())!.notebooks[0].title).toBe('Wichtig');
    expect((await A.engine().run()).pendingDeletions).toHaveLength(0);
  });

  it('Server-Änderung durch Fremdgerät wird erkannt (ETag), ungültige Dateien als Fehler gemeldet', async () => {
    const A = device();
    await seed(A.store, { version: 1, folders: [folder('f1', 'Uni')], notebooks: [] }, []);
    await A.engine().run();
    server.write('/pNotes-Sync/folders/f1.json', JSON.stringify({ format: 'papierwerk-folder', version: 1, folder: folder('f1', 'Uni (umbenannt)', { updatedAt: 5 }) }));
    server.write('/pNotes-Sync/notebooks/kaputt.json', '{"format":"etwas anderes"}');
    const r = await A.engine().run();
    expect(r.downloaded).toBe(1);
    expect(r.errors.join(' ')).toContain('kaputt');
    expect((await A.store.loadLibrary())!.folders[0].name).toBe('Uni (umbenannt)');
  });

  it('PDF-Seiten: PDF-Datei wird einmalig als Asset übertragen, Anmerkungen bleiben an der Seite', async () => {
    const A = device();
    const B = device();
    const pdf = makeTestPdf(3);
    const asset = await A.store.putAsset(new Uint8Array(pdf), 'pdf');
    expect(asset).toMatch(/^[a-f0-9]{40}$/);
    expect(await A.store.putAsset(new Uint8Array(pdf), 'pdf')).toBe(asset); // gleiche Datei → gleiche ID, kein Duplikat
    const c: NotebookContent = {
      version: 1,
      id: 'pdfnb',
      pages: [1, 2].map((n) => ({
        id: `p${n}`,
        template: 'blank' as const,
        size: n === 1 ? { w: 595.28, h: 841.89 } : { w: 841.89, h: 595.28 },
        pdf: { asset, page: n },
        strokes: [{ id: `s${n}`, tool: 'highlighter' as const, color: '#ffe55f', width: 14, points: [10, 10, 0.5, 200, 10, 0.5] }],
        objects: [],
        comments: [{ id: `c${n}`, x: 50, y: 50, createdAt: 1, resolved: false, messages: [{ id: 'm', text: `Notiz ${n}`, createdAt: 1, editedAt: null }] }],
      })),
    };
    await seed(A.store, { version: 1, folders: [], notebooks: [meta('pdfnb', 'Skript', { coverColor: null, coverPdf: { asset, page: 1 } })] }, [c]);

    const ra = await A.engine().run();
    expect(ra.ok).toBe(true);
    expect(server.files.get(`/pNotes-Sync/assets/${asset}.pdf`)?.body.equals(pdf)).toBe(true);
    expect(server.files.get('/pNotes-Sync/notebooks/pdfnb.json')!.body.length).toBeLessThan(pdf.length + 4000); // PDF nicht im JSON

    const rb = await B.engine().run();
    expect(rb.ok).toBe(true);
    expect(Buffer.from((await B.store.getAsset(asset, 'pdf'))!).equals(pdf)).toBe(true);
    const cb = (await B.store.loadNotebook('pdfnb'))!;
    expect(cb.pages[1]).toMatchObject({ size: { w: 841.89, h: 595.28 }, pdf: { asset, page: 2 } });
    expect(cb.pages[1].comments[0].messages[0].text).toBe('Notiz 2');
    // Zweiter Lauf: Asset wird nicht erneut übertragen
    const again = await B.engine().run();
    expect(again.uploaded + again.downloaded).toBe(0);
  });

  it('lehnt Nicht-PDF-Dateien und manipulierte Assets ab', async () => {
    const A = device();
    await expect(A.store.putAsset(new TextEncoder().encode('kein pdf'), 'pdf')).rejects.toThrow(/keine gültige PDF/);
    await expect(A.store.writeAsset('0'.repeat(40), 'pdf', new Uint8Array(makeTestPdf(1)))).rejects.toThrow(/Prüfsumme/);
  });

  it('meldet „offline“, wenn der Server nicht erreichbar ist', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-sync-'));
    dirs.push(dir);
    const dav = new WebDavClient(davRootUrl('http://127.0.0.1:1', 'demo'), 'demo', PASS, fetchFn);
    const r = await new SyncEngine(dav, new Storage(dir), '/pNotes-Sync', 't').run();
    expect(r.ok).toBe(false);
    expect(r.offline).toBe(true);
  });
});

describe('Eigener WebDAV-Server (benutzerdefiniert, volle WebDAV-URL)', () => {
  it('Adresse normalisieren: https ergänzen, Pfad behalten', () => {
    expect(normalizeDavUrl('nas.local:5006/home/')).toBe('https://nas.local:5006/home');
    expect(normalizeDavUrl('http://127.0.0.1:8080/remote.php/webdav')).toBe('http://127.0.0.1:8080/remote.php/webdav');
    expect(() => normalizeDavUrl('  ')).toThrow();
  });

  it('Verbindung testen und synchronisieren über die volle URL', async () => {
    const url = davRootUrl(server.url, 'demo');
    const ok = await testWebDav(url, 'demo', PASS, '/Eigenes-Ziel', fetchFn);
    expect(ok.ok).toBe(true);
    expect((await testWebDav(url, 'demo', 'falsch', '/x', fetchFn)).message).toMatch(/401/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-dav-'));
    dirs.push(dir);
    const store = new Storage(dir);
    await seed(store, { version: 1, folders: [], notebooks: [meta('n1', 'WebDAV-Test')] }, [content('n1', 'x')]);
    const r = await new SyncEngine(new WebDavClient(normalizeDavUrl(url), 'demo', PASS, fetchFn), store, '/Eigenes-Ziel', 'dav', Date.now, 'auf dem WebDAV-Server').run();
    expect(r.ok).toBe(true);
    expect(server.files.has('/Eigenes-Ziel/notebooks/n1.json')).toBe(true);
  });
});