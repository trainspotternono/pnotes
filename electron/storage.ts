import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { LibraryData, NotebookContent } from '../shared/types';
import type { LocalStore, Manifest } from './sync/engine';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ASSET_PATTERN = /^[a-f0-9]{40}$/;
const ASSET_EXTS = new Set(['pdf']);
/** Obergrenze für importierte Dateien (Schutz vor versehentlich riesigen Dateien). */
export const MAX_ASSET_BYTES = 512 * 1024 * 1024;

export function assertAsset(id: unknown, ext: unknown): asserts id is string {
  if (typeof id !== 'string' || !ASSET_PATTERN.test(id)) throw new Error(`Ungültige Asset-ID: ${String(id)}`);
  if (typeof ext !== 'string' || !ASSET_EXTS.has(ext)) throw new Error(`Ungültiger Dateityp: ${String(ext)}`);
}

/** Inhaltsadresse einer Datei (SHA-1, gleiche Datei = gleiche ID, keine Duplikate). */
export const assetIdOf = (data: Uint8Array) => createHash('sha1').update(data).digest('hex');

export function assertId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error(`Ungültige ID: ${String(id)}`);
  }
}

/**
 * Lokale Datenablage:
 *   <root>/library.json          Ordner + Notizbuch-Metadaten
 *   <root>/notebooks/<id>.json   Seiten und Striche eines Notizbuchs
 * Schreibvorgänge sind atomar (temporäre Datei + rename), damit ein Absturz
 * keine halb geschriebene Datei hinterlässt.
 */
export class Storage implements LocalStore {
  readonly libraryFile: string;
  readonly notebooksDir: string;
  /** Sync-Manifest (letzter Abgleich mit Nextcloud) */
  readonly manifestFile: string;
  /** Importierte Originaldateien (PDF), inhaltsadressiert */
  readonly assetsDir: string;

  constructor(readonly root: string) {
    this.libraryFile = path.join(root, 'library.json');
    this.notebooksDir = path.join(root, 'notebooks');
    this.manifestFile = path.join(root, '.sync-state.json');
    this.assetsDir = path.join(root, 'assets');
    fs.mkdirSync(this.notebooksDir, { recursive: true });
    fs.mkdirSync(this.assetsDir, { recursive: true });
  }

  assetFile(id: string, ext: string): string {
    assertAsset(id, ext);
    return path.join(this.assetsDir, `${id}.${ext}`);
  }

  /** Speichert die Datei unter ihrer Inhalts-ID (existiert sie schon, wird nichts geschrieben). */
  async putAsset(data: Uint8Array, ext: string): Promise<string> {
    if (!(data instanceof Uint8Array) || data.byteLength === 0) throw new Error('Leere Datei.');
    if (data.byteLength > MAX_ASSET_BYTES) throw new Error('Die Datei ist größer als 512 MB.');
    if (ext === 'pdf' && Buffer.from(data.subarray(0, 1024)).toString('latin1').indexOf('%PDF-') < 0) throw new Error('Das ist keine gültige PDF-Datei.');
    const id = assetIdOf(data);
    const file = this.assetFile(id, ext);
    if (!fs.existsSync(file)) {
      const tmp = `${file}.${process.pid}.${tmpCounter++}.tmp`;
      await fs.promises.writeFile(tmp, data);
      await fs.promises.rename(tmp, file);
    }
    return id;
  }

  async getAsset(id: string, ext: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.promises.readFile(this.assetFile(id, ext)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async hasAsset(id: string, ext: string): Promise<boolean> {
    return fs.existsSync(this.assetFile(id, ext));
  }

  /** Für den Sync: Datei mit bekannter ID ablegen (Inhalt wird gegen die ID geprüft). */
  async writeAsset(id: string, ext: string, data: Uint8Array): Promise<void> {
    if (assetIdOf(data) !== id) throw new Error(`Prüfsumme von ${id}.${ext} stimmt nicht.`);
    await this.putAsset(data, ext);
  }

  loadManifest(): Promise<Manifest | null> {
    return readJson<Manifest>(this.manifestFile);
  }

  async saveManifest(m: Manifest): Promise<void> {
    await writeJsonAtomic(this.manifestFile, m);
  }

  async deleteManifest(): Promise<void> {
    await fs.promises.rm(this.manifestFile, { force: true });
  }

  notebookFile(id: string): string {
    assertId(id);
    return path.join(this.notebooksDir, `${id}.json`);
  }

  async loadLibrary(): Promise<LibraryData | null> {
    return readJson<LibraryData>(this.libraryFile);
  }

  async saveLibrary(data: LibraryData): Promise<void> {
    if (!data || data.version !== 1 || !Array.isArray(data.folders) || !Array.isArray(data.notebooks)) {
      throw new Error('Ungültige Bibliotheksdaten');
    }
    await writeJsonAtomic(this.libraryFile, data);
  }

  async loadNotebook(id: string): Promise<NotebookContent | null> {
    return readJson<NotebookContent>(this.notebookFile(id));
  }

  async saveNotebook(content: NotebookContent): Promise<void> {
    validateNotebook(content);
    await writeJsonAtomic(this.notebookFile(content.id), content);
  }

  saveNotebookSync(content: NotebookContent): void {
    validateNotebook(content);
    const file = this.notebookFile(content.id);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(content));
    fs.renameSync(tmp, file);
  }

  async deleteNotebook(id: string): Promise<void> {
    await fs.promises.rm(this.notebookFile(id), { force: true });
  }
}

function validateNotebook(content: NotebookContent): void {
  if (!content || content.version !== 1 || !Array.isArray(content.pages)) {
    throw new Error('Ungültiger Notizbuch-Inhalt');
  }
  assertId(content.id);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const text = await fs.promises.readFile(file, 'utf8');
    return JSON.parse(text) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

let tmpCounter = 0;
async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${tmpCounter++}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data));
  await fs.promises.rename(tmp, file);
}
