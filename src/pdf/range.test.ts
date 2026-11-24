import { describe, expect, it } from 'vitest';
import { formatPageRange, parsePageRange } from './range';

describe('Seitenbereich', () => {
  it('leer = alle, Einzelseiten, Bereiche, offene Bereiche', () => {
    expect(parsePageRange('', 4)).toEqual({ pages: [1, 2, 3, 4] });
    expect(parsePageRange('1-3, 5', 10)).toEqual({ pages: [1, 2, 3, 5] });
    expect(parsePageRange('8-', 10)).toEqual({ pages: [8, 9, 10] });
    expect(parsePageRange('-2; 9', 10)).toEqual({ pages: [1, 2, 9] });
    expect(parsePageRange('3 1 2 2', 5)).toEqual({ pages: [1, 2, 3] });
  });
  it('Fehler werden verständlich gemeldet', () => {
    expect(parsePageRange('0', 5)).toHaveProperty('error');
    expect(parsePageRange('4-9', 5)).toHaveProperty('error');
    expect(parsePageRange('abc', 5)).toHaveProperty('error');
    expect(parsePageRange('5-3', 5)).toHaveProperty('error');
  });
  it('kompakte Darstellung', () => {
    expect(formatPageRange([1, 2, 3, 5, 7, 8])).toBe('1-3, 5, 7-8');
  });
});
