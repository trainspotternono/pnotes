/** Sync (Nextcloud, Google Drive, iCloud Drive, eigener Ordner, WebDAV): Statusanzeige, Einstellungsdialog, Lösch-Bestätigung. */
import { useEffect, useState } from 'react';
import { AlertTriangle, Apple, CheckCircle2, Cloud, CloudOff, FileText, Folder, FolderOpen, HardDrive, KeyRound, Loader2, LogIn, RefreshCw, Server, Settings, XCircle } from 'lucide-react';
import { FOLDER_PROVIDERS, type SyncConfigPublic, type SyncFolderSuggestion, type SyncProvider, type SyncTestResult } from '../../shared/types';
import { BRAND } from '../../shared/brand';
import { Modal, Popover, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { useSync, type SyncStatus } from '../state/sync';
import { locale, t, tk } from '../i18n';

const timeFmt = { format: (ts: number) => new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ts) };

const LABELS: Record<SyncStatus, string> = {
  off: tk('Sync aus'),
  idle: tk('Synchronisiert'),
  syncing: tk('Synchronisiert gerade …'),
  offline: tk('Offline'),
  error: tk('Fehler'),
};

/** Anbieter (Beschriftung: Markennamen bleiben unübersetzt, Rest sind Übersetzungsschlüssel) */
const PROVIDERS: { id: SyncProvider; label: string; translate: boolean; icon: React.ReactNode }[] = [
  { id: 'nextcloud', label: 'Nextcloud', translate: false, icon: <Cloud size={18} /> },
  { id: 'gdrive', label: 'Google Drive', translate: false, icon: <HardDrive size={18} /> },
  { id: 'icloud', label: 'iCloud Drive', translate: false, icon: <Apple size={18} /> },
  { id: 'folder', label: tk('Eigener Ordner'), translate: true, icon: <FolderOpen size={18} /> },
  { id: 'webdav', label: tk('WebDAV-Server'), translate: true, icon: <Server size={18} /> },
];
const providerLabel = (p: SyncProvider) => {
  const x = PROVIDERS.find((q) => q.id === p)!;
  return x.translate ? t(x.label) : x.label;
};
const isFolderProvider = (p: SyncProvider) => FOLDER_PROVIDERS.includes(p);

function StatusIcon({ status }: { status: SyncStatus }) {
  switch (status) {
    case 'syncing':
      return <Loader2 size={16} className="spin" />;
    case 'idle':
      return <CheckCircle2 size={16} />;
    case 'offline':
      return <CloudOff size={16} />;
    case 'error':
      return <AlertTriangle size={16} />;
    default:
      return <Cloud size={16} />;
  }
}

/** Kurzbeschreibung des Ziels für die Statusanzeige. */
function targetLine(c: SyncConfigPublic): string {
  if (isFolderProvider(c.provider)) return `${providerLabel(c.provider)} · ${c.localPath}`;
  return [c.username, hostOf(c.serverUrl)].filter(Boolean).join(' · ') + (c.provider === 'webdav' ? ` (${t('WebDAV-Server')})` : '');
}

