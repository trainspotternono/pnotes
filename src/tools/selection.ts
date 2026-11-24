/**
 * Auswahl: Lasso (Freihand-Umrandung) oder Antippen (Bild-Werkzeug), danach
 * Verschieben, Skalieren (Ecken), Drehen (Griff oben) – eine Geste = ein Undo-Schritt.
 */
import type { Page } from '../../shared/types';
import { transformItems } from '../editor/doc';
import type { Selection } from '../editor/store';
import { hitItem, hitObject, lassoSelect, objectBox, refsBox, refsCount, type Box, type ItemRefs } from '../ink/hit';
import { strokeBBox } from '../ink/geometry';

/** Rahmenauswahl: alles, was den Rahmen berührt (Begrenzungsrahmen schneidet ihn); eingravierte Elemente nicht. */
export function marqueeSelect(page: Page, rectPts: number[]): ItemRefs {
  const xs = [rectPts[0], rectPts[2], rectPts[4], rectPts[6]];
  const ys = [rectPts[1], rectPts[3], rectPts[5], rectPts[7]];
  const r = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  if (r.maxX - r.minX < 2 && r.maxY - r.minY < 2) return { strokeIds: [], objectIds: [] };
  const touches = (b: Box) => !(b.maxX < r.minX || b.minX > r.maxX || b.maxY < r.minY || b.minY > r.maxY);
  return {
    strokeIds: page.strokes.filter((s) => !s.engraved && touches(strokeBBox(s))).map((s) => s.id),
    objectIds: page.objects.filter((o) => !o.engraved && touches(objectBox(o))).map((o) => o.id),
  };
}
import { frameCorners, rotateAbout, scaleAbout, transformFrame, translate, type Frame, type Mat } from '../ink/transform';
import { local, type ToolEnv, type ToolHandler } from './types';

export const HANDLE_PX = 12;
export const ROTATE_OFFSET_PX = 28;

export function frameFromBox(b: Box, pad = 4): Frame {
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, w: b.maxX - b.minX + 2 * pad, h: b.maxY - b.minY + 2 * pad, angle: 0 };
}

export function selectionFor(page: Page, pageIndex: number, refs: ItemRefs): Selection | null {
  const box = refsBox(page, refs);
  return box && refsCount(refs) ? { pageIndex, refs, frame: frameFromBox(box) } : null;
}

/** Griffpositionen in seitenlokalen Koordinaten: 4 Ecken + Drehgriff. */
export function selectionHandles(f: Frame, zoom: number): { corners: [number, number][]; rotate: [number, number]; topMid: [number, number] } {
  const corners = frameCorners(f);
  const topMid: [number, number] = [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2];
  const off = ROTATE_OFFSET_PX / zoom;
  const rotate: [number, number] = [topMid[0] + Math.sin(f.angle) * off, topMid[1] - Math.cos(f.angle) * off];
  return { corners, rotate, topMid };
}

function insideFrame(f: Frame, x: number, y: number): boolean {
  const dx = x - f.cx;
  const dy = y - f.cy;
  const u = dx * Math.cos(-f.angle) - dy * Math.sin(-f.angle);
  const v = dx * Math.sin(-f.angle) + dy * Math.cos(-f.angle);
  return Math.abs(u) <= f.w / 2 && Math.abs(v) <= f.h / 2;
}

type Grip = { kind: 'move' } | { kind: 'rotate' } | { kind: 'scale'; corner: number };

/** Touch (Finger, passive IR-Stifte) trifft ungenauer als Maus/aktiver Stift → größere Griffzonen. */
const touchScale = (e: PointerEvent) => (e.pointerType === 'touch' ? 2 : 1);

