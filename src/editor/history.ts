/**
 * Undo/Redo als Folge unveränderlicher Zustände (Structural Sharing: unveränderte
 * Seiten und Striche werden zwischen den Ständen geteilt, daher speicherschonend).
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 200;

export const createHistory = <T,>(present: T): History<T> => ({ past: [], present, future: [] });

/** Neuer Zustand als eigener Undo-Schritt. */
export function push<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

/** Zustand ersetzen, ohne Undo-Schritt (z. B. live während einer Radierer-Geste). */
export function replace<T>(h: History<T>, next: T): History<T> {
  return next === h.present ? h : { ...h, present: next };
}

/** Schließt eine Transaktion ab: `base` war der Stand vor Beginn der Geste. */
export function commitFrom<T>(h: History<T>, base: T): History<T> {
  if (base === h.present) return h;
  // Parallele Gesten (Multi-Touch) mit gleichem Ausgangsstand: nur ein Undo-Schritt
  if (h.past[h.past.length - 1] === base) return { ...h, future: [] };
  return { past: [...h.past, base].slice(-HISTORY_LIMIT), present: h.present, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const prev = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest };
}
