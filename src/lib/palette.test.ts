/**
 * pNotes-Palette: #FFFFFF ist weder Theme- noch UI- noch Stiftfarbe.
 * Einzige dokumentierte Ausnahme: PDF_PAPER (Papierfläche importierter PDF-Dokumente, Dokumentinhalt).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOLS, STICKY_COLORS } from '../ink/tools';
import { PAPER_STYLES } from '../paper/PaperBackground';
import { FOLDER_COLORS, HIGHLIGHTER_COLORS, INK_COLORS } from './colors';
import { INK_EXTRA, PALETTE, isPureWhite } from './palette';

/** erlaubt: die 9 Farben des pNotes Color Kits + die 4 klassischen Schreibfarben */
const KIT = new Set(Object.values(PALETTE).map((c) => c.toLowerCase()));
const ALLOWED = new Set([...KIT, ...Object.values(INK_EXTRA).map((c) => c.toLowerCase())]);
const inPalette = (c: string) => ALLOWED.has(c.toLowerCase());

/** Weiß in allen üblichen Schreibweisen (nicht „white-space“, nicht die Papier-ID 'white'). */
const WHITE = /#fff\b|#ffffff\b|(?<![-\w'"])white(?![-\w'":])|rgba?\(\s*255\s*,\s*255\s*,\s*255\b|rgb\(\s*255\s+255\s+255\b/gi;

function sources(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
    }
  };
  walk(path.resolve(__dirname, '..'));
  return out;
}

describe('pNotes-Palette', () => {
  it('kein #FFFFFF in Styles, Theme-Tokens oder UI-Code (Ausnahme: PDF_PAPER)', () => {
    const hits: string[] = [];
    for (const f of sources()) {
      fs.readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/PDF_PAPER\s*=/.test(line)) return; // dokumentierte Ausnahme
          if (/isPureWhite\s*=/.test(line)) return; // der Weiß-Detektor selbst
          if (line.trim().startsWith('*') || line.trim().startsWith('//')) return; // Kommentare
          for (const m of line.matchAll(WHITE)) hits.push(`${path.basename(f)}:${i + 1}: ${m[0]}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it('tokens.css definiert alle 9 Farben des pNotes Color Kits mit den vorgegebenen Werten', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../styles/tokens.css'), 'utf8').toLowerCase();
    const spec: [string, string][] = [
      ['crimson', '#d92632'], ['crimson-dark', '#a81b25'], ['slate-100', '#f2f3f5'], ['slate-200', '#e1e4e8'], ['slate-300', '#c5cbd3'],
      ['slate-500', '#6e7781'], ['slate-700', '#32383f'], ['slate-800', '#1f242a'], ['slate-900', '#12161a'],
    ];
    for (const [name, hex] of spec) expect(css).toContain(`--pnotes-${name}: ${hex};`);
    expect(new Set(spec.map(([, h]) => h))).toEqual(KIT);
    // keine Reste der vorherigen Palette
    expect(css).not.toMatch(/--rp-|#cc0000|#fa000f|#f4f4f4|#0c0c0c/);
  });

  it('Stift-, Kugelschreiber-, Formen-, Marker-, Text-, Laser-, Notiz- und Seitenfarben stammen aus der Palette', () => {
    const t = DEFAULT_TOOLS;
    const all = [...t.pen.colors, ...t.shape.colors, ...t.highlighter.colors, t.text.color, t.laser.color, t.sticky.color, t.dual.left.color, t.dual.right.color, ...INK_COLORS, ...HIGHLIGHTER_COLORS, ...STICKY_COLORS];
    expect(all.filter((c) => !inPalette(c))).toEqual([]);
    expect(all.some(isPureWhite)).toBe(false);
    // Stift-Farbauswahl („Farbe ändern“): alle 9 Kit-Farben + #1D4ED8, #15803D, #D97706, #6D28D9
    expect(new Set(INK_COLORS.map((c) => c.toLowerCase()))).toEqual(ALLOWED);
    // Werkzeugleiste oben: höchstens 8 Farbfelder, darin die 4 Schreibfarben
    expect(t.pen.colors.length).toBe(8);
    expect(t.shape.colors.length).toBe(8);
    expect(t.highlighter.colors.length).toBeLessThanOrEqual(8);
    for (const c of ['#1d4ed8', '#15803d', '#d97706', '#6d28d9']) expect(t.pen.colors.map((x) => x.toLowerCase())).toContain(c);
  });

  it('Papier „Hell“ und Ordnerfarben ohne Weiß', () => {
    expect(PAPER_STYLES.white.bg).toBe(PALETTE.slate100);
    expect(FOLDER_COLORS.some(isPureWhite)).toBe(false);
  });
});
