import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpenedFile } from '../shared/types';
import { useToast } from './components/ui';
import { importNoahpalle } from './export/importDocument';
import { t } from './i18n';
import { api } from './lib/api';
import { patchNotebook, getNotebook } from './lib/library';
import { LibraryView, type LibraryLocation } from './library/LibraryView';
import { EditorView } from './editor/EditorView';
import { useLibrary } from './state/library';
import { useSync } from './state/sync';

export type ThemeSetting = 'system' | 'light' | 'dark';

type Route = { view: 'library' } | { view: 'editor'; notebookId: string };

function useTheme(): [ThemeSetting, (t: ThemeSetting) => void] {
  const [setting, setSetting] = useState<ThemeSetting>(() => (localStorage.getItem('pw.theme') as ThemeSetting) || 'system');
  useEffect(() => {
    let alive = true;
    api.setTheme(setting).then((effective) => {
      if (alive) document.documentElement.dataset.theme = effective;
    });
    try {
      localStorage.setItem('pw.theme', setting);
    } catch {
      /* optional */
    }
    const off = api.onSystemThemeChanged((t) => {
      if (setting === 'system') document.documentElement.dataset.theme = t;
    });
    return () => {
      alive = false;
      off();
    };
  }, [setting]);
  return [setting, setSetting];
}

/** `lang` nur, damit ein Sprachwechsel neu rendert. */
export function App(_props: { lang?: string }) {
  const { ready, lib, update } = useLibrary();
  const [theme, setTheme] = useTheme();
  const [route, setRoute] = useState<Route>({ view: 'library' });
  const [location, setLocation] = useState<LibraryLocation>({ section: 'documents', folderId: null });

  const sync = useSync();
  const autoSync = !!sync.config?.configured && !!sync.config.autoSync;
  const [opening, setOpening] = useState(false);

  const openNotebook = useCallback(
    async (id: string) => {
      // Auto-Sync beim Öffnen: aktuellen Stand holen, bevor der Editor lädt
      if (autoSync) {
        setOpening(true);
        await sync.run('open');
        setOpening(false);
      }
      update((l) => patchNotebook(l, id, { openedAt: Date.now() }));
      setRoute({ view: 'editor', notebookId: id });
    },
    [update, autoSync, sync],
  );

  const closeNotebook = useCallback(() => {
    setRoute({ view: 'library' });
    // Auto-Sync beim Schließen (der Editor hat vorher gespeichert)
    if (autoSync) void sync.run('close');
  }, [autoSync, sync]);

  // .pnotes per Doppelklick / „Öffnen mit“ / zweite Instanz: als Notizbuch übernehmen und öffnen
  const toast = useToast();
  const openDoc = useRef<(f: OpenedFile) => void>(() => undefined);
  openDoc.current = (f: OpenedFile) => {
    importNoahpalle(f, update, route.view === 'library' && location.section === 'documents' ? location.folderId : null)
      .then((id) => {
        toast(t('„{name}“ geöffnet', { name: f.name }));
        setRoute({ view: 'editor', notebookId: id });
      })
      .catch((e: Error) => toast(t('„{name}“ konnte nicht geöffnet werden: {error}', { name: f.name, error: e.message })));
  };
  useEffect(() => {
    if (!ready) return;
    const off = api.onOpenDocument((f) => openDoc.current(f));
    void api.takePendingDocuments().then((files) => files.forEach((f) => openDoc.current(f)));
    return off;
  }, [ready]);

  if (!ready) return <div className="boot" />;

  if (route.view === 'editor') {
    const meta = getNotebook(lib, route.notebookId);
    if (meta) {
      return <EditorView key={meta.id} meta={meta} onBack={closeNotebook} />;
    }
  }

  if (opening) {
    return (
      <div className="boot boot-sync">
        <span>{t('Synchronisiere …')}</span>
      </div>
    );
  }

  return <LibraryView location={location} onLocation={setLocation} onOpenNotebook={openNotebook} theme={theme} onTheme={setTheme} />;
}
