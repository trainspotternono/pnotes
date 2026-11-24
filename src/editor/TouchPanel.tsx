/**
 * Touch & Großdisplay: Einstellungen (Touch-Modus, Zwei-Finger-Navigation, Spitzen-Erkennung,
 * Handfläche, Zwei-Seiten-Modus, große Bedienelemente, Touch-Monitor), Seiten-Chips für den
 * Zwei-Seiten-Modus und Kalibrierung der Stiftspitzen über die gemeldete Kontaktgröße.
 */
import { useEffect, useRef, useState } from 'react';
import { Columns2, Eraser, Highlighter, PenLine, Ruler } from 'lucide-react';
import { Modal, Popover, Segmented, Toggle } from '../components/ui';
import { HIGHLIGHTER_COLORS, INK_COLORS } from '../lib/colors';
import type { SidePreset, ToolState, TouchConfig } from '../ink/tools';
import { contactSize } from '../tools/inputRouting';
import { t } from '../i18n';

type SetTools = (fn: (t: ToolState) => ToolState) => void;

const patchTouch = (setTools: SetTools, p: Partial<TouchConfig>) => setTools((s) => ({ ...s, touch: { ...s.touch, ...p } }));

/** Schieberegler mit Zahlenanzeige */
function Slider({ label, value, min, max, step = 1, unit, onChange, testId }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void; testId?: string }) {
  return (
    <label className="slider-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testId} />
      <code>
        {value}
        {unit}
      </code>
    </label>
  );
}

export function TouchSettingsPopover({ tools, setTools, anchor, onClose, onCalibrate }: { tools: ToolState; setTools: SetTools; anchor: DOMRect; onClose: () => void; onCalibrate: () => void }) {
  const tc = tools.touch;
  return (
    <Popover anchor={anchor} onClose={onClose} testId="touch-popover">
      <div className="touch-panel">
        <div className="popover-title">{t('Touch-Eingabe')}</div>
        <Segmented
          value={tools.fingerDraws ? 'draw' : 'nav'}
          options={[
            { id: 'nav', label: t('Finger: Navigieren') },
            { id: 'draw', label: t('Finger/IR-Stift: Zeichnen') },
          ]}
          onChange={(v) => setTools((s) => ({ ...s, fingerDraws: v === 'draw' }))}
          testId="touch-mode"
        />
        <p className="popover-note">
          {t('IR-Touch-Displays melden Finger und passive Stifte als Touch. Für Whiteboards „Zeichnen“ wählen; mehrere Personen können gleichzeitig schreiben.')}
        </p>
        <Toggle label={t('Zwei Finger nah beieinander = Verschieben/Zoomen')} checked={tc.twoFingerNav} onChange={(v) => patchTouch(setTools, { twoFingerNav: v })} testId="touch-two-finger" />

        <div className="popover-sep" />
        <div className="popover-title">{t('Stiftspitzen (Kontaktgröße)')}</div>
        <Toggle label={t('Feine / dicke Spitze unterscheiden')} checked={tc.tipDetect} onChange={(v) => patchTouch(setTools, { tipDetect: v })} testId="touch-tip-detect" />
        {tc.tipDetect && (
          <>
            <Slider label={t('Schwelle dicke Spitze')} value={tc.tipThreshold} min={2} max={60} unit=" px" onChange={(v) => patchTouch(setTools, { tipThreshold: v })} testId="touch-tip-threshold" />
            <Segmented
              value={tc.thickAction}
              options={[
                { id: 'thick', label: t('Dicker Strich') },
                { id: 'highlighter', label: t('Textmarker') },
                { id: 'eraser', label: t('Radierer') },
              ]}
              onChange={(v) => patchTouch(setTools, { thickAction: v })}
              testId="touch-thick-action"
            />
            {tc.thickAction === 'thick' && <Slider label={t('Breitenfaktor')} value={tc.thickFactor} min={1.5} max={6} step={0.5} unit="×" onChange={(v) => patchTouch(setTools, { thickFactor: v })} />}
          </>
        )}
        <Slider label={t('Handfläche ab')} value={tc.palmThreshold} min={20} max={160} unit=" px" onChange={(v) => patchTouch(setTools, { palmThreshold: v })} testId="touch-palm-threshold" />
        <Segmented
          value={tc.palmAction}
          options={[
            { id: 'eraser', label: t('Handfläche radiert') },
            { id: 'ignore', label: t('Handfläche ignorieren') },
          ]}
          onChange={(v) => patchTouch(setTools, { palmAction: v })}
          testId="touch-palm-action"
        />
        <button className="btn btn-sm touch-calibrate" onClick={onCalibrate} data-testid="touch-calibrate">
          <Ruler size={15} /> {t('Spitzen kalibrieren …')}
        </button>

        <div className="popover-sep" />
        <div className="popover-title">{t('Großes Display')}</div>
        <Toggle
          label={t('Zwei-Seiten-Modus (linke/rechte Hälfte mit eigenem Stift)')}
          checked={tools.dual.enabled}
          onChange={(v) => setTools((s) => ({ ...s, dual: { ...s.dual, enabled: v } }))}
          testId="dual-toggle"
        />
        <Toggle label={t('Große Bedienelemente')} checked={tc.largeUi} onChange={(v) => patchTouch(setTools, { largeUi: v })} testId="touch-large-ui" />
        <Toggle label={t('Touch-Monitor (Input-Debug) einblenden')} checked={tc.monitor} onChange={(v) => patchTouch(setTools, { monitor: v })} testId="touch-monitor-toggle" />
      </div>
    </Popover>
  );
}

