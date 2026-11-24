import { PALETTE, PALETTE_HIGHLIGHT, PALETTE_INK } from './palette';

/**
 * Ordner- und Umschlagfarben: zuerst die pNotes-Palette, danach weitere Farben zur Unterscheidung
 * von Ordnern (Notizbuch-Inhalt, frei wählbar). Weiß (#FFFFFF) ist nicht enthalten.
 */
export const FOLDER_COLORS = [
  PALETTE.crimson, PALETTE.crimsonDark, PALETTE.slate900, PALETTE.slate800, PALETTE.slate700, PALETTE.slate500, PALETTE.slate300, PALETTE.slate200, PALETTE.slate100,
  '#9B2421', '#9C3F19', '#925C00', '#07711C', '#305BB0', '#6F44A3', '#95356F',
  '#FF5F67', '#FF9F49', '#F7CA1D', '#63DD57', '#80C1FF', '#CEA4FA', '#FC8CC7',
];

export const DEFAULT_FOLDER_COLOR = PALETTE.crimson;
export const DEFAULT_COVER_COLOR = PALETTE.slate800;

/** Eigene Umschlagauswahl (gedeckte Töne, wirken wie Karton/Leinen). */
export const COVER_COLORS = [
  PALETTE.slate800, PALETTE.slate900, PALETTE.crimson, PALETTE.crimsonDark, PALETTE.slate700, PALETTE.slate500, PALETTE.slate300,
  '#305BB0', '#1F3B6E', '#07711C', '#2F5D50', '#6F44A3',
];

/** Stift-/Textfarben = pNotes-Palette (9 Farben, ohne Weiß). */
export const INK_COLORS = PALETTE_INK;
export const HIGHLIGHTER_COLORS = PALETTE_HIGHLIGHT;

/** Relative Helligkeit 0..1 — für lesbaren Text auf farbigen Flächen. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return 1;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const isLight = (hex: string) => luminance(hex) > 0.45;
