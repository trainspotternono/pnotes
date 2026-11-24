import { useCallback, useEffect, useState } from 'react';
import type { FontId, LineStyle, PenStyle, TextAlign } from '../../shared/types';
import { PALETTE, PALETTE_HIGHLIGHT, PALETTE_INK, PALETTE_STICKY } from '../lib/palette';

export type Tool = 'select' | 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'shape' | 'text' | 'sticky' | 'image' | 'laser' | 'comment';

/** Stift-Voreinstellung einer Display-Seite (Zwei-Seiten-Modus). Breite in pt; beim Radierer Radius in Bildschirm-px. */
export interface SidePreset {
  tool: 'pen' | 'highlighter' | 'eraser';
  color: string;
  width: number;
}

/** Touch-/Großdisplay-Einstellungen (z. B. IR-Touch-Display mit passiven Dual-Head-Stiften). */
export interface TouchConfig {
  /** Im Zeichenmodus: zwei Finger, die fast gleichzeitig und nah beieinander aufsetzen = verschieben/zoomen */
  twoFingerNav: boolean;
  /** Spitzen-Erkennung über die gemeldete Kontaktgröße (PointerEvent width/height) */
  tipDetect: boolean;
  /** ab dieser Kontaktgröße (CSS-px, größere Kante) gilt eine Berührung als „dicke Spitze“ */
  tipThreshold: number;
  thickAction: 'thick' | 'highlighter' | 'eraser';
  /** Breitenfaktor für „dicke Spitze → dicker Strich“ */
  thickFactor: number;
  /** ab dieser Kontaktgröße gilt eine Berührung als Handfläche */
  palmThreshold: number;
  palmAction: 'eraser' | 'ignore';
  /** größere Bedienelemente für große Touch-Displays */
  largeUi: boolean;
  /** Input-Debug / Touch-Monitor einblenden */
  monitor: boolean;
}

export const STICKY_COLORS = PALETTE_STICKY;
export type EraserMode = 'stroke' | 'precision';
export type DrawTool = 'pen' | 'highlighter' | 'shape';

export interface DrawConfig {
  colors: string[];
  colorIndex: number;
  widths: number[];
  widthIndex: number;
  dash: LineStyle;
}

export interface ToolState {
  tool: Tool;
  /** Werkzeug vor dem Radierer (für „Automatisch abwählen“) */
  previousTool: Tool;
  pen: DrawConfig & { style: PenStyle };
  highlighter: DrawConfig & { straight: boolean };
  shape: DrawConfig & { fill: boolean };
  eraser: { mode: EraserMode; sizes: number[]; sizeIndex: number; highlighterOnly: boolean; autoDeselect: boolean };
  text: { font: FontId; size: number; color: string; background: string | null; align: TextAlign };
  laser: { mode: 'dot' | 'trail'; color: string };
  sticky: { color: string };
  touch: TouchConfig;
  /** Zwei-Seiten-Modus: linke/rechte Display-Hälfte mit eigener Stift-Voreinstellung */
  dual: { enabled: boolean; left: SidePreset; right: SidePreset };
  /** Freihand-Strich am Ende halten → saubere Form */
  holdToShape: boolean;
  /** Touch zeichnet (sonst: Finger scrollen/zoomen, nur Stift und Maus zeichnen = Handballen-Erkennung). */
  fingerDraws: boolean;
}

/** Max. Farbfelder oben in der Werkzeugleiste je Werkzeug (alle 13 Farben bleiben über „Farbe ändern“ wählbar). */
export const TOOLBAR_COLOR_SLOTS = 8;

/** Farbfelder je Werkzeug (Stift = Füller/Kugelschreiber/Pinsel): 8 Felder aus den 13 Palettenfarben. */
export const COLOR_SLOTS = {
  pen: Math.min(TOOLBAR_COLOR_SLOTS, PALETTE_INK.length),
  shape: Math.min(TOOLBAR_COLOR_SLOTS, PALETTE_INK.length),
  highlighter: Math.min(TOOLBAR_COLOR_SLOTS, PALETTE_HIGHLIGHT.length),
} as const;

