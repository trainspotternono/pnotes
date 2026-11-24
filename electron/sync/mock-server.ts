/**
 * Kleiner WebDAV-Server im Nextcloud-Stil – für automatische Tests und zum lokalen
 * Ausprobieren ohne echte Nextcloud:  npm run webdav:mock
 *   Server-URL:  http://127.0.0.1:8088   Benutzer: demo   App-Passwort: demo-demo-demo-demo-demo
 * Unterstützt: status.php, OPTIONS, PROPFIND (Depth 0/1), MKCOL, GET, PUT, DELETE,
 * ETag + getlastmodified, If-Match / If-None-Match (412), Basic-Auth (401). Daten nur im Speicher.
 * Browser-Anmeldung (Login Flow v2): POST /index.php/login/v2, Anmeldeseite /login/v2/flow/<token>
 * mit Button „Zugriff gewähren“, Poll-Endpunkt, OCS cloud/user und core/apppassword (DELETE).
 */
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

interface Node_ {
  dir: boolean;
  body: Buffer;
  etag: string;
  mtime: number;
}

export interface MockServer {
  url: string;
  files: Map<string, Node_>;
  close(): Promise<void>;
  /** Simuliert eine Änderung direkt auf dem Server (z. B. durch ein anderes Gerät). */
  write(path: string, body: string | Buffer): void;
  remove(path: string): void;
  /** Login Flow v2: Token → gewährt? */
  loginFlows: Map<string, { granted: boolean; userAgent: string }>;
  /** Anzahl widerrufener App-Passwörter (DELETE core/apppassword) */
  revoked: number;
}

const etagOf = (body: Buffer, t: number) => `"${createHash('md5').update(body).update(String(t)).digest('hex').slice(0, 16)}"`;

