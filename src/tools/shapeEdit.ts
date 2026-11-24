/** Ankerpunkte einer gerade erzeugten/ausgewählten Form ziehen (Ecken, Endpunkte, Ellipsenachsen). */
import type { ShapeObj } from '../../shared/types';
import { updateObject } from '../editor/doc';
import { moveAnchor, rotateKnob, rotateShapePoints, shapeAnchors, shapeCenter } from '../ink/shapes';
import { local, type Ptr, type ToolEnv, type ToolHandler } from './types';

export const ANCHOR_HIT_PX = 12;

export function editedShape(env: ToolEnv): { pageIndex: number; shape: ShapeObj } | null {
  const se = env.ui.get().shapeEdit;
  if (!se) return null;
  const shape = env.pages()[se.pageIndex]?.objects.find((o) => o.id === se.id);
  return shape && shape.type === 'shape' ? { pageIndex: se.pageIndex, shape } : null;
}

/** Index des Ankers unter dem Zeiger (oder -1). */
export function anchorUnder(p: Ptr, env: ToolEnv): number {
  const ed = editedShape(env);
  if (!ed) return -1;
  const rect = p.ctx.layout.pages[ed.pageIndex];
  const tol = ANCHOR_HIT_PX / p.ctx.zoom;
  const anchors = shapeAnchors(ed.shape);
  for (let i = 0; i < anchors.length; i++) {
    if (Math.hypot(anchors[i][0] + rect.x - p.x, anchors[i][1] + rect.y - p.y) <= tol) return i;
  }
  return -1;
}

export const ROTATE_KNOB_PX = 28;

/** Liegt der Zeiger auf dem Drehgriff der bearbeiteten Form? */
export function rotateKnobUnder(p: Ptr, env: ToolEnv): boolean {
  const ed = editedShape(env);
  if (!ed) return false;
  const k = rotateKnob(ed.shape, ROTATE_KNOB_PX / p.ctx.zoom);
  if (!k) return false;
  const rect = p.ctx.layout.pages[ed.pageIndex];
  return Math.hypot(k.knob[0] + rect.x - p.x, k.knob[1] + rect.y - p.y) <= (ANCHOR_HIT_PX * (p.e.pointerType === 'touch' ? 2 : 1)) / p.ctx.zoom;
}

/** Form am Drehgriff drehen (Umschalt = 15°-Schritte); eine Geste = ein Undo-Schritt. */
export function createRotateDrag(): ToolHandler {
  let st: { pageIndex: number; id: string; base: ShapeObj; start: number; c: [number, number] } | null = null;
  return {
    down(p, env) {
      const ed = editedShape(env);
      if (!ed) return;
      const q = local(p, p.ctx.layout.pages[ed.pageIndex]);
      const c = shapeCenter(ed.shape);
      st = { pageIndex: ed.pageIndex, id: ed.shape.id, base: ed.shape, start: Math.atan2(q.y - c[1], q.x - c[0]), c };
      env.begin();
    },
    move(p, env) {
      if (!st) return;
      const q = local(p, p.ctx.layout.pages[st.pageIndex]);
      let theta = Math.atan2(q.y - st.c[1], q.x - st.c[0]) - st.start;
      if (p.e.shiftKey) theta = Math.round(theta / (Math.PI / 12)) * (Math.PI / 12);
      const { pageIndex, id, base } = st;
      const pts = rotateShapePoints(base, theta);
      env.replace((pages) => updateObject<ShapeObj>(pages, pageIndex, id, (sh) => ({ ...sh, points: pts })));
      env.redrawUi();
    },
    up(_p, env) {
      if (st) env.commit();
      st = null;
    },
    cancel(env) {
      if (st) env.commit();
      st = null;
    },
  };
}

/** Handler für das Ziehen eines Ankers (eine Geste = ein Undo-Schritt). */
export function createAnchorDrag(index: number): ToolHandler {
  let target: { pageIndex: number; id: string } | null = null;
  return {
    down(_p, env) {
      const ed = editedShape(env);
      if (!ed) return;
      target = { pageIndex: ed.pageIndex, id: ed.shape.id };
      env.begin();
    },
    move(p, env) {
      if (!target) return;
      const rect = p.ctx.layout.pages[target.pageIndex];
      const q = local(p, rect);
      const { pageIndex, id } = target;
      env.replace((pages) => updateObject<ShapeObj>(pages, pageIndex, id, (sh) => ({ ...sh, points: moveAnchor(sh, index, q.x, q.y) })));
      env.redrawUi();
    },
    up(_p, env) {
      if (target) env.commit();
      target = null;
    },
    cancel(env) {
      if (target) env.commit();
      target = null;
    },
  };
}
