/** Text-, Laserpointer- und Kommentar-Werkzeug. */
import type { TextObj } from '../../shared/types';
import { inkOn } from '../lib/palette';
import { newId } from '../lib/ids';
import { addObjects } from '../editor/doc';
import { hitObject } from '../ink/hit';
import { TEXT_LINE_HEIGHT, TEXT_PADDING } from '../ink/render';
import { local, type Ptr, type ToolEnv, type ToolHandler } from './types';

/** Text: Tippen auf eine Textbox bearbeitet sie, sonst entsteht eine neue an der Stelle. */
export function createTextHandler(): ToolHandler {
  return {
    down(p, env) {
      if (!p.page) return;
      const q = local(p, p.page);
      const page = env.pages()[p.page.index];
      const editing = env.ui.get().textEdit;
      const hit = page && hitObject(page, q.x, q.y, 2 / p.ctx.zoom, ['text']);
      if (hit) {
        if (editing?.id === hit.id) return;
        // erst wechseln (schließt eine laufende Bearbeitung ab), dann neue Transaktion = ein Undo-Schritt
        env.ui.set({ textEdit: { pageIndex: p.page.index, id: hit.id }, selection: null });
        env.begin();
        return;
      }
      if (editing) {
        // Klick daneben beendet die Bearbeitung (Textarea verliert den Fokus)
        env.ui.set({ textEdit: null });
        return;
      }
      const t = env.tools().text;
      const w = Math.min(260, p.page.w - q.x - 8);
      const h = t.size * TEXT_LINE_HEIGHT + 2 * TEXT_PADDING;
      const obj: TextObj = {
        id: newId(),
        type: 'text',
        cx: q.x + Math.max(60, w) / 2 - TEXT_PADDING,
        cy: q.y + h / 2 - TEXT_PADDING,
        w: Math.max(60, w),
        h,
        rotation: 0,
        text: '',
        font: t.font,
        size: t.size,
        color: t.color,
        background: t.background,
        align: t.align,
      };
      env.begin();
      env.replace((pages) => addObjects(pages, p.page!.index, [obj]));
      env.ui.set({ textEdit: { pageIndex: p.page.index, id: obj.id }, selection: null });
    },
    move() {},
    up() {},
    cancel() {},
  };
}

export const STICKY_SIZE = 170;

/** Haftnotiz: Tippen setzt eine neue Notiz (Text sofort bearbeiten), Tippen auf eine Notiz bearbeitet sie. */
export function createStickyHandler(): ToolHandler {
  return {
    down(p, env) {
      if (!p.page) return;
      const q = local(p, p.page);
      const page = env.pages()[p.page.index];
      const editing = env.ui.get().textEdit;
      const hit = page && hitObject(page, q.x, q.y, 2 / p.ctx.zoom, ['text']);
      if (hit && (hit as TextObj).sticky) {
        if (editing?.id === hit.id) return;
        env.ui.set({ textEdit: { pageIndex: p.page.index, id: hit.id }, selection: null });
        env.begin();
        return;
      }
      if (editing) {
        env.ui.set({ textEdit: null });
        return;
      }
      const size = Math.min(STICKY_SIZE, p.page.w * 0.45);
      const bg = env.tools().sticky.color;
      const obj: TextObj = {
        id: newId(),
        type: 'text',
        sticky: true,
        cx: Math.min(Math.max(q.x, size / 2 + 4), p.page.w - size / 2 - 4),
        cy: Math.min(Math.max(q.y, size / 2 + 4), p.page.h - size / 2 - 4),
        w: size,
        h: size,
        rotation: 0,
        text: '',
        font: 'hand',
        size: 17,
        color: inkOn(bg),
        background: bg,
        align: 'left',
      };
      env.begin();
      env.replace((pages) => addObjects(pages, p.page!.index, [obj]));
      env.ui.set({ textEdit: { pageIndex: p.page.index, id: obj.id }, selection: null });
    },
    move() {},
    up() {},
    cancel() {},
  };
}

export const LASER_TRAIL_MS = 2000;
export const LASER_DOT_FADE_MS = 600;

/** Laserpointer: Punkt oder Spur, verblasst nach ~2 s, wird nie gespeichert. */
export function createLaserHandler(): ToolHandler {
  const add = (p: Ptr, env: ToolEnv) => {
    const pg = p.page ?? p.ctx.pageAt(p.x, p.y);
    if (!pg) return;
    const pt = { pageIndex: pg.index, x: p.x - pg.x, y: p.y - pg.y, t: performance.now(), seg: env.laser.seg };
    env.laser.dot = pt;
    if (env.tools().laser.mode === 'trail') env.laser.points.push(pt);
  };
  return {
    down(p, env) {
      env.laser.active = true;
      env.laser.seg++;
      add(p, env);
      env.redrawUi();
    },
    move(_p, env, all) {
      for (const q of all) add(q, env);
      env.redrawUi();
    },
    up(_p, env) {
      env.laser.active = false;
      env.laser.releasedAt = performance.now();
      env.redrawUi();
    },
    cancel(env) {
      env.laser.active = false;
      env.laser.releasedAt = performance.now();
    },
  };
}

/** Kommentar: Tippen setzt einen (vorläufigen) Pin und öffnet die Kommentar-Seitenleiste. */
export function createCommentHandler(): ToolHandler {
  return {
    down(p, env) {
      if (!p.page) return;
      const q = local(p, p.page);
      env.ui.set({ pendingComment: { pageIndex: p.page.index, x: q.x, y: q.y }, commentsOpen: true, activeThread: null, selection: null });
    },
    move() {},
    up() {},
    cancel() {},
  };
}
