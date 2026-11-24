/**
 * Ordner-Sync (Google Drive für Desktop, iCloud für Windows, OneDrive, Dropbox, NAS, USB):
 * zwei „Geräte“ (A, B) mit eigener lokaler Ablage synchronisieren über denselben Ordner –
 * genau so, wie es die Cloud-App des Anbieters zwischen zwei PCs tut.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LibraryData, NotebookContent, NotebookMeta } from '../../shared/types';
import { Storage } from '../storage';
import { makeTestPdf } from '../testPdf';
import { detectCloudFolders, type DetectEnv } from './detect';
import { SyncEngine } from './engine';
import { FolderStore, testFolder } from './folder';
import { NetworkError, WebDavError } from './webdav';

let dirs: string[] = [];
let cloud: string;
const tmp = (p: string) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), p));
  dirs.push(d);
  return d;
};

function device(at = 'in Google Drive', now: () => number = Date.now) {
  const store = new Storage(tmp('pn-dev-'));
  return { store, engine: () => new SyncEngine(new FolderStore(cloud), store, '/pNotes-Sync', 'folder-target', now, at) };
}

const meta = (id: string, title: string): NotebookMeta => ({
  id, title, folderId: null, coverColor: '#305BB0', template: 'ruled', paperColor: 'white', format: 'A3', orientation: 'portrait',
  favorite: false, pageCount: 1, createdAt: 1, updatedAt: 1, openedAt: null, trashedAt: null,
});
const content = (id: string, note: string): NotebookContent => ({
  version: 1,
  id,
  pages: [{ id: 'p1', template: 'ruled', strokes: [], objects: [], comments: [{ id: 'c1', x: 5, y: 5, createdAt: 1, resolved: false, messages: [{ id: 'm1', text: note, createdAt: 1, editedAt: null }] }] }],
});
async function seed(store: Storage, lib: LibraryData, contents: NotebookContent[]) {
  await store.saveLibrary(lib);
  for (const c of contents) await store.saveNotebook(c);
}
const note = async (s: Storage, id: string) => (await s.loadNotebook(id))?.pages[0].comments[0].messages[0].text;

beforeEach(() => {
  dirs = [];
  cloud = tmp('pn-cloud-');
});
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('FolderStore (WebDAV-gleiche Semantik auf dem Dateisystem)', () => {
  it('legt Ordner an, schreibt atomar, liefert ETags und prüft Bedingungen (412)', async () => {
    const s = new FolderStore(cloud);
    await s.ensureDir('/pNotes-Sync/notebooks');
    expect(fs.statSync(path.join(cloud, 'pNotes-Sync', 'notebooks')).isDirectory()).toBe(true);
    const e1 = await s.put('/pNotes-Sync/notebooks/a.json', '{"v":1}', { ifNoneMatch: true });
    expect(e1).toMatch(/^"\d+-\d+"$/);
    await expect(s.put('/pNotes-Sync/notebooks/a.json', '{"v":2}', { ifNoneMatch: true })).rejects.toMatchObject({ status: 412 });
    await expect(s.put('/pNotes-Sync/notebooks/a.json', '{"v":2}', { ifMatch: '"0-0"' })).rejects.toMatchObject({ status: 412 });
    const e2 = await s.put('/pNotes-Sync/notebooks/a.json', '{"v":22}', { ifMatch: e1 });
    expect(e2).not.toBe(e1);
    expect((await s.get('/pNotes-Sync/notebooks/a.json')).text).toBe('{"v":22}');
    // keine .tmp-Reste, Konfliktkopien der Cloud-App und versteckte Dateien werden nicht gelistet
    fs.writeFileSync(path.join(cloud, 'pNotes-Sync', 'notebooks', '.tmp.drivedownload'), 'x');
    fs.writeFileSync(path.join(cloud, 'pNotes-Sync', 'notebooks', 'desktop.ini'), 'x');
    expect((await s.list('/pNotes-Sync/notebooks')).map((e) => e.name)).toEqual(['a.json']);
    await expect(s.delete('/pNotes-Sync/notebooks/a.json', '"1-1"')).rejects.toMatchObject({ status: 412 });
    await s.delete('/pNotes-Sync/notebooks/a.json', e2);
    expect(await s.stat('/pNotes-Sync/notebooks/a.json')).toBeNull();
    expect(await s.list('/pNotes-Sync/fehlt')).toEqual([]);
  });

  it('kein Ausbruch aus dem Sync-Ordner über „..“', async () => {
    const s = new FolderStore(cloud);
    await expect(s.put('/../boese.json', 'x')).rejects.toBeInstanceOf(WebDavError);
  });

  it('Ordner nicht erreichbar (Laufwerk getrennt, Google Drive nicht gestartet) → offline statt Fehler', async () => {
    const s = new FolderStore(path.join(cloud, 'gibt-es-nicht'));
    await expect(s.ensureDir('/pNotes-Sync')).rejects.toBeInstanceOf(NetworkError);
    const A = device();
    await seed(A.store, { version: 1, folders: [], notebooks: [meta('n1', 'Mathe')] }, [content('n1', 'x')]);
    const r = await new SyncEngine(s, A.store, '/pNotes-Sync', 't').run();
    expect(r.ok).toBe(false);
    expect(r.offline).toBe(true);
  });

  it('„Ordner prüfen“', async () => {
    expect((await testFolder(cloud, '/pNotes-Sync')).ok).toBe(true);
    expect((await testFolder(path.join(cloud, 'nein'), '/pNotes-Sync')).ok).toBe(false);
    expect((await testFolder('', '/pNotes-Sync')).ok).toBe(false);
  });
});

describe('Sync über einen gemeinsamen Ordner (Google Drive / iCloud)', () => {
  it('A → Ordner → B, inkl. PDF-Asset; zweiter Lauf ändert nichts', async () => {
    const A = device();
    const B = device();
    const id = await A.store.putAsset(new Uint8Array(makeTestPdf()), 'pdf');
    const c = content('n1', 'Hallo aus A');
    c.pages[0].pdf = { asset: id, page: 1 };
    await seed(A.store, { version: 1, folders: [], notebooks: [meta('n1', 'Mathe')] }, [c]);

    const ra = await A.engine().run();
    expect(ra.ok).toBe(true);
    expect(fs.existsSync(path.join(cloud, 'pNotes-Sync', 'notebooks', 'n1.json'))).toBe(true);
    expect(fs.existsSync(path.join(cloud, 'pNotes-Sync', 'assets', `${id}.pdf`))).toBe(true);

    const rb = await B.engine().run();
    expect(rb.downloaded).toBeGreaterThanOrEqual(2);
    expect(await note(B.store, 'n1')).toBe('Hallo aus A');
    expect((await B.store.loadLibrary())?.notebooks[0].format).toBe('A3');
    expect(await B.store.getAsset(id, 'pdf')).toBeTruthy();

    const again = await A.engine().run();
    expect(again.uploaded + again.downloaded).toBe(0);
  });

  it('Änderung auf B erreicht A; gleichzeitige Änderung → Konfliktkopie mit Ortsangabe', async () => {
    const A = device('in iCloud Drive');
    const B = device('in iCloud Drive');
    await seed(A.store, { version: 1, folders: [], notebooks: [meta('n1', 'Mathe')] }, [content('n1', 'Basis')]);
    await A.engine().run();
    await B.engine().run();

    await B.store.saveNotebook(content('n1', 'v2 von B'));
    expect((await B.engine().run()).uploaded).toBe(1);
    expect((await A.engine().run()).downloaded).toBe(1);
    expect(await note(A.store, 'n1')).toBe('v2 von B');

    // beide ändern gleichzeitig
    await A.store.saveNotebook(content('n1', 'A neu'));
    await B.store.saveNotebook(content('n1', 'B neu'));
    await new Promise((r) => setTimeout(r, 15)); // andere Änderungszeit
    await A.engine().run();
    const rb = await B.engine().run();
    expect(rb.conflicts).toHaveLength(1);
    expect(rb.conflicts[0]).toContain('in iCloud Drive');
    const titles = (await B.store.loadLibrary())!.notebooks.map((n) => n.title);
    expect(titles).toHaveLength(2);
    expect(await note(B.store, 'n1')).toBe('A neu');
  });

  it('Löschen nur nach Bestätigung', async () => {
    const A = device();
    const B = device();
    await seed(A.store, { version: 1, folders: [], notebooks: [meta('n1', 'Weg'), meta('n2', 'Bleibt')] }, [content('n1', 'x'), content('n2', 'y')]);
    await A.engine().run();
    await B.engine().run();
    const libA = (await A.store.loadLibrary())!;
    await A.store.saveLibrary({ ...libA, notebooks: libA.notebooks.filter((n) => n.id !== 'n1') });
    await A.store.deleteNotebook('n1');
    const ra = await A.engine().run();
    expect(ra.pendingDeletions.map((d) => `${d.where}:${d.title}`)).toEqual(['remote:Weg']);
    expect(fs.existsSync(path.join(cloud, 'pNotes-Sync', 'notebooks', 'n1.json'))).toBe(true);
    await A.engine().resolveDeletions(ra.pendingDeletions.map((d) => ({ key: d.key, delete: true })));
    expect(fs.existsSync(path.join(cloud, 'pNotes-Sync', 'notebooks', 'n1.json'))).toBe(false);
    const rb = await B.engine().run();
    expect(rb.pendingDeletions.map((d) => `${d.where}:${d.title}`)).toEqual(['local:Weg']);
  });
});

describe('Cloud-Ordner finden', () => {
  it('Google Drive (Laufwerk + Spiegel), iCloud, OneDrive, Dropbox (info.json)', async () => {
    const existing = new Set([
      'G:\\Meine Ablage',
      path.join('C:\\Users\\max', 'iCloudDrive'),
      'C:\\Users\\max\\OneDrive',
      'D:\\Dropbox',
      path.join('C:\\Users\\max', 'My Drive'),
    ]);
    const env: DetectEnv = {
      home: 'C:\\Users\\max',
      env: { OneDrive: 'C:\\Users\\max\\OneDrive', APPDATA: 'C:\\Users\\max\\AppData\\Roaming' },
      isDir: async (p) => existing.has(p),
      readFile: async (p) => (p.endsWith(path.join('Dropbox', 'info.json')) ? JSON.stringify({ personal: { path: 'D:\\Dropbox' } }) : null),
      driveLetters: ['E', 'G'],
    };
    const found = await detectCloudFolders(env);
    expect(found.map((f) => `${f.provider}|${f.label}|${f.path}`)).toEqual([
      'gdrive|Google Drive (G:)|G:\\Meine Ablage',
      `gdrive|Google Drive|${path.join('C:\\Users\\max', 'My Drive')}`,
      `icloud|iCloud Drive|${path.join('C:\\Users\\max', 'iCloudDrive')}`,
      'folder|OneDrive|C:\\Users\\max\\OneDrive',
      'folder|Dropbox|D:\\Dropbox',
    ]);
  });

  it('nichts installiert → leere Liste', async () => {
    const found = await detectCloudFolders({ home: 'C:\\Users\\x', env: {}, isDir: async () => false, readFile: async () => null, driveLetters: ['G'] });
    expect(found).toEqual([]);
  });
});