// ------------------------------------------------------------ Zwei-Seiten-Modus: Chips + Voreinstellung

const PRESET_WIDTHS: Record<SidePreset['tool'], number[]> = { pen: [1.2, 2, 3.4, 6], highlighter: [8, 14, 22], eraser: [8, 14, 28, 48] };

function presetLabel(p: SidePreset) {
  return p.tool === 'eraser' ? t('Radierer') : p.tool === 'highlighter' ? t('Marker') : t('Stift');
}

export function DualChips({ tools, setTools }: { tools: ToolState; setTools: SetTools }) {
  const [edit, setEdit] = useState<{ side: 'left' | 'right'; anchor: DOMRect } | null>(null);
  if (!tools.dual.enabled) return null;
  const setPreset = (side: 'left' | 'right', p: Partial<SidePreset>) =>
    setTools((s) => {
      const next = { ...s.dual[side], ...p };
      // Breite passend zum Werkzeug wählen, wenn das Werkzeug wechselt
      if (p.tool && p.tool !== s.dual[side].tool) next.width = PRESET_WIDTHS[p.tool][1];
      return { ...s, dual: { ...s.dual, [side]: next } };
    });
  const chip = (side: 'left' | 'right') => {
    const p = tools.dual[side];
    return (
      <button
        key={side}
        className={`dual-chip dual-${side}`}
        onClick={(e) => setEdit({ side, anchor: e.currentTarget.getBoundingClientRect() })}
        title={side === 'left' ? t('Stift für die linke Display-Hälfte') : t('Stift für die rechte Display-Hälfte')}
        data-testid={`dual-chip-${side}`}
      >
        <span className="dual-side">{side === 'left' ? 'L' : 'R'}</span>
        {p.tool === 'eraser' ? <Eraser size={14} /> : <span className="dual-dot" style={{ background: p.color, opacity: p.tool === 'highlighter' ? 0.7 : 1 }} />}
        <span>{presetLabel(p)}</span>
      </button>
    );
  };
  const p = edit ? tools.dual[edit.side] : null;
  return (
    <>
      <div className="toolbar-group dual-chips" aria-label={t('Zwei-Seiten-Modus')}>
        <Columns2 size={16} className="dual-icon" aria-hidden />
        {chip('left')}
        {chip('right')}
      </div>
      {edit && p && (
        <Popover anchor={edit.anchor} onClose={() => setEdit(null)} testId="dual-popover">
          <div className="popover-title">{edit.side === 'left' ? t('Linke Seite') : t('Rechte Seite')}</div>
          <div className="toolbar-group">
            {(
              [
                ['pen', <PenLine key="p" size={16} />, t('Stift')],
                ['highlighter', <Highlighter key="h" size={16} />, t('Marker')],
                ['eraser', <Eraser key="e" size={16} />, t('Radierer')],
              ] as const
            ).map(([id, icon, label]) => (
              <button key={id} className={`chip${p.tool === id ? ' on' : ''}`} onClick={() => setPreset(edit.side, { tool: id })} data-testid={`dual-tool-${id}`}>
                {icon} {label}
              </button>
            ))}
          </div>
          {p.tool !== 'eraser' && (
            <div className="color-grid compact dual-colors">
              {(p.tool === 'highlighter' ? HIGHLIGHTER_COLORS : INK_COLORS).map((c) => (
                <button
                  key={c}
                  className={`swatch${p.color.toLowerCase() === c.toLowerCase() ? ' selected' : ''}`}
                  style={{ background: c }}
                  aria-label={c}
                  onClick={() => setPreset(edit.side, { color: c })}
                  data-testid={`dual-color-${c.slice(1)}`}
                />
              ))}
            </div>
          )}
          <div className="toolbar-group">
            {PRESET_WIDTHS[p.tool].map((w, i) => (
              <button key={w} className={`width-slot${Math.abs(p.width - w) < 0.01 ? ' active' : ''}`} title={p.tool === 'eraser' ? t('Radius {w} px', { w }) : `${w} pt`} onClick={() => setPreset(edit.side, { width: w })}>
                <span
                  className={p.tool === 'eraser' ? 'ring' : ''}
                  style={p.tool === 'eraser' ? { width: 6 + i * 6, height: 6 + i * 6 } : { width: 4 + i * 4, height: p.tool === 'highlighter' ? 4 + i * 3 : 4 + i * 4, borderRadius: 99, background: p.color }}
                />
              </button>
            ))}
          </div>
          <p className="popover-note">{t('Gilt für Stift, Textmarker und Radierer: Wer auf dieser Display-Hälfte schreibt, nutzt diese Einstellung – auch gleichzeitig mit der anderen Seite.')}</p>
        </Popover>
      )}
    </>
  );
}

