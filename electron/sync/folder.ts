/**
 * Sync-Ziel „Ordner“: Google Drive für Desktop, iCloud für Windows, OneDrive, Dropbox, NAS, USB …
 *
 * Bietet dieselbe Schnittstelle wie der WebDAV-Client (RemoteStore), damit die erprobte Sync-Engine
 * (Drei-Wege-Abgleich, Konflikte, Löschbestätigung, PDF-Assets) unverändert arbeitet. Hochladen in die
 * Cloud übernimmt die jeweilige Desktop-App des Anbieters.
 *
 *  - ETag = Änderungszeit + Größe (wie bei Apache/nginx) → erkennt Änderungen anderer Geräte
 *  - bedingtes Schreiben (If-Match / If-None-Match) wie bei WebDAV → 412 bei gleichzeitiger Änderung
 *  - atomar: erst `.tmp` schreiben, dann umbenennen → die Cloud-App lädt nie halbe Dateien hoch
 *  - Konfliktkopien der Cloud-Apps („abc (1).json“, „abc-PC-Name.json“) werden ignoriert (keine gültige ID)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { NetworkError, WebDavError, type DavEntry } from './webdav';

/** Was die Sync-Engine vom Ziel braucht (erfüllt von WebDavClient und FolderStore). */
export interface RemoteStore {
  ensureDir(path: string): Promise<void>;
  list(path: string): Promise<DavEntry[]>;
  stat(path: string): Promise<DavEntry | null>;
  get(path: string): Promise<{ text: string; etag: string | null }>;
  put(path: string, body: string, cond?: { ifMatch?: string | null; ifNoneMatch?: boolean }): Promise<string | null>;
  getBinary(path: string): Promise<Uint8Array>;
  putBinary(path: string, data: Uint8Array, contentType: string, ifNoneMatch?: boolean): Promise<void>;
  delete(path: string, ifMatch?: string | null): Promise<void>;
}

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT' || (e as NodeJS.ErrnoException)?.code === 'ENOTDIR';

export class FolderStore implements RemoteStore {
  constructor(
    /** Wurzel, z. B. „G:\Meine Ablage“; die Engine arbeitet darin unter ihrem Zielordner */
    readonly root: string,
  ) {}

  /** Engine-Pfad „/pNotes-Sync/notebooks/x.json“ → absoluter Pfad unterhalb der Wurzel (kein Ausbruch per „..“). */
  private abs(p: string): string {
    const parts = p.split('/').filter(Boolean);
    if (parts.some((x) => x === '..' || x.includes('\\') || x.includes(':'))) throw new WebDavError(400, `Ungültiger Pfad: ${p}`);
    return path.join(this.root, ...parts);
  }

  private static etag(st: { mtimeMs: number; size: number }) {
    return `"${Math.round(st.mtimeMs)}-${st.size}"`;
  }

  private entry(name: string, st: import('node:fs').Stats): DavEntry {
    return { href: name, name, isCollection: st.isDirectory(), etag: st.isDirectory() ? null : FolderStore.etag(st), lastModified: Math.round(st.mtimeMs), size: st.size };
  }

  /** Wurzel erreichbar? Sonst „offline“ (Laufwerk getrennt, Google Drive/iCloud nicht gestartet, NAS aus). */
  private async checkRoot(): Promise<void> {
    try {
      const st = await fs.stat(this.root);
      if (!st.isDirectory()) throw new Error('kein Ordner');
    } catch {
      throw new NetworkError(`Sync-Ordner nicht erreichbar: ${this.root} – läuft Google Drive/iCloud bzw. ist das Laufwerk verbunden?`);
    }
  }

  async ensureDir(p: string): Promise<void> {
    await this.checkRoot();
    const dir = this.abs(p);
    try {
      const st = await fs.stat(dir);
      if (!st.isDirectory()) throw new WebDavError(409, `${p} ist eine Datei, kein Ordner.`);
      return;
    } catch (e) {
      if (e instanceof WebDavError) throw e;
    }
    await fs.mkdir(dir, { recursive: true });
  }

  async list(p: string): Promise<DavEntry[]> {
    await this.checkRoot();
    let names: string[];
    try {
      names = await fs.readdir(this.abs(p));
    } catch (e) {
      if (isMissing(e)) return [];
      throw e;
    }
    const out: DavEntry[] = [];
    for (const name of names) {
      // eigene Zwischenstände und versteckte Dateien (desktop.ini, .tmp.drivedownload …) überspringen
      if (name.startsWith('.') || name.endsWith('.tmp') || name.toLowerCase() === 'desktop.ini') continue;
      try {
        out.push(this.entry(name, await fs.stat(path.join(this.abs(p), name))));
      } catch {
        /* zwischenzeitlich entfernt */
      }
    }
    return out;
  }