/** Kompakte Anzeige in der Bibliotheks-Leiste; Klick öffnet Details mit „Jetzt synchronisieren“. */
export function SyncIndicator() {
  const { status, config, lastResult, run, setSettingsOpen } = useSync();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button className={`sync-indicator sync-${status}`} onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())} title={t('Synchronisierung')} data-testid="sync-indicator">
        <StatusIcon status={status} />
        <span>{t(LABELS[status])}</span>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} testId="sync-popover">
          <div className="sync-pop-head">
            <span className={`sync-dot sync-${status}`} />
            <strong>{t(LABELS[status])}</strong>
          </div>
          {config?.configured ? (
            <>
              <p className="sync-pop-line" data-testid="sync-target">
                {targetLine(config)}
                <br />
                {t('Ordner {folder}', { folder: config.folder })}
              </p>
              <p className="sync-pop-line">{config.lastSyncAt ? t('Zuletzt: {time}', { time: timeFmt.format(config.lastSyncAt) }) : t('Noch nicht synchronisiert')}</p>
              {lastResult && (
                <ul className="sync-summary">
                  <li>{t('↑ {up} hochgeladen · ↓ {down} heruntergeladen', { up: lastResult.uploaded, down: lastResult.downloaded })}</li>
                  {(lastResult.deletedLocal > 0 || lastResult.deletedRemote > 0) && (
                    <li>{t('{remote} im Sync-Ziel gelöscht · {local} lokal gelöscht', { remote: lastResult.deletedRemote, local: lastResult.deletedLocal })}</li>
                  )}
                  {lastResult.conflicts.map((c) => (
                    <li key={c} className="warn">
                      {c}
                    </li>
                  ))}
                  {lastResult.notices.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                  {lastResult.errors.map((c) => (
                    <li key={c} className="err">
                      {c}
                    </li>
                  ))}
                </ul>
              )}
              <div className="sync-pop-actions">
                <button className="btn btn-primary" disabled={status === 'syncing'} onClick={() => void run('manual')} data-testid="sync-now">
                  <RefreshCw size={15} className={status === 'syncing' ? 'spin' : ''} /> {t('Jetzt synchronisieren')}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setAnchor(null);
                    setSettingsOpen(true);
                  }}
                >
                  <Settings size={15} /> {t('Einstellungen')}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="sync-pop-line">{t('Synchronisiere Notizbücher, Ordner und Kommentare mit Nextcloud, Google Drive, iCloud Drive, einem eigenen Ordner oder WebDAV-Server.')}</p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setAnchor(null);
                  setSettingsOpen(true);
                }}
                data-testid="sync-setup"
              >
                <Cloud size={15} /> {t('Sync einrichten')}
              </button>
            </>
          )}
        </Popover>
      )}
    </>
  );
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

const APP_PW_RE = /^[A-Za-z0-9]{5}(-[A-Za-z0-9]{5}){4}$/;

/** Hinweise je Ordner-Anbieter (Übersetzungsschlüssel) */
const FOLDER_HINT: Record<'gdrive' | 'icloud' | 'folder', { how: string; missing: string }> = {
  gdrive: {
    how: tk('Die Notizbücher liegen in einem Ordner deines Google Drive. Die App „Google Drive für Desktop“ lädt ihn hoch und hält alle Geräte aktuell – auch wenn du offline schreibst.'),
    missing: tk('Kein Google-Drive-Ordner gefunden. Installiere „Google Drive für Desktop“ (google.com/drive/download), melde dich an und klicke auf „Erneut suchen“ – oder wähle den Ordner selbst.'),
  },
  icloud: {
    how: tk('Die Notizbücher liegen in deinem iCloud Drive. „iCloud für Windows“ lädt den Ordner hoch – so sind sie auch auf Mac, iPhone und iPad in der Dateien-App.'),
    missing: tk('Kein iCloud-Drive-Ordner gefunden. Installiere „iCloud für Windows“ (Microsoft Store), aktiviere „iCloud Drive“ und klicke auf „Erneut suchen“ – oder wähle den Ordner selbst.'),
  },
  folder: {
    how: tk('Beliebiger Ordner, z. B. OneDrive, Dropbox, ein Netzlaufwerk/NAS oder ein USB-Stick. Jedes Gerät, das diesen Ordner sieht, synchronisiert mit.'),
    missing: tk('Wähle einen Ordner – gefundene OneDrive- und Dropbox-Ordner erscheinen hier automatisch.'),
  },
};

