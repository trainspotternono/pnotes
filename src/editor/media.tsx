/** Bilder & Sticker: Import (verkleinert, als Data-URL im Seiten-JSON), Sticker-Rendering, PNG-Export, Zuschneiden. */
import { useRef, useState } from 'react';
import type { ImageObj, Page } from '../../shared/types';
import { Modal } from '../components/ui';
import { newId } from '../lib/ids';
import { refsBox, type ItemRefs } from '../ink/hit';
import { drawPageContent } from '../ink/render';
import { t } from '../i18n';

const MAX_IMAGE_PX = 1800;
/** Animierte GIFs werden unverändert übernommen (Neukodieren würde die Animation zerstören) */
const MAX_GIF_BYTES = 15 * 1024 * 1024;

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml';

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(t('Datei konnte nicht gelesen werden')));
    r.readAsDataURL(file);
  });

/** Anzahl der Einzelbilder einer GIF (WebCodecs; ohne Unterstützung: 1). */
async function gifFrameCount(file: File): Promise<number> {
  const Ctor = (globalThis as { ImageDecoder?: new (i: { data: ArrayBuffer; type: string }) => { tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null }; close(): void } }).ImageDecoder;
  if (!Ctor) return 1;
  const dec = new Ctor({ data: await file.arrayBuffer(), type: 'image/gif' });
  try {
    await dec.tracks.ready;
    return dec.tracks.selectedTrack?.frameCount ?? 1;
  } catch {
    return 1;
  } finally {
    dec.close();
  }
}

/**
 * Liest eine Bilddatei und liefert eine Data-URL. Statische Bilder werden bei Bedarf verkleinert,
 * animierte GIFs bleiben im Original (`animated: true`), damit sie auf der Seite weiterlaufen.
 */