/** Stiftfarben-Felder = die ersten 8 der Palette (Dunkel, Blau, Rot, Grün, Violett, Orange, Dunkelrot, Slate 800), ohne Weiß. */
export const PEN_COLORS = PALETTE_INK.slice(0, COLOR_SLOTS.pen);

export const DEFAULT_TOOLS: ToolState = {
  tool: 'pen',
  previousTool: 'pen',
  pen: { style: 'fountain', colors: PEN_COLORS, colorIndex: 0, widths: [1.2, 2, 3.4], widthIndex: 1, dash: 'solid' },
  highlighter: { colors: PALETTE_HIGHLIGHT, colorIndex: 0, widths: [8, 14, 22], widthIndex: 1, dash: 'solid', straight: false },
  shape: { colors: PEN_COLORS, colorIndex: 0, widths: [1.2, 2, 3.4], widthIndex: 1, dash: 'solid', fill: false },
  eraser: { mode: 'stroke', sizes: [6, 14, 28], sizeIndex: 1, highlighterOnly: false, autoDeselect: false },
  text: { font: 'sans', size: 16, color: PALETTE.slate900, background: null, align: 'left' },
  laser: { mode: 'trail', color: PALETTE.crimson },
  sticky: { color: STICKY_COLORS[0] },
  touch: {
    twoFingerNav: true,
    tipDetect: false,
    tipThreshold: 12,
    thickAction: 'thick',
    thickFactor: 3,
    palmThreshold: 48,
    palmAction: 'eraser',
    largeUi: false,
    monitor: false,
  },
  dual: {
    enabled: false,
    left: { tool: 'pen', color: PALETTE.slate900, width: 2 },
    right: { tool: 'pen', color: PALETTE.crimson, width: 2 },
  },
  holdToShape: true,
  fingerDraws: false,
};

/** v3: pNotes-Palette – ältere Einstellungen behalten alles außer den (nicht mehr erlaubten) Farben */
const KEY = 'pw.tools.v3';
const OLD_KEYS = ['pw.tools.v2', 'pw.tools.v1'];

/** Gespeicherte Farben übernehmen, fehlende Felder mit Standardfarben auffüllen (ohne Doppelte). */
function fillSlots(colors: unknown, defaults: string[], count: number): string[] {
  const arr = (Array.isArray(colors) ? colors.filter((c): c is string => typeof c === 'string') : []).slice(0, count);
  const rest = defaults.filter((d) => !arr.some((c) => c.toLowerCase() === d.toLowerCase()));
  return [...arr, ...rest].slice(0, count);
}

/** Lädt Einstellungen und migriert ältere Versionen (3 Farbslots → 5). */
export function loadTools(raw: Partial<ToolState> | null): ToolState {
  if (!raw) return DEFAULT_TOOLS;
  const d = DEFAULT_TOOLS;
  const merge = <T extends object>(def: T, v: unknown): T => ({ ...def, ...(v && typeof v === 'object' ? v : {}) });
  const pen = merge(d.pen, raw.pen);
  const highlighter = merge(d.highlighter, raw.highlighter);
  const shape = merge(d.shape, raw.shape);
  const valid: Tool[] = ['select', 'pen', 'highlighter', 'eraser', 'lasso', 'shape', 'text', 'sticky', 'image', 'laser', 'comment'];
  return {
    ...d,
    ...raw,
    tool: valid.includes(raw.tool as Tool) ? (raw.tool as Tool) : 'pen',
    pen: { ...pen, colors: fillSlots(pen.colors, d.pen.colors, COLOR_SLOTS.pen), colorIndex: Math.min(pen.colorIndex, COLOR_SLOTS.pen - 1) },
    highlighter: { ...highlighter, colors: fillSlots(highlighter.colors, d.highlighter.colors, COLOR_SLOTS.highlighter), colorIndex: Math.min(highlighter.colorIndex, COLOR_SLOTS.highlighter - 1) },
    shape: { ...shape, colors: fillSlots(shape.colors, d.shape.colors, COLOR_SLOTS.shape), colorIndex: Math.min(shape.colorIndex, COLOR_SLOTS.shape - 1) },
    eraser: merge(d.eraser, raw.eraser),
    text: merge(d.text, raw.text),
    laser: merge(d.laser, raw.laser),
    sticky: merge(d.sticky, raw.sticky),
    touch: merge(d.touch, raw.touch),
    dual: (() => {
      const v = merge(d.dual, raw.dual);
      return { ...v, left: merge(d.dual.left, v.left), right: merge(d.dual.right, v.right) };
    })(),
  };
}

