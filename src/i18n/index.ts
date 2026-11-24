/**
 * Mehrsprachigkeit (Deutsch, Englisch, Spanisch, Italienisch, Französisch).
 *
 * Gettext-Stil: Der deutsche Text ist zugleich der Schlüssel – `t('Seite drehen')`. Das Wörterbuch
 * (./dict.ts) liefert die Übersetzungen; Platzhalter in geschweiften Klammern: `t('Seite {n}', { n: 3 })`.
 * Fehlende Übersetzungen fallen auf Deutsch zurück; ein Unit-Test (i18n.test.ts) prüft, dass jeder im
 * Quelltext verwendete Schlüssel in allen Sprachen übersetzt ist.
 *
 * Standard: Systemsprache (navigator.languages = Windows-Anzeigesprache in Electron); andere Sprachen → Englisch.
 */
import { useSyncExternalStore } from 'react';
import { DICT } from './dict';

export type Lang = 'de' | 'en' | 'es' | 'it' | 'fr';
export type LangSetting = Lang | 'system';

export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'it', label: 'Italiano' },
  { id: 'fr', label: 'Français' },
];

const INDEX: Record<Exclude<Lang, 'de'>, number> = { en: 0, es: 1, it: 2, fr: 3 };
const LOCALES: Record<Lang, string> = { de: 'de-DE', en: 'en-GB', es: 'es-ES', it: 'it-IT', fr: 'fr-FR' };
const KEY = 'pw.lang';

/** Erste unterstützte Sprache aus der Systemliste; sonst Englisch (international verständlich). */
export function detectSystemLang(languages: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []): Lang {
  for (const l of languages) {
    const code = l.toLowerCase().split(/[-_]/)[0];
    if (code === 'de' || code === 'en' || code === 'es' || code === 'it' || code === 'fr') return code;
  }
  return 'en';
}

function readSetting(): LangSetting {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'system' || v === 'de' || v === 'en' || v === 'es' || v === 'it' || v === 'fr') return v;
  } catch {
    /* kein Speicher (Tests) */
  }
  // Unit-Tests laufen auf Deutsch (Quelltexte), unabhängig von der Sprache der Testmaschine
  if (typeof process !== 'undefined' && process.env?.VITEST) return 'de';
  return 'system';
}

let setting: LangSetting = readSetting();
let current: Lang = setting === 'system' ? detectSystemLang() : setting;
const listeners = new Set<() => void>();

function apply() {
  current = setting === 'system' ? detectSystemLang() : setting;
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  listeners.forEach((l) => l());
}
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const getLang = () => current;
export const getLangSetting = () => setting;
export const locale = () => LOCALES[current];

/** Sprache setzen (oder „system“) und dauerhaft speichern. */
export function setLangSetting(s: LangSetting) {
  setting = s;
  try {
    localStorage.setItem(KEY, s);
  } catch {
    /* optional */
  }
  apply();
}

/** Nur für Tests: Sprache ohne Speichern umschalten. */
export function _setLangForTest(l: Lang) {
  setting = l;
  apply();
}

/** Übersetzt einen (deutschen) Text in die aktuelle Sprache. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = key;
  if (current !== 'de') {
    const row = DICT[key];
    if (row) s = row[INDEX[current]] || key;
  }
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Markiert einen Text als Übersetzungsschlüssel (für Konstanten, die erst beim Anzeigen mit t() übersetzt werden). */
export const tk = (key: string) => key;

/** Plural-Helfer: t1 für genau 1, sonst tn (beide mit {n}). */
export const tn = (n: number, one: string, many: string, vars: Record<string, string | number> = {}) => t(n === 1 ? one : many, { n, ...vars });

/** Lässt eine Komponente bei Sprachwechsel neu rendern. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** Datum/Uhrzeit im Format der aktuellen Sprache. */
export function formatDate(ts: number, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }): string {
  return new Intl.DateTimeFormat(LOCALES[current], opts).format(ts);
}