export async function loadImageFile(file: File): Promise<{ src: string; w: number; h: number; animated?: boolean }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(t('Bild konnte nicht gelesen werden')));
      i.src = url;
    });
    if ((file.type === 'image/gif' || /\.gif$/i.test(file.name)) && (await gifFrameCount(file)) > 1) {
      if (file.size > MAX_GIF_BYTES) throw new Error(t('Animierte GIFs dürfen höchstens 15 MB groß sein.'));
      return { src: await readAsDataUrl(file), w: img.naturalWidth, h: img.naturalHeight, animated: true };
    }
    const k = Math.min(1, MAX_IMAGE_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const keepAlpha = /png|webp|gif|svg/i.test(file.type);
    return { src: c.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.9), w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const STICKERS = ['⭐', '✅', '❗', '❓', '💡', '📌', '📎', '🔥', '❤️', '👍', '🎯', '📅', '✏️', '📚', '🧠', '⚡', '🌱', '☕', '🎉', '🏆', '🔔', '⚠️', '➡️', '✨'];

/** Emoji als transparentes PNG (Sticker). */
export function renderSticker(emoji: string, size = 256): string {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.font = `${size * 0.8}px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.04);
  return c.toDataURL('image/png');
}

export function makeImageObj(src: string, w: number, h: number, page: { w: number; h: number }, center: { x: number; y: number }, sticker = false, animated = false): ImageObj {
  const maxW = sticker ? 64 : page.w * 0.6;
  const k = Math.min(1, maxW / w, (page.h * 0.6) / h);
  const dw = sticker ? 64 : w * k;
  const dh = sticker ? 64 : h * k;
  return { id: newId(), type: 'image', cx: center.x, cy: center.y, w: dw, h: dh, rotation: 0, src, naturalW: w, naturalH: h, crop: { x: 0, y: 0, w: 1, h: 1 }, sticker, ...(animated ? { animated: true } : {}) };
}

/** Rendert die Auswahl als PNG (transparenter Hintergrund, 3-fache Auflösung). */
export async function selectionToPng(page: Page, refs: ItemRefs, scale = 3): Promise<Blob | null> {
  const box = refsBox(page, refs);
  if (!box) return null;
  const pad = 8;
  const w = Math.ceil((box.maxX - box.minX + 2 * pad) * scale);
  const h = Math.ceil((box.maxY - box.minY + 2 * pad) * scale);
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(scale, 0, 0, scale, (-box.minX + pad) * scale, (-box.minY + pad) * scale);
  drawPageContent(ctx, page, { only: { strokes: new Set(refs.strokeIds), objects: new Set(refs.objectIds) } });
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ------------------------------------------------------------ Zuschneiden

type Crop = ImageObj['crop'];

/** Zuschneide-Dialog: Rahmen ziehen (Ecken) oder verschieben; Werte normiert 0..1. */
export function CropDialog({ image, onApply, onClose }: { image: ImageObj; onApply: (crop: Crop) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [crop, setCrop] = useState<Crop>(image.crop);
  const drag = useRef<{ mode: 'move' | 'nw' | 'ne' | 'se' | 'sw'; start: { x: number; y: number }; crop: Crop } | null>(null);
  const maxW = 520;
  const maxH = 380;
  const k = Math.min(maxW / image.naturalW, maxH / image.naturalH);
  const W = image.naturalW * k;
  const H = image.naturalH * k;

  const onDown = (mode: 'move' | 'nw' | 'ne' | 'se' | 'sw') => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, start: { x: e.clientX, y: e.clientY }, crop };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.start.x) / W;
    const dy = (e.clientY - d.start.y) / H;
    const c = { ...d.crop };
    const min = 0.05;
    if (d.mode === 'move') {
      c.x = Math.min(1 - c.w, Math.max(0, c.x + dx));
      c.y = Math.min(1 - c.h, Math.max(0, c.y + dy));
    } else {
      let x0 = c.x, y0 = c.y, x1 = c.x + c.w, y1 = c.y + c.h;
      if (d.mode.includes('w')) x0 = Math.min(x1 - min, Math.max(0, x0 + dx));
      if (d.mode.includes('e')) x1 = Math.max(x0 + min, Math.min(1, x1 + dx));
      if (d.mode.includes('n')) y0 = Math.min(y1 - min, Math.max(0, y0 + dy));
      if (d.mode.includes('s')) y1 = Math.max(y0 + min, Math.min(1, y1 + dy));
      Object.assign(c, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    setCrop(c);
  };

  return (
    <Modal
      title={t('Bild zuschneiden')}
      onClose={onClose}
      width={W + 48}
      testId="crop-dialog"
      footer={
        <>
          <button className="btn" onClick={() => setCrop({ x: 0, y: 0, w: 1, h: 1 })}>
            {t('Zurücksetzen')}
          </button>
          <button className="btn" onClick={onClose} data-testid="dialog-cancel">
            {t('Abbrechen')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onApply(crop);
              onClose();
            }}
            data-testid="crop-apply"
          >
            {t('Zuschneiden')}
          </button>
        </>
      }
    >
      <div ref={box} className="crop-stage" style={{ width: W, height: H }} onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
        <img src={image.src} width={W} height={H} alt="" draggable={false} />
        <div
          className="crop-rect"
          style={{ left: crop.x * W, top: crop.y * H, width: crop.w * W, height: crop.h * H }}
          onPointerDown={onDown('move')}
          data-testid="crop-rect"
        >
          {(['nw', 'ne', 'se', 'sw'] as const).map((m) => (
            <span key={m} className={`crop-handle ${m}`} onPointerDown={onDown(m)} />
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Neue Bildgröße nach dem Zuschneiden (Maßstab bleibt gleich, Mittelpunkt bleibt). */
export function applyCrop(im: ImageObj, crop: Crop): ImageObj {
  const s = im.w / (im.crop.w * im.naturalW);
  return { ...im, crop, w: s * crop.w * im.naturalW, h: s * crop.h * im.naturalH };
}
