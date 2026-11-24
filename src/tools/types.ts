/** Gemeinsame Typen der Werkzeug-Handler (ein Handler pro Werkzeug, siehe ./index.ts). */
import type { Page, ShapeObj, Stroke } from '../../shared/types';
import type { InkContext } from '../editor/PageStage';
import type { PageRect } from '../editor/layout';
import type { UiStore } from '../editor/store';
import type { ToolState } from '../ink/tools';

/** Ein aufbereiteter Pointer-Punkt. x/y = Dokumentkoordinaten (pt), sx/sy = Viewport-px. */
export interface Ptr {
  e: PointerEvent;
  x: number;
  y: number;
  sx: number;
  sy: number;
  t: number;
  page: PageRect | null;
  ctx: InkContext;
}

export interface WetItem {
  pageIndex: number;
  stroke?: Stroke;
  shape?: Pick<ShapeObj, 'kind' | 'points' | 'color' | 'width' | 'fill' | 'dashArray'>;
}

export interface LaserPoint {
  pageIndex: number;
  x: number;
  y: number;
  t: number;
  /** Spur-Segment (eine Geste) */
  seg: number;
}

/** Flüchtige Laserpointer-Spur (wird nie gespeichert). */
export interface LaserState {
  points: LaserPoint[];
  dot: LaserPoint | null;
  active: boolean;
  releasedAt: number;
  seg: number;
}

export interface ToolEnv {
  tools(): ToolState;
  setTools(fn: (t: ToolState) => ToolState): void;
  pages(): Page[];
  /** Änderung als eigener Undo-Schritt */
  push(fn: (pages: Page[]) => Page[]): void;
  /** Live-Änderung ohne Undo-Schritt (innerhalb einer Transaktion) */
  replace(fn: (pages: Page[]) => Page[]): void;
  /** Transaktion: begin → replace… → commit (ein Undo-Schritt) oder rollback */
  begin(): void;
  commit(): void;
  rollback(): void;
  wet(w: WetItem | null): void;
  /** Alle gerade entstehenden Striche (Multi-Touch: mehrere gleichzeitig) */
  wetAll(items: WetItem[]): void;
  /** Transaktion ab einem eigenen Ausgangsstand abschließen (parallele Gesten) */
  commitFrom(base: Page[]): void;
  ui: UiStore;
  redrawUi(): void;
  laser: LaserState;
}

export interface ToolHandler {
  down(p: Ptr, env: ToolEnv): void;
  /** `all` enthält alle (coalesced) Zwischenpunkte, `p` ist der letzte. */
  move(p: Ptr, env: ToolEnv, all: Ptr[]): void;
  up(p: Ptr, env: ToolEnv): void;
  cancel(env: ToolEnv): void;
}

/** Seitenlokale Koordinaten eines Pointers relativ zu einer Seite. */
export const local = (p: { x: number; y: number }, page: PageRect) => ({ x: p.x - page.x, y: p.y - page.y });
