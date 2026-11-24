/**
 * Eingabe-Zuordnung für Maus, aktiven Stift und Touch (inkl. IR-Touch-Displays mit passiven Stiften).
 *
 * Wichtig für IR-Rahmen (z. B. iiyama ProLite TE8615A-B2AG): Alle Kontakte – Finger wie Stifte –
 * kommen als pointerType "touch". `pointerId` ist pro Berührung neu und kennzeichnet keinen Stift.
 * Unterscheidbar ist nur die gemeldete Kontaktgröße (width/height), sofern der Rahmen sie liefert.
 * Darum: Zuordnung über die Display-Seite (links/rechts) und über einen Größen-Schwellenwert.
 */
import { selectTool, type SidePreset, type Tool, type ToolState } from '../ink/tools';

export type ContactClass = 'fine' | 'thick' | 'palm';
export type Side = 'left' | 'right';

/** Kontaktgröße in CSS-px (größere Kante). Geräte ohne Größenangabe melden 0 oder 1. */
export const contactSize = (e: { width?: number; height?: number }) => Math.max(e.width || 0, e.height || 0);

/** Fein / dick / Handfläche – nur für Touch-Kontakte und nur mit aktivierter Spitzen-Erkennung (Handfläche immer). */
export function classifyContact(e: { pointerType: string; width?: number; height?: number }, t: ToolState): ContactClass {
  if (e.pointerType !== 'touch') return 'fine';
  const s = contactSize(e);
  if (s >= t.touch.palmThreshold) return 'palm';
  if (t.touch.tipDetect && s >= t.touch.tipThreshold) return 'thick';
  return 'fine';
}

/** Stift-Radiertaste bzw. Radierer-Ende: button 5 / buttons-Bit 32 (Pointer Events). */
export const STYLUS_ERASER_BUTTON = 5;
type ButtonInfo = { pointerType: string; button: number; buttons: number };
export const isStylusEraser = (e: ButtonInfo) => e.pointerType === 'pen' && (e.button === STYLUS_ERASER_BUTTON || (e.buttons & 32) !== 0);
export const isStylusBarrel = (e: ButtonInfo) => e.pointerType === 'pen' && !isStylusEraser(e) && (e.button === 2 || (e.buttons & 2) !== 0);
export type StylusMode = 'eraser' | 'barrel' | null;
/** Welches Sonder-Werkzeug der Stift gerade durch einen gedrückten Knopf auslöst (für die Anzeige). */
export const stylusModeOf = (e: ButtonInfo): StylusMode => (isStylusEraser(e) ? 'eraser' : isStylusBarrel(e) ? 'barrel' : null);

export const sideOf =(clientX: number, rect: { left: number; width: number }): Side => (clientX < rect.left + rect.width / 2 ? 'left' : 'right');

const DRAW_TOOLS: Tool[] = ['pen', 'highlighter', 'eraser'];

/** Werkzeugzustand mit einer Seiten-Voreinstellung (Farbe/Breite in Slot 0). */
export function applyPreset(t: ToolState, p: SidePreset): ToolState {
  if (p.tool === 'eraser') {
    return { ...selectTool(t, 'eraser'), eraser: { ...t.eraser, sizes: [p.width, ...t.eraser.sizes.slice(1)], sizeIndex: 0 } };
  }
  const cfg = t[p.tool];
  return {
    ...selectTool(t, p.tool),
    [p.tool]: { ...cfg, colors: [p.color, ...cfg.colors.slice(1)], colorIndex: 0, widths: [p.width, ...cfg.widths.slice(1)], widthIndex: 0, dash: 'solid' },
  } as ToolState;
}

/** „Dicke Spitze“: dickerer Strich, Textmarker in gleicher Farbe oder Radierer. */
function applyThick(t: ToolState): ToolState {
  const action = t.touch.thickAction;
  if (t.tool === 'eraser') return { ...t, eraser: { ...t.eraser, sizes: t.eraser.sizes.map((s) => s * 2) } };
  if (action === 'eraser') return { ...selectTool(t, 'eraser'), eraser: { ...t.eraser, sizeIndex: 2 } };
  if (t.tool !== 'pen' && t.tool !== 'highlighter') return t;
  const cfg = t[t.tool];
  if (action === 'highlighter') {
    const color = cfg.colors[cfg.colorIndex];
    return { ...selectTool(t, 'highlighter'), highlighter: { ...t.highlighter, colors: [color, ...t.highlighter.colors.slice(1)], colorIndex: 0, widthIndex: 1 } };
  }
  return { ...t, [t.tool]: { ...cfg, widths: cfg.widths.map((w) => w * t.touch.thickFactor) } } as ToolState;
}

export interface RouteInfo {
  pointerType: string;
  width?: number;
  height?: number;
  clientX: number;
  stylusEraser: boolean;
  stylusBarrel: boolean;
}

export interface Route {
  tool: Tool;
  /** effektiver Werkzeugzustand für diese eine Geste */
  tools: ToolState;
  cls: ContactClass;
  side: Side | null;
}

/**
 * Bestimmt Werkzeug und Einstellungen für eine neue Geste – oder null (ignorieren, z. B. Handfläche).
 * Reihenfolge: Stift-Radiertaste/Seitentaste → Handfläche → Zwei-Seiten-Voreinstellung (nur in Zeichenwerkzeugen) → dicke Spitze.
 */
export function routeInput(t: ToolState, info: RouteInfo, rect: { left: number; width: number }): Route | null {
  if (info.stylusEraser) return { tool: 'eraser', tools: selectTool(t, 'eraser'), cls: 'fine', side: null };
  if (info.stylusBarrel) return { tool: 'select', tools: selectTool(t, 'select'), cls: 'fine', side: null };
  const cls = classifyContact(info, t);
  if (cls === 'palm') {
    if (t.touch.palmAction === 'ignore' || !DRAW_TOOLS.includes(t.tool)) return null;
    // Handfläche radiert mit ihrer eigenen Größe (wie ein Schwamm an der Tafel)
    const r = Math.max(20, Math.min(90, contactSize(info) / 2));
    return { tool: 'eraser', tools: { ...selectTool(t, 'eraser'), eraser: { ...t.eraser, sizes: [r, r, r], sizeIndex: 0, highlighterOnly: false } }, cls, side: null };
  }
  let tools = t;
  let side: Side | null = null;
  if (t.dual.enabled && DRAW_TOOLS.includes(t.tool)) {
    side = sideOf(info.clientX, rect);
    tools = applyPreset(t, side === 'left' ? t.dual.left : t.dual.right);
  }
  if (cls === 'thick') tools = applyThick(tools);
  return { tool: tools.tool, tools, cls, side };
}
