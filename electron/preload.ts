import { contextBridge, ipcRenderer } from 'electron';
import type { LibraryData, NotebookContent, OpenedFile, PapierwerkApi } from '../shared/types';

const api: PapierwerkApi = {
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  saveLibrary: (data: LibraryData) => ipcRenderer.invoke('library:save', data),
  loadNotebook: (id: string) => ipcRenderer.invoke('notebook:load', id),
  saveNotebook: (content: NotebookContent) => ipcRenderer.invoke('notebook:save', content),
  saveNotebookSync: (content: NotebookContent) => {
    ipcRenderer.sendSync('notebook:save-sync', content);
  },
  deleteNotebook: (id: string) => ipcRenderer.invoke('notebook:delete', id),
  getDataPath: () => ipcRenderer.invoke('app:data-path'),
  openDataFolder: () => ipcRenderer.invoke('app:open-data-folder'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  onSystemThemeChanged: (cb) => {
    const listener = (_e: unknown, theme: 'light' | 'dark') => cb(theme);
    ipcRenderer.on('theme:system-changed', listener);
    return () => ipcRenderer.removeListener('theme:system-changed', listener);
  },
  assetPut: (data, ext) => ipcRenderer.invoke('asset:put', data, ext),
  assetGet: (id, ext) => ipcRenderer.invoke('asset:get', id, ext),
  syncGetConfig: () => ipcRenderer.invoke('sync:get-config'),
  syncSaveConfig: (input) => ipcRenderer.invoke('sync:save-config', input),
  syncClearConfig: () => ipcRenderer.invoke('sync:clear-config'),
  syncTest: (input) => ipcRenderer.invoke('sync:test', input),
  syncSsoLogin: (input) => ipcRenderer.invoke('sync:sso-login', input),
  syncSsoCancel: () => ipcRenderer.invoke('sync:sso-cancel'),
  syncRun: () => ipcRenderer.invoke('sync:run'),
  syncDetectFolders: () => ipcRenderer.invoke('sync:detect-folders'),
  syncPickFolder: (start) => ipcRenderer.invoke('sync:pick-folder', start),
  syncResolveDeletions: (decisions) => ipcRenderer.invoke('sync:resolve-deletions', decisions),
  fileSave: (opts) => ipcRenderer.invoke('file:save', opts),
  fileSaveMany: (opts) => ipcRenderer.invoke('file:save-many', opts),
  fileOpenDocument: () => ipcRenderer.invoke('file:open-document'),
  takePendingDocuments: () => ipcRenderer.invoke('file:take-pending'),
  onOpenDocument: (cb) => {
    const listener = (_e: unknown, f: OpenedFile) => cb(f);
    ipcRenderer.on('file:open-request', listener);
    return () => ipcRenderer.removeListener('file:open-request', listener);
  },
  registerFileAssociation: () => ipcRenderer.invoke('file:register-association'),
  setLanguage: (lang) => ipcRenderer.send('app:set-language', lang),
};

contextBridge.exposeInMainWorld('papierwerk', api);
