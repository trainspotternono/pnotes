/**
 * Bidirektionale Sync-Engine (Drei-Wege-Vergleich: lokal ↔ Nextcloud ↔ letzter Sync-Stand).
 *
 * Remote-Layout unter dem Zielordner:
 *   folders/<id>.json    Ordner (Name, Elternordner, Farbe, Favorit, Papierkorb …)
 *   notebooks/<id>.json  Notizbuch: Metadaten + alle Seiten (Striche, Formen, Texte,
 *                        eingebettete Bilder, Kommentare)
 * Lokales Manifest `.sync-state.json`: pro Objekt ETag/Zeitstempel des Servers und
 * Inhalts-Hash zum Zeitpunkt des letzten erfolgreichen Abgleichs.
 *
 * Regeln:
 *  - nur lokal geändert → hochladen (PUT mit If-Match)
 *  - nur entfernt geändert → herunterladen
 *  - beidseitig geändert → Notizbuch: Konfliktkopie „Name (Konflikt JJJJ-MM-TT HH-MM)“ aus dem
 *    lokalen Stand, Original übernimmt den Server-Stand; Ordner: neuere Änderung gewinnt
 *  - lokal gelöscht / entfernt gelöscht → erst nach Bestätigung (pendingDeletions)
 */
import { createHash, randomBytes } from 'node:crypto';
import type { DeletionDecision, Folder, LibraryData, NotebookContent, NotebookMeta, SyncResult } from '../../shared/types';
import { NetworkError, WebDavError, type DavEntry } from './webdav';
import type { RemoteStore } from './folder';

export interface ManifestEntry {
  etag: string | null;
  lastModified: number | null;
  hash: string;
}

export interface Manifest {
  version: 1;
  /** Kennung von Server/Benutzer/Zielordner – ändert sie sich, beginnt der Abgleich neu */
  target: string;
  entries: Record<string, ManifestEntry>;
  lastSync: number | null;
}

export interface LocalStore {
  loadLibrary(): Promise<LibraryData | null>;
  saveLibrary(data: LibraryData): Promise<void>;
  loadNotebook(id: string): Promise<NotebookContent | null>;
  saveNotebook(content: NotebookContent): Promise<void>;
  deleteNotebook(id: string): Promise<void>;
  loadManifest(): Promise<Manifest | null>;
  saveManifest(m: Manifest): Promise<void>;
  /** Importierte PDFs (inhaltsadressiert, unveränderlich) */
  hasAsset(id: string, ext: string): Promise<boolean>;
  getAsset(id: string, ext: string): Promise<Uint8Array | null>;
  writeAsset(id: string, ext: string, data: Uint8Array): Promise<void>;
}

interface NotebookPayload {
  format: 'papierwerk-notebook';
  version: 1;
  meta: Omit<NotebookMeta, 'openedAt'>;
  content: NotebookContent;
}

interface FolderPayload {
  format: 'papierwerk-folder';
  version: 1;
  folder: Folder;
}

type Kind = 'folder' | 'notebook';

// ------------------------------------------------------------ Hilfsfunktionen

/** JSON mit sortierten Schlüsseln (stabil für Hashes). */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const newId = () => randomBytes(12).toString('hex').slice(0, 20);

