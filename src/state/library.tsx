import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LibraryData } from '../../shared/types';
import { api } from '../lib/api';
import { emptyLibrary, normalizeLibrary } from '../lib/library';
import { t } from '../i18n';

interface LibraryCtx {
  lib: LibraryData;
  ready: boolean;
  error: string | null;
  /** Wendet eine reine Änderung an und speichert verzögert. */
  update: (fn: (lib: LibraryData) => LibraryData) => void;
  deleteNotebookFiles: (ids: string[]) => void;
  /**
   * Für den Sync: speichert sofort und sperrt die Bibliothek. Änderungen während der
   * Sperre werden gesammelt und nach `unlockAndReload` auf den neu geladenen Stand angewendet.
   */
  lockForSync: () => Promise<void>;
  unlockAndReload: (reload: boolean) => Promise<void>;
  locked: boolean;
}

const Ctx = createContext<LibraryCtx | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [lib, setLib] = useState<LibraryData>(emptyLibrary);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const latest = useRef(lib);
  const lockedRef = useRef(false);
  const queued = useRef<((lib: LibraryData) => LibraryData)[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .loadLibrary()
      .then((data) => {
        if (!alive) return;
        const normalized = normalizeLibrary(data);
        latest.current = normalized;
        setLib(normalized);
        setReady(true);
      })
      .catch((err: Error) => {
        setError(t('Bibliothek konnte nicht geladen werden: {error}', { error: err.message }));
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const saveNow = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    try {
      await api.saveLibrary(latest.current);
    } catch (err) {
      setError(t('Speichern fehlgeschlagen: {error}', { error: (err as Error).message }));
    }
  }, []);

  const update = useCallback(
    (fn: (lib: LibraryData) => LibraryData) => {
      if (lockedRef.current) queued.current.push(fn);
      const next = fn(latest.current);
      if (next === latest.current) return;
      latest.current = next;
      setLib(next);
      if (lockedRef.current) return; // wird nach dem Sync gespeichert
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void saveNow(), 250);
    },
    [saveNow],
  );

  const lockForSync = useCallback(async () => {
    await saveNow();
    lockedRef.current = true;
    queued.current = [];
    setLocked(true);
  }, [saveNow]);

  const unlockAndReload = useCallback(
    async (reload: boolean) => {
      const pending = queued.current;
      queued.current = [];
      if (reload) {
        try {
          let next = normalizeLibrary(await api.loadLibrary());
          for (const fn of pending) next = fn(next); // während des Syncs gemachte Änderungen erneut anwenden
          latest.current = next;
          setLib(next);
        } catch (err) {
          setError(t('Bibliothek konnte nicht neu geladen werden: {error}', { error: (err as Error).message }));
        }
      }
      lockedRef.current = false;
      setLocked(false);
      if (pending.length || reload) await saveNow();
    },
    [saveNow],
  );

  useEffect(() => {
    const onUnload = () => {
      if (saveTimer.current !== undefined) void saveNow();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [saveNow]);

  const deleteNotebookFiles = useCallback((ids: string[]) => {
    for (const id of ids) api.deleteNotebook(id).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ lib, ready, error, update, deleteNotebookFiles, lockForSync, unlockAndReload, locked }),
    [lib, ready, error, update, deleteNotebookFiles, lockForSync, unlockAndReload, locked],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLibrary(): LibraryCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLibrary außerhalb von LibraryProvider');
  return v;
}
