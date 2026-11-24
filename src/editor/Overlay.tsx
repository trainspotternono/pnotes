/** DOM-Elemente über der Bühne, die der Ansicht folgen: Kommentar-Pins, Texteditor, Auswahl- und Form-Leiste. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy, CopyPlus, Crop, Download, ImageDown, MessageSquare, PaintBucket, Palette, PenLine, RotateCcw, RotateCw, Scissors, Stamp, Trash2 } from 'lucide-react';
import { STICKY_COLORS } from '../ink/tools';
import { t, tk } from '../i18n';

/** Alias, wo 	 als Variable (Kommentar-Thread) belegt ist */
const tr = t;
import type { CommentThread, Page, ShapeObj, TextObj } from '../../shared/types';
import { INK_COLORS } from '../lib/colors';
import type { Viewport } from '../ink/InkLayer';
import { FONT_FAMILIES, TEXT_LINE_HEIGHT, textPadding } from '../ink/render';
import { isClosedKind, shapeAngle, shapeOutline } from '../ink/shapes';
import { frameCorners } from '../ink/transform';
import { ROTATE_OFFSET_PX } from '../tools/selection';
import type { Selection } from './store';

export function toScreen(v: Viewport, pageIndex: number, x: number, y: number): [number, number] {
  const p = v.layout.pages[pageIndex];
  return [v.offsetX + (p.x + x) * v.zoom - v.scrollLeft, v.offsetY + (p.y + y) * v.zoom - v.scrollTop];
}

const inView = (v: Viewport, sx: number, sy: number, m = 40) => sx > -m && sy > -m && sx < v.width + m && sy < v.height + m;

// ------------------------------------------------------------ Kommentar-Pins

export function CommentPins({
  v,
  pages,
  activeId,
  pending,
  showResolved,
  onOpen,
}: {
  v: Viewport;
  pages: Page[];
  activeId: string | null;
  pending: { pageIndex: number; x: number; y: number } | null;
  showResolved: boolean;
  onOpen: (pageIndex: number, id: string) => void;
}) {
  let n = 0;
  const pins: React.ReactNode[] = [];
  pages.forEach((page, pi) => {
    if (!v.layout.pages[pi]) return;
    page.comments.forEach((t: CommentThread) => {
      n++;
      if (t.resolved && !showResolved) return;
      const [sx, sy] = toScreen(v, pi, t.x, t.y);
      if (!inView(v, sx, sy)) return;
      pins.push(
        <button
          key={t.id}
          className={`comment-pin${t.resolved ? ' resolved' : ''}${activeId === t.id ? ' active' : ''}`}
          style={{ left: sx, top: sy }}
          title={t.messages[0]?.text ?? tr('Kommentar')}
          onClick={() => onOpen(pi, t.id)}
          data-testid="comment-pin"
        >
          {t.resolved ? <Check size={13} strokeWidth={2.5} /> : <span>{n}</span>}
        </button>,
      );
    });
  });
  if (pending && v.layout.pages[pending.pageIndex]) {
    const [sx, sy] = toScreen(v, pending.pageIndex, pending.x, pending.y);
    pins.push(
      <div key="pending" className="comment-pin pending" style={{ left: sx, top: sy }}>
        <MessageSquare size={13} strokeWidth={2.2} />
      </div>,
    );
  }
  return <>{pins}</>;
}

// ------------------------------------------------------------ Texteditor

