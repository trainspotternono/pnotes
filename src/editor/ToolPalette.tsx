/**
 * Werkzeugleiste (vgl. SPEC §1.6/§2.3): Werkzeuggruppe + kontextabhängige Einstellungen.
 * Stift/Textmarker/Formen: 5 Farb-Slots (aktiven Slot erneut klicken = Farbwähler), 3 Stärken, Linienstil.
 */
import { useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, BoxSelect, Crop, Eraser, Hand, Highlighter, ImagePlus, Lasso, MessageSquare, MousePointer2,
  PenLine, Settings2, Shapes, Smile, Sparkles, Stamp, StickyNote, Trash2, Type,
} from 'lucide-react';
import type { FontId, LineStyle } from '../../shared/types';
import { Popover, Segmented, Toggle } from '../components/ui';
import { HIGHLIGHTER_COLORS, INK_COLORS, isLight } from '../lib/colors';
import { INK_EXTRA, PALETTE } from '../lib/palette';
import { activeColor, selectTool, STICKY_COLORS, type DrawTool, type Tool, type ToolState } from '../ink/tools';
import { STICKERS } from './media';
import { t, tk } from '../i18n';

type Pop = { kind: 'color' | 'options' | 'dash' | 'sticker' | 'textColor' | 'textBg'; anchor: DOMRect } | null;

export interface PaletteActions {
  onClearPage(): void;
  onSelectAll(): void;
  onInsertImage(): void;
  onInsertSticker(emoji: string): void;
  onCrop(): void;
  canCrop: boolean;
  onTextStyle(patch: Partial<ToolState['text']>): void;
  commentsOpen: boolean;
  openComments: number;
  onToggleComments(): void;
  /** Gerade bearbeiteten Text fest in die Seite einbetten */
  onEngraveText(): void;
  canEngraveText: boolean;
}

const TOOLS: { id: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { id: 'pen', label: tk('Stift'), key: 'P', icon: <PenLine size={19} strokeWidth={1.7} /> },
  { id: 'highlighter', label: tk('Textmarker'), key: 'H', icon: <Highlighter size={19} strokeWidth={1.7} /> },
  { id: 'eraser', label: tk('Radierer'), key: 'E', icon: <Eraser size={19} strokeWidth={1.7} /> },
  { id: 'lasso', label: tk('Lasso'), key: 'L', icon: <Lasso size={19} strokeWidth={1.7} /> },
  { id: 'shape', label: tk('Formen'), key: 'S', icon: <Shapes size={19} strokeWidth={1.7} /> },
  { id: 'text', label: tk('Text'), key: 'T', icon: <Type size={19} strokeWidth={1.7} /> },
  { id: 'sticky', label: tk('Haftnotiz'), key: 'N', icon: <StickyNote size={19} strokeWidth={1.7} /> },
  { id: 'image', label: tk('Bilder, GIFs & Sticker'), key: 'I', icon: <ImagePlus size={19} strokeWidth={1.7} /> },
  { id: 'laser', label: tk('Laserpointer'), key: 'K', icon: <Sparkles size={19} strokeWidth={1.7} /> },
  { id: 'comment', label: tk('Kommentar'), key: 'C', icon: <MessageSquare size={19} strokeWidth={1.7} /> },
];

/** V = Auswählen (eigener Knopf links in der Werkzeugleiste) */
export const TOOL_KEYS: Record<string, Tool> = { v: 'select', ...Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id])) };

const FONTS: { id: FontId; label: string }[] = [
  { id: 'sans', label: 'Segoe UI' },
  { id: 'serif', label: 'Georgia' },
  { id: 'mono', label: 'Consolas' },
  { id: 'hand', label: tk('Handschrift') },
];
const TEXT_SIZES = [10, 12, 14, 16, 20, 24, 32, 40, 56];

function DashIcon({ dash }: { dash: LineStyle }) {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden>
      <line x1="2" y1="5" x2="20" y2="5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray={dash === 'dashed' ? '5 3.5' : dash === 'dotted' ? '0.1 4' : undefined} />
    </svg>
  );
}

