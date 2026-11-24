/**
 * Vollständigkeit der Übersetzungen: Jeder im Quelltext verwendete Schlüssel – t('…'), tk('…'),
 * tn(n, '…', '…') – muss in allen vier Sprachen übersetzt sein und dieselben Platzhalter haben.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DICT } from './dict';
import { _setLangForTest, detectSystemLang, t, tn } from './index';

function sourceKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && !p.includes(`${path.sep}i18n${path.sep}`)) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/\b(?:t|tk|tr)\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.set(m[1].replace(/\\'/g, "'"), p);
        for (const m of src.matchAll(/\btn\([^,]+,\s*'((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'/g)) {
          keys.set(m[1], p);
          keys.set(m[2], p);
        }
      }
    }
  };
  walk(path.resolve(__dirname, '..'));
  return keys;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('Übersetzungen', () => {
  const keys = sourceKeys();
  afterAll(() => _setLangForTest('de'));

  it('jeder verwendete Text ist in EN/ES/IT/FR übersetzt', () => {
    const missing = [...keys.keys()].filter((k) => !DICT[k] || DICT[k].some((v) => !v || !v.trim()));
    if (missing.length) console.log(`FEHLENDE SCHLÜSSEL (${missing.length}):\n${JSON.stringify(missing, null, 1)}`);
    expect(missing).toEqual([]);
  });

  it('Platzhalter stimmen in allen Sprachen überein', () => {
    const bad = Object.entries(DICT).filter(([k, v]) => v.some((x) => placeholders(x) !== placeholders(k))).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it('keine verwaisten Einträge im Wörterbuch', () => {
    const unused = Object.keys(DICT).filter((k) => !keys.has(k));
    expect(unused).toEqual([]);
  });

  it('Übersetzen mit Platzhaltern und Plural', () => {
    _setLangForTest('en');
    expect(t('Seite {n} von {total}', { n: 2, total: 5 })).toBe('Page 2 of 5');
    expect(tn(1, 'Seite eingefügt', '{n} Seiten eingefügt')).toBe('Page inserted');
    _setLangForTest('fr');
    expect(t('Einstellungen')).toBe('Paramètres');
    _setLangForTest('de');
    expect(t('Einstellungen')).toBe('Einstellungen');
  });

  it('Systemsprache: unterstützte Sprache oder Englisch', () => {
    expect(detectSystemLang(['it-IT', 'en-US'])).toBe('it');
    expect(detectSystemLang(['pl-PL', 'fr-FR'])).toBe('fr');
    expect(detectSystemLang(['pl-PL'])).toBe('en');
    expect(detectSystemLang(['de-AT'])).toBe('de');
  });
});
