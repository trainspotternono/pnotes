/**
 * Seitenbereich parsen: „1-3, 5, 8-“ → [1,2,3,5,8,…,max]. Leer = alle Seiten.
 * Liefert sortierte, eindeutige Seitennummern oder eine Fehlermeldung.
 */
import { t } from '../i18n';

export function parsePageRange(input: string, max: number): { pages: number[] } | { error: string } {
  const text = input.trim();
  if (!text) return { pages: Array.from({ length: max }, (_, i) => i + 1) };
  const set = new Set<number>();
  for (const part of text.split(/[,;]\s*|\s+(?=\d)/).map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d+)?\s*[-–]\s*(\d+)?$/.exec(part);
    if (m) {
      const a = m[1] ? Number(m[1]) : 1;
      const b = m[2] ? Number(m[2]) : max;
      if (!m[1] && !m[2]) return { error: t('Ungültiger Bereich „{part}“', { part }) };
      if (a < 1 || b > max || a > b) return { error: t('Bereich „{part}“ liegt außerhalb von 1–{max}', { part, max }) };
      for (let i = a; i <= b; i++) set.add(i);
    } else if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n < 1 || n > max) return { error: t('Seite {n} gibt es nicht (1–{max})', { n, max }) };
      set.add(n);
    } else {
      return { error: t('Nicht verstanden: „{part}“ – Beispiel: 1-3, 5, 8-', { part }) };
    }
  }
  return { pages: [...set].sort((x, y) => x - y) };
}

/** Kompakte Darstellung: [1,2,3,5,7,8] → „1-3, 5, 7-8“ */
export function formatPageRange(pages: number[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < pages.length) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(j > i ? `${pages[i]}-${pages[j]}` : `${pages[i]}`);
    i = j + 1;
  }
  return out.join(', ');
}