export function TextEditor({ v, pageIndex, obj, onChange, onClose }: { v: Viewport; pageIndex: number; obj: TextObj; onChange: (text: string, h: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const z = v.zoom;
  const [sx, sy] = toScreen(v, pageIndex, obj.cx, obj.cy);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const pad = textPadding(obj);
  // Haftnotizen behalten mindestens ihre Größe (quadratisches Papier), Textboxen wachsen mit dem Inhalt
  const minH = obj.sticky ? obj.h : obj.size * TEXT_LINE_HEIGHT + 2 * pad;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    const h = Math.max(el.scrollHeight, minH * z);
    el.style.height = `${h}px`;
  });

  return (
    <textarea
      ref={ref}
      className={`text-editor${obj.sticky ? ' sticky-editor' : ''}`}
      data-testid="text-editor"
      value={obj.text}
      placeholder={obj.sticky ? t('Notiz schreiben …') : t('Text eingeben')}
      spellCheck={false}
      style={{
        left: sx,
        top: sy,
        width: obj.w * z,
        transform: `translate(-50%, -50%) rotate(${obj.rotation}deg)`,
        font: `${obj.size * z}px/${TEXT_LINE_HEIGHT} ${FONT_FAMILIES[obj.font]}`,
        color: obj.color,
        background: obj.background ?? 'transparent',
        textAlign: obj.align,
        padding: `${pad * z}px`,
      }}
      onChange={(e) => {
        const el = e.currentTarget;
        el.style.height = '0px';
        onChange(e.target.value, Math.max(el.scrollHeight / z, minH));
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
      onBlur={onClose}
    />
  );
}

// ------------------------------------------------------------ Auswahl-Leiste

export interface SelectionActions {
  onColor(color: string): void;
  onCut(): void;
  onCopy(): void;
  onDuplicate(): void;
  onDelete(): void;
  onExportPng(): void;
  onCopyPng(): void;
  onCrop?: () => void;
  /** „Einbetten / Eingravieren“ (Text bzw. Handschrift fest in die Seite) */
  onEngrave(): void;
  /** Beschriftung je nach Auswahl („Text einbetten“, „Handschrift eingravieren“ …) */
  engraveLabel: string;
  /** nur Haftnotizen ausgewählt → Notizfarben anbieten */
  stickyOnly?: boolean;
}

export function SelectionBar({ v, sel, actions }: { v: Viewport; sel: Selection; actions: SelectionActions }) {
  const [colors, setColors] = useState(false);
  const pts = frameCorners(sel.frame).map(([x, y]) => toScreen(v, sel.pageIndex, x, y));
  const top = Math.min(...pts.map((p) => p[1]));
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
  // Oberhalb des Drehgriffs (ROTATE_OFFSET_PX) bleiben, sonst unterhalb der Auswahl
  const above = top - ROTATE_OFFSET_PX - 52;
  const y = above < 4 ? Math.max(...pts.map((p) => p[1])) + 16 : above;
  return (
    <div className="float-bar" style={{ left: Math.max(150, Math.min(v.width - 150, cx)), top: y }} data-testid="selection-bar" onPointerDown={(e) => e.stopPropagation()}>
      <button className="icon-btn" title={t('Farbe ändern')} onClick={() => setColors((c) => !c)} data-testid="sel-color">
        <Palette size={17} />
      </button>
      <button className="icon-btn" title={t('Ausschneiden (Strg+X)')} onClick={actions.onCut} data-testid="sel-cut">
        <Scissors size={17} />
      </button>
      <button className="icon-btn" title={t('Kopieren (Strg+C)')} onClick={actions.onCopy} data-testid="sel-copy">
        <Copy size={17} />
      </button>
      <button className="icon-btn" title={t('Duplizieren (Strg+D)')} onClick={actions.onDuplicate} data-testid="sel-duplicate">
        <CopyPlus size={17} />
      </button>
      {actions.onCrop && (
        <button className="icon-btn" title={t('Zuschneiden')} onClick={actions.onCrop} data-testid="sel-crop">
          <Crop size={17} />
        </button>
      )}
      <button className="icon-btn" title={t('Als Bild speichern (PNG)')} onClick={actions.onExportPng} data-testid="sel-export">
        <Download size={17} />
      </button>
      <button className="icon-btn" title={t('Als Bild in die Zwischenablage')} onClick={actions.onCopyPng} data-testid="sel-copy-png">
        <ImageDown size={17} />
      </button>
      <div className="float-sep" />
      <button
        className="btn btn-ghost float-done"
        title={t('Fest in die Seite einbetten: danach nicht mehr verschiebbar und nicht radierbar (nur Rückgängig oder „Seite leeren“)')}
        onClick={actions.onEngrave}
        data-testid="sel-engrave"
      >
        <Stamp size={15} /> {actions.engraveLabel}
      </button>
      <div className="float-sep" />
      <button className="icon-btn danger" title={t('Löschen (Entf)')} onClick={actions.onDelete} data-testid="sel-delete">
        <Trash2 size={17} />
      </button>
      {colors && (
        <div className="float-colors">
          {(actions.stickyOnly ? STICKY_COLORS : INK_COLORS).map((c) => (
            <button
              key={c}
              className="swatch"
              style={{ background: c }}
              aria-label={c}
              onClick={() => {
                actions.onColor(c);
                setColors(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ Form-Leiste (Anker-Modus)

export function ShapeBar({
  v,
  pageIndex,
  shape,
  onToggleFill,
  onDelete,
  onDone,
  onKeepFreehand,
  onRotate,
}: {
  v: Viewport;
  pageIndex: number;
  shape: ShapeObj;
  onToggleFill: () => void;
  onDelete: () => void;
  onDone: () => void;
  /** nur direkt nach dem Einrasten verfügbar */
  onKeepFreehand?: () => void;
  /** Drehen um ±Grad (geschlossene Formen) */
  onRotate?: (deg: number) => void;
}) {
  const pts = shapeOutline(shape).pts;
  let minY = Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const [sx, sy] = toScreen(v, pageIndex, pts[i], pts[i + 1]);
    minY = Math.min(minY, sy);
    maxY = Math.max(maxY, sy);
    sumX += sx;
  }
  const cx = sumX / (pts.length / 2);
  const closed = isClosedKind(shape.kind);
  // Geschlossene Formen haben oben einen Drehgriff → Leiste darunter (falls Platz), sonst weit darüber
  const y = closed ? (maxY + 70 < v.height ? maxY + 18 : minY - 104) : minY - 60 < 4 ? maxY + 18 : minY - 56;
  return (
    <div className="float-bar" style={{ left: Math.max(160, Math.min(v.width - 160, cx)), top: y }} data-testid="shape-bar" onPointerDown={(e) => e.stopPropagation()}>
      <span className="float-label">{t(SHAPE_LABELS[shape.kind])}</span>
      {closed && onRotate && (
        <>
          <button className="icon-btn" title={t('15° gegen den Uhrzeigersinn drehen')} onClick={() => onRotate(-15)} data-testid="shape-rotate-ccw">
            <RotateCcw size={16} />
          </button>
          <span className="float-angle" data-testid="shape-angle">
            {shapeAngle(shape)}°
          </span>
          <button className="icon-btn" title={t('15° im Uhrzeigersinn drehen')} onClick={() => onRotate(15)} data-testid="shape-rotate-cw">
            <RotateCw size={16} />
          </button>
        </>
      )}
      {isClosedKind(shape.kind) && (
        <button className={`icon-btn${shape.fill ? ' active' : ''}`} title={t('Füllung')} onClick={onToggleFill} data-testid="shape-fill">
          <PaintBucket size={17} />
        </button>
      )}
      {onKeepFreehand && (
        <button className="btn btn-ghost float-done" title={t('Einrasten rückgängig: Originalstrich behalten')} onClick={onKeepFreehand} data-testid="shape-keep-freehand">
          <PenLine size={15} /> {t('Als Freihand')}
        </button>
      )}
      <button className="icon-btn danger" title={t('Form löschen')} onClick={onDelete} data-testid="shape-delete">
        <Trash2 size={17} />
      </button>
      <button className="btn btn-ghost float-done" onClick={onDone} data-testid="shape-done">
        {t('Fertig')}
      </button>
    </div>
  );
}

export const SHAPE_LABELS: Record<ShapeObj['kind'], string> = {
  line: tk('Linie'),
  arrow: tk('Pfeil'),
  ellipse: tk('Ellipse'),
  rect: tk('Rechteck'),
  triangle: tk('Dreieck'),
  polygon: tk('Polygon'),
};
