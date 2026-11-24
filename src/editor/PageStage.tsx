import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Page, PaperColor } from '../../shared/types';
import { PaperBackground } from '../paper/PaperBackground';
import { PdfCanvas } from '../pdf/PdfCanvas';
import {
  clampZoom, computeLayout, contentOffset, fitZoom, nearestPage, pageAt, screenToDoc, scrollForAnchor, visiblePages,
  type Layout, type PageRect, type ScrollDirection,
} from './layout';
import { MomentumScroller, VelocityTracker } from './momentum';

export interface StageHandle {
  zoomTo(zoom: number, anchor?: { sx: number; sy: number }): void;
  zoomBy(factor: number): void;
  fit(mode: 'width' | 'page'): void;
  scrollToPage(index: number, smooth?: boolean): void;
  /** Bildschirmpunkt (clientX/Y) → Seite + Seitenkoordinaten in pt (für den Touch-Monitor) */
  docAt(clientX: number, clientY: number): { page: number; x: number; y: number } | null;
}

export interface ViewInfo {
  zoom: number;
  currentPage: number;
}

/** Zeichen-Eingabe, die die Bühne an die Stift-Engine weiterreicht (Meilenstein 3). */
export interface InkInput {
  /** true = Bühne übernimmt diesen Pointer für Tinte/Radierer. */
  wantsPointer(e: PointerEvent): boolean;
  down(e: PointerEvent, ctx: InkContext): void;
  move(e: PointerEvent, ctx: InkContext): void;
  up(e: PointerEvent, ctx: InkContext): void;
  cancel(e: PointerEvent, ctx: InkContext): void;
  /** Geste eines Pointers verwerfen (z. B. wenn sich zwei Finger als Zoom-Geste herausstellen) */
  cancelPointer(pointerId: number): void;
  /** Zeichenmodus per Touch: zwei fast gleichzeitige, nahe Finger = Navigation statt zwei Striche */
  allowTwoFingerNav?(): boolean;
}

/** Zwei Touch-Kontakte innerhalb dieses Zeitfensters und Abstands gelten als Zoom/Verschieben. */
export const TWO_FINGER_MS = 160;
export const TWO_FINGER_PX = 300;

export interface InkContext {
  layout: Layout;
  zoom: number;
  /** Viewport-Punkt → Dokumentpunkt */
  toDoc(sx: number, sy: number): { x: number; y: number };
  pageAt(x: number, y: number): PageRect | null;
  viewportRect(): DOMRect;
}

/** Wird bei jeder Ansichtsänderung aufgerufen (für Canvas-Rendering der Tinte). */
export type ViewportListener = (v: {
  layout: Layout;
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}) => void;

interface Props {
  pages: Page[];
  /** Seitengröße je Seite in pt */
  sizes: { w: number; h: number }[];
  paperColor: PaperColor;
  direction: ScrollDirection;
  onView: (v: ViewInfo) => void;
  ink?: InkInput;
  onViewport?: ViewportListener;
  overlay?: React.ReactNode;
  /** DOM-Overlay, das bei jeder Ansichtsänderung neu positioniert wird (Pins, Textfeld, Auswahlleiste). */
  renderOverlay?: (v: Parameters<ViewportListener>[0]) => React.ReactNode;
  cursor?: string;
}

const WHEEL_ZOOM_SPEED = 0.0022;

