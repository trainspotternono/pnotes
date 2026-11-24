import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { t } from '../i18n';

// ------------------------------------------------------------------ Modal

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 440,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  testId?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ width }} data-testid={testId}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('Schließen')} data-testid="dialog-close">
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function PromptDialog({
  title,
  label,
  initial = '',
  confirmLabel = 'OK', // Aufrufer übergeben bereits übersetzte Beschriftungen
  validate,
  onConfirm,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | null;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const error = value.trim() ? (validate?.(value) ?? null) : null;
  const canSubmit = value.trim().length > 0 && !error;
  const submit = () => {
    if (!canSubmit) return;
    onConfirm(value.trim());
    onClose();
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} data-testid="dialog-cancel">
            {t('Abbrechen')}
          </button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={submit} data-testid="prompt-confirm">
            {confirmLabel}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">{label}</span>
        <input
          ref={inputRef}
          className="input"
          value={value}
          maxLength={120}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          data-testid="prompt-input"
        />
        {error && <span className="field-error">{error}</span>}
      </label>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} data-testid="dialog-cancel">
            {t('Abbrechen')}
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
            data-testid="confirm-ok"
            autoFocus
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="modal-text">{message}</p>
    </Modal>
  );
}

// ------------------------------------------------------------------ Menüs

export type MenuItem =
  | {
      id: string;
      label: string;
      icon?: ReactNode;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      shortcut?: string;
      onSelect: () => void;
    }
  | 'separator';

export function Menu({ x, y, items, onClose, align = 'start' }: { x: number; y: number; items: MenuItem[]; onClose: () => void; align?: 'start' | 'end' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = align === 'end' ? x - r.width : x;
    let top = y;
    if (left + r.width > window.innerWidth - 8) left = window.innerWidth - r.width - 8;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height);
    setPos({ left: Math.max(8, left), top });
  }, [x, y, align]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const id = window.setTimeout(() => {
      window.addEventListener('mousedown', onDown);
      window.addEventListener('contextmenu', onDown);
    });
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('contextmenu', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="menu" role="menu" style={pos}>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={`sep-${i}`} className="menu-sep" />
        ) : (
          <button
            key={item.id}
            role="menuitem"
            className={`menu-item${item.danger ? ' danger' : ''}${item.checked ? ' checked' : ''}`}
            disabled={item.disabled}
            data-testid={`ctx-${item.id}`}
            title={item.label}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span className="menu-icon">{item.icon}</span>
            <span className="menu-label">{item.label}</span>
            {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Zustand für ein an einem Element oder Punkt verankertes Menü. */
export function useMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; align?: 'start' | 'end' } | null>(null);
  const openAt = useCallback((x: number, y: number, align?: 'start' | 'end') => setMenu({ x, y, align }), []);
  const openBelow = useCallback((el: HTMLElement, align: 'start' | 'end' = 'start') => {
    const r = el.getBoundingClientRect();
    setMenu({ x: align === 'end' ? r.right : r.left, y: r.bottom + 4, align });
  }, []);
  const close = useCallback(() => setMenu(null), []);
  return { menu, openAt, openBelow, close };
}

/** Frei gestaltbares Popover unter einem Element. */
export function Popover({ anchor, onClose, children, testId }: { anchor: DOMRect; onClose: () => void; children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 6 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = anchor.left + anchor.width / 2 - r.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
    setPos({ left, top: anchor.bottom + 6 });
  }, [anchor]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const id = window.setTimeout(() => window.addEventListener('pointerdown', onDown));
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="popover" style={pos} data-testid={testId}>
      {children}
    </div>,
    document.body,
  );
}

export function Toggle({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <button role="switch" aria-checked={checked} className={`toggle${checked ? ' on' : ''}`} onClick={() => onChange(!checked)} data-testid={testId}>
        <span />
      </button>
    </label>
  );
}

// --------------------------------------------------------------- Segmented

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" data-testid={testId}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? 'active' : ''} onClick={() => onChange(o.id)} data-value={o.id}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Toasts

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
const ToastCtx = createContext<(text: string, action?: Toast['action']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, action }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              <span>{t.text}</span>
              {t.action && (
                <button
                  className="toast-action"
                  onClick={() => {
                    t.action!.run();
                    setToasts((all) => all.filter((x) => x.id !== t.id));
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
