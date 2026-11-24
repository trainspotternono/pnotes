/**
 * Dateien im Main-Prozess: Speichern-/Öffnen-Dialoge (Export), Übergabe von .pnotes-Dokumenten
 * per Doppelklick / Kommandozeile / zweiter Instanz und die Windows-Dateizuordnung.
 *
 * Dateizuordnung:
 *  - Installer (NSIS) registriert .pnotes über electron-builder `fileAssociations`.
 *  - Portable-EXE: „Doppelklick aktivieren“ schreibt die Zuordnung nach HKCU\Software\Classes
 *    (nur aktueller Benutzer, keine Adminrechte nötig).
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { FileFilter, OpenedFile } from '../shared/types';
import { mt, setMainLang } from './i18n';
import { BRAND, READABLE_EXTS, isDocName } from '../shared/brand';

export const DOC_EXT = BRAND.doc.ext;
const PROG_ID = BRAND.progId;
/** Schutz vor versehentlich riesigen Dateien */
const MAX_DOC_BYTES = 1024 * 1024 * 1024;

const pending: string[] = [];
let rendererReady = false;
/** Im Smoke-Test: Dialoge überspringen und in diesen Ordner schreiben */
let autoDir: string | null = null;

export function setAutoSaveDir(dir: string) {
  autoDir = dir;
  fs.mkdirSync(dir, { recursive: true });
}

export const isDocPath = (p: string) => typeof p === 'string' && isDocName(p) && !p.startsWith('--');

/** Dokumentpfade aus einer Kommandozeile (Doppelklick übergibt den Pfad als Argument). */
export function docArgs(argv: string[]): string[] {
  return argv.slice(1).filter((a) => isDocPath(a) && fs.existsSync(a));
}

function readDoc(file: string): OpenedFile {
  const st = fs.statSync(file);
  if (st.size > MAX_DOC_BYTES) throw new Error(mt('Die Datei ist zu groß.'));
  return { name: path.basename(file), data: new Uint8Array(fs.readFileSync(file)) };
}

/** Dokument an den Renderer geben – oder vormerken, bis er bereit ist. */
export function openDocumentPath(win: BrowserWindow | null, file: string) {
  if (!rendererReady || !win || win.isDestroyed()) {
    pending.push(file);
    return;
  }
  try {
    win.webContents.send('file:open-request', readDoc(file));
  } catch (err) {
    void dialog.showMessageBox(win, { type: 'error', message: mt('„{name}“ konnte nicht geöffnet werden.', { name: path.basename(file) }), detail: (err as Error).message });
  }
}

const safeName = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'Export';

function writeFileAtomic(file: string, data: Uint8Array) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function registerFileIpc(getWin: () => BrowserWindow | null) {
  ipcMain.handle('file:save', async (_e, opts: { defaultName: string; filters: FileFilter[]; data: Uint8Array }) => {
    if (!(opts?.data instanceof Uint8Array)) throw new Error(mt('Keine Daten.'));
    const name = safeName(opts.defaultName);
    let file: string | undefined;
    if (autoDir) file = path.join(autoDir, name);
    else {
      const win = getWin();
      const r = await (win
        ? dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name), filters: opts.filters })
        : dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), name), filters: opts.filters }));
      if (r.canceled || !r.filePath) return null;
      file = r.filePath;
    }
    writeFileAtomic(file, opts.data);
    return file;
  });

  ipcMain.handle('file:save-many', async (_e, opts: { title: string; files: { name: string; data: Uint8Array }[] }) => {
    if (!Array.isArray(opts?.files) || opts.files.length === 0) return null;
    let dir: string | undefined;
    if (autoDir) dir = autoDir;
    else {
      const win = getWin();
      const o = { title: opts.title || mt('Zielordner wählen'), defaultPath: app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
      const r = await (win ? dialog.showOpenDialog(win, o) : dialog.showOpenDialog(o));
      if (r.canceled || !r.filePaths[0]) return null;
      dir = r.filePaths[0];
    }
    for (const f of opts.files) {
      if (!(f.data instanceof Uint8Array)) continue;
      writeFileAtomic(path.join(dir, safeName(f.name)), f.data);
    }
    return dir;
  });

  ipcMain.handle('file:open-document', async () => {
    const win = getWin();
    const o = { title: mt('pNotes-Dokument öffnen'), filters: [{ name: mt('pNotes-Dokument'), extensions: READABLE_EXTS }], properties: ['openFile'] as 'openFile'[] };
    const r = await (win ? dialog.showOpenDialog(win, o) : dialog.showOpenDialog(o));
    if (r.canceled || !r.filePaths[0]) return null;
    return readDoc(r.filePaths[0]);
  });

  ipcMain.handle('file:take-pending', () => {
    rendererReady = true;
    const out: OpenedFile[] = [];
    for (const f of pending.splice(0)) {
      try {
        out.push(readDoc(f));
      } catch {
        /* Datei inzwischen weg */
      }
    }
    return out;
  });

  ipcMain.handle('file:register-association', () => registerAssociation());
  ipcMain.on('app:set-language', (_e, l: string) => setMainLang(l));
}

/** HKCU-Dateizuordnung für die laufende EXE (Portable oder installiert). */
function registerAssociation(): Promise<{ ok: boolean; message: string }> {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, message: mt('Nur unter Windows verfügbar.') });
  if (!app.isPackaged) return Promise.resolve({ ok: false, message: mt('Nur in der gebauten App (EXE) verfügbar.') });
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const base = 'HKCU\\Software\\Classes';
  const cmds: string[][] = [
    ['add', `${base}\\.${DOC_EXT}`, '/ve', '/d', PROG_ID, '/f'],
    ['add', `${base}\\.${DOC_EXT}`, '/v', 'Content Type', '/d', BRAND.doc.mime, '/f'],
    ['add', `${base}\\${PROG_ID}`, '/ve', '/d', 'pNotes-Dokument', '/f'],
    ['add', `${base}\\${PROG_ID}\\DefaultIcon`, '/ve', '/d', `"${exe}",0`, '/f'],
    ['add', `${base}\\${PROG_ID}\\shell\\open\\command`, '/ve', '/d', `"${exe}" "%1"`, '/f'],
  ];
  const run = (args: string[]) => new Promise<void>((resolve, reject) => execFile('reg.exe', args, { windowsHide: true }, (err) => (err ? reject(err) : resolve())));
  return cmds
    .reduce((p, c) => p.then(() => run(c)), Promise.resolve())
    .then(() => {
      // Explorer über die geänderte Zuordnung informieren (SHChangeNotify ist ohne Native-Modul nicht direkt erreichbar;
      // ie4uinit aktualisiert den Symbol-Cache, die Zuordnung selbst greift sofort)
      execFile('ie4uinit.exe', ['-show'], { windowsHide: true }, () => undefined);
      return { ok: true, message: mt('.pnotes-Dateien öffnen sich jetzt per Doppelklick mit pNotes ({exe}).', { exe: path.basename(exe) }) };
    })
    .catch((err: Error) => ({ ok: false, message: mt('Zuordnung fehlgeschlagen: {error}', { error: err.message }) }));
}
