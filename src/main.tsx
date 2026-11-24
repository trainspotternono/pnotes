import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastProvider } from './components/ui';
import { useLang } from './i18n';
import { SettingsHost } from './settings/SettingsDialog';
import { LibraryProvider } from './state/library';
import { SyncProvider } from './state/sync';
import { SyncDialogs } from './sync/SyncUi';
import './styles/tokens.css';
import './styles/app.css';

/** Bei Sprachwechsel rendert der ganze Baum neu (Zustand wie geöffnetes Notizbuch bleibt erhalten). */
function Root() {
  const lang = useLang();
  useEffect(() => window.papierwerk?.setLanguage?.(lang), [lang]);
  return (
    <LibraryProvider>
      <ToastProvider>
        <SyncProvider>
          <App lang={lang} />
          <SyncDialogs />
          <SettingsHost />
        </SyncProvider>
      </ToastProvider>
    </LibraryProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