/** Einstellungsdialog „Synchronisierung“. */
export function SyncSettingsDialog() {
  const { config, saveConfig, clearConfig, test, ssoLogin, ssoCancel, run, setSettingsOpen } = useSync();
  const [provider, setProvider] = useState<SyncProvider>(config?.configured ? config.provider : 'nextcloud');
  const [serverUrl, setServerUrl] = useState(config?.serverUrl ?? '');
  const [username, setUsername] = useState(config?.username ?? '');
  const [password, setPassword] = useState('');
  const [folder, setFolder] = useState(config?.folder || `/${BRAND.syncFolder}`);
  const [localPath, setLocalPath] = useState(config?.localPath ?? '');
  const [suggestions, setSuggestions] = useState<SyncFolderSuggestion[] | null>(null);
  const [autoSync, setAutoSync] = useState(config?.autoSync ?? true);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<SyncTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ssoWaiting, setSsoWaiting] = useState(false);
  const sameProvider = config?.configured && config.provider === provider;
  const ssoConnected = !!sameProvider && provider === 'nextcloud' && config.authMethod === 'sso';
  // Manuelle Eingabe nur zeigen, wenn bereits mit App-Passwort eingerichtet oder ausdrücklich gewünscht
  const [manual, setManual] = useState(!!config?.configured && config.provider === 'nextcloud' && config.authMethod === 'password');
  const close = () => {
    if (ssoWaiting) void ssoCancel();
    setSettingsOpen(false);
  };

  const detect = () => {
    setSuggestions(null);
    void api
      .syncDetectFolders()
      .then(setSuggestions)
      .catch(() => setSuggestions([]));
  };
  useEffect(detect, []);

  const forProvider = (suggestions ?? []).filter((s) => s.provider === provider);
  // Beim Wechsel auf einen Ordner-Anbieter den ersten gefundenen Ordner vorschlagen
  useEffect(() => {
    if (!isFolderProvider(provider) || !suggestions) return;
    const own = suggestions.filter((s) => s.provider === provider);
    const keep = (sameProvider && localPath) || own.some((s) => s.path === localPath);
    if (!keep) setLocalPath(own[0]?.path ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, suggestions]);

  const switchProvider = (p: SyncProvider) => {
    setProvider(p);
    setResult(null);
    setError(null);
    if (p !== config?.provider) setPassword('');
    if (isFolderProvider(p) && config?.provider !== p) setLocalPath('');
  };

  const onSso = async () => {
    setSsoWaiting(true);
    setResult(null);
    setError(null);
    try {
      await ssoLogin({ serverUrl, folder, autoSync });
      setSettingsOpen(false);
      void run('manual');
    } catch (e) {
      const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      if (!/abgebrochen/i.test(msg)) setError(msg);
    } finally {
      setSsoWaiting(false);
    }
  };
  const input = { provider, localPath, serverUrl, username, folder, autoSync, password: password || undefined };
  const hasStoredPw = !!sameProvider && !!config?.hasPassword;
  const canSave = isFolderProvider(provider)
    ? !!localPath.trim()
    : provider === 'webdav'
      ? !!serverUrl.trim() && (!username.trim() || !!password || hasStoredPw)
      : !!serverUrl.trim() && !!username.trim() && (!!password || hasStoredPw);
  const looksLikeAppPassword = !password || APP_PW_RE.test(password.trim());

  const onTest = async () => {
    setTesting(true);
    setResult(null);
    setError(null);
    try {
      setResult(await test(input));
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message, details: [] });
    } finally {
      setTesting(false);
    }
  };

  const onSave = async (syncAfter: boolean) => {
    setError(null);
    try {
      await saveConfig({ ...input, password: password.trim() || undefined });
      close();
      if (syncAfter) void run('manual');
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  const pickFolder = async () => {
    const p = await api.syncPickFolder(localPath || forProvider[0]?.path);
    if (p) setLocalPath(p);
  };

  return (
    <Modal
      title={t('Synchronisierung')}
      onClose={close}
      width={560}
      testId="sync-settings"
      footer={
        <>
          {config?.configured && (
            <button
              className="btn btn-ghost danger-text sync-disconnect"
              onClick={() => {
                void clearConfig();
                close();
              }}
              data-testid="sync-clear"
            >
              {t('Verbindung trennen')}
            </button>
          )}
          <button className="btn" onClick={close} data-testid="dialog-cancel">
            {t('Abbrechen')}
          </button>
          <button className="btn" disabled={!canSave} onClick={() => void onSave(false)} data-testid="sync-save">
            {t('Speichern')}
          </button>
          <button className="btn btn-primary" disabled={!canSave} onClick={() => void onSave(true)} data-testid="sync-save-run">
            {t('Speichern & synchronisieren')}
          </button>
        </>
      }
    >
      <div className="sync-providers" role="radiogroup" aria-label={t('Synchronisieren mit')}>
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={provider === p.id}
            className={`sync-provider${provider === p.id ? ' selected' : ''}`}
            onClick={() => switchProvider(p.id)}
            disabled={ssoWaiting}
            data-testid={`sync-provider-${p.id}`}
          >
            {p.icon}
            <span>{p.translate ? t(p.label) : p.label}</span>
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------------- Nextcloud */}
      {provider === 'nextcloud' && (
        <>
          <label className="field">
            <span className="field-label">{t('Server-URL')}</span>
            <input className="input" placeholder="https://cloud.example.com" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} autoFocus disabled={ssoWaiting} data-testid="sync-url" />
          </label>

          <div className="sso-box" data-testid="sso-box">
            {ssoWaiting ? (
              <>
                <div className="sso-row">
                  <Loader2 size={16} className="spin" /> {t('Bitte im Browser bei Nextcloud anmelden und „Zugriff gewähren“ klicken …')}
                </div>
                <button className="btn" onClick={() => void ssoCancel()} data-testid="sso-cancel">
                  {t('Abbrechen')}
                </button>
              </>
            ) : (
              <>
                {ssoConnected && (
                  <div className="sso-row">
                    <CheckCircle2 size={16} /> {t('Verbunden als „{name}“ über Browser-Anmeldung', { name: config!.username })}
                  </div>
                )}
                <button className={`btn ${ssoConnected ? '' : 'btn-primary'}`} disabled={!serverUrl.trim()} onClick={() => void onSso()} data-testid="sso-login">
                  <LogIn size={15} /> {ssoConnected ? t('Erneut im Browser anmelden') : t('Im Browser anmelden (SSO)')}
                </button>
                <span className="field-hint">
                  {t('Öffnet die Anmeldeseite deiner Nextcloud im Standardbrowser – funktioniert mit Passwort, Zwei-Faktor und Single Sign-On (SAML/OpenID Connect). pNotes erhält danach automatisch ein eigenes App-Passwort.')}
                </span>
              </>
            )}
          </div>

          {!manual && (
            <button className="link-btn" onClick={() => setManual(true)} data-testid="sync-manual">
              {t('Stattdessen App-Passwort manuell eingeben')}
            </button>
          )}
          {manual && (
            <>
              <label className="field">
                <span className="field-label">{t('Benutzername')}</span>
                <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} data-testid="sync-user" />
              </label>
              <label className="field">
                <span className="field-label">{t('App-Passwort')}</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  placeholder={hasStoredPw ? t('•••••• gespeichert – leer lassen zum Beibehalten') : 'xxxxx-xxxxx-xxxxx-xxxxx-xxxxx'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="sync-password"
                />
                <span className="field-hint">
                  <KeyRound size={13} /> {t('Bitte ein App-Passwort verwenden, nicht dein Login-Passwort: Nextcloud → Persönliche Einstellungen → Sicherheit → „Geräte & Sitzungen“ → „Neues App-Passwort erstellen“. Bei Zwei-Faktor-Anmeldung ist es Pflicht.')}
                </span>
                {!looksLikeAppPassword && <span className="field-warn">{t('Das sieht nicht wie ein Nextcloud-App-Passwort aus (Format xxxxx-xxxxx-xxxxx-xxxxx-xxxxx). Es funktioniert trotzdem, wird aber nicht empfohlen.')}</span>}
              </label>
            </>
          )}
          <label className="field">
            <span className="field-label">{t('Zielordner in Nextcloud')}</span>
            <input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} data-testid="sync-folder" />
          </label>
        </>
      )}

      {/* ---------------------------------------------------------------- WebDAV (benutzerdefiniert) */}
      {provider === 'webdav' && (
        <>
          <p className="field-hint">{t('Für jeden Server mit WebDAV: Synology/QNAP-NAS, ownCloud, Seafile, Apache/nginx, Hetzner Storage Box, IONOS HiDrive, MagentaCLOUD …')}</p>
          <label className="field">
            <span className="field-label">{t('WebDAV-Adresse')}</span>
            <input className="input" placeholder="https://nas.example.com:5006/home" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} autoFocus data-testid="sync-url" />
          </label>
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('Benutzername')}</span>
              <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} data-testid="sync-user" />
            </label>
            <label className="field">
              <span className="field-label">{t('Passwort')}</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder={hasStoredPw ? t('•••••• gespeichert – leer lassen zum Beibehalten') : ''}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="sync-password"
              />
            </label>
          </div>
          <label className="field">
            <span className="field-label">{t('Zielordner auf dem Server')}</span>
            <input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} data-testid="sync-folder" />
          </label>
        </>
      )}

      {/* ---------------------------------------------------------------- Google Drive / iCloud / eigener Ordner */}
      {isFolderProvider(provider) && (
        <>
          <p className="field-hint">{t(FOLDER_HINT[provider as 'gdrive' | 'icloud' | 'folder'].how)}</p>
          <div className="field">
            <span className="field-label">{t('Speicherort')}</span>
            {suggestions === null ? (
              <div className="sso-row">
                <Loader2 size={15} className="spin" /> {t('Suche Cloud-Ordner …')}
              </div>
            ) : (
              <div className="lang-list" role="radiogroup" data-testid="sync-suggestions">
                {forProvider.map((s) => (
                  <button key={s.path} role="radio" aria-checked={localPath === s.path} className={`lang-row${localPath === s.path ? ' selected' : ''}`} onClick={() => setLocalPath(s.path)} data-testid="sync-suggestion">
                    <span className="lang-icon">{provider === 'icloud' ? <Apple size={16} /> : provider === 'gdrive' ? <HardDrive size={16} /> : <Folder size={16} />}</span>
                    <span className="lang-label">
                      {s.label}
                      <small>{s.path}</small>
                    </span>
                    {localPath === s.path && <CheckCircle2 size={16} />}
                  </button>
                ))}
                {forProvider.length === 0 && <p className="field-hint" data-testid="sync-none-found">{t(FOLDER_HINT[provider as 'gdrive' | 'icloud' | 'folder'].missing)}</p>}
              </div>
            )}
            <div className="sync-path-row">
              <input className="input" value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="D:\Cloud" data-testid="sync-local-path" />
              <button className="btn" onClick={() => void pickFolder()} data-testid="sync-pick-folder">
                <FolderOpen size={15} /> {t('Ordner wählen …')}
              </button>
              <button className="btn btn-ghost" onClick={detect} title={t('Erneut suchen')} data-testid="sync-detect">
                <RefreshCw size={15} />
              </button>
            </div>
          </div>
          <label className="field">
            <span className="field-label">{t('Unterordner für pNotes')}</span>
            <input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} data-testid="sync-folder" />
          </label>
        </>
      )}

      <Toggle label={t('Automatisch synchronisieren beim Öffnen und Schließen eines Notizbuchs')} checked={autoSync} onChange={setAutoSync} testId="sync-auto" />

      <div className="sync-test-row">
        <button className="btn" disabled={testing || !canSave} onClick={() => void onTest()} data-testid="sync-test">
          {testing ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} {isFolderProvider(provider) ? t('Ordner prüfen') : t('Verbindung testen')}
        </button>
        {config && !config.encryptionAvailable && !isFolderProvider(provider) && <span className="field-warn">{t('Sichere Passwortablage ist auf diesem System nicht verfügbar.')}</span>}
      </div>
      {result && (
        <div className={`sync-test-result ${result.ok ? 'ok' : 'fail'}`} data-testid="sync-test-result">
          <div className="sync-test-msg">
            {result.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />} {result.message}
          </div>
          {result.details.length > 0 && (
            <ul>
              {result.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <div className="sync-test-result fail" data-testid="sync-error">
          {error}
        </div>
      )}
      <p className="field-hint sync-privacy">
        {isFolderProvider(provider)
          ? t('Es wird kein Passwort gespeichert: Anmeldung und Hochladen übernimmt die Desktop-App des Anbieters. Konflikte (gleichzeitige Änderungen auf zwei Geräten) erkennt pNotes selbst und legt eine Kopie an.')
          : t('Passwörter werden mit der Windows-Datenschutz-API (DPAPI) verschlüsselt in den App-Einstellungen gespeichert – nie im Klartext und nie zusammen mit deinen Notizbüchern.')}
      </p>
    </Modal>
  );
}

/** Bestätigung vor dem Löschen (lokal → Sync-Ziel bzw. Sync-Ziel → lokal). */
export function DeletionDialog() {
  const { pending, resolve } = useSync();
  const [keep, setKeep] = useState<Set<string>>(new Set());
  if (!pending.length) return null;
  const remote = pending.filter((p) => p.where === 'remote');
  const local = pending.filter((p) => p.where === 'local');
  const toggle = (key: string) =>
    setKeep((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const decide = (all: boolean | null) => {
    void resolve(pending.map((p) => ({ key: p.key, delete: all === null ? !keep.has(p.key) : all })));
    setKeep(new Set());
  };
  const row = (p: (typeof pending)[number]) => (
    <label key={p.key} className="del-row">
      <input type="checkbox" checked={!keep.has(p.key)} onChange={() => toggle(p.key)} />
      {p.kind === 'folder' ? <Folder size={15} /> : <FileText size={15} />}
      <span>{p.title}</span>
    </label>
  );
  return (
    <Modal
      title={t('Löschungen synchronisieren?')}
      onClose={() => decide(false)}
      width={480}
      testId="deletion-dialog"
      footer={
        <>
          <button className="btn" onClick={() => decide(false)} data-testid="del-keep-all">
            {t('Nichts löschen (wiederherstellen)')}
          </button>
          <button className="btn btn-danger" onClick={() => decide(null)} data-testid="del-confirm">
            {t('Ausgewählte löschen')}
          </button>
        </>
      }
    >
      {remote.length > 0 && (
        <>
          <p className="modal-text">{t('Diese Objekte hast du lokal gelöscht. Sollen sie auch im Sync-Ziel gelöscht werden?')}</p>
          <div className="del-list">{remote.map(row)}</div>
        </>
      )}
      {local.length > 0 && (
        <>
          <p className="modal-text">{t('Diese Objekte wurden im Sync-Ziel (z. B. auf einem anderen Gerät) gelöscht. Auch hier löschen?')}</p>
          <div className="del-list">{local.map(row)}</div>
        </>
      )}
      <p className="field-hint">{t('Nicht angehakte Objekte bleiben erhalten und werden auf beiden Seiten wiederhergestellt.')}</p>
    </Modal>
  );
}

/** Global eingehängte Sync-Dialoge. */
export function SyncDialogs() {
  const { settingsOpen } = useSync();
  return (
    <>
      {settingsOpen && <SyncSettingsDialog />}
      <DeletionDialog />
    </>
  );
}
