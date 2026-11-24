/**
 * Sync im Main-Prozess: Konfiguration, sichere Ablage von Passwörtern
 * (Electron safeStorage → Windows DPAPI, an das Windows-Benutzerkonto gebunden),
 * Netzwerk über net.fetch (nutzt Windows-Zertifikatsspeicher und Proxy-Einstellungen).
 * Passwörter verlassen den Main-Prozess nie.
 *
 * Ziele: Nextcloud (WebDAV + SSO), beliebiger WebDAV-Server, Google Drive / iCloud Drive / eigener Ordner
 * (über die Desktop-App des Anbieters, siehe folder.ts).
 */
import { app, BrowserWindow, dialog, ipcMain, net, safeStorage, shell } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FOLDER_PROVIDERS, type DeletionDecision, type SyncConfigInput, type SyncConfigPublic, type SyncProvider, type SyncResult, type SyncSsoInput } from '../../shared/types';
import { BRAND } from '../../shared/brand';
import type { Storage } from '../storage';
import { detectCloudFolders } from './detect';
import { SyncEngine, emptyResult } from './engine';
import { FolderStore, testFolder } from './folder';
import { LoginFlowCancelled, fetchUserId, pollLoginFlow, revokeAppPassword, startLoginFlow } from './loginflow';
import { WebDavClient, davRootUrl, normalizeDavUrl, normalizeFolder, normalizeServerUrl, testConnection, testWebDav, type FetchFn } from './webdav';

const DEFAULT_FOLDER = `/${BRAND.syncFolder}`;

/** Ortsangabe für Meldungen der Sync-Engine */
const AT: Record<SyncProvider, string> = {
  nextcloud: 'auf Nextcloud',
  webdav: 'auf dem WebDAV-Server',
  gdrive: 'in Google Drive',
  icloud: 'in iCloud Drive',
  folder: 'im Sync-Ordner',
};

const isFolderProvider = (p: SyncProvider) => FOLDER_PROVIDERS.includes(p);

interface StoredConfig {
  /** fehlt bei älteren Konfigurationen = nextcloud */
  provider?: SyncProvider;
  /** Ordner-Anbieter: Wurzelordner auf diesem PC */
  localPath?: string;
  serverUrl: string;
  /** Benutzer-ID (WebDAV-Pfad /remote.php/dav/files/<username>/) */
  username: string;
  /** Login-Name für Basic-Auth, falls abweichend von der ID (bei SSO z. B. die E-Mail) */
  loginName?: string;
  /** Herkunft des App-Passworts; fehlt bei alten Konfigurationen = 'password' */
  authMethod?: 'password' | 'sso';
  folder: string;
  autoSync: boolean;
  /** base64 von safeStorage.encryptString(passwort) */
  passwordEnc: string | null;
  lastSyncAt: number | null;
}

/** Öffnet die Anmeldeseite; im Smoke-Test ersetzbar (simulierter Browser). */
let openLoginPage: (url: string) => Promise<void> = (url) => shell.openExternal(url);
export function setLoginPageOpener(fn: (url: string) => Promise<void>) {
  openLoginPage = fn;
}

/** Erscheint in Nextcloud unter „Geräte & Sitzungen“ als Name des App-Passworts. */
const USER_AGENT = `pNotes/${app.getVersion()} (Windows)`;

const REQUEST_TIMEOUT_MS = 30_000;

const configFile = () => path.join(app.getPath('userData'), 'sync-config.json');

function readConfig(): StoredConfig | null {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8')) as StoredConfig;
  } catch {
    return null;
  }
}

function writeConfig(c: StoredConfig) {
  const file = configFile();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const providerOf = (c: StoredConfig | null): SyncProvider => c?.provider ?? 'nextcloud';

function isConfigured(c: StoredConfig | null): boolean {
  if (!c) return false;
  if (isFolderProvider(providerOf(c))) return !!c.localPath;
  // WebDAV ohne Anmeldung (z. B. offenes Heim-NAS) ist erlaubt: dann leerer Benutzer + leeres Passwort
  if (providerOf(c) === 'webdav') return !!c.serverUrl && (!!c.passwordEnc || !c.username);
  return !!c.serverUrl && !!c.username && !!c.passwordEnc;
}

async function toPublic(c: StoredConfig | null): Promise<SyncConfigPublic> {
  return {
    provider: providerOf(c),
    localPath: c?.localPath ?? '',
    configured: isConfigured(c),
    serverUrl: c?.serverUrl ?? '',
    username: c?.username ?? '',
    folder: c?.folder ?? DEFAULT_FOLDER,
    autoSync: c?.autoSync ?? false,
    hasPassword: !!c?.passwordEnc,
    authMethod: c?.authMethod ?? 'password',
    encryptionAvailable: await safeStorage.isAsyncEncryptionAvailable(),
    lastSyncAt: c?.lastSyncAt ?? null,
  };
}

async function encryptPassword(plain: string): Promise<string> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('Sichere Speicherung ist auf diesem System nicht verfügbar – das Passwort wird nicht gespeichert.');
  }
  return (await safeStorage.encryptStringAsync(plain)).toString('base64');
}

