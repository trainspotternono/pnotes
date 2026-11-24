/**
 * Werkzeug-Engine: verteilt Pointer-Events (Stift / Maus / Touch) an Werkzeug-Handler.
 *
 *  - Mehrere gleichzeitige Gesten (Multi-Touch, z. B. zwei Personen an einem großen Display):
 *    Stift, Textmarker, Formen, Radierer und Laser bekommen pro Pointer eine eigene Handler-Instanz,
 *    einen eigenen „nassen“ Strich und eine eigene Transaktion. Auswahl, Text, Haftnotiz, Kommentar
 *    und Bild arbeiten mit genau einem Pointer.
 *  - Stift-Radiertaste (buttons & 32) = Radierer; Stift-Seitentaste (button 2) = Auswählen.
 *  - Touch zeichnet nur mit „Mit Finger zeichnen“ (sonst Navigation); Handfläche = Radierer oder ignoriert.
 *  - Zwei-Seiten-Modus und Spitzen-Erkennung: siehe ./inputRouting.ts.
 */
import { useMemo, useRef, type MutableRefObject } from 'react';
import type { Page } from '../../shared/types';
import type { InkContext, InkInput } from '../editor/PageStage';
import type { Tool, ToolState } from '../ink/tools';
import { createDrawHandler } from './draw';
import { createEraserHandler } from './eraser';
import { isStylusBarrel, isStylusEraser, routeInput, type Route } from './inputRouting';
import { createCommentHandler, createLaserHandler, createStickyHandler, createTextHandler } from './misc';
import { createSelectionHandler } from './selection';
import type { Ptr, ToolEnv, ToolHandler, WetItem } from './types';

/** Werkzeuge, die mehrere gleichzeitige Pointer erlauben (je Pointer eine eigene Instanz) */
const MULTI: Partial<Record<Tool, () => ToolHandler>> = {
  pen: () => createDrawHandler('pen'),
  highlighter: () => createDrawHandler('highlighter'),
  shape: () => createDrawHandler('shape'),
  eraser: () => createEraserHandler(),
};

interface Active {
  handler: ToolHandler;
  env: ToolEnv;
  multi: boolean;
  route: Route;
}

/** Info zu einer laufenden Geste (für Touch-Monitor/Diagnose). */
export interface GestureInfo {
  pointerId: number;
  tool: Tool;
  cls: Route['cls'];
  side: Route['side'];
}

export interface ToolEngine extends InkInput {
  gestures(): GestureInfo[];
}

export function useToolEngine(env: MutableRefObject<ToolEnv>): ToolEngine {
  const active = useRef(new Map<number, Active>());
  const wets = useRef(new Map<number, WetItem>());
  const penSeenAt = useRef(0);

  return useMemo<ToolEngine>(() => {
    const singles: Record<Tool, ToolHandler> = {
      select: createSelectionHandler('select'),
      sticky: createStickyHandler(),
      pen: createDrawHandler('pen'),
      highlighter: createDrawHandler('highlighter'),
      shape: createDrawHandler('shape'),
      eraser: createEraserHandler(),
      lasso: createSelectionHandler('lasso'),
      image: createSelectionHandler('tap'),
      text: createTextHandler(),
      laser: createLaserHandler(),
      comment: createCommentHandler(),
    };

    const ptr = (e: PointerEvent, ctx: InkContext): Ptr => {
      const r = ctx.viewportRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const d = ctx.toDoc(sx, sy);
      return { e, x: d.x, y: d.y, sx, sy, t: e.timeStamp || performance.now(), page: ctx.pageAt(d.x, d.y), ctx };
    };

    const routeFor = (e: PointerEvent, rect: { left: number; width: number }) =>
      routeInput(
        env.current.tools(),
        { pointerType: e.pointerType, width: e.width, height: e.height, clientX: e.clientX, stylusEraser: isStylusEraser(e), stylusBarrel: isStylusBarrel(e) },
        rect,
      );

    /** Umgebung einer einzelnen Geste: eigene Werkzeugeinstellungen, eigener Nass-Strich, eigene Transaktion. */
    const gestureEnv = (pointerId: number, tools: ToolState, multi: boolean): ToolEnv => {
      const base = env.current;
      let txn: Page[] | null = null;
      const wet = (w: WetItem | null) => {
        if (w) wets.current.set(pointerId, w);
        else wets.current.delete(pointerId);
        base.wetAll([...wets.current.values()]);
      };
      if (!multi) return { ...base, tools: () => tools, wet };
      return {
        ...base,
        tools: () => tools,
        wet,
        begin: () => {
          txn = base.pages();
        },
        commit: () => {
          if (txn) base.commitFrom(txn);
          txn = null;
        },
        // parallele Gesten: kein Zurücksetzen auf einen alten Stand (würde fremde Striche verwerfen)
        rollback: () => {
          if (txn) base.commitFrom(txn);
          txn = null;
        },
      };
    };

    const singleBusy = () => [...active.current.values()].some((a) => !a.multi);

    return {
      wantsPointer(e) {
        if (e.pointerType === 'pen') penSeenAt.current = performance.now();
        if (e.pointerType === 'touch') {
          const t = env.current.tools();
          // aktiver Stift in Benutzung → Touch ist Handballen
          if (!t.fingerDraws || performance.now() - penSeenAt.current < 1500) return false;
          // Handfläche ignorieren → Bühne behandelt sie wie Navigation (bzw. gar nicht während Stift-Gesten)
          const r = routeFor(e, { left: 0, width: window.innerWidth });
          if (!r) return false;
          if (!MULTI[r.tool] && singleBusy()) return false;
          return true;
        }
        return e.button === 0 || isStylusEraser(e) || isStylusBarrel(e);
      },
      down(e, ctx) {
        const rect = ctx.viewportRect();
        const route = routeFor(e, rect);
        if (!route) return;
        const factory = MULTI[route.tool];
        const multi = !!factory;
        if (!multi && singleBusy()) return;
        const handler = multi ? factory!() : singles[route.tool];
        const genv = gestureEnv(e.pointerId, route.tools, multi);
        active.current.set(e.pointerId, { handler, env: genv, multi, route });
        handler.down(ptr(e, ctx), genv);
      },
      move(e, ctx) {
        const a = active.current.get(e.pointerId);
        if (!a) return;
        const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        const all = (list.length ? list : [e]).map((ev) => ptr(ev, ctx));
        a.handler.move(all[all.length - 1], a.env, all);
      },
      up(e, ctx) {
        const a = active.current.get(e.pointerId);
        if (!a) return;
        active.current.delete(e.pointerId);
        a.handler.up(ptr(e, ctx), a.env);
      },
      cancel(e) {
        const a = active.current.get(e.pointerId);
        if (!a) return;
        active.current.delete(e.pointerId);
        a.handler.cancel(a.env);
      },
      cancelPointer(id) {
        const a = active.current.get(id);
        if (!a) return;
        active.current.delete(id);
        a.handler.cancel(a.env);
        wets.current.delete(id);
        env.current.wetAll([...wets.current.values()]);
      },
      allowTwoFingerNav: () => {
        const t = env.current.tools();
        return t.fingerDraws && t.touch.twoFingerNav;
      },
      gestures: () => [...active.current.entries()].map(([pointerId, a]) => ({ pointerId, tool: a.route.tool, cls: a.route.cls, side: a.route.side })),
    };
  }, [env]);
}
