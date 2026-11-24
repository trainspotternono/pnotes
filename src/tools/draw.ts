/**
 * Zeichnen mit Stift, Textmarker und Formen-Werkzeug.
 *  - Druck vom Stift (pointerType "pen"); bei Maus/Touch simuliert Füller/Pinsel den Druck über die Geschwindigkeit
 *  - coalesced Events (volle Abtastrate) und predicted Events (nur Nass-Strich)
 *  - „Zeichnen und Halten“: Zeiger ~500 ms ruhig halten → Formenerkennung, danach
 *    passt weiteres Ziehen die Form an; nach dem Absetzen erscheinen Ankerpunkte
 *  - Formen-Werkzeug: jeder Strich wird beim Absetzen erkannt
 */
import type { ShapeObj, Stroke } from '../../shared/types';
import { newId } from '../lib/ids';
import { addObjects, addStroke, withAlpha } from '../editor/doc';
import { hitObject } from '../ink/hit';
import { dashArrayFor, normalizePoints } from '../ink/geometry';
import { adjustSnapped, recognizeShape, type Recognized } from '../ink/shapes';
import { activeColor, activeWidth, type DrawTool } from '../ink/tools';
import { anchorUnder, createAnchorDrag, createRotateDrag, rotateKnobUnder } from './shapeEdit';
import { local, type Ptr, type ToolEnv, type ToolHandler } from './types';

export const HOLD_MS = 500;
const HOLD_TOLERANCE_PX = 3;

interface DrawState {
  pageIndex: number;
  ox: number;
  oy: number;
  base: Omit<Stroke, 'points'>;
  points: number[];
  predicted: number[];
  usePressure: boolean;
  simPressure: number;
  last: { sx: number; sy: number; t: number } | null;
  stillAt: { sx: number; sy: number };
  timer: number | undefined;
  snapped: { rec: Recognized; hold: [number, number]; points: number[] } | null;
  zoom: number;
}

