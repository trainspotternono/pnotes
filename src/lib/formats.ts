import type { Orientation, PageFormat, PaperColor, PaperTemplate } from '../../shared/types';
import { t, tk } from '../i18n';

/** 1 mm in pt (Seiteneinheit). */
export const MM = 72 / 25.4;
const mm = (w: number, h: number) => ({ w: +(w * MM).toFixed(2), h: +(h * MM).toFixed(2) });
const inch = (w: number, h: number) => ({ w: w * 72, h: h * 72 });

/** Papierformate (Hochformat, pt). ISO 216 (A/B-Reihe) und nordamerikanische Formate (ANSI). */
const FORMATS: Record<PageFormat, { w: number; h: number; dim: string }> = {
  A3: { ...mm(297, 420), dim: '297 × 420 mm' },
  A4: { w: 595.28, h: 841.89, dim: '210 × 297 mm' },
  A5: { w: 419.53, h: 595.28, dim: '148 × 210 mm' },
  A6: { ...mm(105, 148), dim: '105 × 148 mm' },
  B4: { ...mm(250, 353), dim: '250 × 353 mm' },
  B5: { ...mm(176, 250), dim: '176 × 250 mm' },
  Letter: { ...inch(8.5, 11), dim: '8,5 × 11 in' },
  Legal: { ...inch(8.5, 14), dim: '8,5 × 14 in' },
  Tabloid: { ...inch(11, 17), dim: '11 × 17 in' },
  Executive: { ...inch(7.25, 10.5), dim: '7,25 × 10,5 in' },
  Statement: { ...inch(5.5, 8.5), dim: '5,5 × 8,5 in' },
};

/** Auswahl im Dialog, nach Region gruppiert (Beschriftungen sind Übersetzungsschlüssel). */
export const FORMAT_GROUPS: { label: string; formats: PageFormat[] }[] = [
  { label: tk('ISO (Europa, international)'), formats: ['A3', 'A4', 'A5', 'A6', 'B4', 'B5'] },
  { label: tk('Nordamerika (USA, Kanada)'), formats: ['Letter', 'Legal', 'Tabloid', 'Executive', 'Statement'] },
];
export const FORMAT_OPTIONS: PageFormat[] = FORMAT_GROUPS.flatMap((g) => g.formats);

export const isPageFormat = (f: unknown): f is PageFormat => typeof f === 'string' && f in FORMATS;

/** „A3 · 297 × 420 mm“ */
export const formatLabel = (f: PageFormat) => `${f} · ${FORMATS[f].dim}`;

/** Seitengröße in pt; unbekannte Formate (z. B. aus einer neueren Version) fallen auf A4 zurück. */
export function pageSize(format: PageFormat, orientation: Orientation): { w: number; h: number } {
  const f = FORMATS[format] ?? FORMATS.A4;
  return orientation === 'landscape' ? { w: f.h, h: f.w } : { w: f.w, h: f.h };
}

/** Bekanntes Format, das einer Seitengröße (pt, beliebige Ausrichtung) am nächsten kommt – z. B. beim PDF-Import. */
export function nearestFormat(w: number, h: number): PageFormat {
  const s = Math.min(w, h);
  const l = Math.max(w, h);
  let best: PageFormat = 'A4';
  let bestD = Infinity;
  for (const f of FORMAT_OPTIONS) {
    const d = Math.abs(FORMATS[f].w - s) + Math.abs(FORMATS[f].h - l);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

/** Beschriftungen sind Übersetzungsschlüssel – beim Anzeigen mit t() übersetzen (bzw. die *Options()-Funktionen nutzen). */
export const TEMPLATE_OPTIONS: { id: PaperTemplate; label: string }[] = [
  { id: 'blank', label: tk('Blanko') },
  { id: 'ruled', label: tk('Liniert') },
  { id: 'squared', label: tk('Kariert') },
  { id: 'dotted', label: tk('Punkt') },
];

export const PAPER_COLOR_OPTIONS: { id: PaperColor; label: string }[] = [
  { id: 'white', label: tk('Weiß') },
  { id: 'yellow', label: tk('Gelb') },
  { id: 'dark', label: tk('Dunkel') },
];

export const templateOptions = () => TEMPLATE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }));
export const paperColorOptions = () => PAPER_COLOR_OPTIONS.map((o) => ({ ...o, label: t(o.label) }));
export const templateLabel = (id: PaperTemplate) => t(TEMPLATE_OPTIONS.find((o) => o.id === id)?.label ?? id);