function gripAt(sel: Selection, q: { x: number; y: number }, zoom: number, scale = 1): Grip | null {
  const tol = (HANDLE_PX * scale) / zoom;
  const h = selectionHandles(sel.frame, zoom);
  if (Math.hypot(h.rotate[0] - q.x, h.rotate[1] - q.y) <= tol) return { kind: 'rotate' };
  for (let i = 0; i < 4; i++) if (Math.hypot(h.corners[i][0] - q.x, h.corners[i][1] - q.y) <= tol) return { kind: 'scale', corner: i };
  if (insideFrame(sel.frame, q.x, q.y)) return { kind: 'move' };
  return null;
}

const DOUBLE_TAP_MS = 400;

/**
 * mode 'lasso': Freihand einkreisen. 'tap': Objekt antippen (Bild-Werkzeug).
 * 'select': Auswahl-Werkzeug – Element antippen (Strich, Form, Text, Haftnotiz, Bild), auf freier
 * Fläche Rahmen aufziehen, Umschalt/Strg = zur Auswahl hinzufügen, Doppeltippen auf Text = bearbeiten.
 */
export function createSelectionHandler(mode: 'lasso' | 'tap' | 'select'): ToolHandler {
  let drag: { grip: Grip; sel: Selection; base: Page; start: { x: number; y: number }; moved: boolean } | null = null;
  let lassoPage: number | null = null;
  let marquee: { x: number; y: number } | null = null;
  let lastTap: { id: string; t: number } | null = null;

  const startDrag = (grip: Grip, sel: Selection, q: { x: number; y: number }, env: ToolEnv) => {
    drag = { grip, sel, base: env.pages()[sel.pageIndex], start: q, moved: false };
    env.begin();
  };

  return {
    down(p, env) {
      // Doppeltippen auf Text/Haftnotiz → Text bearbeiten
      if (mode === 'select' && p.page) {
        const q = local(p, p.page);
        const page = env.pages()[p.page.index];
        const text = page && hitObject(page, q.x, q.y, 4 / p.ctx.zoom, ['text']);
        if (text && lastTap?.id === text.id && p.t - lastTap.t < DOUBLE_TAP_MS) {
          lastTap = null;
          env.ui.set({ selection: null, textEdit: { pageIndex: p.page.index, id: text.id } });
          env.begin(); // nach dem Wechsel: eigene Transaktion für die Bearbeitung
          return;
        }
        lastTap = text ? { id: text.id, t: p.t } : null;
      }
      const sel = env.ui.get().selection;
      const additive = mode === 'select' && (p.e.shiftKey || p.e.ctrlKey);
      if (sel && !additive) {
        const rect = p.ctx.layout.pages[sel.pageIndex];
        const q = local(p, rect);
        const grip = gripAt(sel, q, p.ctx.zoom, touchScale(p.e));
        if (grip) {
          startDrag(grip, sel, q, env);
          return;
        }
      }
      if (mode === 'select' && p.page) {
        const q = local(p, p.page);
        const pi = p.page.index;
        const page = env.pages()[pi];
        const hit = page && hitItem(page, q.x, q.y, (6 * touchScale(p.e)) / p.ctx.zoom);
        if (hit && additive && sel?.pageIndex === pi) {
          // Umschalt/Strg: Element zur Auswahl hinzufügen bzw. daraus entfernen
          const toggle = (ids: string[], add: string[]) => (add.length && ids.includes(add[0]) ? ids.filter((x) => x !== add[0]) : [...ids, ...add]);
          const refs = { strokeIds: toggle(sel.refs.strokeIds, hit.strokeIds), objectIds: toggle(sel.refs.objectIds, hit.objectIds) };
          env.ui.set({ selection: selectionFor(page, pi, refs), shapeEdit: null });
          return;
        }
        env.ui.set({ selection: null, shapeEdit: null, textEdit: null });
        if (hit) {
          const s = selectionFor(page, pi, hit);
          if (s) {
            env.ui.set({ selection: s });
            startDrag({ kind: 'move' }, s, q, env);
          }
          return;
        }
        // Freie Fläche: Auswahlrahmen aufziehen
        marquee = q;
        lassoPage = pi;
        env.ui.set({ lasso: { pageIndex: pi, points: [q.x, q.y, q.x, q.y, q.x, q.y, q.x, q.y] } });
        return;
      }
      env.ui.set({ selection: null, shapeEdit: null });
      if (!p.page) return;
      const q = local(p, p.page);
      if (mode === 'tap') {
        const page = env.pages()[p.page.index];
        const hit = page && hitObject(page, q.x, q.y, 4 / p.ctx.zoom);
        if (hit) {
          const s: Selection = { pageIndex: p.page.index, refs: { strokeIds: [], objectIds: [hit.id] }, frame: frameFromBox(objectBox(hit), 2) };
          env.ui.set({ selection: s });
          startDrag({ kind: 'move' }, s, q, env);
        }
        return;
      }
      lassoPage = p.page.index;
      env.ui.set({ lasso: { pageIndex: lassoPage, points: [q.x, q.y] } });
    },

    move(p, env, all) {
      if (drag) {
        const rect = p.ctx.layout.pages[drag.sel.pageIndex];
        const q = local(p, rect);
        const { frame } = drag.sel;
        let m: Mat;
        if (drag.grip.kind === 'move') {
          m = translate(q.x - drag.start.x, q.y - drag.start.y);
        } else if (drag.grip.kind === 'rotate') {
          let a = Math.atan2(q.y - frame.cy, q.x - frame.cx) - Math.atan2(drag.start.y - frame.cy, drag.start.x - frame.cx);
          if (p.e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
          m = rotateAbout(a, frame.cx, frame.cy);
        } else {
          const opp = frameCorners(frame)[(drag.grip.corner + 2) % 4];
          const d0 = Math.hypot(drag.start.x - opp[0], drag.start.y - opp[1]) || 1;
          const s = Math.max(0.05, Math.min(20, Math.hypot(q.x - opp[0], q.y - opp[1]) / d0));
          m = scaleAbout(s, opp[0], opp[1]);
        }
        drag.moved = true;
        const { sel, base } = drag;
        env.replace((pages) => transformItems(pages, base, sel.pageIndex, sel.refs, m));
        env.ui.set({ selection: { ...sel, frame: transformFrame(frame, m) } });
        return;
      }
      const lasso = env.ui.get().lasso;
      if (marquee && lasso && lassoPage !== null) {
        const q = local(p, p.ctx.layout.pages[lassoPage]);
        const m = marquee;
        env.ui.set({ lasso: { pageIndex: lassoPage, points: [m.x, m.y, q.x, m.y, q.x, q.y, m.x, q.y] } });
        return;
      }
      if (lasso && lassoPage !== null) {
        const rect = p.ctx.layout.pages[lassoPage];
        const pts = lasso.points;
        for (const ev of all) {
          const q = local(ev, rect);
          const n = pts.length;
          if (Math.hypot(q.x - pts[n - 2], q.y - pts[n - 1]) >= 1.5 / p.ctx.zoom) pts.push(q.x, q.y);
        }
        env.redrawUi();
      }
    },

    up(_p, env) {
      if (drag) {
        if (drag.moved) env.commit();
        else env.rollback();
        drag = null;
        return;
      }
      const lasso = env.ui.get().lasso;
      if (lasso && lassoPage !== null) {
        const page = env.pages()[lassoPage];
        const refs = page ? (marquee ? marqueeSelect(page, lasso.points) : lassoSelect(page, lasso.points)) : { strokeIds: [], objectIds: [] };
        env.ui.set({ lasso: null, selection: page ? selectionFor(page, lassoPage, refs) : null });
      }
      lassoPage = null;
      marquee = null;
    },

    cancel(env) {
      if (drag) env.commit();
      drag = null;
      lassoPage = null;
      marquee = null;
      env.ui.set({ lasso: null });
    },
  };
}
