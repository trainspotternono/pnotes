/** Radierer: „Gesamter Strich“ oder „Präzision“, optional „Nur Textmarker“. Formen werden ganz entfernt. */
import { erasePrecise, eraseShapes, eraseWhole, type Pt } from '../ink/erase';
import { updatePage } from '../editor/doc';
import type { Ptr, ToolEnv, ToolHandler } from './types';

export function createEraserHandler(): ToolHandler {
  let st: { last: Pt; radius: number } | null = null;

  const segment = (from: Pt, p: Ptr, env: ToolEnv) => {
    const t = env.tools();
    const opts = { highlighterOnly: t.eraser.highlighterOnly };
    const pagesTouched = new Set<number>();
    for (const q of [from, p, { x: (from.x + p.x) / 2, y: (from.y + p.y) / 2 }]) {
      const pg = p.ctx.pageAt(q.x, q.y);
      if (pg) pagesTouched.add(pg.index);
    }
    const r = st!.radius;
    for (const idx of pagesTouched) {
      const rect = p.ctx.layout.pages[idx];
      const a = { x: from.x - rect.x, y: from.y - rect.y };
      const b = { x: p.x - rect.x, y: p.y - rect.y };
      env.replace((pages) =>
        updatePage(pages, idx, (page) => {
          const strokes = t.eraser.mode === 'precision' ? erasePrecise(page.strokes, a, b, r, opts) : eraseWhole(page.strokes, a, b, r, opts);
          const objects = opts.highlighterOnly ? page.objects : eraseShapes(page.objects, a, b, r);
          return strokes === page.strokes && objects === page.objects ? page : { ...page, strokes, objects };
        }),
      );
    }
  };

  return {
    down(p, env) {
      const t = env.tools();
      st = { last: { x: p.x, y: p.y }, radius: t.eraser.sizes[t.eraser.sizeIndex] / p.ctx.zoom };
      env.ui.set({ selection: null, shapeEdit: null });
      env.begin();
      segment(st.last, p, env);
    },
    move(_p, env, all) {
      if (!st) return;
      for (const q of all) {
        segment(st.last, q, env);
        st.last = { x: q.x, y: q.y };
      }
    },
    up(_p, env) {
      if (!st) return;
      st = null;
      env.commit();
    },
    cancel(env) {
      if (st) env.commit();
      st = null;
    },
  };
}