export function conflictTitle(title: string, now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${title} (Konflikt ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())})`;
}

function notebookPayload(meta: NotebookMeta, content: NotebookContent): NotebookPayload {
  const rest: Partial<NotebookMeta> = { ...meta };
  delete rest.openedAt;
  return { format: 'papierwerk-notebook', version: 1, meta: rest as Omit<NotebookMeta, 'openedAt'>, content: { ...content, id: meta.id } };
}

const folderPayload = (folder: Folder): FolderPayload => ({ format: 'papierwerk-folder', version: 1, folder });

const keyOf = (kind: Kind, id: string) => `${kind === 'folder' ? 'f' : 'n'}:${id}`;
const parseKey = (key: string): { kind: Kind; id: string } => ({ kind: key.startsWith('f:') ? 'folder' : 'notebook', id: key.slice(2) });

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function emptyResult(): SyncResult {
  return { ok: true, offline: false, uploaded: 0, downloaded: 0, deletedRemote: 0, deletedLocal: 0, conflicts: [], notices: [], errors: [], pendingDeletions: [], changedLocal: false, finishedAt: Date.now() };
}

// ------------------------------------------------------------ Engine

export class SyncEngine {
  private lib!: LibraryData;
  private manifest!: Manifest;
  private remote = new Map<string, DavEntry>();
  private remoteAssets = new Set<string>();
  private libDirty = false;

  constructor(
    /** Ziel: WebDAV (Nextcloud/eigener Server) oder Ordner (Google Drive, iCloud, OneDrive …) */
    private readonly dav: RemoteStore,
    private readonly store: LocalStore,
    /** Zielordner, z. B. /pNotes-Sync */
    private readonly folder: string,
    /** Kennung für das Manifest (Server + Benutzer + Ordner) */
    private readonly targetId: string,
    private readonly now: () => number = Date.now,
    /** Ortsangabe für Meldungen, z. B. „auf Nextcloud“, „in Google Drive“, „im Sync-Ordner“ */
    private readonly at: string = 'auf Nextcloud',
  ) {}

  private path(kind: Kind, id: string) {
    return `${this.folder}/${kind === 'folder' ? 'folders' : 'notebooks'}/${id}.json`;
  }

  // ---------------------------------------------------------- Laden

  private async prepare(): Promise<void> {
    await this.dav.ensureDir(`${this.folder}/folders`);
    await this.dav.ensureDir(`${this.folder}/notebooks`);
    await this.dav.ensureDir(`${this.folder}/assets`);
    this.remoteAssets = new Set((await this.dav.list(`${this.folder}/assets`)).filter((e) => !e.isCollection).map((e) => e.name));
    this.remote.clear();
    for (const kind of ['folder', 'notebook'] as Kind[]) {
      for (const e of await this.dav.list(`${this.folder}/${kind === 'folder' ? 'folders' : 'notebooks'}`)) {
        if (e.isCollection || !e.name.endsWith('.json')) continue;
        const id = e.name.slice(0, -5);
        if (ID_RE.test(id)) this.remote.set(keyOf(kind, id), e);
      }
    }
    const lib = await this.store.loadLibrary();
    this.lib = lib && lib.version === 1 ? { version: 1, folders: [...(lib.folders ?? [])], notebooks: [...(lib.notebooks ?? [])] } : { version: 1, folders: [], notebooks: [] };
    const m = await this.store.loadManifest();
    this.manifest = m && m.version === 1 && m.target === this.targetId ? { ...m, entries: { ...m.entries } } : { version: 1, target: this.targetId, entries: {}, lastSync: null };
    this.libDirty = false;
  }

  private async localPayload(key: string): Promise<{ payload: NotebookPayload | FolderPayload; hash: string; title: string } | null> {
    const { kind, id } = parseKey(key);
    if (kind === 'folder') {
      const f = this.lib.folders.find((x) => x.id === id);
      if (!f) return null;
      const payload = folderPayload(f);
      return { payload, hash: sha256(stableStringify(payload)), title: f.name };
    }
    const meta = this.lib.notebooks.find((x) => x.id === id);
    if (!meta) return null;
    const content = (await this.store.loadNotebook(id)) ?? { version: 1 as const, id, pages: [] };
    const payload = notebookPayload(meta, content);
    return { payload, hash: sha256(stableStringify(payload)), title: meta.title };
  }

  private async fetchRemote(key: string): Promise<{ payload: NotebookPayload | FolderPayload; hash: string; etag: string | null }> {
    const { kind, id } = parseKey(key);
    const { text, etag } = await this.dav.get(this.path(kind, id));
    const raw = JSON.parse(text) as NotebookPayload | FolderPayload;
    if (kind === 'folder') {
      if (raw.format !== 'papierwerk-folder' || !('folder' in raw) || raw.folder.id !== id) throw new Error(`Ungültige Ordnerdatei ${id}.json`);
      const payload = folderPayload(raw.folder);
      return { payload, hash: sha256(stableStringify(payload)), etag };
    }
    if (raw.format !== 'papierwerk-notebook' || !('meta' in raw) || raw.meta.id !== id || !Array.isArray(raw.content?.pages)) throw new Error(`Ungültige Notizbuchdatei ${id}.json`);
    const payload = notebookPayload({ ...raw.meta, openedAt: null }, raw.content);
    return { payload, hash: sha256(stableStringify(payload)), etag };
  }

  // ---------------------------------------------------------- Lokal anwenden

  private async applyLocal(payload: NotebookPayload | FolderPayload): Promise<void> {
    if (payload.format === 'papierwerk-folder') {
      const f = payload.folder;
      const i = this.lib.folders.findIndex((x) => x.id === f.id);
      if (i >= 0) this.lib.folders[i] = f;
      else this.lib.folders.push(f);
    } else {
      const old = this.lib.notebooks.find((x) => x.id === payload.meta.id);
      const meta: NotebookMeta = { ...payload.meta, openedAt: old?.openedAt ?? null };
      await this.store.saveNotebook({ ...payload.content, version: 1, id: meta.id });
      const i = this.lib.notebooks.findIndex((x) => x.id === meta.id);
      if (i >= 0) this.lib.notebooks[i] = meta;
      else this.lib.notebooks.push(meta);
    }
    this.libDirty = true;
  }

  private async deleteLocal(key: string): Promise<void> {
    const { kind, id } = parseKey(key);
    if (kind === 'folder') this.lib.folders = this.lib.folders.filter((f) => f.id !== id);
    else {
      this.lib.notebooks = this.lib.notebooks.filter((n) => n.id !== id);
      await this.store.deleteNotebook(id);
    }
    this.libDirty = true;
  }

  // ---------------------------------------------------------- Remote schreiben

  private async upload(key: string, payload: NotebookPayload | FolderPayload, hash: string, cond: { ifMatch?: string | null; ifNoneMatch?: boolean }): Promise<void> {
    const { kind, id } = parseKey(key);
    const path = this.path(kind, id);
    let etag = await this.dav.put(path, JSON.stringify(payload), cond);
    let lastModified: number | null = null;
    if (!etag) {
      const st = await this.dav.stat(path);
      etag = st?.etag ?? null;
      lastModified = st?.lastModified ?? null;
    }
    this.manifest.entries[key] = { etag, lastModified, hash };
  }

  private remoteChanged(r: DavEntry, m: ManifestEntry): boolean {
    if (r.etag && m.etag) return r.etag !== m.etag;
    return r.lastModified !== m.lastModified;
  }

  private record(key: string, r: { etag: string | null; lastModified?: number | null }, hash: string) {
    this.manifest.entries[key] = { etag: r.etag, lastModified: r.lastModified ?? this.remote.get(key)?.lastModified ?? null, hash };
  }

  // ---------------------------------------------------------- Hauptlauf

  async run(): Promise<SyncResult> {
    const res = emptyResult();
    try {
      await this.prepare();
    } catch (err) {
      return this.failed(res, err);
    }

    const keys = new Set<string>([
      ...this.lib.folders.map((f) => keyOf('folder', f.id)),
      ...this.lib.notebooks.map((n) => keyOf('notebook', n.id)),
      ...this.remote.keys(),
      ...Object.keys(this.manifest.entries),
    ]);
    // Ordner vor Notizbüchern, damit Elternordner zuerst existieren
    const ordered = [...keys].sort((a, b) => (a[0] === b[0] ? a.localeCompare(b) : a.startsWith('f:') ? -1 : 1));

    for (const key of ordered) {
      try {
        await this.syncOne(key, res);
      } catch (err) {
        if (err instanceof NetworkError) return this.failed(res, err);
        const { kind, id } = parseKey(key);
        res.errors.push(`${kind === 'folder' ? 'Ordner' : 'Notizbuch'} ${this.titleOf(key) ?? id}: ${(err as Error).message}`);
      }
    }
    try {
      await this.syncAssets(res);
    } catch (err) {
      if (err instanceof NetworkError) return this.failed(res, err);
      res.errors.push(`PDF-Dateien: ${(err as Error).message}`);
    }
    return this.finish(res);
  }

  /**
   * PDF-Dateien abgleichen, auf die Notizbücher verweisen: fehlt eine Datei auf einer Seite,
   * wird sie übertragen. Inhaltsadressiert (ID = SHA-1) → nie Konflikte, nie Überschreiben.
   */
  private async syncAssets(res: SyncResult): Promise<void> {
    const refs = new Set<string>();
    for (const nb of this.lib.notebooks) {
      if (nb.coverPdf?.asset) refs.add(nb.coverPdf.asset);
      const content = await this.store.loadNotebook(nb.id);
      for (const p of content?.pages ?? []) {
        if (p.pdf?.asset) refs.add(p.pdf.asset);
        if (p.hiddenPdf?.asset) refs.add(p.hiddenPdf.asset); // per Vorlagenwechsel ausgeblendet, kann wiederhergestellt werden
      }
    }
    for (const id of refs) {
      if (!/^[a-f0-9]{40}$/.test(id)) continue;
      const name = `${id}.pdf`;
      const local = await this.store.hasAsset(id, 'pdf');
      const remote = this.remoteAssets.has(name);
      if (local && !remote) {
        const data = await this.store.getAsset(id, 'pdf');
        if (!data) continue;
        await this.dav.putBinary(`${this.folder}/assets/${name}`, data, 'application/pdf', true);
        this.remoteAssets.add(name);
        res.uploaded++;
      } else if (!local && remote) {
        const data = await this.dav.getBinary(`${this.folder}/assets/${name}`);
        await this.store.writeAsset(id, 'pdf', data);
        res.downloaded++;
        res.changedLocal = true;
      } else if (!local && !remote) {
        res.notices.push(`Eine PDF-Datei (${id.slice(0, 8)}…) fehlt lokal und ${this.at} – die betroffenen Seiten zeigen nur die Anmerkungen.`);
      }
    }
  }

  private titleOf(key: string): string | null {
    const { kind, id } = parseKey(key);
    return kind === 'folder' ? (this.lib.folders.find((f) => f.id === id)?.name ?? null) : (this.lib.notebooks.find((n) => n.id === id)?.title ?? null);
  }

  private async syncOne(key: string, res: SyncResult): Promise<void> {
    const { kind } = parseKey(key);
    const local = await this.localPayload(key);
    const r = this.remote.get(key);
    const m = this.manifest.entries[key];

    // --- existiert nirgends mehr
    if (!local && !r) {
      delete this.manifest.entries[key];
      return;
    }

    // --- nur lokal
    if (local && !r) {
      if (m && local.hash === m.hash) {
        // war synchronisiert, wurde auf Nextcloud gelöscht → Bestätigung
        res.pendingDeletions.push({ key, kind, title: local.title, where: 'local' });
        return;
      }
      if (m) res.notices.push(`„${local.title}“ wurde ${this.at} gelöscht, lokal aber geändert – wird erneut hochgeladen.`);
      await this.upload(key, local.payload, local.hash, { ifNoneMatch: true });
      res.uploaded++;
      return;
    }

    // --- nur entfernt
    if (!local && r) {
      if (m && !this.remoteChanged(r, m)) {
        // war synchronisiert, wurde lokal gelöscht → Bestätigung
        const remote = await this.fetchRemote(key).catch(() => null);
        const title = remote ? (remote.payload.format === 'papierwerk-folder' ? remote.payload.folder.name : remote.payload.meta.title) : parseKey(key).id;
        res.pendingDeletions.push({ key, kind, title, where: 'remote' });
        return;
      }
      const remote = await this.fetchRemote(key);
      if (m) res.notices.push(`„${this.payloadTitle(remote.payload)}“ wurde lokal gelöscht, ${this.at} aber geändert – wurde wiederhergestellt.`);
      await this.applyLocal(remote.payload);
      this.record(key, { etag: remote.etag ?? r.etag, lastModified: r.lastModified }, remote.hash);
      res.downloaded++;
      res.changedLocal = true;
      return;
    }

    // --- beidseitig vorhanden
    const L = local!;
    const R = r!;
    const localChanged = !m || L.hash !== m.hash;
    const remoteChanged = !m || this.remoteChanged(R, m);
    if (!localChanged && !remoteChanged) return;

    if (localChanged && !remoteChanged) {
      await this.upload(key, L.payload, L.hash, { ifMatch: R.etag });
      res.uploaded++;
      return;
    }

    const remote = await this.fetchRemote(key);
    if (remote.hash === L.hash) {
      // identischer Inhalt (z. B. erster Abgleich zweier gleicher Stände)
      this.record(key, { etag: remote.etag ?? R.etag, lastModified: R.lastModified }, L.hash);
      return;
    }
    if (!localChanged && remoteChanged) {
      await this.applyLocal(remote.payload);
      this.record(key, { etag: remote.etag ?? R.etag, lastModified: R.lastModified }, remote.hash);
      res.downloaded++;
      res.changedLocal = true;
      return;
    }

    // --- Konflikt: beide Seiten geändert
    if (kind === 'folder') {
      const lf = (L.payload as FolderPayload).folder;
      const rf = (remote.payload as FolderPayload).folder;
      if (lf.updatedAt > rf.updatedAt) {
        await this.upload(key, L.payload, L.hash, { ifMatch: remote.etag ?? R.etag });
        res.uploaded++;
      } else {
        await this.applyLocal(remote.payload);
        this.record(key, { etag: remote.etag ?? R.etag, lastModified: R.lastModified }, remote.hash);
        res.downloaded++;
        res.changedLocal = true;
      }
      res.notices.push(`Ordner „${lf.name}“ wurde auf beiden Seiten geändert – die neuere Änderung wurde übernommen.`);
      return;
    }

    const lp = L.payload as NotebookPayload;
    const now = this.now();
    const copyId = newId();
    const copyMeta: NotebookMeta = { ...lp.meta, id: copyId, title: conflictTitle(lp.meta.title, now), favorite: false, createdAt: now, updatedAt: now, openedAt: null };
    const copyContent: NotebookContent = { ...lp.content, id: copyId };
    await this.store.saveNotebook(copyContent);
    this.lib.notebooks.push(copyMeta);
    this.libDirty = true;
    const copyKey = keyOf('notebook', copyId);
    const copyPayload = notebookPayload(copyMeta, copyContent);
    await this.upload(copyKey, copyPayload, sha256(stableStringify(copyPayload)), { ifNoneMatch: true });
    await this.applyLocal(remote.payload);
    this.record(key, { etag: remote.etag ?? R.etag, lastModified: R.lastModified }, remote.hash);
    res.downloaded++;
    res.uploaded++;
    res.changedLocal = true;
    res.conflicts.push(`„${lp.meta.title}“ wurde lokal und ${this.at} geändert. Der Stand ${this.at} wurde übernommen, deine lokale Version liegt als „${copyMeta.title}“ daneben.`);
  }

  private payloadTitle(p: NotebookPayload | FolderPayload) {
    return p.format === 'papierwerk-folder' ? p.folder.name : p.meta.title;
  }

  // ---------------------------------------------------------- Löschungen bestätigen

  async resolveDeletions(decisions: DeletionDecision[]): Promise<SyncResult> {
    const res = emptyResult();
    try {
      await this.prepare();
    } catch (err) {
      return this.failed(res, err);
    }
    for (const d of decisions) {
      const key = d.key;
      try {
        const local = await this.localPayload(key);
        const r = this.remote.get(key);
        const m = this.manifest.entries[key];
        if (!local && r) {
          // lokal gelöscht
          if (d.delete) {
            await this.dav.delete(this.path(parseKey(key).kind, parseKey(key).id), m?.etag ?? r.etag);
            delete this.manifest.entries[key];
            res.deletedRemote++;
          } else {
            const remote = await this.fetchRemote(key);
            await this.applyLocal(remote.payload);
            this.record(key, { etag: remote.etag ?? r.etag, lastModified: r.lastModified }, remote.hash);
            res.downloaded++;
            res.changedLocal = true;
          }
        } else if (local && !r) {
          // auf Nextcloud gelöscht
          if (d.delete) {
            await this.deleteLocal(key);
            delete this.manifest.entries[key];
            res.deletedLocal++;
            res.changedLocal = true;
          } else {
            await this.upload(key, local.payload, local.hash, { ifNoneMatch: true });
            res.uploaded++;
          }
        }
      } catch (err) {
        if (err instanceof NetworkError) return this.failed(res, err);
        res.errors.push(`${key}: ${(err as Error).message}`);
      }
    }
    try {
      await this.syncAssets(res); // wiederhergestellte Notizbücher brauchen ggf. ihre PDFs
    } catch (err) {
      if (err instanceof NetworkError) return this.failed(res, err);
      res.errors.push(`PDF-Dateien: ${(err as Error).message}`);
    }
    return this.finish(res);
  }

  // ---------------------------------------------------------- Abschluss

  /** Objekte, deren Elternordner fehlt, landen im Stamm (z. B. nach entfernt gelöschten Ordnern). */
  private fixOrphans() {
    const ids = new Set(this.lib.folders.map((f) => f.id));
    for (const f of this.lib.folders) {
      if (f.parentId && !ids.has(f.parentId)) {
        f.parentId = null;
        this.libDirty = true;
      }
    }
    this.lib.notebooks = this.lib.notebooks.map((n) => {
      if (n.folderId && !ids.has(n.folderId)) {
        this.libDirty = true;
        return { ...n, folderId: null };
      }
      return n;
    });
  }

  private async finish(res: SyncResult): Promise<SyncResult> {
    this.fixOrphans();
    if (this.libDirty) {
      await this.store.saveLibrary(this.lib);
      res.changedLocal = true;
    }
    this.manifest.lastSync = this.now();
    await this.store.saveManifest(this.manifest);
    res.ok = res.errors.length === 0;
    res.finishedAt = this.now();
    return res;
  }

  private async failed(res: SyncResult, err: unknown): Promise<SyncResult> {
    // bereits erledigte Teile sichern
    if (this.lib && this.manifest) {
      try {
        if (this.libDirty) {
          await this.store.saveLibrary(this.lib);
          res.changedLocal = true;
        }
        await this.store.saveManifest(this.manifest);
      } catch {
        /* ignorieren */
      }
    }
    res.ok = false;
    res.offline = err instanceof NetworkError;
    res.errors.push(err instanceof WebDavError || err instanceof NetworkError ? err.message : `Synchronisierung fehlgeschlagen: ${(err as Error).message}`);
    res.finishedAt = this.now();
    return res;
  }
}