export const PageStage = forwardRef<StageHandle, Props>(function PageStage(
  { pages, sizes, paperColor, direction, onView, ink, onViewport, overlay, renderOverlay, cursor },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const pendingAnchor = useRef<{ dx: number; dy: number; sx: number; sy: number } | null>(null);
  const pendingPage = useRef<number | null>(null);

  const layout = useMemo(() => computeLayout(sizes, direction), [sizes, direction]);
  const metrics = useMemo(() => ({ zoom: zoom || 1, viewportW: vp.w, viewportH: vp.h }), [zoom, vp]);
  const offset = useMemo(() => contentOffset(layout, metrics), [layout, metrics]);

  // Aktuelle Werte für Event-Handler ohne Neu-Registrierung
  const live = useRef({ layout, metrics, zoom, offset });
  live.current = { layout, metrics, zoom, offset };

  // Nachlauf nach dem Loslassen einer Verschiebe-Geste
  const momentum = useRef<MomentumScroller | null>(null);
  const tracker = useRef(new VelocityTracker());
  const stopMomentum = useCallback(() => momentum.current?.stop(), []);
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const m = new MomentumScroller(el, () => el.classList.remove('gliding'));
    momentum.current = m;
    return () => {
      m.stop();
      momentum.current = null;
    };
  }, []);

  // Viewport-Größe beobachten; beim ersten Messen auf Seitenbreite zoomen.
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setVp({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (zoom === 0 && vp.w > 0) setZoom(Math.min(1.6, fitZoom(layout.pages[0]?.w ?? 595, layout.pages[0]?.h ?? 842, vp.w, vp.h, 'width')));
  }, [zoom, vp, layout]);

  // Nach Zoom-/Layoutänderung die Scrollposition so setzen, dass der Anker stehen bleibt.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !zoom) return;
    const a = pendingAnchor.current;
    if (a) {
      const s = scrollForAnchor(layout, metrics, a.dx, a.dy, a.sx, a.sy);
      el.scrollLeft = s.left;
      el.scrollTop = s.top;
      pendingAnchor.current = null;
    }
    if (pendingPage.current !== null) {
      const p = layout.pages[Math.min(pendingPage.current, layout.pages.length - 1)];
      if (p) {
        el.scrollTop = direction === 'vertical' ? offset.y + p.y * zoom - 16 : 0;
        el.scrollLeft = direction === 'horizontal' ? offset.x + p.x * zoom - 16 : el.scrollLeft;
      }
      pendingPage.current = null;
    }
    setScroll({ left: el.scrollLeft, top: el.scrollTop });
  }, [zoom, layout, metrics, offset, direction]);

  const zoomTo = useCallback((z: number, anchor?: { sx: number; sy: number }) => {
    const el = scrollRef.current;
    const { layout: l, metrics: m, zoom: cur } = live.current;
    if (!el || !cur) return;
    momentum.current?.stop();
    const next = clampZoom(z);
    if (Math.abs(next - cur) < 1e-4) return;
    const sx = anchor?.sx ?? m.viewportW / 2;
    const sy = anchor?.sy ?? m.viewportH / 2;
    const d = screenToDoc(l, m, { left: el.scrollLeft, top: el.scrollTop }, sx, sy);
    pendingAnchor.current = { dx: d.x, dy: d.y, sx, sy };
    setZoom(next);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      zoomTo,
      zoomBy: (f) => zoomTo(live.current.zoom * f),
      fit: (mode) => {
        const { metrics: m } = live.current;
        const el = scrollRef.current;
        if (!el) return;
        stopMomentum();
        const page = nearestPage(live.current.layout, ...centerDoc(el));
        pendingPage.current = page;
        const rect = live.current.layout.pages[page];
        if (rect) setZoom(fitZoom(rect.w, rect.h, m.viewportW, m.viewportH, mode));
      },
      scrollToPage: (index, smooth = true) => {
        const el = scrollRef.current;
        const { layout: l, zoom: z, offset: o } = live.current;
        const p = l.pages[index];
        if (!el || !p) return;
        stopMomentum();
        const target = direction === 'vertical' ? { top: o.y + p.y * z - 16 } : { left: o.x + p.x * z - 16 };
        el.scrollTo({ ...target, behavior: smooth ? 'smooth' : 'auto' });
      },
      docAt: (clientX, clientY) => {
        const el = scrollRef.current;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const { layout: l, metrics: m } = live.current;
        const d = screenToDoc(l, m, { left: el.scrollLeft, top: el.scrollTop }, clientX - r.left, clientY - r.top);
        const p = pageAt(l, d.x, d.y);
        return p ? { page: p.index, x: d.x - p.x, y: d.y - p.y } : null;
      },
    }),
    [zoomTo, direction, stopMomentum],
  );

  function centerDoc(el: HTMLDivElement): [number, number] {
    const { layout: l, metrics: m } = live.current;
    const d = screenToDoc(l, m, { left: el.scrollLeft, top: el.scrollTop }, m.viewportW / 2, m.viewportH / 2);
    return [d.x, d.y];
  }

  // Beim Wechsel der Scrollrichtung die aktuelle Seite im Blick behalten.
  const lastPage = useRef(0);
  const lastDirection = useRef(direction);
  if (lastDirection.current !== direction) {
    lastDirection.current = direction;
    pendingPage.current = lastPage.current;
  }

  // Aktuelle Seite + Zoom melden
  useEffect(() => {
    if (!zoom || !scrollRef.current) return;
    const [x, y] = centerDoc(scrollRef.current);
    lastPage.current = nearestPage(layout, x, y);
    onView({ zoom, currentPage: lastPage.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, scroll, layout, onView]);

  // Viewport an Tinten-Renderer melden
  useLayoutEffect(() => {
    if (!zoom || !onViewport) return;
    onViewport({ layout, zoom, scrollLeft: scroll.left, scrollTop: scroll.top, offsetX: offset.x, offsetY: offset.y, width: vp.w, height: vp.h });
  }, [onViewport, layout, zoom, scroll, offset, vp]);

  // Strg + Mausrad / Touchpad-Pinch (kommt in Chromium als ctrl+wheel) = Zoom am Cursor
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      momentum.current?.stop();
      if (!e.ctrlKey) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const f = Math.min(1.35, Math.max(0.74, Math.exp(-e.deltaY * unit * WHEEL_ZOOM_SPEED)));
      const r = el.getBoundingClientRect();
      zoomTo(live.current.zoom * f, { sx: e.clientX - r.left, sy: e.clientY - r.top });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

  // ------------------------------------------------ Pointer: Gesten + Tinte
  const gesture = useRef<{
    touches: Map<number, { x: number; y: number }>;
    pan: { id: number; x: number; y: number; left: number; top: number } | null;
    pinch: { dist: number; zoom: number; dx: number; dy: number } | null;
    /** laufende Zeichen-/Werkzeug-Gesten: pointerId → Typ, Startzeit, letzte Position (Multi-Touch) */
    ink: Map<number, { type: string; t: number; x: number; y: number }>;
  }>({ touches: new Map(), pan: null, pinch: null, ink: new Map() });
  const spaceDown = useRef(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        spaceDown.current = true;
        scrollRef.current?.classList.add('panning-ready');
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false;
        scrollRef.current?.classList.remove('panning-ready');
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const inkCtx = useCallback((): InkContext => {
    const el = scrollRef.current!;
    const { layout: l, metrics: m, zoom: z } = live.current;
    return {
      layout: l,
      zoom: z,
      toDoc: (sx, sy) => screenToDoc(l, m, { left: el.scrollLeft, top: el.scrollTop }, sx, sy),
      pageAt: (x, y) => pageAt(l, x, y),
      viewportRect: () => el.getBoundingClientRect(),
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current!;
    const g = gesture.current;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const startPinch = () => {
      const [a, b] = [...g.touches.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const { layout: l, metrics: m, zoom: z } = live.current;
      const d = screenToDoc(l, m, { left: el.scrollLeft, top: el.scrollTop }, mid.x, mid.y);
      g.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: z, dx: d.x, dy: d.y };
      g.pan = null;
    };

    const penActive = () => [...g.ink.values()].some((v) => v.type === 'pen');
    const track = () => tracker.current.add(performance.now(), el.scrollLeft, el.scrollTop);
    const beginPan = (id: number, p: { x: number; y: number }) => {
      g.pan = { id, x: p.x, y: p.y, left: el.scrollLeft, top: el.scrollTop };
      tracker.current.reset();
      track();
    };
    const glide = () => {
      const v = tracker.current.velocity(performance.now());
      tracker.current.reset();
      momentum.current?.start(v);
      if (momentum.current?.running) el.classList.add('gliding');
    };

    const onDown = (e: PointerEvent) => {
      // Jede neue Berührung hält eine nachlaufende Ansicht sofort an (wie am Tablet)
      momentum.current?.stop();
      const p = local(e);
      const isTouch = e.pointerType === 'touch';
      // Laufende Touch-Navigation (Zoom/Verschieben): weitere Finger gehören dazu
      if (isTouch && g.pinch) {
        g.touches.set(e.pointerId, p);
        return;
      }
      // Zeichenmodus per Touch: zweiter Finger kurz nach dem ersten und nah daneben → Zoom-Geste statt zweitem Strich
      if (isTouch && ink?.allowTwoFingerNav?.()) {
        const now = performance.now();
        const partner = [...g.ink.entries()].find(([, v]) => v.type === 'touch' && now - v.t < TWO_FINGER_MS && Math.hypot(v.x - p.x, v.y - p.y) < TWO_FINGER_PX);
        if (partner) {
          const [pid, v] = partner;
          ink.cancelPointer(pid);
          g.ink.delete(pid);
          g.touches = new Map([
            [pid, { x: v.x, y: v.y }],
            [e.pointerId, p],
          ]);
          startPinch();
          return;
        }
      }
      // Zeichnen/Radieren/Auswählen – mehrere Pointer gleichzeitig möglich (Multi-Touch, zwei Personen)
      if (ink && e.button !== 1 && !spaceDown.current && !(isTouch && penActive()) && ink.wantsPointer(e)) {
        g.ink.set(e.pointerId, { type: e.pointerType, t: performance.now(), x: p.x, y: p.y });
        if (e.pointerType === 'pen') {
          // Handballen lag evtl. schon auf: laufendes Verschieben/Zoomen per Touch beenden
          g.pan = null;
          g.pinch = null;
          g.touches.clear();
        }
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* synthetische Events */
        }
        ink.down(e, inkCtx());
        e.preventDefault();
        return;
      }
      // Handballen-Erkennung: Berührungen während einer Stift-Geste ignorieren (kein Scrollen unter dem Stift)
      if (isTouch && penActive()) return;
      // Touch während anderer Zeichengesten (z. B. Handfläche im Zeichenmodus) verschiebt die Ansicht nicht
      if (isTouch && g.ink.size > 0) return;
      if (isTouch) {
        g.touches.set(e.pointerId, p);
        if (g.touches.size === 1) beginPan(e.pointerId, p);
        else if (g.touches.size === 2) startPinch();
        return;
      }
      // Mittlere Maustaste oder Leertaste + Ziehen = Verschieben
      if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
        e.preventDefault();
        beginPan(e.pointerId, p);
        el.classList.add('panning');
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignorieren */
        }
      }
    };

    const onMove = (e: PointerEvent) => {
      const gi = g.ink.get(e.pointerId);
      if (gi && ink) {
        const q = local(e);
        gi.x = q.x;
        gi.y = q.y;
        ink.move(e, inkCtx());
        return;
      }
      const p = local(e);
      if (g.touches.has(e.pointerId)) g.touches.set(e.pointerId, p);
      if (g.pinch && g.touches.size >= 2) {
        const [a, b] = [...g.touches.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const z = clampZoom((g.pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / g.pinch.dist);
        pendingAnchor.current = { dx: g.pinch.dx, dy: g.pinch.dy, sx: mid.x, sy: mid.y };
        if (Math.abs(z - live.current.zoom) > 1e-4) {
          setZoom(z);
          // Während sich der Zoom ändert, ist die Scroll-Geschwindigkeit kein Wisch → nicht nachlaufen
          tracker.current.reset();
        } else {
          const s = scrollForAnchor(live.current.layout, live.current.metrics, g.pinch.dx, g.pinch.dy, mid.x, mid.y);
          el.scrollLeft = s.left;
          el.scrollTop = s.top;
          pendingAnchor.current = null;
          track();
        }
        return;
      }
      if (g.pan && g.pan.id === e.pointerId) {
        el.scrollLeft = g.pan.left - (p.x - g.pan.x);
        el.scrollTop = g.pan.top - (p.y - g.pan.y);
        track();
      }
    };

    const onUp = (e: PointerEvent) => {
      if (g.ink.has(e.pointerId) && ink) {
        g.ink.delete(e.pointerId);
        if (e.type === 'pointercancel') ink.cancel(e, inkCtx());
        else ink.up(e, inkCtx());
        return;
      }
      g.touches.delete(e.pointerId);
      const cancelled = e.type === 'pointercancel';
      if (g.pinch && g.touches.size < 2) {
        g.pinch = null;
        const rest = [...g.touches.entries()][0];
        g.pan = rest ? { id: rest[0], x: rest[1].x, y: rest[1].y, left: el.scrollLeft, top: el.scrollTop } : null;
        if (!rest && !cancelled) glide();
      } else if (g.pan?.id === e.pointerId) {
        g.pan = null;
        el.classList.remove('panning');
        if (!cancelled) glide();
      }
    };

    // Mittlere Maustaste: Autoscroll des Browsers unterdrücken
    const onMouseDown = (e: MouseEvent) => e.button === 1 && e.preventDefault();
    // Stift „gedrückt halten“ bzw. Seitentaste löst unter Windows ein Kontextmenü aus – auf der Bühne nie gewünscht
    const onContextMenu = (e: Event) => e.preventDefault();

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, [ink, inkCtx]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setScroll({ left: el.scrollLeft, top: el.scrollTop });
  }, []);

  // Nur sichtbare Seiten (plus Vorlauf) bekommen ihre SVG-Vorlage.
  const z = zoom || 1;
  const viewDoc = { x: (scroll.left - offset.x) / z, y: (scroll.top - offset.y) / z, w: vp.w / z, h: vp.h / z };
  const visible = new Set(visiblePages(layout, viewDoc, 600).map((p) => p.index));

  return (
    <div className="stage" data-zoom={zoom.toFixed(3)}>
      <div ref={scrollRef} className="stage-scroll" onScroll={onScroll} style={{ cursor }} data-testid="stage">
        <div className="stage-content" style={{ width: offset.scrollW, height: offset.scrollH }}>
          {zoom > 0 &&
            layout.pages.map((p) => (
              <PageSheet
                key={pages[p.index].id}
                rect={p}
                left={offset.x + p.x * z}
                top={offset.y + p.y * z}
                zoom={z}
                template={pages[p.index].template}
                pdf={pages[p.index].pdf}
                rotation={pages[p.index].rotation ?? 0}
                paperColor={paperColor}
                visible={visible.has(p.index)}
              />
            ))}
        </div>
      </div>
      {overlay}
      {renderOverlay && zoom > 0 && (
        <div className="dom-overlay">
          {renderOverlay({ layout, zoom, scrollLeft: scroll.left, scrollTop: scroll.top, offsetX: offset.x, offsetY: offset.y, width: vp.w, height: vp.h })}
        </div>
      )}
    </div>
  );
});

const PageSheet = memo(function PageSheet({
  rect,
  left,
  top,
  zoom,
  template,
  pdf,
  rotation,
  paperColor,
  visible,
}: {
  rect: PageRect;
  left: number;
  top: number;
  zoom: number;
  template: Page['template'];
  pdf?: Page['pdf'];
  rotation: number;
  paperColor: PaperColor;
  visible: boolean;
}) {
  const cssW = rect.w * zoom;
  // Hintergrund in unverdrehter Größe, per CSS gedreht (Inhalte liegen bereits in der gedrehten Lage)
  const odd = rotation === 90 || rotation === 270;
  const bw = odd ? rect.h : rect.w;
  const bh = odd ? rect.w : rect.h;
  return (
    <div className={`page-sheet${pdf ? ' is-pdf' : ''}`} style={{ left, top, width: cssW, height: rect.h * zoom }} data-testid="page" data-page={rect.index} data-rotation={rotation}>
      <RotatedBackground rotation={rotation} baseW={bw * zoom} baseH={bh * zoom}>
        {pdf ? (
          // PDF-Seite: nur sichtbare Seiten werden gerendert (lazy), Auflösung folgt dem Zoom in Stufen
          <PdfCanvas pdf={pdf} pageW={bw} pageH={bh} cssWidth={bw * zoom} active={visible} />
        ) : visible ? (
          <PaperBackground template={template} paperColor={paperColor} width={bw} height={bh} style={{ width: '100%', height: '100%', display: 'block' }} />
        ) : (
          <div className={`page-placeholder paper-${paperColor}`} />
        )}
      </RotatedBackground>
    </div>
  );
});

/** Dreht einen Hintergrund (Größe baseW×baseH in CSS-px) um seinen Mittelpunkt in die Seitenlage. */
export function RotatedBackground({ rotation, baseW, baseH, children }: { rotation: number; baseW: number; baseH: number; children: React.ReactNode }) {
  if (!rotation) return <>{children}</>;
  const odd = rotation === 90 || rotation === 270;
  const outerW = odd ? baseH : baseW;
  const outerH = odd ? baseW : baseH;
  return (
    <div
      className="rotated-bg"
      style={{ position: 'absolute', width: baseW, height: baseH, left: (outerW - baseW) / 2, top: (outerH - baseH) / 2, transform: `rotate(${rotation}deg)` }}
    >
      {children}
    </div>
  );
}
