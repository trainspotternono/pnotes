/** Einstellungen: Sprache (inkl. „Systemsprache automatisch verwenden“) und Darstellung. */
import { useSyncExternalStore } from 'react';
import { Check, Globe, Monitor } from 'lucide-react';
import { Modal } from '../components/ui';
import { detectSystemLang, getLangSetting, LANGUAGES, setLangSetting, t, useLang, type LangSetting } from '../i18n';

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openSettings() {
  open = true;
  emit();
}

function useOpen() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
  );
}

/** Global eingehängt (main.tsx): öffnet sich über openSettings() aus Bibliothek oder Editor. */
export function SettingsHost() {
  const isOpen = useOpen();
  useLang();
  if (!isOpen) return null;
  return <SettingsDialog onClose={() => ((open = false), emit())} />;
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const setting = getLangSetting();
  const system = detectSystemLang();
  const systemLabel = LANGUAGES.find((l) => l.id === system)?.label ?? system;
  const pick = (s: LangSetting) => setLangSetting(s);
  const row = (id: LangSetting, label: string, hint?: string, icon?: React.ReactNode) => (
    <button key={id} role="radio" aria-checked={setting === id} className={`lang-row${setting === id ? ' selected' : ''}`} onClick={() => pick(id)} data-testid={`lang-${id}`}>
      <span className="lang-icon">{icon}</span>
      <span className="lang-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {setting === id && <Check size={16} strokeWidth={2.4} />}
    </button>
  );
  return (
    <Modal
      title={t('Einstellungen')}
      onClose={onClose}
      width={460}
      testId="settings-dialog"
      footer={
        <button className="btn btn-primary" onClick={onClose} data-testid="settings-close">
          {t('Fertig')}
        </button>
      }
    >
      <div className="field">
        <span className="field-label">
          <Globe size={14} /> {t('Sprache')}
        </span>
        <div className="lang-list" role="radiogroup">
          {row('system', t('Systemsprache automatisch verwenden'), t('Erkannt: {lang}', { lang: systemLabel }), <Monitor size={16} />)}
          {LANGUAGES.map((l) => row(l.id, l.label, undefined, <span className="lang-code">{l.id.toUpperCase()}</span>))}
        </div>
        <p className="field-hint">{t('Die Sprache wird sofort übernommen und dauerhaft gespeichert. Andere Systemsprachen verwenden Englisch.')}</p>
      </div>
    </Modal>
  );
}
