import { describe, expect, it } from 'vitest';
import type { PageFormat } from '../../shared/types';
import { FORMAT_OPTIONS, MM, formatLabel, isPageFormat, nearestFormat, pageSize } from './formats';

describe('Papierformate', () => {
  it('ISO- und nordamerikanische Formate inkl. A3 mit korrekten Maßen', () => {
    const mm = (f: PageFormat) => {
      const s = pageSize(f, 'portrait');
      return [Math.round(s.w / MM), Math.round(s.h / MM)];
    };
    expect(mm('A3')).toEqual([297, 420]);
    expect(mm('A4')).toEqual([210, 297]);
    expect(mm('A6')).toEqual([105, 148]);
    expect(mm('B5')).toEqual([176, 250]);
    expect(pageSize('Letter', 'portrait')).toEqual({ w: 612, h: 792 });
    expect(pageSize('Legal', 'portrait')).toEqual({ w: 612, h: 1008 });
    expect(pageSize('Tabloid', 'landscape')).toEqual({ w: 1224, h: 792 });
    expect(FORMAT_OPTIONS).toHaveLength(11);
    expect(formatLabel('A3')).toBe('A3 · 297 × 420 mm');
  });

  it('PDF-Import: nächstliegendes Format (auch quer), Seiten behalten ihre Größe', () => {
    expect(nearestFormat(842, 1191)).toBe('A3');
    expect(nearestFormat(1191, 842)).toBe('A3');
    expect(nearestFormat(612, 792)).toBe('Letter');
    expect(nearestFormat(612, 1008)).toBe('Legal');
    expect(nearestFormat(792, 1224)).toBe('Tabloid');
    expect(nearestFormat(595, 842)).toBe('A4');
    expect(nearestFormat(1000, 1000)).toBe('B4'); // exotisch → irgendein bekanntes Format
  });

  it('unbekanntes Format (z. B. aus neuerer Version) fällt auf A4 zurück', () => {
    expect(isPageFormat('A3')).toBe(true);
    expect(isPageFormat('A0')).toBe(false);
    expect(pageSize('A0' as PageFormat, 'portrait')).toEqual(pageSize('A4', 'portrait'));
  });
});
