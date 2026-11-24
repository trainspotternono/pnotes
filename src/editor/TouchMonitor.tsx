/**
 * Input-Debug / Touch-Monitor: zeigt live, wie Eingaben ankommen – pointerType, pointerId,
 * Kontaktgröße (width × height), Druck, Bildschirm- und Seitenkoordinaten, erkannte Spitze
 * (fein/dick/Handfläche), Display-Seite und das tatsächlich benutzte Werkzeug. Ringe markieren
 * jeden Kontakt in seiner gemeldeten Größe. Fängt selbst keine Eingaben ab.
 */
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ToolState } from '../ink/tools';
import { classifyContact, contactSize, sideOf } from '../tools/inputRouting';
import type { GestureInfo } from '../tools';
import { t, tk } from '../i18n';

interface Contact {
  id: number;
  type: string;
  w: number;
  h: number;
  pressure: number;
  x: number;
  y: number;
  primary: boolean;
  buttons: number;
  doc: { page: number; x: number; y: number } | null;
  cls: string;
  side: string;
  downAt: number;
  moves: number;
}

interface LogEntry {
  t: number;
  kind: string;
  id: number;
  type: string;
  w: number;
  h: number;
}

const CLS_LABEL: Record<string, string> = { fine: tk('fein'), thick: tk('dick'), palm: tk('Handfläche') };
const TOOL_LABEL: Record<string, string> = { pen: tk('Stift'), highlighter: tk('Marker'), eraser: tk('Radierer'), select: tk('Auswahl'), shape: tk('Form'), lasso: tk('Lasso'), text: tk('Text'), sticky: tk('Notiz'), image: tk('Bild'), laser: tk('Laser'), comment: tk('Kommentar') };