export function createDrawHandler(kind: DrawTool): ToolHandler {
  let st: DrawState | null = null;
  let delegate: ToolHandler | null = null;

  const cfgOf = (env: ToolEnv) => env.tools()[kind];

  const shapeStyle = (env: ToolEnv): Pick<ShapeObj, 'color' | 'width' | 'fill' | 'dashArray'> => {
    const c = cfgOf(env);
    const color = activeColor(c);
    const width = activeWidth(c);
    const fill = kind === 'shape' && env.tools().shape.fill ? withAlpha(color, 0.25) : null;
    return { color, width, fill, dashArray: dashArrayFor(c.dash, width) };
  };

  const showWet = (env: ToolEnv) => {
    if (!st) return;
    if (st.snapped) {
      env.wet({ pageIndex: st.pageIndex, shape: { kind: st.snapped.rec.kind, points: st.snapped.points, ...shapeStyle(env) } });
      return;
    }
    let pts = st.predicted.length ? st.points.concat(st.predicted) : st.points;
    if (kind === 'highlighter' && env.tools().highlighter.straight) pts = straighten(pts);
    env.wet({ pageIndex: st.pageIndex, stroke: { ...st.base, points: pts } });
  };

  const trySnap = (env: ToolEnv) => {
    if (!st || st.snapped || !env.tools().holdToShape) return;
    if (st.points.length < 12) return;
    if (kind === 'highlighter') {
      // Textmarker: Halten begradigt die Markierung
      st.points = straighten(st.points);
      showWet(env);
      return;
    }
    const rec = recognizeShape(st.points, 3);
    if (!rec) return;
    const n = st.points.length;
    st.snapped = { rec, hold: [st.points[n - 3], st.points[n - 2]], points: rec.points };
    showWet(env);
  };

  const armHold = (env: ToolEnv) => {
    if (!st) return;
    window.clearTimeout(st.timer);
    st.timer = window.setTimeout(() => trySnap(env), HOLD_MS);
  };

  const pressureFor = (p: Ptr, env: ToolEnv): number => {
    if (!st) return 0.5;
    if (st.usePressure) return Math.max(0.05, Math.min(1, p.e.pressure || 0.05));
    const style = kind === 'pen' ? env.tools().pen.style : 'ballpoint';
    if (style === 'ballpoint' || kind !== 'pen') return 0.5;
    // Maus/Touch: langsamer = kräftiger (wie Tinte), geglättet
    if (st.last) {
      const dt = Math.max(1, p.t - st.last.t);
      const speed = Math.hypot(p.sx - st.last.sx, p.sy - st.last.sy) / dt;
      const target = Math.max(0.2, Math.min(0.85, 0.85 - speed * 0.22));
      st.simPressure = st.simPressure * 0.75 + target * 0.25;
    }
    return st.simPressure;
  };

  const addPoint = (p: Ptr, env: ToolEnv) => {
    if (!st) return;
    const q = { x: p.x - st.ox, y: p.y - st.oy };
    const n = st.points.length;
    const pr = pressureFor(p, env);
    st.last = { sx: p.sx, sy: p.sy, t: p.t };
    if (n >= 3 && Math.hypot(q.x - st.points[n - 3], q.y - st.points[n - 2]) < 0.4 / st.zoom) return;
    st.points.push(q.x, q.y, pr);
  };

  return {
    down(p, env) {
      // Anker einer gerade erzeugten Form ziehen
      if (kind !== 'highlighter') {
        // Drehgriff der bearbeiteten Form (Ellipse, Rechteck, Dreieck)
        if (rotateKnobUnder(p, env)) {
          delegate = createRotateDrag();
          delegate.down(p, env);
          return;
        }
        const ai = anchorUnder(p, env);
        if (ai >= 0) {
          delegate = createAnchorDrag(ai);
          delegate.down(p, env);
          return;
        }
      }
      if (!p.page) return;
      // Formen-Werkzeug: Tippen auf eine vorhandene Form wählt sie zum Bearbeiten
      if (kind === 'shape') {
        const page = env.pages()[p.page.index];
        const q = local(p, p.page);
        const hit = page && hitObject(page, q.x, q.y, 6 / p.ctx.zoom, ['shape']);
        if (hit) {
          env.ui.set({ shapeEdit: { pageIndex: p.page.index, id: hit.id }, selection: null });
          return;
        }
      }
      env.ui.set({ shapeEdit: null, selection: null });
      const c = cfgOf(env);
      const width = activeWidth(c);
      st = {
        pageIndex: p.page.index,
        ox: p.page.x,
        oy: p.page.y,
        base: {
          id: newId(),
          tool: kind === 'highlighter' ? 'highlighter' : 'pen',
          penStyle: kind === 'pen' ? env.tools().pen.style : kind === 'shape' ? 'ballpoint' : undefined,
          color: activeColor(c),
          width,
          dash: c.dash,
          dashArray: dashArrayFor(c.dash, width),
        },
        points: [],
        predicted: [],
        usePressure: p.e.pointerType === 'pen',
        simPressure: 0.6,
        last: null,
        stillAt: { sx: p.sx, sy: p.sy },
        timer: undefined,
        snapped: null,
        zoom: p.ctx.zoom,
      };
      addPoint(p, env);
      showWet(env);
      armHold(env);
    },

    move(p, env, all) {
      if (delegate) return delegate.move(p, env, all);
      if (!st) return;
      if (st.snapped) {
        const q = local(p, p.ctx.layout.pages[st.pageIndex]);
        st.snapped.points = adjustSnapped(st.snapped.rec, st.snapped.hold, [q.x, q.y]);
        showWet(env);
        return;
      }
      for (const ev of all) addPoint(ev, env);
      st.predicted = [];
      if (typeof p.e.getPredictedEvents === 'function') {
        for (const pe of p.e.getPredictedEvents().slice(0, 2)) {
          const r = p.ctx.viewportRect();
          const d = p.ctx.toDoc(pe.clientX - r.left, pe.clientY - r.top);
          st.predicted.push(d.x - st.ox, d.y - st.oy, st.usePressure ? pe.pressure || 0.5 : st.simPressure);
        }
      }
      showWet(env);
      if (Math.hypot(p.sx - st.stillAt.sx, p.sy - st.stillAt.sy) > HOLD_TOLERANCE_PX) {
        st.stillAt = { sx: p.sx, sy: p.sy };
        armHold(env);
      }
    },

    up(p, env) {
      if (delegate) {
        delegate.up(p, env);
        delegate = null;
        return;
      }
      const s = st;
      st = null;
      if (!s) return;
      window.clearTimeout(s.timer);
      env.wet(null);
      // Formen-Werkzeug erkennt beim Absetzen
      let rec = s.snapped ? { kind: s.snapped.rec.kind, points: s.snapped.points } : null;
      if (!rec && kind === 'shape') rec = recognizeShape(s.points, 3);
      if (rec && kind !== 'highlighter') {
        const shape: ShapeObj = { id: newId(), type: 'shape', kind: rec.kind, points: rec.points, ...shapeStyle(env), dash: cfgOf(env).dash };
        env.push((pages) => addObjects(pages, s.pageIndex, [shape]));
        // Originalstrich merken, damit „Als Freihand behalten“ ihn wiederherstellen kann
        const original: Stroke = { ...s.base, points: normalizePoints(s.points) };
        env.ui.set({ shapeEdit: { pageIndex: s.pageIndex, id: shape.id }, shapeOrigin: { pageIndex: s.pageIndex, id: shape.id, stroke: original } });
        return;
      }
      let pts = s.points;
      if (kind === 'highlighter' && env.tools().highlighter.straight) pts = straighten(pts);
      const stroke: Stroke = { ...s.base, points: normalizePoints(pts) };
      if (stroke.points.length >= 6) env.push((pages) => addStroke(pages, s.pageIndex, stroke));
    },

    cancel(env) {
      if (delegate) {
        delegate.cancel(env);
        delegate = null;
      }
      if (st) window.clearTimeout(st.timer);
      st = null;
      env.wet(null);
    },
  };
}

/** Gerade Linie: nur Anfangs- und Endpunkt. */
export function straighten(pts: number[]): number[] {
  if (pts.length < 6) return pts;
  const n = pts.length;
  return [pts[0], pts[1], pts[2], pts[n - 3], pts[n - 2], pts[n - 1]];
}
