import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { docArgs, openDocumentPath, registerFileIpc, setAutoSaveDir } from './files';
import { Storage } from './storage';
import { runSmoke } from './smoke';
import { registerSyncIpc } from './sync';

const args = process.argv.slice(1);
const devServer = args.find((a) => a.startsWith('--dev-server='))?.split('=')[1];
const smokeArg = args.find((a) => a === '--smoke' || a.startsWith('--smoke='));
const smokeScenario = smokeArg ? smokeArg.split('=')[1] ?? 'all' : null;

// Smoke-Tests laufen mit einem frischen, temporären Datenordner.
if (smokeScenario) {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'pnotes-smoke-')));
  // Tests sollen auch laufen, wenn das Testfenster verdeckt ist (der Nutzer arbeitet nebenher):
  // sonst pausiert Chromium das Zeichnen → capturePage scheitert (UnknownVizError), Animationen stehen.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
} else {
  // Eigener Datenordner %APPDATA%\pNotes – fest gesetzt (nicht nur vom Produktnamen abgeleitet), damit
  // pNotes niemals die Daten der Schwester-App (eigener Ordner unter %APPDATA%) mitbenutzt.
  app.setPath('userData', path.join(app.getPath('appData'), 'pNotes'));
}

/** Fensterleiste in den pNotes-Farben (Slate 200 / Slate 800, Symbole Slate 900 / Slate 100) */
const CHROME = {
  light: { color: '#E1E4E8', symbolColor: '#12161A' },
  dark: { color: '#1F242A', symbolColor: '#F2F3F5' },
};
const WINDOW_BG = { light: '#C5CBD3', dark: '#12161A' };
const TITLEBAR_HEIGHT = 44;

let mainWindow: BrowserWindow | null = null;
let storage: Storage;

function effectiveTheme(): 'light' | 'dark' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function boundsFile() {
  return path.join(app.getPath('userData'), 'window.json');
}

function loadBounds(): { width: number; height: number; x?: number; y?: number; maximized?: boolean } {
  try {
    return JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
  } catch {
    return { width: 1280, height: 820 };
  }
}

function createWindow() {
  const bounds = smokeScenario ? { width: 1280, height: 800 } : loadBounds();
  const theme = effectiveTheme();
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'pNotes',
    backgroundColor: WINDOW_BG[theme],
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...CHROME[theme], height: TITLEBAR_HEIGHT },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      ...(smokeScenario ? { backgroundThrottling: false } : {}),
    },
  });
  mainWindow = win;

  // Keine fremden Seiten im App-Fenster; externe Links im Standardbrowser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Nur die App selbst darf geladen werden – auch keine per Drag & Drop abgelegten Dateien (file://…pdf)
  const appUrl = pathToFileURL(path.join(__dirname, '..', '..', 'dist', 'index.html')).href;
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = devServer ? url.startsWith(devServer) : url.split('#')[0] === appUrl;
    if (!allowed) e.preventDefault();
  });

  win.once('ready-to-show', () => {
    if (bounds.maximized) win.maximize();
    win.show();
  });

  win.on('close', () => {
    if (smokeScenario) return;
    const b = win.getNormalBounds();
    try {
      fs.writeFileSync(boundsFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
    } catch {
      /* Fenstergröße ist nur Komfort */
    }
  });

  if (devServer) {
    void win.loadURL(devServer);
  } else {
    void win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }
  return win;
}

function registerIpc() {
  ipcMain.handle('library:load', () => storage.loadLibrary());
  ipcMain.handle('library:save', (_e, data) => storage.saveLibrary(data));
  ipcMain.handle('notebook:load', (_e, id) => storage.loadNotebook(id));
  ipcMain.handle('notebook:save', (_e, content) => storage.saveNotebook(content));
  ipcMain.handle('notebook:delete', (_e, id) => storage.deleteNotebook(id));
  ipcMain.on('notebook:save-sync', (e, content) => {
    try {
      storage.saveNotebookSync(content);
      e.returnValue = true;
    } catch (err) {
      console.error(err);
      e.returnValue = false;
    }
  });
  ipcMain.handle('asset:put', (_e, data: Uint8Array, ext: string) => storage.putAsset(data, ext));
  ipcMain.handle('asset:get', (_e, id: string, ext: string) => storage.getAsset(id, ext));
  ipcMain.handle('app:data-path', () => storage.root);
  ipcMain.handle('app:open-data-folder', () => shell.openPath(storage.root));
  ipcMain.handle('theme:set', (_e, theme: 'system' | 'light' | 'dark') => {
    nativeTheme.themeSource = theme === 'light' || theme === 'dark' ? theme : 'system';
    applyChromeTheme();
    return effectiveTheme();
  });
}

function applyChromeTheme() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const t = effectiveTheme();
  mainWindow.setTitleBarOverlay({ ...CHROME[t], height: TITLEBAR_HEIGHT });
  mainWindow.setBackgroundColor(WINDOW_BG[t]);
}

if (!smokeScenario && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Doppelklick auf eine .pnotes-/.noahpalle-Datei, während pNotes schon läuft
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    for (const f of docArgs(argv)) openDocumentPath(mainWindow, f);
  });

  app.whenReady().then(async () => {
    storage = new Storage(path.join(app.getPath('userData'), 'library'));
    registerIpc();
    registerSyncIpc(storage);
    registerFileIpc(() => mainWindow);
    if (smokeScenario) setAutoSaveDir(path.join(app.getPath('userData'), 'exports'));
    // Beim Start per Doppelklick übergebene Dokumente (werden abgeholt, sobald der Renderer bereit ist)
    for (const f of docArgs(process.argv)) openDocumentPath(null, f);
    nativeTheme.on('updated', () => {
      applyChromeTheme();
      mainWindow?.webContents.send('theme:system-changed', effectiveTheme());
    });
    const win = createWindow();

    if (smokeScenario) {
      const code = await runSmoke(win, smokeScenario, storage.root);
      app.exit(code);
    }
  });

  app.on('window-all-closed', () => app.quit());
}