/** Trennlinie + Seitenbeschriftung über der Bühne im Zwei-Seiten-Modus. */
export function DualDivider({ left, right }: { left: SidePreset; right: SidePreset }) {
  const tag = (p: SidePreset, side: string) => (
    <span className={`dual-tag dual-tag-${side}`} style={{ borderColor: p.tool === 'eraser' ? undefined : p.color }}>
      {side === 'left' ? 'L' : 'R'} · {presetLabel(p)}
    </span>
  );
  return (
    <div className="dual-divider" aria-hidden data-testid="dual-divider">
      {tag(left, 'left')}
      {tag(right, 'right')}
    </div>
  );
}

// ------------------------------------------------------------ Kalibrierung

/** Misst die gemeldete Kontaktgröße beider Spitzen und schlägt Schwellenwerte vor. */
export function CalibrateDialog({ tools, setTools, onClose }: { tools: ToolState; setTools: SetTools; onClose: () => void }) {
  const [phase, setPhase] = useState<'fine' | 'thick' | 'done'>('fine');
  const [fine, setFine] = useState<number[]>([]);
  const [thick, setThick] = useState<number[]>([]);
  const [last, setLast] = useState<{ type: string; w: number; h: number } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const SAMPLES = 5;
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      const s = contactSize(e);
      setLast({ type: e.pointerType, w: Math.round(e.width * 10) / 10, h: Math.round(e.height * 10) / 10 });
      if (phase === 'fine') {
        setFine((a) => {
          const n = [...a, s];
          if (n.length >= SAMPLES) setPhase('thick');
          return n;
        });
      } else if (phase === 'thick') {
        setThick((a) => {
          const n = [...a, s];
          if (n.length >= SAMPLES) setPhase('done');
          return n;
        });
      }
    };
    el.addEventListener('pointerdown', onDown);
    return () => el.removeEventListener('pointerdown', onDown);
  }, [phase]);

  const f = avg(fine);
  const th = avg(thick);
  const distinguishable = phase === 'done' && th > f * 1.3 && th - f >= 2;
  const threshold = Math.round(((f + th) / 2) * 10) / 10;
  const palm = Math.max(Math.round(th * 2.5), Math.round(tools.touch.palmThreshold), 30);

  return (
    <Modal
      title={t('Stiftspitzen kalibrieren')}
      onClose={onClose}
      width={560}
      testId="calibrate-dialog"
      footer={
        <>
          <button
            className="btn"
            onClick={() => {
              setFine([]);
              setThick([]);
              setPhase('fine');
            }}
          >
            {t('Neu messen')}
          </button>
          <button className="btn" onClick={onClose} data-testid="dialog-cancel">
            {t('Abbrechen')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!distinguishable}
            onClick={() => {
              setTools((s) => ({ ...s, touch: { ...s.touch, tipDetect: true, tipThreshold: threshold, palmThreshold: Math.max(palm, Math.ceil(th * 1.8)) } }));
              onClose();
            }}
            data-testid="calibrate-apply"
          >
            {t('Übernehmen')}
          </button>
        </>
      }
    >
      <p className="modal-text">
        {phase === 'fine' && t('Tippe {n}× mit der feinen Spitze in das Feld ({done}/{n}).', { n: SAMPLES, done: fine.length })}
        {phase === 'thick' && t('Jetzt {n}× mit der dicken Spitze tippen ({done}/{n}).', { n: SAMPLES, done: thick.length })}
        {phase === 'done' &&
          (distinguishable ? (
            t('Fein ≈ {fine} px, dick ≈ {thick} px → Schwelle {threshold} px, Handfläche ab ≈ {palm} px.', { fine: f.toFixed(1), thick: th.toFixed(1), threshold, palm })
          ) : (
            t('Fein ≈ {fine} px, dick ≈ {thick} px – nicht sicher unterscheidbar. Der Touch-Rahmen meldet vermutlich keine (oder gleiche) Kontaktgrößen. Nutze dann den Zwei-Seiten-Modus oder wechsle das Werkzeug manuell.', { fine: f.toFixed(1), thick: th.toFixed(1) })
          ))}
      </p>
      <div ref={area} className={`calibrate-area phase-${phase}`} data-testid="calibrate-area">
        <span>{phase === 'fine' ? t('Feine Spitze') : phase === 'thick' ? t('Dicke Spitze') : t('Fertig')}</span>
        {last && (
          <code>
            {last.type} · {last.w} × {last.h} px
          </code>
        )}
      </div>
      <div className="calibrate-samples">
        <span>{t('Fein')}: {fine.map((x) => x.toFixed(1)).join(', ') || '–'}</span>
        <span>{t('Dick')}: {thick.map((x) => x.toFixed(1)).join(', ') || '–'}</span>
      </div>
    </Modal>
  );
}

export const touchButtonClass = (t: ToolState) => `icon-btn${t.fingerDraws || t.dual.enabled || t.touch.monitor ? ' active' : ''}`;
