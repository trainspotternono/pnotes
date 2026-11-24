/** Browser-Anmeldung (Login Flow v2) gegen den Nextcloud-Mock – inkl. SSO-Login-Name ≠ Benutzer-ID. */
import { afterEach, describe, expect, it } from 'vitest';
import { LoginFlowCancelled, fetchUserId, pollLoginFlow, revokeAppPassword, startLoginFlow } from './loginflow';
import { startMockServer, type MockServer } from './mock-server';
import { testConnection, type FetchFn } from './webdav';

const fetchFn: FetchFn = async (url, init) => {
  const r = await fetch(url, init);
  return { status: r.status, headers: r.headers, text: () => r.text(), arrayBuffer: () => r.arrayBuffer() };
};
const UA = 'pNotes/test (Windows)';
const PASS = 'ssoAp-pPass-word0-12345-abcde';

let server: MockServer;
afterEach(async () => server?.close());

describe('Login Flow v2', () => {
  it('liefert nach „Zugriff gewähren“ App-Passwort, Login-Name und echte Benutzer-ID', async () => {
    server = await startMockServer({ user: 'a1b2-uuid', loginName: 'anna@example.com', password: PASS });
    const start = await startLoginFlow(`${server.url}/index.php/apps/files`, fetchFn, UA);
    expect(start.loginUrl).toContain('/login/v2/flow/');
    expect(server.loginFlows.get(start.token)?.userAgent).toBe(UA);

    // Anmeldeseite wie im Browser öffnen und bestätigen
    const page = await fetch(start.loginUrl);
    expect(await page.text()).toContain('Zugriff gewähren');
    const ctrl = new AbortController();
    const polling = pollLoginFlow(start, fetchFn, UA, ctrl.signal, { intervalMs: 20 });
    await new Promise((r) => setTimeout(r, 60)); // erst ein paar 404-Polls
    await fetch(start.loginUrl.replace('/flow/', '/grant/'), { method: 'POST' });
    const result = await polling;
    expect(result).toEqual({ serverUrl: server.url, loginName: 'anna@example.com', appPassword: PASS });

    const id = await fetchUserId(result.serverUrl, result.loginName, result.appPassword, fetchFn);
    expect(id).toBe('a1b2-uuid');

    // WebDAV: Pfad mit ID, Anmeldung mit Login-Name
    const t = await testConnection(result.serverUrl, id, result.appPassword, '/pNotes-Sync', fetchFn, result.loginName);
    expect(t.ok).toBe(true);

    expect(await revokeAppPassword(result.serverUrl, result.loginName, result.appPassword, fetchFn)).toBe(true);
    expect(server.revoked).toBe(1);
  });

  it('lässt sich abbrechen und läuft ab', async () => {
    server = await startMockServer();
    const start = await startLoginFlow(server.url, fetchFn, UA);
    const ctrl = new AbortController();
    const p = pollLoginFlow(start, fetchFn, UA, ctrl.signal, { intervalMs: 20 });
    setTimeout(() => ctrl.abort(), 50);
    await expect(p).rejects.toBeInstanceOf(LoginFlowCancelled);

    await expect(pollLoginFlow(start, fetchFn, UA, new AbortController().signal, { intervalMs: 10, timeoutMs: 40 })).rejects.toThrow(/Zeit abgelaufen/);
  });

  it('meldet Server ohne Login Flow verständlich', async () => {
    server = await startMockServer();
    await expect(startLoginFlow(`${server.url}/kein-nextcloud`, fetchFn, UA)).rejects.toThrow(/Login Flow v2|HTTP/);
  });
});
