/**
 * Zeigt an, wenn der Stift über einen gedrückten Knopf ein anderes Werkzeug benutzt
 * (Radiertaste / Radierer-Ende → Radierer, Seitentaste → Auswählen):
 *  - ein Kreis in Radiergröße plus Beschriftung direkt an der Stiftspitze,
 *  - der Modus wird nach außen gemeldet (Werkzeugleiste hebt den Radierer hervor, Cursor wechselt).
 *
 * Hinweis: Windows/Chromium melden die Radiertaste je nach Stift erst bei Kontakt (buttons-Bit 32).
 * Damit die Anzeige zwischen zwei Radierstrichen nicht flackert, bleibt sie nach dem Abheben kurz stehen.
 */
import { Eraser, MousePointer2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { stylusModeOf, type StylusMode } from '../tools/inputRouting';

/** So lange bleibt die Anzeige nach dem letzten Ereignis mit gedrückter Radiertaste stehen. */
export const STYLUS_HOLD_MS = 700;

export function useStylusMode(): [StylusMode, React.RefObject<HTMLDivElement | null>] {
  const [mode, setMode] = useState<StylusMode>(null);
  const el = useRef<HTMLDivElement>(null);
  const cur = useRef<StylusMode>(null);

  useEffect(() => {
    let timer = 0;
    const set = (m: StylusMode) => {
      if (cur.current === m) return;
      cur.current = m;
      setMode(m);
    };
    const clearLater = () => {
      if (timer || !cur.current) return;
      timer = window.setTimeout(() => {
        timer = 0;
        set(null);
      }, STYLUS_HOLD_MS);
    };
    const cancelTimer = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
    };
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'pen') {
        if (e.type === 'pointerdown') {
          cancelTimer();
          set(null);
        }
        return;
      }
      const onStage = e.target instanceof Element && !!e.target.closest('.stage');
      // Bei pointerup meldet `button` den gerade LOSGELASSENEN Knopf → nur noch gehaltene Knöpfe zählen
      const released = e.type === 'pointerup' || e.type === 'pointercancel';
      const m = onStage && !released ? stylusModeOf(e) : null;
      if (m) {
        cancelTimer();
        set(m);
      } else if (e.type === 'pointerdown') {
        // Stift setzt ohne Knopf auf → sofort wieder normales Werkzeug
        cancelTimer();
        set(null);
      } else {
        clearLater();
      }
      const node = el.current;
      if (node) node.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };
    const opts = { capture: true, passive: true } as const;
    const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerover'] as const;
    for (const ty of types) window.addEventListener(ty, onPointer, opts);
    const onLeave = (e: PointerEvent) => {
      // Stift verlässt den Erfassungsbereich
      if (e.pointerType === 'pen' && !e.relatedTarget) clearLater();
    };
    window.addEventListener('pointerout', onLeave, opts);
    return () => {
      cancelTimer();
      for (const ty of types) window.removeEventListener(ty, onPointer, opts);
      window.removeEventListener('pointerout', onLeave, opts);
    };
  }, []);

  return [mode, el];
}

/** Kreis + Beschriftung an der Stiftspitze. `diameter` in Bildschirm-px. */
export function StylusIndicator({ mode, diameter, nodeRef }: { mode: StylusMode; diameter: number; nodeRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={nodeRef} className={`stylus-indicator${mode ? ` show ${mode}` : ''}`} aria-hidden data-testid="stylus-indicator" data-mode={mode ?? ''}>
      {mode === 'eraser' && <span className="stylus-ring" style={{ width: diameter, height: diameter }} />}
      {mode && (
        <span className="stylus-chip" style={mode === 'eraser' ? { left: diameter / 2 + 6, top: -diameter / 2 - 22 } : undefined}>
          {mode === 'eraser' ? <Eraser size={14} strokeWidth={2} /> : <MousePointer2 size={14} strokeWidth={2} />}
          {mode === 'eraser' ? t('Radierer') : t('Auswählen')}
        </span>
      )}
    </div>
  );
}
