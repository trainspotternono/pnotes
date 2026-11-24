import { memo, useEffect, useRef, useState } from 'react';
import { FileText, MoreHorizontal, Plus, RotateCw, StickyNote } from 'lucide-react';
import type { Page, PaperColor } from '../../shared/types';
import { PaperBackground } from '../paper/PaperBackground';
import { PdfCanvas } from '../pdf/PdfCanvas';
import { InkThumb } from './InkThumb';
import { RotatedBackground } from './PageStage';
import { t } from '../i18n';

const THUMB_W = 116;

/**
 * Seitenleiste mit Seitenvorschauen (SPEC §1.2 „EditorThumbnails“): Klick springt zur Seite,
 * Rechtsklick/„…“ = Seitenaktionen, Ziehen = Seite verschieben. PDF-Vorschauen werden erst beim Einblenden gerendert.
 */
export function Thumbnails({
  pages,
  defaultSize,
  paperColor,
  current,
  onSelect,
  onMenu,
  onAdd,
  onMove,
}: {
  pages: Page[];
  defaultSize: { w: number; h: number };
  paperColor: PaperColor;
  current: number;
  onSelect: (index: number) => void;
  onMenu: (index: number, x: number, y: number) => void;
  onAdd: () => void;
  onMove: (from: number, to: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);

  // Aktuelle Seite sichtbar halten
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-thumb="${current}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return (
    <aside className="thumbs" aria-label={t('Seiten')} data-testid="thumbs">
      <div className="thumbs-head">
        <span>{t('Seiten')}</span>
        <span className="thumbs-count">{pages.length}</span>
      </div>
      <div className="thumbs-list" ref={listRef}>
        {pages.map((p, i) => (
          <Thumb
            key={p.id}
            page={p}
            index={i}
            active={i === current}
            size={p.size ?? defaultSize}
            paperColor={paperColor}
            onSelect={onSelect}
            onMenu={onMenu}
            dropTarget={!!drag && drag.over === i && drag.from !== i}
            onDragStart={() => setDrag({ from: i, over: null })}
            onDragOver={() => setDrag((d) => (d && d.over !== i ? { ...d, over: i } : d))}
            onDrop={() => {
              if (drag && drag.from !== i) onMove(drag.from, i);
              setDrag(null);
            }}
            onDragEnd={() => setDrag(null)}
          />
        ))}
      </div>
      <button className="thumbs-add" onClick={onAdd} data-testid="add-page">
        <Plus size={16} strokeWidth={2} /> {t('Seite hinzufügen')}
      </button>
    </aside>
  );
}

const Thumb = memo(function Thumb({
  page,
  index,
  active,
  size,
  paperColor,
  onSelect,
  onMenu,
  dropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  page: Page;
  index: number;
  active: boolean;
  size: { w: number; h: number };
  paperColor: PaperColor;
  onSelect: (i: number) => void;
  onMenu: (i: number, x: number, y: number) => void;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const width = THUMB_W;
  const height = Math.round((THUMB_W * size.h) / size.w);
  const rotation = page.rotation ?? 0;
  const odd = rotation === 90 || rotation === 270;
  const bw = odd ? size.h : size.w;
  const bh = odd ? size.w : size.h;
  const k = width / size.w;
  const stickies = page.objects.filter((o) => o.type === 'text' && o.sticky).length;
  return (
    <div
      className={`thumb${active ? ' active' : ''}${dropTarget ? ' drop-target' : ''}`}
      data-thumb={index}
      data-testid="thumb"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-papierwerk-page', String(index));
        onDragStart();
      }}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('application/x-papierwerk-page')) return;
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(index, e.clientX, e.clientY);
      }}
    >
      <button className="thumb-page" style={{ width, height }} onClick={() => onSelect(index)} aria-label={t('Seite {n}', { n: index + 1 })}>
        <RotatedBackground rotation={rotation} baseW={bw * k} baseH={bh * k}>
          {page.pdf ? (
            <PdfCanvas pdf={page.pdf} pageW={bw} pageH={bh} cssWidth={bw * k} observe />
          ) : (
            <PaperBackground template={page.template} paperColor={paperColor} width={bw} height={bh} strokeScale={3} style={{ width: '100%', height: '100%', display: 'block' }} />
          )}
        </RotatedBackground>
        <InkThumb page={page} pageW={size.w} pageH={size.h} width={width} height={height} />
      </button>
      <div className="thumb-footer">
        {page.pdf && <FileText size={11} className="thumb-pdf-badge" aria-label={t('PDF-Seite')} />}
        {rotation !== 0 && <RotateCw size={11} className="thumb-pdf-badge" aria-label={t('Gedreht {deg}°', { deg: rotation })} />}
        {stickies > 0 && <StickyNote size={11} className="thumb-pdf-badge" aria-label={t('{n} Haftnotizen', { n: stickies })} />}
        <span>{index + 1}</span>
        <button
          className="icon-btn thumb-more"
          aria-label={t('Seitenaktionen')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onMenu(index, r.left, r.bottom + 4);
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    </div>
  );
});
