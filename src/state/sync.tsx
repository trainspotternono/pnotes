import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DeletionDecision, PendingDeletion, SyncConfigInput, SyncConfigPublic, SyncResult, SyncSsoInput, SyncTestResult } from '../../shared/types';
import { useToast } from '../components/ui';
import { api } from '../lib/api';
import { useLibrary } from './library';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

interface SyncCtx {
  config: SyncConfigPublic | null;
  status: SyncStatus;
  lastResult: SyncResult | null;
  pending: PendingDeletion[];
  /** Startet einen Abgleich (wenn eingerichtet). `reason` nur für die Anzeige. */
  run: (reason?: 'manual' | 'open' | 'close' | 'online') => Promise<SyncResult | null>;
  resolve: (decisions: DeletionDecision[]) => Promise<void>;
  saveConfig: (input: SyncConfigInput) => Promise<SyncConfigPublic>;
  clearConfig: () => Promise<void>;
  test: (input: SyncConfigInput) => Promise<SyncTestResult>;
  /** Browser-Anmeldung (SSO) – löst auf, sobald die Anmeldung im Browser abgeschlossen ist. */
  ssoLogin: (input: SyncSsoInput) => Promise<SyncConfigPublic>;
  ssoCancel: () => Promise<void>;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
}

const Ctx = createContext<SyncCtx | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { lockForSync, unlockAndReload } = useLibrary();
  const toast = useToast();
  const [config, setConfig] = useState<SyncConfigPublic | null>(null);
  const [status, setStatus] = useState<SyncStatus>('off');
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [pending, setPending] = useState<PendingDeletion[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const running = useRef<Promise<SyncResult | null> | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    api
      .syncGetConfig()
      .then((c) => {
        setConfig(c);
        setStatus(c.configured ? 'idle' : 'off');
      })
      .catch(() => setStatus('off'));
  }, []);

  const applyResult = useCallback(
    (r: SyncResult) => {
      setLastResult(r);
      setStatus(r.offline ? 'offline' : r.ok ? 'idle' : 'error');
      if (r.pendingDeletions.length) setPending(r.pendingDeletions);
      for (const c of r.conflicts) toast(c);
      if (r.conflicts.length === 0 && r.notices.length) toast(r.notices[0]);
      setConfig((c) => (c ? { ...c, lastSyncAt: r.ok ? r.finishedAt : c.lastSyncAt } : c));
    },
    [toast],
  );

  const guarded = useCallback(
    async (call: () => Promise<SyncResult>): Promise<SyncResult | null> => {
      if (running.current) return running.current;
      const job = (async () => {
        setStatus('syncing');
        await lockForSync();
        let result: SyncResult | null = null;
        try {
          result = await call();
          return result;
        } catch (err) {
          setStatus('error');
          setLastResult({ ok: false, offline: false, uploaded: 0, downloaded: 0, deletedRemote: 0, deletedLocal: 0, conflicts: [], notices: [], errors: [(err as Error).message], pendingDeletions: [], changedLocal: false, finishedAt: Date.now() });
          return null;
        } finally {
          await unlockAndReload(!!result?.changedLocal);
          if (result) applyResult(result);
        }
      })();
      running.current = job;
      try {
        return await job;
      } finally {
        running.current = null;
      }
    },
    [lockForSync, unlockAndReload, applyResult],
  );

  const run = useCallback(
    async (reason: 'manual' | 'open' | 'close' | 'online' = 'manual') => {
      const c = configRef.current;
      if (!c?.configured) {
        if (reason === 'manual') setSettingsOpen(true);
        return null;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setStatus('offline');
        return null;
      }
      return guarded(() => api.syncRun());
    },
    [guarded],
  );

  const resolve = useCallback(
    async (decisions: DeletionDecision[]) => {
      setPending([]);
      await guarded(() => api.syncResolveDeletions(decisions));
    },
    [guarded],
  );

  // Wieder online → nachholen
  useEffect(() => {
    const onOnline = () => {
      if (configRef.current?.configured) void run('online');
    };
    const onOffline = () => configRef.current?.configured && setStatus('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [run]);

  const saveConfig = useCallback(async (input: SyncConfigInput) => {
    const c = await api.syncSaveConfig(input);
    configRef.current = c; // sofort, damit ein direkt folgendes run() die neue Konfiguration sieht
    setConfig(c);
    setStatus(c.configured ? 'idle' : 'off');
    return c;
  }, []);

  const clearConfig = useCallback(async () => {
    const c = await api.syncClearConfig();
    setConfig(c);
    setStatus('off');
    setLastResult(null);
    setPending([]);
  }, []);

  const test = useCallback((input: SyncConfigInput) => api.syncTest(input), []);

  const ssoLogin = useCallback(async (input: SyncSsoInput) => {
    const c = await api.syncSsoLogin(input);
    configRef.current = c;
    setConfig(c);
    setStatus(c.configured ? 'idle' : 'off');
    return c;
  }, []);

  const ssoCancel = useCallback(() => api.syncSsoCancel(), []);

  const value = useMemo(
    () => ({ config, status, lastResult, pending, run, resolve, saveConfig, clearConfig, test, ssoLogin, ssoCancel, settingsOpen, setSettingsOpen }),
    [config, status, lastResult, pending, run, resolve, saveConfig, clearConfig, test, ssoLogin, ssoCancel, settingsOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSync(): SyncCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSync außerhalb von SyncProvider');
  return v;
}