export function TouchMonitor({
  tools,
  docAt,
  gestures,
  stageRect,
  onClose,
}: {
  tools: ToolState;
  docAt: (x: number, y: number) => { page: number; x: number; y: number } | null;
  gestures: () => GestureInfo[];
  stageRect: () => DOMRect | null;
  onClose: () => void;
}) {
  const contacts = useRef(new Map<number, Contact>());
  const log = useRef<LogEntry[]>([]);
  const stats = useRef({ events: 0, rate: 0, maxContacts: 0, since: performance.now() });
  const [, setTick] = useState(0);
  const frame = useRef<number | null>(null);
  const live = useRef({ tools, docAt, stageRect });
  live.current = { tools, docAt, stageRect };

  useEffect(() => {
    const schedule = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setTick((t) => t + 1);
      });
    };
    const update = (e: PointerEvent, kind: string) => {
      if (!e.isTrusted || !e.pointerType) return; // nur echte Geräte-Eingaben (keine per Skript erzeugten Events)
      const { tools: t, docAt: toDoc, stageRect: sr } = live.current;
      const r = sr();
      stats.current.events++;
      const now = performance.now();
      if (now - stats.current.since >= 1000) {
        stats.current.rate = Math.round((stats.current.events * 1000) / (now - stats.current.since));
        stats.current.events = 0;
        stats.current.since = now;
      }
      if (kind === 'up' || kind === 'cancel') {
        contacts.current.delete(e.pointerId);
      } else {
        const prev = contacts.current.get(e.pointerId);
        if (kind === 'move' && !prev) return; // Schweben (Hover) ohne Kontakt ignorieren
        contacts.current.set(e.pointerId, {
          id: e.pointerId,
          type: e.pointerType,
          w: e.width,
          h: e.height,
          pressure: e.pressure,
          x: e.clientX,
          y: e.clientY,
          primary: e.isPrimary,
          buttons: e.buttons,
          doc: toDoc(e.clientX, e.clientY),
          cls: prev?.cls ?? classifyContact(e, t),
          side: r ? sideOf(e.clientX, r) : '–',
          downAt: prev?.downAt ?? now,
          moves: (prev?.moves ?? 0) + (kind === 'move' ? 1 : 0),
        });
        stats.current.maxContacts = Math.max(stats.current.maxContacts, contacts.current.size);
      }
      if (kind !== 'move') {
        log.current = [{ t: now, kind, id: e.pointerId, type: e.pointerType, w: e.width, h: e.height }, ...log.current].slice(0, 12);
      }
      schedule();
    };
    const down = (e: PointerEvent) => update(e, 'down');
    const move = (e: PointerEvent) => update(e, 'move');
    const up = (e: PointerEvent) => update(e, 'up');
    const cancel = (e: PointerEvent) => update(e, 'cancel');
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const active = [...contacts.current.values()];
  const used = new Map(gestures().map((g) => [g.pointerId, g]));
  const sizesReported = active.some((c) => contactSize({ width: c.w, height: c.h }) > 1.5) || log.current.some((l) => Math.max(l.w, l.h) > 1.5);
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

  return (
    <>
      {active.map((c) => (
        <div
          key={c.id}
          className={`touch-ring ring-${c.type} ring-${c.cls}`}
          style={{ left: c.x, top: c.y, width: Math.max(14, c.w), height: Math.max(14, c.h) }}
          aria-hidden
        >
          <span>{c.id}</span>
        </div>
      ))}
      <div className="touch-monitor" data-testid="touch-monitor">
        <div className="tm-head">
          <strong>{t('Touch-Monitor')}</strong>
          <span>
            {t('{n} aktiv · max {max} · {rate} Ereignisse/s', { n: active.length, max: stats.current.maxContacts, rate: stats.current.rate })}
          </span>
          <button className="icon-btn tm-close" onClick={onClose} aria-label={t('Touch-Monitor schließen')} data-testid="touch-monitor-close">
            <X size={14} />
          </button>
        </div>
        <table className="tm-table">
          <thead>
            <tr>
              <th>pointerId</th>
              <th>pointerType</th>
              <th>width × height</th>
              <th>{t('Druck')}</th>
              <th>x / y (px)</th>
              <th>{t('Seite / pt')}</th>
              <th>{t('Spitze')}</th>
              <th>{t('Hälfte')}</th>
              <th>{t('Werkzeug')}</th>
            </tr>
          </thead>
          <tbody data-testid="touch-monitor-rows">
            {active.length === 0 && (
              <tr>
                <td colSpan={9} className="tm-empty">
                  {t('Display berühren – jeder Kontakt erscheint hier')}
                </td>
              </tr>
            )}
            {active.map((c) => {
              const g = used.get(c.id);
              return (
                <tr key={c.id} data-pointer-type={c.type} data-pointer-id={c.id} data-w={c.w} data-h={c.h} data-cls={c.cls} data-side={c.side}>
                  <td>
                    {c.id}
                    {c.primary ? '*' : ''}
                  </td>
                  <td className={`tm-type tm-${c.type}`}>{c.type}</td>
                  <td>
                    {fmt(c.w)} × {fmt(c.h)}
                  </td>
                  <td>{fmt(c.pressure)}</td>
                  <td>
                    {Math.round(c.x)} / {Math.round(c.y)}
                  </td>
                  <td>{c.doc ? `${t('S')}${c.doc.page + 1} · ${Math.round(c.doc.x)} / ${Math.round(c.doc.y)}` : '–'}</td>
                  <td>{c.type === 'touch' ? t(CLS_LABEL[c.cls]) : '–'}</td>
                  <td>{c.side === 'left' ? t('links') : c.side === 'right' ? t('rechts') : '–'}</td>
                  <td>{g ? t(TOOL_LABEL[g.tool] ?? g.tool) : <span className="tm-dim">{t('Navigation')}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="tm-log">
          {log.current.map((l, i) => (
            <span key={`${l.t}-${i}`} className={`tm-ev tm-ev-${l.kind}`}>
              {l.kind} #{l.id} {l.type} {fmt(l.w)}×{fmt(l.h)}
            </span>
          ))}
        </div>
        <div className="tm-hint">
          {tools.fingerDraws ? t('Touch: Zeichnen') : t('Touch: Navigieren')} · {tools.touch.tipDetect ? t('Spitzen-Erkennung ab {px} px', { px: tools.touch.tipThreshold }) : t('Spitzen-Erkennung aus')} · {t('Handfläche ab {px} px', { px: tools.touch.palmThreshold })}
          {tools.dual.enabled ? ` · ${t('Zwei-Seiten-Modus an')}` : ''}
          {log.current.length > 0 && !sizesReported && ` · ⚠ ${t('Gerät meldet keine Kontaktgröße (width/height ≤ 1) – Spitzen-Erkennung nicht möglich')}`}
        </div>
      </div>
    </>
  );
}
