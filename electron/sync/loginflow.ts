/**
 * Nextcloud Login Flow v2 – Anmeldung im Browser (SSO).
 * https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html#login-flow-v2
 *
 * 1. POST <server>/index.php/login/v2           → { poll: { token, endpoint }, login }
 * 2. `login` im Standardbrowser öffnen – dort greift jede Nextcloud-Anmeldung
 *    (Passwort, 2FA, SAML/OIDC/Keycloak/Entra-SSO über user_saml / user_oidc).
 * 3. POST <endpoint> token=…  alle paar Sekunden: 404 = noch nicht fertig,
 *    200 = { server, loginName, appPassword } (einmalig abrufbar, Token läuft nach 20 min ab).
 * 4. Mit dem App-Passwort die echte Benutzer-ID abfragen (OCS cloud/user): bei SSO weicht
 *    der Login-Name (z. B. E-Mail) oft von der ID im WebDAV-Pfad ab.
 *
 * Ohne Electron-Abhängigkeit (fetch wird injiziert) → im Mock-Server-Test prüfbar.
 */
import { NetworkError, normalizeServerUrl, type FetchFn } from './webdav';

export interface LoginFlowStart {
  loginUrl: string;
  pollEndpoint: string;
  token: string;
}

export interface LoginFlowResult {
  serverUrl: string;
  loginName: string;
  appPassword: string;
}

export class LoginFlowCancelled extends Error {
  constructor() {
    super('Anmeldung abgebrochen.');
    this.name = 'LoginFlowCancelled';
  }
}

const isHttpUrl = (u: unknown): u is string => {
  if (typeof u !== 'string') return false;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
};

export async function startLoginFlow(serverUrl: string, fetchFn: FetchFn, userAgent: string): Promise<LoginFlowStart> {
  const base = normalizeServerUrl(serverUrl);
  let res;
  try {
    res = await fetchFn(`${base}/index.php/login/v2`, { method: 'POST', headers: { 'User-Agent': userAgent, Accept: 'application/json', 'OCS-APIRequest': 'true' } });
  } catch (err) {
    throw new NetworkError(`Server nicht erreichbar: ${(err as Error).message}`, err);
  }
  if (res.status === 404) throw new Error('Dieser Server unterstützt keine Browser-Anmeldung (Login Flow v2, ab Nextcloud 16). Bitte die URL prüfen oder ein App-Passwort verwenden.');
  if (res.status !== 200) throw new Error(`Browser-Anmeldung konnte nicht gestartet werden (HTTP ${res.status}).`);
  let data: { poll?: { token?: unknown; endpoint?: unknown }; login?: unknown };
  try {
    data = JSON.parse(await res.text());
  } catch {
    throw new Error('Unerwartete Antwort vom Server – ist das wirklich eine Nextcloud?');
  }
  const token = data.poll?.token;
  const endpoint = data.poll?.endpoint;
  if (typeof token !== 'string' || !token || !isHttpUrl(endpoint) || !isHttpUrl(data.login)) {
    throw new Error('Unerwartete Antwort vom Server (Login Flow v2).');
  }
  return { loginUrl: data.login, pollEndpoint: endpoint, token };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new LoginFlowCancelled());
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new LoginFlowCancelled());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

/** Fragt den Poll-Endpunkt ab, bis die Anmeldung im Browser abgeschlossen ist (max. 20 min). */
export async function pollLoginFlow(
  start: LoginFlowStart,
  fetchFn: FetchFn,
  userAgent: string,
  signal: AbortSignal,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<LoginFlowResult> {
  const interval = opts.intervalMs ?? 2000;
  const deadline = Date.now() + (opts.timeoutMs ?? 20 * 60_000);
  let networkFailures = 0;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new LoginFlowCancelled();
    let res;
    try {
      res = await fetchFn(start.pollEndpoint, {
        method: 'POST',
        headers: { 'User-Agent': userAgent, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: `token=${encodeURIComponent(start.token)}`,
      });
      networkFailures = 0;
    } catch (err) {
      // kurze Aussetzer (WLAN-Wechsel) tolerieren
      if (++networkFailures >= 10) throw new NetworkError(`Verbindung zum Server verloren: ${(err as Error).message}`, err);
      await sleep(interval, signal);
      continue;
    }
    if (res.status === 200) {
      const d = JSON.parse(await res.text()) as { server?: unknown; loginName?: unknown; appPassword?: unknown };
      if (!isHttpUrl(d.server) || typeof d.loginName !== 'string' || typeof d.appPassword !== 'string' || !d.loginName || !d.appPassword) {
        throw new Error('Unerwartete Antwort nach der Anmeldung.');
      }
      return { serverUrl: normalizeServerUrl(d.server), loginName: d.loginName, appPassword: d.appPassword };
    }
    if (res.status !== 404) throw new Error(`Anmeldung fehlgeschlagen (HTTP ${res.status}).`);
    await sleep(interval, signal);
  }
  throw new Error('Zeit abgelaufen – die Anmeldung im Browser wurde nicht innerhalb von 20 Minuten abgeschlossen.');
}

const basic = (user: string, pw: string) => `Basic ${Buffer.from(`${user}:${pw}`, 'utf8').toString('base64')}`;

/** Echte Benutzer-ID (für /remote.php/dav/files/<id>/). Fällt auf den Login-Namen zurück. */
export async function fetchUserId(serverUrl: string, loginName: string, appPassword: string, fetchFn: FetchFn): Promise<string> {
  try {
    const res = await fetchFn(`${normalizeServerUrl(serverUrl)}/ocs/v2.php/cloud/user?format=json`, {
      method: 'GET',
      headers: { Authorization: basic(loginName, appPassword), 'OCS-APIRequest': 'true', Accept: 'application/json' },
    });
    if (res.status !== 200) return loginName;
    const id = (JSON.parse(await res.text()) as { ocs?: { data?: { id?: unknown } } }).ocs?.data?.id;
    return typeof id === 'string' && id ? id : loginName;
  } catch {
    return loginName;
  }
}

/** Widerruft das App-Passwort auf dem Server (beim Trennen). Fehler werden ignoriert. */
export async function revokeAppPassword(serverUrl: string, loginName: string, appPassword: string, fetchFn: FetchFn): Promise<boolean> {
  try {
    const res = await fetchFn(`${normalizeServerUrl(serverUrl)}/ocs/v2.php/core/apppassword`, {
      method: 'DELETE',
      headers: { Authorization: basic(loginName, appPassword), 'OCS-APIRequest': 'true' },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