function load(): ToolState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return loadTools(JSON.parse(raw));
    const old = OLD_KEYS.map((k) => localStorage.getItem(k)).find(Boolean);
    return loadTools(old ? withPaletteColors(JSON.parse(old)) : null);
  } catch {
    return DEFAULT_TOOLS;
  }
}

/** Migration auf die pNotes-Palette: Farbfelder, Text-, Laser-, Notiz- und Seitenfarben zurücksetzen. */
export function withPaletteColors(raw: Partial<ToolState>): Partial<ToolState> {
  const d = DEFAULT_TOOLS;
  // Farbfelder entfernen → loadTools füllt sie mit der Palette auf
  const strip = <T extends object>(v: T | undefined) => (v ? ({ ...v, colors: undefined, colorIndex: 0 } as unknown as T) : v);
  return {
    ...raw,
    pen: strip(raw.pen),
    highlighter: strip(raw.highlighter),
    shape: strip(raw.shape),
    text: raw.text ? { ...raw.text, color: d.text.color, background: null } : raw.text,
    laser: raw.laser ? { ...raw.laser, color: d.laser.color } : raw.laser,
    sticky: d.sticky,
    dual: raw.dual ? { ...raw.dual, left: d.dual.left, right: d.dual.right } : raw.dual,
  };
}

/** Werkzeugeinstellungen (pro Gerät gemerkt). */
export function useToolState(): [ToolState, (fn: (t: ToolState) => ToolState) => void] {
  const [state, setState] = useState<ToolState>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* optional */
    }
  }, [state]);
  const update = useCallback((fn: (t: ToolState) => ToolState) => setState(fn), []);
  return [state, update];
}

export function selectTool(t: ToolState, tool: Tool): ToolState {
  if (t.tool === tool) return t;
  return { ...t, tool, previousTool: t.tool === 'eraser' ? t.previousTool : t.tool };
}

export const drawConfig = (t: ToolState, tool: DrawTool): DrawConfig => t[tool];
export const activeColor = (c: DrawConfig) => c.colors[c.colorIndex];
export const activeWidth = (c: DrawConfig) => c.widths[c.widthIndex];

const svgCursor = (svg: string, x: number, y: number, fallback = 'crosshair') =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;

/** Cursor pro Werkzeug (Radierer = Kreis in Radiergröße, Stifte = Punkt in Farbe; vgl. SPEC §1.5). */
export function cursorFor(t: ToolState, zoom: number): string {
  switch (t.tool) {
    case 'eraser': {
      const d = Math.max(6, Math.round(t.eraser.sizes[t.eraser.sizeIndex] * 2));
      const size = d + 6;
      return svgCursor(
        `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${size / 2}' cy='${size / 2}' r='${d / 2}' fill='rgba(242,243,245,0.35)' stroke='rgba(110,119,129,0.9)' stroke-width='1.5'/></svg>`,
        size / 2,
        size / 2,
      );
    }
    case 'pen':
    case 'highlighter':
    case 'shape': {
      const cfg = t[t.tool];
      const r = Math.max(2, Math.min(14, (activeWidth(cfg) * zoom) / 2));
      const size = Math.ceil(r * 2 + 4);
      return svgCursor(
        `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${size / 2}' cy='${size / 2}' r='${r}' fill='${activeColor(cfg)}' fill-opacity='${t.tool === 'highlighter' ? 0.5 : 1}' stroke='${PALETTE.slate100}' stroke-width='1'/></svg>`,
        size / 2,
        size / 2,
      );
    }
    case 'laser':
      return svgCursor(
        `<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14'><circle cx='7' cy='7' r='4' fill='${t.laser.color}' stroke='${PALETTE.slate100}' stroke-width='1.5'/></svg>`,
        7,
        7,
      );
    case 'text':
      return 'text';
    case 'comment':
      return 'copy';
    case 'sticky':
      return 'cell';
    case 'select':
    case 'lasso':
    case 'image':
      return 'default';
  }
}
