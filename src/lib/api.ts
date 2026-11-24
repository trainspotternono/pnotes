import type { LibraryData, NotebookContent, PapierwerkApi } from '../../shared/types';
import { BRAND, READABLE_EXTS } from '../../shared/brand';
import { t } from '../i18n';

declare global {
  interface Window {
    papierwerk?: PapierwerkApi;
  }
}

/**
 * Fallback für `vite` im normalen Browser (ohne Electron): speichert in localStorage.
 * In der Desktop-App wird immer die Preload-API (Dateisystem) verwendet.
 */
function createBrowserFallback(): PapierwerkApi {
  const read = <T,>(k: string): T | null => {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  };
  const write = (k: string, v: unknown) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* Speicher voll oder blockiert */
    }
  };
  return {
    loadLibrary: async () => read<LibraryData>('pw.library'),
    saveLibrary: async (d) => write('pw.library', d),
    loadNotebook: async (id) => read<NotebookContent>(`pw.nb.${id}`),
    saveNotebook: async (c) => write(`pw.nb.${c.id}`, c),
    saveNotebookSync: (c) => write(`pw.nb.${c.id}`, c),
    deleteNotebook: async (id) => localStorage.removeItem(`pw.nb.${id}`),
    getDataPath: async () => 'localStorage (Browser-Modus)',
    openDataFolder: async () => undefined,
    setTheme: async (t) => (t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t),
    onSystemThemeChanged: (cb) => {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const l = () => cb(mq.matches ? 'dark' : 'light');
      mq.addEventListener('change', l);
      return () => mq.removeEventListener('change', l);
    },
    assetPut: async (data, ext) => {
      const hash = await crypto.subtle.digest('SHA-1', data as BufferSource);
      const id = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
      await idb('readwrite', (s) => s.put(data, `${id}.${ext}`));
      return id;
    },
    assetGet: async (id, ext) => (await idb<Uint8Array | undefined>('readonly', (s) => s.get(`${id}.${ext}`))) ?? null,
    // Nextcloud-Sync braucht den Main-Prozess (Dateizugriff, sichere Passwortablage, kein CORS)
    syncGetConfig: async () => ({ ...EMPTY_CONFIG }),
    syncSaveConfig: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    syncClearConfig: async () => ({ ...EMPTY_CONFIG }),
    syncTest: async () => ({ ok: false, message: DESKTOP_ONLY, details: [] }),
    syncSsoLogin: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    syncSsoCancel: async () => undefined,
    syncDetectFolders: async () => [],
    syncPickFolder: async () => null,
    // Browser-Modus: Download über einen Link statt Speichern-Dialog
    fileSave: async ({ defaultName, data }) => {
      browserDownload(new Blob([data as BlobPart]), defaultName);
      return defaultName;
    },
    fileSaveMany: async ({ files }) => {
      for (const f of files) browserDownload(new Blob([f.data as BlobPart]), f.name);
      return 'Downloads';
    },
    fileOpenDocument: () =>
      new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = READABLE_EXTS.map((e) => `.${e}`).join(',');
        input.onchange = async () => {
          const f = input.files?.[0];
          resolve(f ? { name: f.name, data: new Uint8Array(await f.arrayBuffer()) } : null);
        };
        input.click();
      }),
    takePendingDocuments: async () => [],
    onOpenDocument: () => () => undefined,
    registerFileAssociation: async () => ({ ok: false, message: t('Nur in der Desktop-App verfügbar.') }),
    setLanguage: () => undefined,
    syncRun: async () => ({ ...EMPTY_RESULT, ok: false, errors: [DESKTOP_ONLY], finishedAt: Date.now() }),
    syncResolveDeletions: async () => ({ ...EMPTY_RESULT, ok: false, errors: [DESKTOP_ONLY], finishedAt: Date.now() }),
  };
}

/** Minimaler IndexedDB-Zugriff für den Browser-Modus (große Dateien passen nicht in localStorage). */
function idb<T = unknown>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('papierwerk-assets', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('assets');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = fn(open.result.transaction('assets', mode).objectStore('assets'));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    };
  });
}

function browserDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const DESKTOP_ONLY = 'Sync ist nur in der Desktop-App verfügbar.'; // nur Browser-Vorschau
const EMPTY_CONFIG = { provider: 'nextcloud' as const, localPath: '', configured: false, serverUrl: '', username: '', folder: `/${BRAND.syncFolder}`, autoSync: false, hasPassword: false, authMethod: 'password' as const, encryptionAvailable: false, lastSyncAt: null };
const EMPTY_RESULT ={ ok: true, offline: false, uploaded: 0, downloaded: 0, deletedRemote: 0, deletedLocal: 0, conflicts: [], notices: [], errors: [], pendingDeletions: [], changedLocal: false, finishedAt: 0 };

export const api: PapierwerkApi =
  typeof window !== 'undefined' && window.papierwerk ? window.papierwerk : createBrowserFallback();
