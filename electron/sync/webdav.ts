/**
 * Minimaler WebDAV-Client für Nextcloud (PROPFIND, MKCOL, GET, PUT, DELETE, OPTIONS).
 * Ohne Electron-Abhängigkeit: die fetch-Funktion wird injiziert (Electron: net.fetch,
 * Tests: Node-fetch gegen einen Mock-Server).
 */
import { BRAND } from '../../shared/brand';

export interface FetchResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }) => Promise<FetchResponseLike>;

export class WebDavError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'WebDavError';
  }
}

/** Netzwerkfehler (Server nicht erreichbar, DNS, TLS, Zeitüberschreitung). */
export class NetworkError extends Error {
  constructor(message: string, readonly original?: unknown) {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface DavEntry {
  href: string;
  name: string;
  isCollection: boolean;
  etag: string | null;
  lastModified: number | null;
  size: number | null;
}

/** Nextcloud-WebDAV-Wurzel des Benutzers: <server>/remote.php/dav/files/<user> */
export function davRootUrl(serverUrl: string, username: string): string {
  return `${normalizeServerUrl(serverUrl)}/remote.php/dav/files/${encodeURIComponent(username)}`;
}

/** Entfernt Schrägstriche am Ende sowie versehentlich mitkopierte Pfade (/index.php, /remote.php, /apps …). */
export function normalizeServerUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  const url = new URL(u);
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/(index\.php|remote\.php|apps|login|ocs|status\.php)(\/.*)?$/i, '');
  return `${url.protocol}//${url.host}${path}`;
}

/** Zielordner normalisieren: führender Schrägstrich, keine Endung, kein „..“. */
export function normalizeFolder(input: string): string {
  const parts = input
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) throw new Error('Der Zielordner darf kein „..“ enthalten.');
  return `/${parts.join('/') || BRAND.syncFolder}`;
}

export const encodePath = (path: string) =>
  path
    .split('/')
    .map((s) => (s ? encodeURIComponent(s) : s))
    .join('/');

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
}

const tag = (name: string) => new RegExp(`<(?:[A-Za-z0-9_-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${name}>`, 'i');

