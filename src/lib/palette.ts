/**
 * pNotes Color Kit (bewusst ohne Weiß #FFFFFF). Gleiche Werte als CSS-Variablen in
 * styles/tokens.css (--pnotes-crimson … --pnotes-slate-900). Alle Theme-, Stift- und Werkzeugfarben stammen von hier.
 */
export const PALETTE = {
  /** Primärakzent */
  crimson: '#D92632',
  /** Primärakzent Hover/Active */
  crimsonDark: '#A81B25',
  /** hellster Flächen-/Papier-Ton (Light Mode) */
  slate100: '#F2F3F5',
  /** Toolbar/Sidebar (Light Mode) */
  slate200: '#E1E4E8',
  /** Rahmen/Trennlinien (Light Mode) */
  slate300: '#C5CBD3',
  /** Sekundärtext / Icons */
  slate500: '#6E7781',
  /** Karten/Dropdowns (Dark Mode) */
  slate700: '#32383F',
  /** Toolbar/Sidebar (Dark Mode) */
  slate800: '#1F242A',
  /** App-Hintergrund (Dark Mode), dunkelste Schriftfarbe */
  slate900: '#12161A',
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Klassische Schreibfarben, die die Stift-Auswahl ergänzen (ebenfalls ohne Weiß). */
export const INK_EXTRA = {
  blue: '#1D4ED8',
  green: '#15803D',
  amber: '#D97706',
  violet: '#6D28D9',
} as const;

const P = PALETTE;
const X = INK_EXTRA;

/**
 * Stift/Kugelschreiber/Formen: 13 Farben – die 9 Kit-Farben plus 4 klassische Schreibfarben,
 * nach Nutzen für Schrift geordnet (Dunkel, Blau, Rot, Grün, Violett, Orange, dann die Slate-Töne).
 */
export const PALETTE_INK = [P.slate900, X.blue, P.crimson, X.green, X.violet, X.amber, P.crimsonDark, P.slate800, P.slate700, P.slate500, P.slate300, P.slate200, P.slate100];

/** Textmarker (halbtransparent): Akzent, Schreibfarben und Slate-Töne. */
export const PALETTE_HIGHLIGHT = [P.crimson, X.amber, X.green, X.blue, X.violet, P.slate300, P.slate500];

/** Haftnotizen: helle Slate-Töne, Crimson und Schreibfarben (Schriftfarbe passt sich an). */
export const PALETTE_STICKY = [P.slate200, P.slate100, P.slate300, P.crimson, X.amber, X.blue, P.slate500];

/** Lesbare Schrift auf einer Farbfläche: Slate 900 auf hellen, Slate 100 auf dunklen/farbigen Flächen. */
export const inkOn = (bg: string) => (relLum(bg) > 0.35 ? P.slate900 : P.slate100);

function relLum(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return 1;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * EINZIGE bewusste Ausnahme: Papierfläche gerenderter PDF-Seiten. PDFs setzen weißes Papier voraus; mit
 * Slate 100 würden importierte Dokumente (Scans, Fotos, Formulare) eingefärbt. Dokumentinhalt – keine Theme-,
 * UI- oder Stiftfarbe. Der Palettentest (palette.test.ts) erlaubt #FFFFFF nur hier.
 */
export const PDF_PAPER = '#FFFFFF';

/** true für exakt Weiß (in allen Schreibweisen) – verboten als Theme-/Stiftfarbe. */
export const isPureWhite = (c: string) => /^(#fff|#ffffff|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i.test(c.trim());