  async stat(p: string): Promise<DavEntry | null> {
    try {
      return this.entry(path.basename(this.abs(p)), await fs.stat(this.abs(p)));
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }

  async get(p: string): Promise<{ text: string; etag: string | null }> {
    await this.checkRoot();
    try {
      const file = this.abs(p);
      const text = await fs.readFile(file, 'utf8');
      return { text, etag: FolderStore.etag(await fs.stat(file)) };
    } catch (e) {
      if (isMissing(e)) throw new WebDavError(404, `GET ${p}: Nicht gefunden.`);
      throw e;
    }
  }

  /** Bedingung wie bei WebDAV prüfen (412 = jemand anders hat die Datei inzwischen geändert/angelegt). */
  private async checkCond(p: string, cond: { ifMatch?: string | null; ifNoneMatch?: boolean }) {
    const cur = await this.stat(p);
    if (cond.ifNoneMatch && cur) throw new WebDavError(412, `PUT ${p}: Datei wurde zwischenzeitlich im Sync-Ordner angelegt.`);
    if (cond.ifMatch && (!cur || cur.etag !== cond.ifMatch)) throw new WebDavError(412, `PUT ${p}: Datei wurde zwischenzeitlich im Sync-Ordner geändert.`);
  }

  private async writeAtomic(file: string, data: string | Uint8Array) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, data);
    try {
      await fs.rename(tmp, file);
    } catch (e) {
      // Windows: Ziel kurz von der Cloud-App gesperrt → einmal kurz warten und erneut versuchen
      await new Promise((r) => setTimeout(r, 300));
      try {
        await fs.rename(tmp, file);
      } catch {
        await fs.rm(tmp, { force: true });
        throw new WebDavError(423, `Datei ist gesperrt (wird gerade synchronisiert?): ${path.basename(file)} – ${(e as Error).message}`);
      }
    }
  }

  async put(p: string, body: string, cond: { ifMatch?: string | null; ifNoneMatch?: boolean } = {}): Promise<string | null> {
    await this.checkRoot();
    await this.checkCond(p, cond);
    const file = this.abs(p);
    await this.writeAtomic(file, body);
    return FolderStore.etag(await fs.stat(file));
  }

  async getBinary(p: string): Promise<Uint8Array> {
    await this.checkRoot();
    try {
      return new Uint8Array(await fs.readFile(this.abs(p)));
    } catch (e) {
      if (isMissing(e)) throw new WebDavError(404, `GET ${p}: Nicht gefunden.`);
      throw e;
    }
  }

  async putBinary(p: string, data: Uint8Array, _contentType: string, ifNoneMatch = false): Promise<void> {
    await this.checkRoot();
    if (ifNoneMatch && (await this.stat(p))) return; // inhaltsadressiert: schon vorhanden = gleicher Inhalt
    await this.writeAtomic(this.abs(p), data);
  }

  async delete(p: string, ifMatch?: string | null): Promise<void> {
    await this.checkRoot();
    const cur = await this.stat(p);
    if (!cur) return;
    if (ifMatch && cur.etag !== ifMatch) throw new WebDavError(412, `DELETE ${p}: Datei wurde zwischenzeitlich im Sync-Ordner geändert.`);
    await fs.rm(this.abs(p), { force: true });
  }
}

/** „Verbindung testen“ für Ordner: vorhanden, beschreibbar, Zielordner anlegbar. */
export async function testFolder(root: string, folder: string): Promise<{ ok: boolean; message: string; details: string[] }> {
  const details: string[] = [];
  if (!root.trim()) return { ok: false, message: 'Bitte einen Ordner wählen.', details };
  try {
    const st = await fs.stat(root);
    if (!st.isDirectory()) return { ok: false, message: `${root} ist kein Ordner.`, details };
  } catch {
    return { ok: false, message: `Ordner nicht gefunden: ${root}`, details };
  }
  details.push(`Ordner gefunden: ${root}`);
  const store = new FolderStore(root);
  try {
    await store.ensureDir(folder);
    const probe = `${folder}/.schreibtest-${process.pid}`;
    await store.put(probe, 'ok');
    await store.delete(probe);
    details.push(`Schreibzugriff in ${path.join(root, ...folder.split('/').filter(Boolean))} ok.`);
  } catch (e) {
    return { ok: false, message: `Kein Schreibzugriff: ${(e as Error).message}`, details };
  }
  return { ok: true, message: 'Ordner bereit.', details };
}