/** Parst eine WebDAV-Multistatus-Antwort (Namespace-Präfix egal: d:, D:, ohne). */
export function parseMultistatus(xml: string): DavEntry[] {
  const out: DavEntry[] = [];
  const responseRe = /<(?:[A-Za-z0-9_-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?response>/gi;
  let m: RegExpExecArray | null;
  while ((m = responseRe.exec(xml))) {
    const block = m[1];
    const hrefRaw = tag('href').exec(block)?.[1]?.trim();
    if (!hrefRaw) continue;
    // nur Eigenschaften aus propstat-Blöcken mit Status 200
    const propstats = [...block.matchAll(/<(?:[A-Za-z0-9_-]+:)?propstat\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?propstat>/gi)].map((x) => x[1]);
    const ok = propstats.filter((p) => /HTTP\/[\d.]+\s+200/i.test(tag('status').exec(p)?.[1] ?? 'HTTP/1.1 200')).join('\n') || block;
    const href = decodeXml(hrefRaw);
    let decoded = href;
    try {
      decoded = decodeURIComponent(href);
    } catch {
      /* bereits dekodiert */
    }
    const name = decoded.replace(/\/+$/, '').split('/').pop() ?? '';
    const etag = tag('getetag').exec(ok)?.[1]?.trim();
    const lm = tag('getlastmodified').exec(ok)?.[1]?.trim();
    const size = tag('getcontentlength').exec(ok)?.[1]?.trim();
    const rt = tag('resourcetype').exec(ok)?.[1] ?? '';
    out.push({
      href: decoded,
      name,
      isCollection: /<(?:[A-Za-z0-9_-]+:)?collection\b/i.test(rt),
      etag: etag ? decodeXml(etag) : null,
      lastModified: lm ? Date.parse(lm) || null : null,
      size: size ? Number(size) : null,
    });
  }
  return out;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>`;

function describeNetworkError(err: unknown): string {
  const e = err as { message?: string; code?: string; cause?: { code?: string; message?: string } };
  const text = `${e?.code ?? ''} ${e?.cause?.code ?? ''} ${e?.message ?? ''} ${e?.cause?.message ?? ''}`;
  if (/ENOTFOUND|NAME_NOT_RESOLVED|EAI_AGAIN/i.test(text)) return 'Server nicht gefunden (DNS). Bitte die Server-URL prüfen.';
  if (/ECONNREFUSED|CONNECTION_REFUSED/i.test(text)) return 'Verbindung abgelehnt. Läuft der Server und stimmt der Port?';
  if (/CERT|SSL|TLS|self.signed|UNABLE_TO_VERIFY/i.test(text)) return 'TLS-Zertifikat ungültig oder nicht vertrauenswürdig.';
  if (/TIMED?_?OUT|Timeout|aborted/i.test(text)) return 'Zeitüberschreitung – der Server antwortet nicht.';
  if (/INTERNET_DISCONNECTED|ENETUNREACH|NETWORK_CHANGED/i.test(text)) return 'Keine Internetverbindung.';
  return `Netzwerkfehler: ${e?.message ?? String(err)}`;
}

export class WebDavClient {
  private readonly auth: string;

  constructor(
    /** volle URL der Benutzer-Wurzel, ohne abschließenden Schrägstrich */
    readonly root: string,
    username: string,
    password: string,
    private readonly fetchFn: FetchFn,
  ) {
    this.auth = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
  }

  url(path: string): string {
    return this.root + encodePath(path.startsWith('/') ? path : `/${path}`);
  }

  async request(method: string, path: string, headers: Record<string, string> = {}, body?: string | Uint8Array): Promise<FetchResponseLike> {
    try {
      return await this.fetchFn(this.url(path), {
        method,
        headers: { Authorization: this.auth, 'OCS-APIRequest': 'true', ...headers },
        body,
      });
    } catch (err) {
      throw new NetworkError(describeNetworkError(err), err);
    }
  }

  private fail(res: FetchResponseLike, what: string): never {
    const hint =
      res.status === 401
        ? 'Anmeldung fehlgeschlagen – Benutzername oder App-Passwort falsch.'
        : res.status === 403
          ? 'Zugriff verweigert.'
          : res.status === 404
            ? 'Nicht gefunden.'
            : res.status === 412
              ? 'Datei wurde zwischenzeitlich auf dem Server geändert.'
              : res.status === 423
                ? 'Datei ist auf dem Server gesperrt.'
                : res.status === 507
                  ? 'Kein Speicherplatz mehr auf dem Server.'
                  : res.status === 503
                    ? 'Server nicht verfügbar (Wartungsmodus?).'
                    : `HTTP ${res.status}`;
    throw new WebDavError(res.status, `${what}: ${hint}`);
  }

  async propfind(path: string, depth: 0 | 1): Promise<DavEntry[]> {
    const res = await this.request('PROPFIND', path, { Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' }, PROPFIND_BODY);
    if (res.status !== 207 && res.status !== 200) this.fail(res, `PROPFIND ${path}`);
    return parseMultistatus(await res.text());
  }

  /** Einträge eines Ordners (ohne den Ordner selbst); fehlender Ordner = leere Liste. */
  async list(path: string): Promise<DavEntry[]> {
    try {
      const entries = await this.propfind(path.endsWith('/') ? path : `${path}/`, 1);
      const self = path.replace(/\/+$/, '').split('/').pop();
      return entries.filter((e, i) => !(i === 0 && e.isCollection && e.name === self));
    } catch (err) {
      if (err instanceof WebDavError && err.status === 404) return [];
      throw err;
    }
  }

  async stat(path: string): Promise<DavEntry | null> {
    try {
      return (await this.propfind(path, 0))[0] ?? null;
    } catch (err) {
      if (err instanceof WebDavError && err.status === 404) return null;
      throw err;
    }
  }

  async mkcol(path: string): Promise<void> {
    const res = await this.request('MKCOL', path.endsWith('/') ? path : `${path}/`);
    if (res.status === 201 || res.status === 405) return; // 405 = existiert bereits
    this.fail(res, `MKCOL ${path}`);
  }

  /** Legt alle fehlenden Ordner eines Pfades an. */
  async ensureDir(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur += `/${p}`;
      const st = await this.stat(cur);
      if (!st) await this.mkcol(cur);
      else if (!st.isCollection) throw new WebDavError(409, `${cur} ist eine Datei, kein Ordner.`);
    }
  }

  async get(path: string): Promise<{ text: string; etag: string | null }> {
    const res = await this.request('GET', path);
    if (res.status !== 200) this.fail(res, `GET ${path}`);
    return { text: await res.text(), etag: res.headers.get('etag') ?? res.headers.get('oc-etag') };
  }

  /** PUT mit optionaler Bedingung; liefert das neue ETag (falls der Server es meldet). */
  async put(path: string, body: string, cond: { ifMatch?: string | null; ifNoneMatch?: boolean } = {}): Promise<string | null> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
    if (cond.ifMatch) headers['If-Match'] = cond.ifMatch;
    if (cond.ifNoneMatch) headers['If-None-Match'] = '*';
    const res = await this.request('PUT', path, headers, body);
    if (res.status !== 200 && res.status !== 201 && res.status !== 204) this.fail(res, `PUT ${path}`);
    return res.headers.get('etag') ?? res.headers.get('oc-etag');
  }

  /** Binärdatei laden (PDF-Assets). */
  async getBinary(path: string): Promise<Uint8Array> {
    const res = await this.request('GET', path);
    if (res.status !== 200) this.fail(res, `GET ${path}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Binärdatei hochladen; `ifNoneMatch` verhindert das Überschreiben vorhandener Dateien. */
  async putBinary(path: string, data: Uint8Array, contentType: string, ifNoneMatch = false): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': contentType };
    if (ifNoneMatch) headers['If-None-Match'] = '*';
    const res = await this.request('PUT', path, headers, data);
    if (res.status === 412 && ifNoneMatch) return; // existiert bereits (gleicher Inhalt, da inhaltsadressiert)
    if (res.status !== 200 && res.status !== 201 && res.status !== 204) this.fail(res, `PUT ${path}`);
  }

  async delete(path: string, ifMatch?: string | null): Promise<void> {
    const res = await this.request('DELETE', path, ifMatch ? { 'If-Match': ifMatch } : {});
    if (res.status === 204 || res.status === 200 || res.status === 404) return;
    this.fail(res, `DELETE ${path}`);
  }

  async options(path: string): Promise<string | null> {
    const res = await this.request('OPTIONS', path);
    return res.headers.get('dav');
  }
}

/** Volle WebDAV-URL eines beliebigen Servers: https ergänzen, Schrägstrich am Ende entfernen, Pfad behalten. */
export function normalizeDavUrl(input: string): string {
  let u = input.trim();
  if (!u) throw new Error('Bitte die WebDAV-Adresse angeben.');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  const url = new URL(u);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

/** „Verbindung testen“ für einen beliebigen WebDAV-Server (Synology, ownCloud, Apache, IONOS HiDrive, …). */
export async function testWebDav(url: string, username: string, password: string, folder: string, fetchFn: FetchFn): Promise<{ ok: boolean; message: string; details: string[] }> {
  const details: string[] = [];
  let root: string;
  let target: string;
  try {
    root = normalizeDavUrl(url);
    target = normalizeFolder(folder);
  } catch (e) {
    return { ok: false, message: `Ungültige Eingabe: ${(e as Error).message}`, details };
  }
  if (root.startsWith('http://') && !/\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(root)) details.push('Warnung: unverschlüsselte Verbindung (http). Für echte Server bitte https verwenden.');
  const dav = new WebDavClient(root, username.trim(), password, fetchFn);
  try {
    await dav.propfind('/', 0);
    details.push(`WebDAV-Anmeldung${username.trim() ? ` als „${username.trim()}“` : ''} erfolgreich.`);
  } catch (err) {
    if (err instanceof WebDavError && err.status === 401) return { ok: false, message: 'Anmeldung fehlgeschlagen (401): Benutzername oder Passwort falsch.', details };
    if (err instanceof WebDavError && (err.status === 404 || err.status === 405)) return { ok: false, message: `Unter dieser Adresse antwortet kein WebDAV (HTTP ${err.status}). Bitte die vollständige WebDAV-URL angeben.`, details };
    return { ok: false, message: (err as Error).message, details };
  }
  try {
    const st = await dav.stat(target);
    if (!st) details.push(`Zielordner ${target} existiert noch nicht und wird beim ersten Sync angelegt.`);
    else if (!st.isCollection) return { ok: false, message: `${target} ist eine Datei, kein Ordner.`, details };
    else details.push(`Zielordner ${target} vorhanden.`);
  } catch (err) {
    return { ok: false, message: (err as Error).message, details };
  }
  return { ok: true, message: 'Verbindung erfolgreich.', details };
}

/**
 * „Verbindung testen“: status.php (Server erkannt?), PROPFIND auf die Benutzer-Wurzel
 * (Anmeldung), OPTIONS (WebDAV-Fähigkeiten), PROPFIND auf den Zielordner.
 */
export async function testConnection(
  serverUrl: string,
  username: string,
  password: string,
  folder: string,
  fetchFn: FetchFn,
  /** Login-Name für die Anmeldung, falls abweichend von der Benutzer-ID (SSO) */
  loginName?: string,
): Promise<{ ok: boolean; message: string; details: string[] }> {
  const details: string[] = [];
  let base: string;
  let target: string;
  try {
    base = normalizeServerUrl(serverUrl);
    target = normalizeFolder(folder);
  } catch (e) {
    return { ok: false, message: `Ungültige Eingabe: ${(e as Error).message}`, details };
  }
  if (!username.trim()) return { ok: false, message: 'Bitte einen Benutzernamen angeben.', details };
  if (!password) return { ok: false, message: 'Bitte ein App-Passwort angeben.', details };
  if (base.startsWith('http://') && !/\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(base)) {
    details.push('Warnung: unverschlüsselte Verbindung (http). Für echte Server bitte https verwenden.');
  }

  // 1) Server erkennen
  try {
    const res = await fetchFn(`${base}/status.php`, { method: 'GET', headers: { Accept: 'application/json' } });
    if (res.status === 200) {
      const info = JSON.parse(await res.text()) as { productname?: string; versionstring?: string; maintenance?: boolean; installed?: boolean };
      if (info.maintenance) return { ok: false, message: 'Der Nextcloud-Server ist im Wartungsmodus.', details };
      details.push(`Server erkannt: ${info.productname ?? 'Nextcloud'} ${info.versionstring ?? ''}`.trim());
    } else {
      details.push(`status.php nicht verfügbar (HTTP ${res.status}) – evtl. kein Nextcloud-Server oder falscher Pfad.`);
    }
  } catch (err) {
    return { ok: false, message: describeNetworkError(err), details };
  }

  // 2) Anmeldung + WebDAV-Wurzel
  const dav = new WebDavClient(davRootUrl(base, username.trim()), loginName || username.trim(), password, fetchFn);
  try {
    await dav.propfind('/', 0);
    details.push(`WebDAV-Anmeldung als „${username.trim()}“ erfolgreich.`);
  } catch (err) {
    if (err instanceof WebDavError) {
      if (err.status === 401)
        return { ok: false, message: 'Anmeldung fehlgeschlagen (401): Benutzername oder App-Passwort falsch. Bei aktivierter Zwei-Faktor-Anmeldung ist ein App-Passwort zwingend.', details };
      if (err.status === 404) return { ok: false, message: 'WebDAV-Endpunkt nicht gefunden (404). Bitte nur die Basis-URL angeben, z. B. https://cloud.example.com', details };
      return { ok: false, message: err.message, details };
    }
    return { ok: false, message: (err as Error).message, details };
  }

  // 3) WebDAV-Fähigkeiten
  try {
    const davHeader = await dav.options('/');
    if (davHeader) details.push(`WebDAV-Klassen: ${davHeader}`);
  } catch {
    /* optional */
  }

  // 4) Zielordner
  try {
    const st = await dav.stat(target);
    if (!st) details.push(`Zielordner ${target} existiert noch nicht und wird beim ersten Sync angelegt.`);
    else if (!st.isCollection) return { ok: false, message: `${target} ist eine Datei, kein Ordner.`, details };
    else details.push(`Zielordner ${target} vorhanden.`);
  } catch (err) {
    return { ok: false, message: (err as Error).message, details };
  }
  return { ok: true, message: 'Verbindung erfolgreich.', details };
}