/** Entschlüsselt das App-Passwort; bei rotiertem Schlüssel wird es neu verschlüsselt gespeichert. */
async function decryptPassword(c: StoredConfig): Promise<string> {
  if (!c.passwordEnc) throw new Error('Kein App-Passwort gespeichert.');
  const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(c.passwordEnc, 'base64'));
  if (shouldReEncrypt) {
    try {
      writeConfig({ ...c, passwordEnc: await encryptPassword(result) });
    } catch {
      /* altes Chiffrat bleibt gültig */
    }
  }
  return result;
}

/** Beim Wechsel weg von Nextcloud-SSO: das automatisch erzeugte App-Passwort auf dem Server widerrufen (best effort). */
async function revokeOldSso(old: StoredConfig | null): Promise<void> {
  if (!old || providerOf(old) !== 'nextcloud' || old.authMethod !== 'sso' || !old.passwordEnc) return;
  try {
    await revokeAppPassword(old.serverUrl, old.loginName || old.username, await decryptPassword(old), fetchFn);
  } catch {
    /* offline o. Ä. – egal */
  }
}

/** fetch über Chromiums Netzwerk-Stack, mit Zeitlimit. */
const fetchFn: FetchFn = async (url, init) => {
  // Binärdaten als eigenständiger ArrayBuffer (TS-Typ von Uint8Array<ArrayBufferLike> ist kein BodyInit)
  const body = init.body instanceof Uint8Array ? (init.body.slice().buffer as ArrayBuffer) : init.body;
  const res = await net.fetch(url, { method: init.method, headers: init.headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'follow' });
  return { status: res.status, headers: res.headers, text: () => res.text(), arrayBuffer: () => res.arrayBuffer() };
};

function validateInput(input: SyncConfigInput): { serverUrl: string; username: string; folder: string } {
  const serverUrl = normalizeServerUrl(input.serverUrl);
  const username = input.username.trim();
  if (!username) throw new Error('Bitte einen Benutzernamen angeben.');
  return { serverUrl, username, folder: normalizeFolder(input.folder || DEFAULT_FOLDER) };
}