export function startMockServer(opts: { port?: number; user?: string; password?: string; loginName?: string } = {}): Promise<MockServer> {
  const user = opts.user ?? 'demo';
  const password = opts.password ?? 'demo-demo-demo-demo-demo';
  /** Login-Name bei SSO (z. B. E-Mail); WebDAV-Pfad nutzt weiterhin die ID `user` */
  const loginName = opts.loginName ?? user;
  const loginFlows = new Map<string, { granted: boolean; userAgent: string }>();
  const stats = { revoked: 0 };
  const prefix = `/remote.php/dav/files/${encodeURIComponent(user)}`;
  const files = new Map<string, Node_>([['/', { dir: true, body: Buffer.alloc(0), etag: '"root"', mtime: Date.now() }]]);
  let clock = Date.now();
  const tick = () => (clock = Math.max(clock + 1000, Date.now()));

  const norm = (p: string) => {
    const s = decodeURIComponent(p).replace(/\/+$/, '');
    return s || '/';
  };
  const parent = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';

  const write = (path: string, data: string | Buffer) => {
    const t = tick();
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    files.set(path, { dir: false, body, etag: etagOf(body, t), mtime: t });
  };
  const remove = (path: string) => {
    for (const k of [...files.keys()]) if (k === path || k.startsWith(`${path}/`)) files.delete(k);
  };

  const propXml = (path: string, n: Node_) => `<d:response><d:href>${prefix}${path.split('/').map(encodeURIComponent).join('/')}${n.dir && path !== '/' ? '/' : ''}</d:href><d:propstat><d:prop>${n.dir ? '<d:resourcetype><d:collection/></d:resourcetype>' : `<d:resourcetype/><d:getcontentlength>${n.body.length}</d:getcontentlength>`}<d:getetag>${n.etag}</d:getetag><d:getlastmodified>${new Date(n.mtime).toUTCString()}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/status.php') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ installed: true, maintenance: false, productname: 'Nextcloud (Mock)', versionstring: '30.0.0' }));
      return;
    }

    // ---- Login Flow v2
    const base = `http://${req.headers.host}`;
    if (req.method === 'POST' && url.pathname === '/index.php/login/v2') {
      const token = randomBytes(32).toString('hex');
      loginFlows.set(token, { granted: false, userAgent: String(req.headers['user-agent'] ?? '') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ poll: { token, endpoint: `${base}/login/v2/poll` }, login: `${base}/login/v2/flow/${token}` }));
      return;
    }
    const flowMatch = /^\/login\/v2\/(flow|grant)\/([0-9a-f]+)$/.exec(url.pathname);
    if (flowMatch) {
      const flow = loginFlows.get(flowMatch[2]);
      if (!flow) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Anmeldung abgelaufen.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (flowMatch[1] === 'grant' && req.method === 'POST') {
        flow.granted = true;
        res.end('<!doctype html><meta charset="utf-8"><title>Nextcloud (Mock)</title><body style="font-family:sans-serif;padding:3em"><h2>Konto verbunden</h2><p>Du kannst dieses Fenster schließen und zu pNotes zurückkehren.</p>');
      } else {
        res.end(`<!doctype html><meta charset="utf-8"><title>Nextcloud (Mock)</title><body style="font-family:sans-serif;padding:3em"><h2>Mit deinem Konto verbinden</h2><p>„${flow.userAgent.replace(/[<>&"]/g, '')}“ möchte auf dein Konto <b>${loginName}</b> zugreifen (simulierte SSO-Anmeldung).</p><form method="post" action="/login/v2/grant/${flowMatch[2]}"><button style="font-size:1.1em;padding:.5em 1.2em">Zugriff gewähren</button></form>`);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/login/v2/poll') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const token = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('token') ?? '';
        const flow = loginFlows.get(token);
        if (!flow?.granted) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end('[]');
          return;
        }
        loginFlows.delete(token); // nur einmal abrufbar
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ server: base, loginName, appPassword: password }));
      });
      return;
    }

    const auth = req.headers.authorization ?? '';
    const okAuth = [user, loginName].some((n) => auth === `Basic ${Buffer.from(`${n}:${password}`).toString('base64')}`);
    if (!okAuth) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Nextcloud"' });
      res.end();
      return;
    }
    if (url.pathname === '/ocs/v2.php/cloud/user' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ocs: { meta: { status: 'ok', statuscode: 200 }, data: { id: user, 'display-name': loginName } } }));
      return;
    }
    if (url.pathname === '/ocs/v2.php/core/apppassword' && req.method === 'DELETE') {
      stats.revoked++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ocs: { meta: { status: 'ok', statuscode: 200 }, data: [] } }));
      return;
    }
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const path = norm(url.pathname.slice(prefix.length) || '/');
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const node = files.get(path);
      const ifMatch = req.headers['if-match'];
      const ifNoneMatch = req.headers['if-none-match'];
      switch (req.method) {
        case 'OPTIONS':
          res.writeHead(200, { DAV: '1, 3, extended-mkcol', Allow: 'OPTIONS, GET, PUT, DELETE, PROPFIND, MKCOL' });
          res.end();
          return;
        case 'PROPFIND': {
          if (!node) {
            res.writeHead(404);
            res.end();
            return;
          }
          const depth = req.headers.depth === '0' ? 0 : 1;
          const parts = [propXml(path, node)];
          if (depth === 1 && node.dir) {
            for (const [k, n] of files) if (k !== path && parent(k) === path) parts.push(propXml(k, n));
          }
          res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
          res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${parts.join('')}</d:multistatus>`);
          return;
        }
        case 'MKCOL':
          if (node) {
            res.writeHead(405);
          } else if (!files.get(parent(path))?.dir) {
            res.writeHead(409);
          } else {
            files.set(path, { dir: true, body: Buffer.alloc(0), etag: `"d${tick()}"`, mtime: clock });
            res.writeHead(201);
          }
          res.end();
          return;
        case 'GET':
          if (!node || node.dir) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, { ETag: node.etag, 'Content-Type': path.endsWith('.pdf') ? 'application/pdf' : 'application/json' });
          res.end(node.body);
          return;
        case 'PUT':
          if (!files.get(parent(path))?.dir) {
            res.writeHead(409);
            res.end();
            return;
          }
          if ((ifMatch && (!node || node.etag !== ifMatch)) || (ifNoneMatch === '*' && node)) {
            res.writeHead(412);
            res.end();
            return;
          }
          write(path, body);
          res.writeHead(node ? 204 : 201, { ETag: files.get(path)!.etag });
          res.end();
          return;
        case 'DELETE':
          if (!node) {
            res.writeHead(404);
            res.end();
            return;
          }
          if (ifMatch && node.etag !== ifMatch) {
            res.writeHead(412);
            res.end();
            return;
          }
          remove(path);
          res.writeHead(204);
          res.end();
          return;
        default:
          res.writeHead(405);
          res.end();
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        files,
        write,
        remove,
        loginFlows,
        get revoked() {
          return stats.revoked;
        },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// Direkt gestartet: als Test-Server für die App
if (typeof require !== 'undefined' && require.main === module) {
  void startMockServer({ port: Number(process.env.PORT) || 8088 }).then((s) => {
    console.log(`WebDAV-Mock (Nextcloud-kompatibel) läuft:\n  Server-URL:   ${s.url}\n  Benutzer:     demo\n  App-Passwort: demo-demo-demo-demo-demo\n  „Im Browser anmelden (SSO)“ funktioniert ebenfalls (Mock-Anmeldeseite → „Zugriff gewähren“).\n  Daten nur im Arbeitsspeicher – Strg+C beendet.`);
  });
}