export function ToolPalette({
  tools,
  setTools,
  actions,
  stylusTool = null,
}: {
  tools: ToolState;
  setTools: (fn: (t: ToolState) => ToolState) => void;
  actions: PaletteActions;
  /** Werkzeug, das der Stift gerade per Knopf vorübergehend benutzt (z. B. Radiertaste) */
  stylusTool?: Tool | null;
}) {
  const [pop, setPop] = useState<Pop>(null);
  const tl = tools.tool;
  const shown = stylusTool ?? tl;
  const isDraw = tl === 'pen' || tl === 'highlighter' || tl === 'shape';
  const cfg = isDraw ? tools[tl as DrawTool] : null;
  const open = (kind: NonNullable<Pop>['kind']) => (e: React.MouseEvent<HTMLElement>) => setPop({ kind, anchor: e.currentTarget.getBoundingClientRect() });
  const close = () => setPop(null);

  const setDraw = (patch: Partial<ToolState['pen']>) =>
    setTools((s) => {
      if (s.tool !== 'pen' && s.tool !== 'highlighter' && s.tool !== 'shape') return s;
      return { ...s, [s.tool]: { ...s[s.tool], ...patch } } as ToolState;
    });

  return (
    <>
      <div className="toolbar-group tool-group" role="radiogroup" aria-label={t('Werkzeug')}>
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            className={`tool-btn${shown === tool.id ? ' active' : ''}${stylusTool && stylusTool === tool.id && tl !== tool.id ? ' stylus-temp' : ''}${stylusTool && tl === tool.id && stylusTool !== tl ? ' stylus-dimmed' : ''}`}
            onClick={(e) => {
              if (tl === tool.id) open('options')(e);
              else setTools((s) => selectTool(s, tool.id));
            }}
            title={`${t(tool.label)} (${tool.key})`}
            aria-pressed={tl === tool.id}
            data-testid={`tool-${tool.id}`}
          >
            {tool.icon}
          </button>
        ))}
      </div>
      <div className="toolbar-sep" />

      {/* ---------------- Stift / Textmarker / Formen */}
      {cfg && (
        <>
          <div className="toolbar-group" aria-label={t('Farben')}>
            {cfg.colors.map((c, i) => (
              <button
                key={i}
                className={`color-slot${cfg.colorIndex === i ? ' active' : ''}`}
                style={{ ['--slot' as string]: c }}
                title={cfg.colorIndex === i ? t('Farbe ändern') : t('Farbe wählen')}
                onClick={(e) => (cfg.colorIndex === i ? open('color')(e) : setDraw({ colorIndex: i }))}
                data-testid={`color-${i}`}
              >
                <span className={isLight(c) ? 'light' : ''} />
              </button>
            ))}
          </div>
          <div className="toolbar-group" aria-label={t('Stärke')}>
            {cfg.widths.map((_w, i) => (
              <button key={i} className={`width-slot${cfg.widthIndex === i ? ' active' : ''}`} title={t('Stärke {n}', { n: i + 1 })} onClick={() => setDraw({ widthIndex: i })} data-testid={`width-${i}`}>
                <span style={{ width: 4 + i * 5, height: tl === 'highlighter' ? 4 + i * 3 : 4 + i * 5, borderRadius: tl === 'highlighter' ? 2 : 99 }} />
              </button>
            ))}
          </div>
          <button className="icon-btn dash-btn" title={t('Linienstil')} onClick={open('dash')} data-testid="dash-style">
            <DashIcon dash={cfg.dash} />
          </button>
        </>
      )}

      {/* ---------------- Radierer */}
      {tl === 'eraser' && (
        <>
          <div className="toolbar-group" aria-label={t('Radiergröße')}>
            {tools.eraser.sizes.map((_s, i) => (
              <button
                key={i}
                className={`width-slot${tools.eraser.sizeIndex === i ? ' active' : ''}`}
                title={t('Größe {n}', { n: i + 1 })}
                onClick={() => setTools((st) => ({ ...st, eraser: { ...st.eraser, sizeIndex: i } }))}
                data-testid={`eraser-size-${i}`}
              >
                <span className="ring" style={{ width: 6 + i * 6, height: 6 + i * 6 }} />
              </button>
            ))}
          </div>
          <Segmented
            value={tools.eraser.mode}
            options={[
              { id: 'stroke', label: t('Ganzer Strich') },
              { id: 'precision', label: t('Präzision') },
            ]}
            onChange={(mode) => setTools((s) => ({ ...s, eraser: { ...s.eraser, mode } }))}
            testId="eraser-mode"
          />
          <button
            className={`chip${tools.eraser.highlighterOnly ? ' on' : ''}`}
            onClick={() => setTools((s) => ({ ...s, eraser: { ...s.eraser, highlighterOnly: !s.eraser.highlighterOnly } }))}
            title={t('Nur Textmarker löschen')}
            data-testid="eraser-hl-only"
          >
            <Highlighter size={14} /> {t('Nur Marker')}
          </button>
          <button className="btn btn-ghost btn-sm danger-text" onClick={actions.onClearPage} data-testid="clear-page">
            <Trash2 size={15} /> {t('Seite leeren')}
          </button>
        </>
      )}

      {/* ---------------- Auswählen */}
      {tl === 'select' && (
        <>
          <span className="tool-hint">{t('Antippen = auswählen · Rahmen ziehen · Umschalt/Strg = hinzufügen · Doppeltippen auf Text = bearbeiten')}</span>
          <button className="btn btn-ghost btn-sm" onClick={actions.onSelectAll} data-testid="select-all">
            <BoxSelect size={15} /> {t('Alles auswählen')}
          </button>
        </>
      )}

      {/* ---------------- Haftnotiz */}
      {tl === 'sticky' && (
        <>
          <div className="toolbar-group" aria-label={t('Notizfarbe')}>
            {STICKY_COLORS.map((c) => (
              <button
                key={c}
                className={`color-slot${tools.sticky.color === c ? ' active' : ''}`}
                style={{ ['--slot' as string]: c }}
                title={t('Notizfarbe')}
                onClick={() => setTools((s) => ({ ...s, sticky: { color: c } }))}
                data-testid={`sticky-color-${c.slice(1)}`}
              >
                <span className="light" />
              </button>
            ))}
          </div>
          <span className="tool-hint">{t('Auf die Seite tippen = neue Haftnotiz · Notiz antippen = Text bearbeiten · Verschieben/Farbe/Löschen mit „Auswählen“')}</span>
        </>
      )}

      {/* ---------------- Lasso */}
      {tl === 'lasso' && (
        <>
          <span className="tool-hint">{t('Einkreisen zum Auswählen · Ziehen, Ecken skalieren, Griff drehen')}</span>
          <button className="btn btn-ghost btn-sm" onClick={actions.onSelectAll} data-testid="select-all">
            <BoxSelect size={15} /> {t('Alles auswählen')}
          </button>
        </>
      )}

      {/* ---------------- Text */}
      {tl === 'text' && (
        <>
          <select className="select" value={tools.text.font} onChange={(e) => actions.onTextStyle({ font: e.target.value as FontId })} title={t('Schriftart')} data-testid="text-font">
            {FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {t(f.label)}
              </option>
            ))}
          </select>
          <select className="select select-narrow" value={tools.text.size} onChange={(e) => actions.onTextStyle({ size: Number(e.target.value) })} title={t('Schriftgröße')} data-testid="text-size">
            {TEXT_SIZES.map((s) => (
              <option key={s} value={s}>
                {s} pt
              </option>
            ))}
          </select>
          <button className="color-slot active" style={{ ['--slot' as string]: tools.text.color }} title={t('Textfarbe')} onClick={open('textColor')} data-testid="text-color">
            <span />
          </button>
          <button className={`chip${tools.text.background ? ' on' : ''}`} title={t('Hintergrund')} onClick={open('textBg')} data-testid="text-bg">
            <span className="chip-swatch" style={{ background: tools.text.background ?? 'transparent' }} /> {t('Hintergrund')}
          </button>
          <div className="toolbar-group">
            {(
              [
                ['left', <AlignLeft key="l" size={16} />],
                ['center', <AlignCenter key="c" size={16} />],
                ['right', <AlignRight key="r" size={16} />],
              ] as const
            ).map(([a, icon]) => (
              <button key={a} className={`icon-btn${tools.text.align === a ? ' active' : ''}`} onClick={() => actions.onTextStyle({ align: a })} title={a === 'left' ? t('Linksbündig') : a === 'center' ? t('Zentriert') : t('Rechtsbündig')} data-testid={`text-align-${a}`}>
                {icon}
              </button>
            ))}
          </div>
          <button
            className="btn btn-ghost btn-sm"
            disabled={!actions.canEngraveText}
            onMouseDown={(e) => e.preventDefault() /* Textfeld behält den Fokus bis zum Klick */}
            onClick={actions.onEngraveText}
            title={t('Text fest in die Seite einbetten (danach nicht mehr verschiebbar oder radierbar)')}
            data-testid="text-engrave"
          >
            <Stamp size={15} /> {t('Text einbetten')}
          </button>
        </>
      )}

      {/* ---------------- Bilder & Sticker */}
      {tl === 'image' && (
        <>
          <button className="btn btn-ghost btn-sm" onClick={actions.onInsertImage} data-testid="insert-image">
            <ImagePlus size={15} /> {t('Bild / GIF einfügen')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={open('sticker')} data-testid="insert-sticker">
            <Smile size={15} /> {t('Sticker')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={actions.onCrop} disabled={!actions.canCrop} data-testid="crop-image">
            <Crop size={15} /> {t('Zuschneiden')}
          </button>
          <span className="tool-hint">
            <MousePointer2 size={13} /> {t('Antippen zum Auswählen')}
          </span>
        </>
      )}

      {/* ---------------- Laserpointer */}
      {tl === 'laser' && (
        <>
          <Segmented
            value={tools.laser.mode}
            options={[
              { id: 'dot', label: t('Punkt') },
              { id: 'trail', label: t('Spur') },
            ]}
            onChange={(mode) => setTools((s) => ({ ...s, laser: { ...s.laser, mode } }))}
            testId="laser-mode"
          />
          <div className="toolbar-group">
            {[PALETTE.crimson, PALETTE.crimsonDark, INK_EXTRA.blue, INK_EXTRA.green].map((c) => (
              <button key={c} className={`color-slot${tools.laser.color === c ? ' active' : ''}`} style={{ ['--slot' as string]: c }} onClick={() => setTools((s) => ({ ...s, laser: { ...s.laser, color: c } }))}>
                <span />
              </button>
            ))}
          </div>
          <span className="tool-hint">{t('verblasst nach 2 s · wird nicht gespeichert')}</span>
        </>
      )}

      {/* ---------------- Kommentar */}
      {tl === 'comment' && (
        <>
          <span className="tool-hint">{t('Auf die Seite tippen, um einen Kommentar zu setzen')}</span>
          <button className={`chip${actions.commentsOpen ? ' on' : ''}`} onClick={actions.onToggleComments} data-testid="toggle-comments-chip">
            <MessageSquare size={14} /> {t('{n} offen', { n: actions.openComments })}
          </button>
        </>
      )}

      {(isDraw || tl === 'eraser') && (
        <button className="icon-btn" title={t('Werkzeug-Optionen')} onClick={open('options')} data-testid="tool-options">
          <Settings2 size={17} strokeWidth={1.7} />
        </button>
      )}
      <button
        className={`icon-btn${tools.fingerDraws ? ' active' : ''}`}
        title={tools.fingerDraws ? t('Mit Finger zeichnen: an') : t('Mit Finger zeichnen: aus (Finger scrollt/zoomt)')}
        aria-pressed={tools.fingerDraws}
        onClick={() => setTools((s) => ({ ...s, fingerDraws: !s.fingerDraws }))}
        data-testid="finger-draws"
      >
        <Hand size={17} strokeWidth={1.7} />
      </button>

      {/* ---------------- Popovers */}
      {pop?.kind === 'color' && cfg && (
        <Popover anchor={pop.anchor} onClose={close} testId="color-popover">
          <div className="popover-title">{t('Farbe für Slot {n}', { n: cfg.colorIndex + 1 })}</div>
          <ColorGrid
            colors={tl === 'highlighter' ? HIGHLIGHTER_COLORS : INK_COLORS}
            value={activeColor(cfg)}
            onPick={(c) => {
              const colors = [...cfg.colors];
              colors[cfg.colorIndex] = c;
              setDraw({ colors });
              close();
            }}
          />
          <CustomColor
            value={activeColor(cfg)}
            onChange={(c) => {
              const colors = [...cfg.colors];
              colors[cfg.colorIndex] = c;
              setDraw({ colors });
            }}
          />
        </Popover>
      )}

      {pop?.kind === 'dash' && cfg && (
        <Popover anchor={pop.anchor} onClose={close} testId="dash-popover">
          <div className="popover-title">{t('Linienstil')}</div>
          <div className="dash-options">
            {(['solid', 'dashed', 'dotted'] as LineStyle[]).map((d) => (
              <button
                key={d}
                className={`dash-option${cfg.dash === d ? ' active' : ''}`}
                onClick={() => {
                  setDraw({ dash: d });
                  close();
                }}
                data-testid={`dash-${d}`}
              >
                <DashIcon dash={d} />
                <span>{d === 'solid' ? t('Durchgezogen') : d === 'dashed' ? t('Gestrichelt') : t('Gepunktet')}</span>
              </button>
            ))}
          </div>
          {tl === 'pen' && <p className="popover-note">{t('Gestrichelte/gepunktete Linien haben eine gleichmäßige Breite (ohne Druck).')}</p>}
        </Popover>
      )}

      {pop?.kind === 'options' && (
        <Popover anchor={pop.anchor} onClose={close} testId="options-popover">
          {tl === 'pen' && (
            <>
              <div className="popover-title">{t('Stifttyp')}</div>
              <Segmented
                value={tools.pen.style}
                options={[
                  { id: 'fountain', label: t('Füller') },
                  { id: 'ballpoint', label: t('Kugelschreiber') },
                  { id: 'brush', label: t('Pinsel') },
                ]}
                onChange={(style) => setTools((s) => ({ ...s, pen: { ...s.pen, style } }))}
                testId="pen-style"
              />
              <p className="popover-note">{t('Füller: druckempfindlich. Kugelschreiber: konstante Breite. Pinsel: sehr druckempfindlich mit weichen Enden. Mit der Maus wird der Druck aus der Geschwindigkeit geschätzt.')}</p>
            </>
          )}
          {tl === 'highlighter' && (
            <>
              <div className="popover-title">{t('Textmarker')}</div>
              <Toggle label={t('Gerade Linie zeichnen')} checked={tools.highlighter.straight} onChange={(v) => setTools((s) => ({ ...s, highlighter: { ...s.highlighter, straight: v } }))} testId="hl-straight" />
            </>
          )}
          {tl === 'shape' && (
            <>
              <div className="popover-title">{t('Formen')}</div>
              <Toggle label={t('Geschlossene Formen füllen')} checked={tools.shape.fill} onChange={(v) => setTools((s) => ({ ...s, shape: { ...s.shape, fill: v } }))} testId="shape-fill-default" />
              <p className="popover-note">{t('Freihand zeichnen – beim Absetzen entsteht Linie, Pfeil, Kreis/Ellipse, Rechteck/Quadrat, Dreieck oder Polygon. Tippen auf eine Form zeigt ihre Ankerpunkte und einen Drehgriff.')}</p>
            </>
          )}
          {tl === 'eraser' && (
            <>
              <div className="popover-title">{t('Radierer')}</div>
              <Toggle label={t('Nur Textmarker löschen')} checked={tools.eraser.highlighterOnly} onChange={(v) => setTools((s) => ({ ...s, eraser: { ...s.eraser, highlighterOnly: v } }))} />
              <Toggle label={t('Automatisch abwählen')} checked={tools.eraser.autoDeselect} onChange={(v) => setTools((s) => ({ ...s, eraser: { ...s.eraser, autoDeselect: v } }))} />
            </>
          )}
          {(tl === 'pen' || tl === 'highlighter') && (
            <>
              <div className="popover-sep" />
              <Toggle label={t('Zeichnen und Halten → Form')} checked={tools.holdToShape} onChange={(v) => setTools((s) => ({ ...s, holdToShape: v }))} testId="hold-to-shape" />
              <p className="popover-note">{t('Am Ende eines Strichs ~½ s stillhalten: Stift → saubere Form mit Ankerpunkten, Textmarker → gerade Linie.')}</p>
            </>
          )}
          <div className="popover-sep" />
          <Toggle label={t('Mit Finger zeichnen')} checked={tools.fingerDraws} onChange={(v) => setTools((s) => ({ ...s, fingerDraws: v }))} />
        </Popover>
      )}

      {pop?.kind === 'sticker' && (
        <Popover anchor={pop.anchor} onClose={close} testId="sticker-popover">
          <div className="popover-title">{t('Sticker')}</div>
          <div className="sticker-grid">
            {STICKERS.map((s) => (
              <button
                key={s}
                className="sticker-btn"
                onClick={() => {
                  actions.onInsertSticker(s);
                  close();
                }}
                data-testid="sticker"
              >
                {s}
              </button>
            ))}
          </div>
        </Popover>
      )}

      {pop?.kind === 'textColor' && (
        <Popover anchor={pop.anchor} onClose={close}>
          <div className="popover-title">{t('Textfarbe')}</div>
          <ColorGrid colors={INK_COLORS} value={tools.text.color} onPick={(c) => (actions.onTextStyle({ color: c }), close())} />
          <CustomColor value={tools.text.color} onChange={(c) => actions.onTextStyle({ color: c })} />
        </Popover>
      )}

      {pop?.kind === 'textBg' && (
        <Popover anchor={pop.anchor} onClose={close}>
          <div className="popover-title">{t('Hintergrund')}</div>
          <div className="color-grid compact">
            <button className={`swatch swatch-none${!tools.text.background ? ' selected' : ''}`} onClick={() => (actions.onTextStyle({ background: null }), close())} title={t('Kein Hintergrund')}>
              ∅
            </button>
            {[PALETTE.slate100, PALETTE.slate200, PALETTE.slate300, PALETTE.slate500, PALETTE.slate800, PALETTE.slate900, PALETTE.crimson, PALETTE.crimsonDark, INK_EXTRA.blue, INK_EXTRA.green, INK_EXTRA.amber, INK_EXTRA.violet].map((c) => (
              <button key={c} className={`swatch${tools.text.background === c ? ' selected' : ''}`} style={{ background: c }} onClick={() => (actions.onTextStyle({ background: c }), close())} />
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

function ColorGrid({ colors, value, onPick }: { colors: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div className="color-grid compact">
      {[...new Set(colors)].map((c) => (
        <button key={c} className={`swatch${value.toLowerCase() === c.toLowerCase() ? ' selected' : ''}`} style={{ background: c }} aria-label={c} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

function CustomColor({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <label className="custom-color-row popover-custom">
      <span>{t('Eigene Farbe')}</span>
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} data-testid="custom-color" />
    </label>
  );
}