export function registerSyncIpc(storage: Storage) {
  let running: Promise<SyncResult> | null = null;

  const engineFor = async (c: StoredConfig) => {
    const provider = providerOf(c);
    if (isFolderProvider(provider)) {
      const targetId = createHash('sha256').update(`${provider}|${path.resolve(c.localPath!).toLowerCase()}|${c.folder}`).digest('hex').slice(0, 16);
      return new SyncEngine(new FolderStore(c.localPath!), storage, c.folder, targetId, Date.now, AT[provider]);
    }
    const password = c.passwordEnc ? await decryptPassword(c) : '';
    const dav =
      provider === 'webdav'
        ? new WebDavClient(normalizeDavUrl(c.serverUrl), c.username, password, fetchFn)
        : new WebDavClient(davRootUrl(c.serverUrl, c.username), c.loginName || c.username, password, fetchFn);
    // Nextcloud behält die bisherige Ziel-ID (kein erneuter Erstabgleich nach dem Update)
    const targetId = createHash('sha256').update(provider === 'webdav' ? `webdav|${c.serverUrl}|${c.username}|${c.folder}` : `${c.serverUrl}|${c.username}|${c.folder}`).digest('hex').slice(0, 16);
    return new SyncEngine(dav, storage, c.folder, targetId, Date.now, AT[provider]);
  };

  /** Nur ein Sync gleichzeitig. */
  const exclusive = (fn: () => Promise<SyncResult>) => {
    if (running) return running;
    running = fn().finally(() => {
      running = null;
    });
    return running;
  };

  const withConfig = async (fn: (c: StoredConfig) => Promise<SyncResult>): Promise<SyncResult> => {
    const c = readConfig();
    if (!c || !isConfigured(c)) {
      const r = emptyResult();
      r.ok = false;
      r.errors.push('Sync ist nicht eingerichtet.');
      return r;
    }
    try {
      const result = await fn(c);
      if (result.ok || !result.offline) writeConfig({ ...c, lastSyncAt: result.finishedAt });
      return result;
    } catch (err) {
      const r = emptyResult();
      r.ok = false;
      r.errors.push((err as Error).message);
      return r;
    }
  };

  ipcMain.handle('sync:get-config', () => toPublic(readConfig()));

  ipcMain.handle('sync:save-config', async (_e, input: SyncConfigInput) => {
    const provider: SyncProvider = input.provider ?? 'nextcloud';
    const old = readConfig();
    // ---- Google Drive / iCloud / eigener Ordner: nur Pfad + Unterordner, kein Passwort
    if (isFolderProvider(provider)) {
      const localPath = (input.localPath ?? '').trim();
      if (!localPath) throw new Error('Bitte einen Ordner wählen.');
      if (!fs.existsSync(localPath) || !fs.statSync(localPath).isDirectory()) throw new Error(`Ordner nicht gefunden: ${localPath}`);
      const folder = normalizeFolder(input.folder || DEFAULT_FOLDER);
      const same = !!old && providerOf(old) === provider && old.localPath === localPath && old.folder === folder;
      await revokeOldSso(old);
      const next: StoredConfig = { provider, localPath, serverUrl: '', username: '', folder, autoSync: !!input.autoSync, passwordEnc: null, lastSyncAt: same ? old.lastSyncAt : null };
      writeConfig(next);
      return toPublic(next);
    }
    // ---- beliebiger WebDAV-Server
    if (provider === 'webdav') {
      const serverUrl = normalizeDavUrl(input.serverUrl);
      const username = input.username.trim();
      const folder = normalizeFolder(input.folder || DEFAULT_FOLDER);
      const sameAccount = !!old && providerOf(old) === 'webdav' && old.serverUrl === serverUrl && old.username === username;
      let passwordEnc = sameAccount ? old.passwordEnc : null;
      if (input.password) passwordEnc = await encryptPassword(input.password);
      if (username && !passwordEnc) throw new Error('Bitte das Passwort angeben.');
      await revokeOldSso(old);
      const next: StoredConfig = { provider, serverUrl, username, folder, autoSync: !!input.autoSync, passwordEnc, lastSyncAt: sameAccount && old.folder === folder ? old.lastSyncAt : null };
      writeConfig(next);
      return toPublic(next);
    }
    // ---- Nextcloud
    const v = validateInput(input);
    const wasNextcloud = !!old && providerOf(old) === 'nextcloud';
    const sameAccount = wasNextcloud && old.serverUrl === v.serverUrl && old.username === v.username;
    // Passwort eines anderen Anbieters (z. B. WebDAV) nie für Nextcloud weiterverwenden
    let passwordEnc = wasNextcloud ? (old.passwordEnc ?? null) : null;
    // Gespeichertes (ggf. per SSO erhaltenes) Passwort samt Login-Name nur für dasselbe Konto weiterverwenden
    let loginName = sameAccount ? old.loginName : undefined;
    let authMethod = sameAccount ? (old.authMethod ?? 'password') : 'password';
    if (!sameAccount && old?.authMethod === 'sso') passwordEnc = null;
    if (input.password) {
      passwordEnc = await encryptPassword(input.password);
      loginName = undefined;
      authMethod = 'password';
    }
    // Anderer Server/Benutzer/Ordner → altes Manifest gilt nicht mehr (Engine erkennt das über die Ziel-ID)
    const next: StoredConfig = { provider: 'nextcloud', ...v, loginName, authMethod, autoSync: !!input.autoSync, passwordEnc, lastSyncAt: sameAccount && old.folder === v.folder ? old.lastSyncAt : null };
    writeConfig(next);
    return toPublic(next);
  });

  // ---- Cloud-Ordner finden / Ordner wählen
  ipcMain.handle('sync:detect-folders', () => detectCloudFolders());
  ipcMain.handle('sync:pick-folder', async (_e, start?: string) => {
    const win = BrowserWindow.getFocusedWindow();
    const o = {
      title: 'Sync-Ordner wählen',
      defaultPath: typeof start === 'string' && start && fs.existsSync(start) ? start : app.getPath('home'),
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
    };
    const r = await (win ? dialog.showOpenDialog(win, o) : dialog.showOpenDialog(o));
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });

  ipcMain.handle('sync:clear-config', async () => {
    try {
      const c = readConfig();
      // Per SSO erzeugtes App-Passwort auf dem Server widerrufen (best effort, z. B. offline egal)
      if (c?.authMethod === 'sso' && c.passwordEnc) {
        try {
          await revokeAppPassword(c.serverUrl, c.loginName || c.username, await decryptPassword(c), fetchFn);
        } catch {
          /* ignorieren */
        }
      }
      fs.rmSync(configFile(), { force: true });
      await storage.deleteManifest();
    } catch {
      /* ignorieren */
    }
    return toPublic(null);
  });

  ipcMain.handle('sync:test', async (_e, input: SyncConfigInput) => {
    const provider: SyncProvider = input.provider ?? 'nextcloud';
    if (isFolderProvider(provider)) {
      try {
        return await testFolder(input.localPath ?? '', normalizeFolder(input.folder || DEFAULT_FOLDER));
      } catch (e) {
        return { ok: false, message: (e as Error).message, details: [] };
      }
    }
    let password = input.password ?? '';
    let loginName: string | undefined;
    if (!password) {
      const c = readConfig();
      // gespeichertes Passwort nur für denselben Anbieter verwenden
      if (c?.passwordEnc && providerOf(c) === provider) {
        try {
          password = await decryptPassword(c);
          if (c.username === input.username.trim()) loginName = c.loginName;
        } catch {
          return { ok: false, message: 'Gespeichertes Passwort konnte nicht entschlüsselt werden – bitte neu eingeben.', details: [] };
        }
      }
    }
    if (provider === 'webdav') return testWebDav(input.serverUrl, input.username, password, input.folder || DEFAULT_FOLDER, fetchFn);
    return testConnection(input.serverUrl, input.username, password, input.folder || DEFAULT_FOLDER, fetchFn, loginName);
  });

  // ---- Browser-Anmeldung (SSO, Nextcloud Login Flow v2)
  let ssoAbort: AbortController | null = null;

  ipcMain.handle('sync:sso-login', async (_e, input: SyncSsoInput) => {
    ssoAbort?.abort();
    const abort = new AbortController();
    ssoAbort = abort;
    try {
      const serverUrl = normalizeServerUrl(input.serverUrl);
      const folder = normalizeFolder(input.folder || DEFAULT_FOLDER);
      const start = await startLoginFlow(serverUrl, fetchFn, USER_AGENT);
      // Standardbrowser: dort sind SSO-Sitzungen, Passwort-Manager und Hardware-Schlüssel verfügbar
      await openLoginPage(start.loginUrl);
      const result = await pollLoginFlow(start, fetchFn, USER_AGENT, abort.signal);
      const userId = await fetchUserId(result.serverUrl, result.loginName, result.appPassword, fetchFn);
      const passwordEnc = await encryptPassword(result.appPassword);

      const old = readConfig();
      // Vorheriges SSO-App-Passwort eines anderen Kontos widerrufen
      if (old?.authMethod === 'sso' && old.passwordEnc) {
        try {
          const oldPw = await decryptPassword(old);
          if (oldPw !== result.appPassword) await revokeAppPassword(old.serverUrl, old.loginName || old.username, oldPw, fetchFn);
        } catch {
          /* ignorieren */
        }
      }
      // Server-URL aus der Eingabe behalten (erreichbar); Nextcloud meldet hinter Proxys manchmal http://
      const sameTarget = !!old && providerOf(old) === 'nextcloud' && old.serverUrl === serverUrl && old.username === userId && old.folder === folder;
      const next: StoredConfig = {
        provider: 'nextcloud',
        serverUrl,
        username: userId,
        loginName: result.loginName !== userId ? result.loginName : undefined,
        authMethod: 'sso',
        folder,
        autoSync: !!input.autoSync,
        passwordEnc,
        lastSyncAt: sameTarget ? old.lastSyncAt : null,
      };
      writeConfig(next);
      return toPublic(next);
    } catch (err) {
      if (err instanceof LoginFlowCancelled) throw new Error('Anmeldung abgebrochen.');
      throw err;
    } finally {
      if (ssoAbort === abort) ssoAbort = null;
    }
  });

  ipcMain.handle('sync:sso-cancel', () => {
    ssoAbort?.abort();
    ssoAbort = null;
  });

  ipcMain.handle('sync:run', () => exclusive(() => withConfig(async (c) => (await engineFor(c)).run())));

  ipcMain.handle('sync:resolve-deletions', (_e, decisions: DeletionDecision[]) =>
    exclusive(() => withConfig(async (c) => (await engineFor(c)).resolveDeletions(Array.isArray(decisions) ? decisions.filter((d) => d && typeof d.key === 'string') : []))),
  );
}
