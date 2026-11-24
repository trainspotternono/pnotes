/**
 * Flüchtiger Editor-UI-Zustand (nicht im Dokument gespeichert): Auswahl, Lasso,
 * Formbearbeitung, Textbearbeitung, Kommentar-Panel. Kleiner externer Store, damit
 * Werkzeug-Handler ihn ohne React-Re-Render des ganzen Editors ändern können.
 */
import { useSyncExternalStore } from 'react';
import type { Stroke } from '../../shared/types';
import type { ItemRefs } from '../ink/hit';
import type { Frame } from '../ink/transform';

export interface Selection {
  pageIndex: number;
  refs: ItemRefs;
  frame: Frame;
}

export interface EditorUi {
  selection: Selection | null;
  lasso: { pageIndex: number; points: number[] } | null;
  shapeEdit: { pageIndex: number; id: string } | null;
  /** Ursprünglicher Freihandstrich der zuletzt eingerasteten Form („Als Freihand behalten“) */
  shapeOrigin: { pageIndex: number; id: string; stroke: Stroke } | null;
  textEdit: { pageIndex: number; id: string } | null;
  commentsOpen: boolean;
  activeThread: { pageIndex: number; id: string } | null;
  pendingComment: { pageIndex: number; x: number; y: number } | null;
  cropImage: { pageIndex: number; id: string } | null;
}

export const INITIAL_UI: EditorUi = {
  selection: null,
  lasso: null,
  shapeEdit: null,
  shapeOrigin: null,
  textEdit: null,
  commentsOpen: false,
  activeThread: null,
  pendingComment: null,
  cropImage: null,
};

export interface UiStore {
  get(): EditorUi;
  set(patch: Partial<EditorUi> | ((s: EditorUi) => Partial<EditorUi>)): void;
  subscribe(l: () => void): () => void;
}

export function createUiStore(initial: EditorUi = INITIAL_UI): UiStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      const keys = Object.keys(p) as (keyof EditorUi)[];
      if (keys.every((k) => state[k] === p[k])) return;
      state = { ...state, ...p };
      listeners.forEach((l) => l());
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function useUi<T>(store: UiStore, select: (s: EditorUi) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
