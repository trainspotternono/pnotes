import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowLeftRight, ArrowUp, ArrowUpDown, ChevronsDownUp, ClipboardCopy, ClipboardPaste, Copy, Download, Eraser, FilePlus2, FileText,
  FileUp, Hash, Maximize, Settings, MessageSquare, MoreHorizontal, MousePointer2, PanelLeft, Presentation, Redo2, RotateCw, Trash2, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { ImageObj, NotebookMeta, Page, PaperTemplate, ShapeObj, TextObj } from '../../shared/types';
import { Menu, PromptDialog, useMenu, useToast, type MenuItem } from '../components/ui';
import { api } from '../lib/api';
import { pageSize, TEMPLATE_OPTIONS } from '../lib/formats';
import { isTitleTaken, patchNotebook, rename } from '../lib/library';
import { normalizeContent } from '../lib/notebook';
import { useLibrary } from '../state/library';
import { InkLayer, type InkLayerHandle, type Viewport } from '../ink/InkLayer';
import { measureTextHeight } from '../ink/render';
import { cursorFor, selectTool, useToolState, type Tool, type ToolState } from '../ink/tools';
import { translate } from '../ink/transform';
import { useToolEngine } from '../tools';
import { frameFromBox, selectionFor } from '../tools/selection';
import type { LaserState, ToolEnv } from '../tools/types';
import { CommentsPanel, type CommentActions } from './CommentsPanel';
import { PdfImportDialog } from '../pdf/PdfImportDialog';
import * as D from './doc';
import * as H from './history';
import type { ScrollDirection } from './layout';
import { applyCrop, CropDialog, downloadBlob, IMAGE_ACCEPT, loadImageFile, makeImageObj, renderSticker, selectionToPng } from './media';
import { ExportDialog } from '../export/ExportDialog';
import { t, tn } from '../i18n';
import { openSettings } from '../settings/SettingsDialog';
import { CalibrateDialog, DualChips, DualDivider, TouchSettingsPopover, touchButtonClass } from './TouchPanel';
import { TouchMonitor } from './TouchMonitor';
import { CommentPins, SelectionBar, ShapeBar, TextEditor, type SelectionActions } from './Overlay';
import { PageStage, type StageHandle, type ViewInfo, type ViewportListener } from './PageStage';
import * as P from './pages';
import { createUiStore, useUi } from './store';
import { Thumbnails } from './Thumbnails';
import { TOOL_KEYS, ToolPalette } from './ToolPalette';
import { StylusIndicator, useStylusMode } from './StylusIndicator';
import { ClearPageDialog } from './ClearPageDialog';
import { UiLayer, type UiLayerHandle } from './UiLayer';
import { objectBox } from '../ink/hit';
import { rotateShapePoints } from '../ink/shapes';

const pref = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* optional */
    }
  },
};

/** Interne Zwischenablage (über Notizbücher hinweg innerhalb der Sitzung). */
let clipboard: D.ClipboardItems | null = null;
/** Seiten-Zwischenablage: „Seite kopieren“ → in diesem oder einem anderen Notizbuch „Seite einfügen“. */
let pageClipboard: Page[] | null = null;

/** Beschriftung der Einbetten-Aktion je nach Auswahl. */
function engraveLabelFor(page: Page, refs: { strokeIds: string[]; objectIds: string[] }): string {
  const objs = page.objects.filter((o) => refs.objectIds.includes(o.id));
  if (refs.strokeIds.length === 0 && objs.length > 0 && objs.every((o) => o.type === 'text' && !o.sticky)) return t('Text einbetten');
  if (objs.length === 0 && refs.strokeIds.length > 0) return t('Handschrift eingravieren');
  return t('Eingravieren');
}

export function EditorView({ meta, onBack }: { meta: NotebookMeta; onBack: () => void }) {
  const { lib, update } = useLibrary();
  const toast = useToast();
  const [hist, setHist] = useState<H.History<Page[]> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<ViewInfo>({ zoom: 1, currentPage: 0 });
  const [direction, setDirection] = useState<ScrollDirection>(() => (pref.get(`pw.dir.${meta.id}`) as ScrollDirection) || 'vertical');
  const [showThumbs, setShowThumbs] = useState(() => pref.get('pw.thumbs') !== '0');
  const [showResolved, setShowResolved] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [goto, setGoto] = useState(false);
  /** Seite, für die der „Seite leeren“-Dialog offen ist */
  const [clearIndex, setClearIndex] = useState<number | null>(null);
  const stage = useRef<StageHandle>(null);
  const moreMenu = useMenu();
  const zoomMenu = useMenu();
  const pageMenu = useMenu();
  const [pageMenuIndex, setPageMenuIndex] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [exporting, setExporting] = useState(false);
  const [touchPop, setTouchPop] = useState<DOMRect | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [, setPageClipTick] = useState(0);

  const size = useMemo(() => pageSize(meta.format, meta.orientation), [meta.format, meta.orientation]);
  const pages = hist?.present ?? null;
  /** Seitengröße je Seite (importierte PDF-Seiten haben ihre eigene Größe) */
  const sizes = useMemo(() => (pages ?? []).map((p) => p.size ?? size), [pages, size]);
  const pageSizeAt = (i: number) => pages?.[i]?.size ?? size;

  // ------------------------------------------------------------ Laden
  useEffect(() => {
    let alive = true;
    api
      .loadNotebook(meta.id)
      .then((raw) => alive && setHist(H.createHistory(normalizeContent(raw, meta.id, meta.template).pages)))
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [meta.id, meta.template]);

  // ------------------------------------------------------------ Speichern (Autosave)
  const savedPages = useRef<Page[] | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const latestPages = useRef<Page[] | null>(null);
  latestPages.current = pages;

  const save = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const current = latestPages.current;
    if (!current || current === savedPages.current) return;
    try {
      await api.saveNotebook({ version: 1, id: meta.id, pages: current });
      savedPages.current = current;
      update((l) => patchNotebook(l, meta.id, { pageCount: current.length, updatedAt: Date.now() }));
    } catch (e) {
      toast(t('Speichern fehlgeschlagen: {error}', { error: (e as Error).message }));
    }
  }, [meta.id, update, toast]);

  useEffect(() => {
    if (!pages) return;
    if (savedPages.current === null) {
      savedPages.current = pages;
      return;
    }
    if (pages === savedPages.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(), 600);
  }, [pages, save]);

  useEffect(() => {
    const onUnload = () => {
      const current = latestPages.current;
      if (current && current !== savedPages.current) api.saveNotebookSync({ version: 1, id: meta.id, pages: current });
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      void save();
    };
  }, [meta.id, save]);

  // ------------------------------------------------------------ Werkzeuge, UI-Zustand, Engine
  const [tools, setTools] = useToolState();
  // Stift-Radiertaste / Seitentaste gedrückt → vorübergehend Radierer bzw. Auswählen anzeigen
  const [stylusMode, stylusNode] = useStylusMode();
  const stylusTool: Tool | null = stylusMode === 'eraser' ? 'eraser' : stylusMode === 'barrel' ? 'select' : null;
  const shownTools = stylusTool ? selectTool(tools, stylusTool) : tools;
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const store = useMemo(() => createUiStore(), []);
  const ui = useUi(store, (s) => s);
  const inkLayer = useRef<InkLayerHandle | null>(null);
  const uiLayer = useRef<UiLayerHandle | null>(null);
  const laser = useRef<LaserState>({ points: [], dot: null, active: false, releasedAt: 0, seg: 0 });
  const histRef = useRef(hist);
  histRef.current = hist;
  const txnBase = useRef<Page[] | null>(null);

  const env = useRef<ToolEnv>(null!);
  env.current = {
    tools: () => toolsRef.current,
    setTools,
    pages: () => histRef.current?.present ?? [],
    push: (fn) => setHist((h) => (h ? H.push(h, fn(h.present)) : h)),
    replace: (fn) => setHist((h) => (h ? H.replace(h, fn(h.present)) : h)),
    begin: () => {
      txnBase.current = histRef.current?.present ?? null;
    },
    commit: () => {
      const base = txnBase.current;
      txnBase.current = null;
      if (base) setHist((h) => (h ? H.commitFrom(h, base) : h));
    },
    rollback: () => {
      const base = txnBase.current;
      txnBase.current = null;
      if (base) setHist((h) => (h ? H.replace(h, base) : h));
    },
    wet: (w) => inkLayer.current?.drawWet(w),
    wetAll: (items) => inkLayer.current?.drawWetAll(items),
    commitFrom: (base) => setHist((h) => (h ? H.commitFrom(h, base) : h)),
    ui: store,
    redrawUi: () => uiLayer.current?.redraw(),
    laser: laser.current,
  };
  const engine = useToolEngine(env);

  const onViewport = useCallback<ViewportListener>((v) => {
    inkLayer.current?.setViewport(v);
    uiLayer.current?.setViewport(v);
  }, []);

  // Radierer „Automatisch abwählen“: nach einer Radier-Geste zurück zum vorherigen Werkzeug
  const lastHist = useRef(hist);
  useEffect(() => {
    if (lastHist.current !== hist && hist && lastHist.current && hist.past.length > lastHist.current.past.length) {
      setTools((s) => (s.tool === 'eraser' && s.eraser.autoDeselect ? selectTool(s, s.previousTool) : s));
    }
    lastHist.current = hist;
  }, [hist, setTools]);

  // Textbearbeitung beenden, sobald textEdit wechselt (Klick daneben, Escape, Werkzeugwechsel)
  useEffect(() => {
    let prev = store.get().textEdit;
    return store.subscribe(() => {
      const cur = store.get().textEdit;
      if (prev && prev.id !== cur?.id) finishText(prev.pageIndex, prev.id);
      prev = cur;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  function finishText(pageIndex: number, id: string) {
    const base = txnBase.current;
    const obj = histRef.current?.present[pageIndex]?.objects.find((o) => o.id === id) as TextObj | undefined;
    const existedBefore = !!base?.[pageIndex]?.objects.some((o) => o.id === id);
    // Leere Textboxen verschwinden; leere Haftnotizen bleiben (Notizzettel ohne Text ist erlaubt)
    if (!obj || (!obj.text.trim() && !obj.sticky)) {
      if (!existedBefore) {
        env.current.rollback();
        return;
      }
      env.current.replace((p) => D.removeObject(p, pageIndex, id));
    }
    env.current.commit();
  }

  // Werkzeugwechsel räumt kontextabhängige Zustände auf
  useEffect(() => {
    const keepSel = tools.tool === 'lasso' || tools.tool === 'image' || tools.tool === 'select';
    store.set((s) => ({
      selection: keepSel ? s.selection : null,
      shapeEdit: tools.tool === 'pen' || tools.tool === 'shape' ? s.shapeEdit : null,
      textEdit: tools.tool === 'text' || tools.tool === 'sticky' || tools.tool === 'select' ? s.textEdit : null,
      pendingComment: tools.tool === 'comment' ? s.pendingComment : null,
    }));
  }, [tools.tool, store]);

  // ------------------------------------------------------------ Änderungen
  const apply = useCallback((fn: (p: Page[]) => Page[]) => setHist((h) => (h ? H.push(h, fn(h.present)) : h)), []);
  const clearTransient = useCallback(() => store.set({ selection: null, shapeEdit: null, textEdit: null }), [store]);
  const undo = useCallback(() => {
    clearTransient();
    setHist((h) => (h ? H.undo(h) : h));
  }, [clearTransient]);
  const redo = useCallback(() => {
    clearTransient();
    setHist((h) => (h ? H.redo(h) : h));
  }, [clearTransient]);

  const current = Math.min(view.currentPage, (pages?.length ?? 1) - 1);

  const addPage = useCallback(
    (at: number) => {
      const template = pages?.[Math.max(0, at - 1)]?.template ?? meta.template;
      apply((p) => P.insertPage(p, at, template));
      window.setTimeout(() => stage.current?.scrollToPage(at), 30);
    },
    [apply, pages, meta.template],
  );

  const setDir = (d: ScrollDirection) => {
    setDirection(d);
    pref.set(`pw.dir.${meta.id}`, d);
  };

  const toggleThumbs = () =>
    setShowThumbs((s) => {
      pref.set('pw.thumbs', s ? '0' : '1');
      return !s;
    });

  /** Mittelpunkt des sichtbaren Bereichs der aktuellen Seite (für eingefügte Objekte). */
  const visibleCenter = (): { pageIndex: number; x: number; y: number } => {
    const pi = current;
    const s = pageSizeAt(pi);
    return { pageIndex: pi, x: s.w / 2, y: Math.min(s.h / 2, 260) };
  };

  // ------------------------------------------------------------ Auswahl-Aktionen
  const sel = ui.selection;
  const selPage = sel && pages ? pages[sel.pageIndex] : null;

  const selectionActions: SelectionActions | null =
    sel && selPage
      ? {
          onColor: (c) => apply((p) => D.recolorItems(p, sel.pageIndex, sel.refs, c)),
          onCopy: () => {
            clipboard = D.copyItems(selPage, sel.refs);
            toast(t('Kopiert'));
          },
          onCut: () => {
            clipboard = D.copyItems(selPage, sel.refs);
            apply((p) => D.removeItems(p, sel.pageIndex, sel.refs));
            store.set({ selection: null });
          },
          onDuplicate: () => duplicateSelection(),
          onDelete: () => {
            apply((p) => D.removeItems(p, sel.pageIndex, sel.refs));
            store.set({ selection: null });
          },
          onExportPng: async () => {
            const blob = await selectionToPng(selPage, sel.refs);
            if (blob) downloadBlob(blob, `${meta.title.replace(/[\\/:*?"<>|]/g, '_')}-${t('Auswahl')}.png`);
          },
          onCopyPng: async () => {
            const blob = await selectionToPng(selPage, sel.refs);
            if (!blob) return;
            try {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
              toast(t('Bild in die Zwischenablage kopiert'));
            } catch {
              toast(t('Zwischenablage nicht verfügbar – nutze „Als Bild speichern“'));
            }
          },
          onCrop:
            sel.refs.strokeIds.length === 0 && sel.refs.objectIds.length === 1 && selPage.objects.find((o) => o.id === sel.refs.objectIds[0])?.type === 'image'
              ? () => store.set({ cropImage: { pageIndex: sel.pageIndex, id: sel.refs.objectIds[0] } })
              : undefined,
          onEngrave: () => engrave(sel.pageIndex, sel.refs),
          engraveLabel: engraveLabelFor(selPage, sel.refs),
          stickyOnly: sel.refs.strokeIds.length === 0 && sel.refs.objectIds.every((id) => {
            const o = selPage.objects.find((x) => x.id === id);
            return o?.type === 'text' && !!o.sticky;
          }),
        }
      : null;

  /** Elemente fest in die Seite einbetten (ein Undo-Schritt). */
  function engrave(pageIndex: number, refs: { strokeIds: string[]; objectIds: string[] }) {
    const n = refs.strokeIds.length + refs.objectIds.length;
    if (!n) return;
    apply((p) => D.engraveItems(p, pageIndex, refs));
    store.set({ selection: null });
    toast(tn(n, 'Element eingraviert – nicht mehr verschieb- oder radierbar', '{n} Elemente eingraviert – nicht mehr verschieb- oder radierbar'), { label: t('Rückgängig'), run: undo });
  }

  /** Text, der gerade bearbeitet wird, abschließen und einbetten. */
  function engraveEditedText() {
    const te = store.get().textEdit;
    if (!te) return;
    const obj = histRef.current?.present[te.pageIndex]?.objects.find((o) => o.id === te.id) as TextObj | undefined;
    store.set({ textEdit: null }); // schließt die Bearbeitung ab (eigener Undo-Schritt)
    if (obj && (obj.text.trim() || obj.sticky)) window.setTimeout(() => engrave(te.pageIndex, { strokeIds: [], objectIds: [te.id] }));
  }

  // ------------------------------------------------------------ Seiten drehen / kopieren
  const rotate = (index: number) => {
    store.set({ selection: null, shapeEdit: null, textEdit: null, pendingComment: null });
    const before = pageSizeAt(index);
    apply((p) => P.rotatePage(p, index, size));
    // Hochformat → Querformat: Seite wird breiter → auf Seitenbreite einpassen, damit sie nicht über den Rand ragt
    if (before.h > before.w) window.setTimeout(() => stage.current?.fit('width'), 30);
  };

  const copyPage = (index: number) => {
    const p = histRef.current?.present[index];
    if (!p) return;
    pageClipboard = [P.clonePage(p)];
    setPageClipTick((t) => t + 1);
    toast(t('Seite {n} kopiert – in diesem oder einem anderen Notizbuch über „Seite einfügen“ einfügen', { n: index + 1 }));
  };

  const pastePage = (after: number) => {
    if (!pageClipboard) return;
    const copied = pageClipboard;
    apply((p) => P.pastePages(p, after + 1, copied));
    toast(tn(copied.length, 'Seite eingefügt', '{n} Seiten eingefügt'));
    window.setTimeout(() => stage.current?.scrollToPage(after + 1), 40);
  };

  function duplicateSelection() {
    const s = store.get().selection;
    const page = s && histRef.current?.present[s.pageIndex];
    if (!s || !page) return;
    const items = D.copyItems(page, s.refs);
    let refs = s.refs;
    apply((p) => {
      const r = D.pasteItems(p, s.pageIndex, items, translate(16, 16));
      refs = r.refs;
      return r.pages;
    });
    window.setTimeout(() => {
      const pg = histRef.current?.present[s.pageIndex];
      if (pg) store.set({ selection: selectionFor(pg, s.pageIndex, refs) });
    });
  }

  function paste() {
    if (!clipboard || !pages) return;
    const pi = current;
    const items = clipboard;
    let refs = { strokeIds: [] as string[], objectIds: [] as string[] };
    apply((p) => {
      const r = D.pasteItems(p, pi, items, translate(16, 16));
      refs = r.refs;
      return r.pages;
    });
    setTools((s) => selectTool(s, 'lasso'));
    window.setTimeout(() => {
      const pg = histRef.current?.present[pi];
      if (pg) store.set({ selection: selectionFor(pg, pi, refs) });
    });
  }

  function selectAll() {
    const page = pages?.[current];
    if (!page) return;
    setTools((s) => (s.tool === 'select' ? s : selectTool(s, 'lasso')));
    // Eingravierte Elemente gehören zur Seite und werden nicht mit ausgewählt
    const refs = { strokeIds: page.strokes.filter((s) => !s.engraved).map((s) => s.id), objectIds: page.objects.filter((o) => !o.engraved).map((o) => o.id) };
    window.setTimeout(() => store.set({ selection: selectionFor(page, current, refs) }));
  }

  // ------------------------------------------------------------ Bilder & Sticker
  const insertImageObj = (im: ImageObj, pageIndex: number) => {
    apply((p) => D.addObjects(p, pageIndex, [im]));
    setTools((s) => (s.tool === 'select' ? s : selectTool(s, 'image')));
    window.setTimeout(() => store.set({ selection: { pageIndex, refs: { strokeIds: [], objectIds: [im.id] }, frame: frameFromBox(objectBox(im), 2) } }));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { src, w, h, animated } = await loadImageFile(file);
      const c = visibleCenter();
      insertImageObj(makeImageObj(src, w, h, pageSizeAt(c.pageIndex), c, false, animated), c.pageIndex);
      if (animated) toast(t('Animiertes GIF eingefügt'));
    } catch (e) {
      toast((e as Error).message);
    }
  };

  // ------------------------------------------------------------ Text-Stil
  const onTextStyle = (patch: Partial<ToolState['text']>) => {
    setTools((s) => ({ ...s, text: { ...s.text, ...patch } }));
    const te = store.get().textEdit;
    if (te) {
      env.current.replace((p) =>
        D.updateObject<TextObj>(p, te.pageIndex, te.id, (o) => {
          const n = { ...o, ...patch };
          return { ...n, h: measureTextHeight(n) };
        }),
      );
    }
  };

  // ------------------------------------------------------------ Kommentare
  const commentActions: CommentActions = {
    onCreate: (text) => {
      const pc = store.get().pendingComment;
      if (!pc) return;
      let id = '';
      apply((p) => {
        const r = D.addThread(p, pc.pageIndex, pc.x, pc.y, text, Date.now());
        id = r.id;
        return r.pages;
      });
      window.setTimeout(() => store.set({ pendingComment: null, activeThread: { pageIndex: pc.pageIndex, id } }));
    },
    onCancelPending: () => store.set({ pendingComment: null }),
    onReply: (pi, id, text) => apply((p) => D.addReply(p, pi, id, text, Date.now())),
    onEdit: (pi, id, mid, text) => apply((p) => D.editMessage(p, pi, id, mid, text, Date.now())),
    onDeleteMessage: (pi, id, mid) => apply((p) => D.deleteMessage(p, pi, id, mid)),
    onResolve: (pi, id, resolved) => apply((p) => D.setResolved(p, pi, id, resolved)),
    onDeleteThread: (pi, id) => {
      apply((p) => D.deleteThread(p, pi, id));
      toast(t('Kommentar gelöscht'), { label: t('Rückgängig'), run: undo });
    },
    onSelect: (pi, id) => {
      store.set({ activeThread: { pageIndex: pi, id }, pendingComment: null });
      stage.current?.scrollToPage(pi);
    },
    onClose: () => store.set({ commentsOpen: false, pendingComment: null, activeThread: null }),
  };
  const openComments = pages?.reduce((n, p) => n + p.comments.filter((c) => !c.resolved).length, 0) ?? 0;

  // ------------------------------------------------------------ Tastatur
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return;
      if (document.querySelector('.modal-backdrop')) return;
      const k = e.key.toLowerCase();
      const s = store.get();
      if (e.ctrlKey && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.ctrlKey && k === 'c' && s.selection) {
        e.preventDefault();
        selectionActions?.onCopy();
      } else if (e.ctrlKey && k === 'x' && s.selection) {
        e.preventDefault();
        selectionActions?.onCut();
      } else if (e.ctrlKey && k === 'v') {
        e.preventDefault();
        paste();
      } else if (e.ctrlKey && k === 'd' && s.selection) {
        e.preventDefault();
        duplicateSelection();
      } else if (e.ctrlKey && k === 'a') {
        e.preventDefault();
        selectAll();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && (s.selection || s.shapeEdit)) {
        e.preventDefault();
        if (s.selection) selectionActions?.onDelete();
        else if (s.shapeEdit) {
          const se = s.shapeEdit;
          apply((p) => D.removeObject(p, se.pageIndex, se.id));
          store.set({ shapeEdit: null });
        }
      } else if (e.key === 'Escape') {
        store.set({ selection: null, shapeEdit: null, pendingComment: null, lasso: null });
      } else if (e.ctrlKey && (k === '+' || k === '=')) {
        e.preventDefault();
        stage.current?.zoomBy(1.2);
      } else if (e.ctrlKey && k === '-') {
        e.preventDefault();
        stage.current?.zoomBy(1 / 1.2);
      } else if (e.ctrlKey && k === '0') {
        e.preventDefault();
        stage.current?.fit('width');
      } else if (e.ctrlKey && e.shiftKey && k === 'd') {
        e.preventDefault(); // Strg+Umschalt+D: Touch-Monitor
        setTools((s) => ({ ...s, touch: { ...s.touch, monitor: !s.touch.monitor } }));
      } else if (e.ctrlKey && k === 'e') {
        e.preventDefault();
        setExporting(true);
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && k === 'r') {
        e.preventDefault(); // R: aktuelle Seite drehen
        rotate(current);
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && TOOL_KEYS[k]) {
        const tool: Tool = TOOL_KEYS[k];
        setTools((st) => selectTool(st, tool));
        if (tool === 'image' && e.shiftKey) fileInput.current?.click();
      } else if (e.key === 'PageDown' && pages) {
        e.preventDefault();
        stage.current?.scrollToPage(Math.min(pages.length - 1, current + 1));
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        stage.current?.scrollToPage(Math.max(0, current - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onView = useCallback((v: ViewInfo) => setView((old) => (old.zoom === v.zoom && old.currentPage === v.currentPage ? old : v)), []);

  // ------------------------------------------------------------ Seitenmenü
  const pageItems = (index: number): MenuItem[] => {
    if (!pages) return [];
    return [
      { id: 'page-insert-before', label: t('Seite davor einfügen'), icon: <FilePlus2 size={16} />, onSelect: () => addPage(index) },
      { id: 'page-insert-after', label: t('Seite danach einfügen'), icon: <FilePlus2 size={16} />, onSelect: () => addPage(index + 1) },
      { id: 'page-duplicate', label: t('Seite duplizieren'), icon: <Copy size={16} />, onSelect: () => apply((p) => P.duplicatePage(p, index)) },
      { id: 'page-copy', label: t('Seite kopieren'), icon: <ClipboardCopy size={16} />, onSelect: () => copyPage(index) },
      {
        id: 'page-paste',
        label: pageClipboard && pageClipboard.length > 1 ? t('{n} Seiten danach einfügen', { n: pageClipboard.length }) : t('Kopierte Seite danach einfügen'),
        icon: <ClipboardPaste size={16} />,
        disabled: !pageClipboard,
        onSelect: () => pastePage(index),
      },
      { id: 'page-rotate', label: t('Seite drehen (90° im Uhrzeigersinn)'), icon: <RotateCw size={16} />, onSelect: () => rotate(index) },
      'separator',
      { id: 'page-up', label: t('Nach vorne'), icon: <ArrowUp size={16} />, disabled: index === 0, onSelect: () => apply((p) => P.movePage(p, index, index - 1)) },
      { id: 'page-down', label: t('Nach hinten'), icon: <ArrowDown size={16} />, disabled: index === pages.length - 1, onSelect: () => apply((p) => P.movePage(p, index, index + 1)) },
      'separator',
      ...TEMPLATE_OPTIONS.map(
        (o): MenuItem => ({
          id: `template-${o.id}`,
          label: t('Vorlage: {name}', { name: t(o.label) }),
          icon: <FileText size={16} />,
          checked: !pages[index]?.pdf && pages[index]?.template === o.id,
          onSelect: () => apply((p) => P.setPageTemplate(p, index, o.id as PaperTemplate)),
        }),
      ),
      ...(pages[index]?.pdf || pages[index]?.hiddenPdf
        ? [
            {
              id: 'template-pdf',
              label: t('Vorlage: PDF (Original)'),
              icon: <FileUp size={16} />,
              checked: !!pages[index]?.pdf,
              onSelect: () => apply((p) => P.restorePdfBackground(p, index)),
            } as MenuItem,
          ]
        : []),
      'separator',
      { id: 'page-clear', label: t('Seite leeren'), icon: <Eraser size={16} />, disabled: !!pages[index] && !P.pageHasContent(pages[index]), onSelect: () => setClearIndex(index) },
      {
        id: 'page-delete',
        label: pages.length === 1 ? t('Seite leeren') : t('Seite löschen'),
        icon: <Trash2 size={16} />,
        danger: true,
        onSelect: () => {
          apply((p) => P.deletePage(p, index));
          toast(t('Seite gelöscht'), { label: t('Rückgängig'), run: undo });
        },
      },
    ];
  };

  const zoomPct = Math.round(view.zoom * 100);
  const titleNow = useMemo(() => lib.notebooks.find((n) => n.id === meta.id)?.title ?? meta.title, [lib, meta.id, meta.title]);
  const counts = useMemo(
    () => ({
      strokes: pages?.reduce((n, p) => n + p.strokes.length, 0) ?? 0,
      objects: pages?.reduce((n, p) => n + p.objects.length, 0) ?? 0,
      comments: pages?.reduce((n, p) => n + p.comments.length, 0) ?? 0,
    }),
    [pages],
  );
  const hidden = useMemo(() => new Set(ui.textEdit ? [ui.textEdit.id] : []), [ui.textEdit]);

  const editedShape = ui.shapeEdit && pages ? (pages[ui.shapeEdit.pageIndex]?.objects.find((o) => o.id === ui.shapeEdit!.id) as ShapeObj | undefined) : undefined;
  const editedText = ui.textEdit && pages ? (pages[ui.textEdit.pageIndex]?.objects.find((o) => o.id === ui.textEdit!.id) as TextObj | undefined) : undefined;
  const cropTarget = ui.cropImage && pages ? (pages[ui.cropImage.pageIndex]?.objects.find((o) => o.id === ui.cropImage!.id) as ImageObj | undefined) : undefined;

  const renderOverlay = (v: Viewport) =>
    pages && (
      <>
        {tools.dual.enabled && <DualDivider left={tools.dual.left} right={tools.dual.right} />}
        <CommentPins
          v={v}
          pages={pages}
          activeId={ui.activeThread?.id ?? null}
          pending={ui.pendingComment}
          showResolved={showResolved}
          onOpen={(pi, id) => store.set({ commentsOpen: true, activeThread: { pageIndex: pi, id }, pendingComment: null })}
        />
        {ui.textEdit && editedText && (
          <TextEditor
            key={editedText.id}
            v={v}
            pageIndex={ui.textEdit.pageIndex}
            obj={editedText}
            onChange={(text, h) => {
              const te = store.get().textEdit;
              if (te) env.current.replace((p) => D.updateObject<TextObj>(p, te.pageIndex, te.id, (o) => ({ ...o, text, h: Math.max(h, measureTextHeight({ ...o, text })) })));
            }}
            onClose={() => store.set({ textEdit: null })}
          />
        )}
        {sel && selectionActions && !ui.lasso && <SelectionBar v={v} sel={sel} actions={selectionActions} />}
        {ui.shapeEdit && editedShape && (
          <ShapeBar
            v={v}
            pageIndex={ui.shapeEdit.pageIndex}
            shape={editedShape}
            onToggleFill={() => {
              const se = store.get().shapeEdit!;
              apply((p) => D.updateObject<ShapeObj>(p, se.pageIndex, se.id, (o) => ({ ...o, fill: o.fill ? null : D.withAlpha(o.color, 0.25) })));
            }}
            onDelete={() => {
              const se = store.get().shapeEdit!;
              apply((p) => D.removeObject(p, se.pageIndex, se.id));
              store.set({ shapeEdit: null });
            }}
            onDone={() => store.set({ shapeEdit: null, shapeOrigin: null })}
            onRotate={(deg) => {
              const se = store.get().shapeEdit!;
              apply((p) => D.updateObject<ShapeObj>(p, se.pageIndex, se.id, (o) => ({ ...o, points: rotateShapePoints(o, (deg * Math.PI) / 180) })));
            }}
            onKeepFreehand={
              ui.shapeOrigin && ui.shapeOrigin.id === ui.shapeEdit.id
                ? () => {
                    const o = store.get().shapeOrigin!;
                    apply((p) => D.addStroke(D.removeObject(p, o.pageIndex, o.id), o.pageIndex, o.stroke));
                    store.set({ shapeEdit: null, shapeOrigin: null });
                  }
                : undefined
            }
          />
        )}
      </>
    );

  if (loadError) {
    return (
      <div className="editor" data-testid="editor">
        <div className="empty">Notizbuch konnte nicht geladen werden: {loadError}</div>
        <button className="btn" onClick={onBack} data-testid="editor-back">
          Zurück
        </button>
      </div>
    );
  }

  const goBack = async () => {
    store.set({ textEdit: null });
    await save();
    onBack();
  };

  return (
    <div
      className={`editor${tools.touch.largeUi ? ' touch-large' : ''}`}
      data-testid="editor"
      data-finger-draws={tools.fingerDraws ? '1' : '0'}
      data-dual={tools.dual.enabled ? '1' : '0'}
      data-pages={pages?.length ?? 0}
      data-strokes={counts.strokes}
      data-objects={counts.objects}
      data-comments={counts.comments}
      data-tool={tools.tool}
      data-stylus={stylusMode ?? ''}
    >
      <StylusIndicator mode={stylusMode} diameter={Math.max(8, tools.eraser.sizes[tools.eraser.sizeIndex] * 2)} nodeRef={stylusNode} />
      {/* Navigationsleiste (zugleich Fenstertitelleiste) */}
      <header className="editor-nav drag">
        <button className="icon-btn" onClick={() => void goBack()} title={t('Zurück zur Bibliothek')} data-testid="editor-back">
          <ArrowLeft size={18} strokeWidth={1.8} />
        </button>
        <button className={`icon-btn${showThumbs ? ' active' : ''}`} onClick={toggleThumbs} title={t('Seitenleiste ein/aus')} data-testid="toggle-thumbs">
          <PanelLeft size={18} strokeWidth={1.7} />
        </button>
        <button className="editor-title-btn" onClick={() => setRenaming(true)} title={t('Umbenennen')}>
          {titleNow}
        </button>
        <span className="editor-page-indicator" data-testid="page-indicator">
          {pages ? t('Seite {n} von {total}', { n: current + 1, total: pages.length }) : ''}
        </span>
        <button className="btn btn-ghost btn-sm nav-action" onClick={() => rotate(current)} disabled={!pages} title={t('Aktuelle Seite im Uhrzeigersinn drehen (R)')} data-testid="rotate-page">
          <RotateCw size={16} strokeWidth={1.8} /> {t('Drehen')}
        </button>
        <span className="nav-spacer" />
        <button className="btn btn-ghost btn-sm nav-action" onClick={() => setExporting(true)} disabled={!pages} title={t('Exportieren: PDF, PNG oder .pnotes (Strg+E)')} data-testid="export-open">
          <Download size={16} strokeWidth={1.8} /> {t('Exportieren')}
        </button>
        <button
          className={`icon-btn nav-comments${ui.commentsOpen ? ' active' : ''}`}
          onClick={() => store.set((s) => ({ commentsOpen: !s.commentsOpen }))}
          title={t('Kommentare')}
          data-testid="toggle-comments"
        >
          <MessageSquare size={18} strokeWidth={1.7} />
          {openComments > 0 && <span className="nav-badge">{openComments}</span>}
        </button>
      </header>

      {/* Werkzeugleiste */}
      <div className="toolbar" role="toolbar" aria-label={t('Werkzeuge')}>
        <div className="toolbar-group">
          <button className="icon-btn" onClick={undo} disabled={!hist?.past.length} title={t('Rückgängig (Strg+Z)')} data-testid="undo">
            <Undo2 size={18} strokeWidth={1.8} />
          </button>
          <button className="icon-btn" onClick={redo} disabled={!hist?.future.length} title={t('Wiederholen (Strg+Y)')} data-testid="redo">
            <Redo2 size={18} strokeWidth={1.8} />
          </button>
        </div>
        <div className="toolbar-sep" />
        <button
          className={`select-mode-btn${shownTools.tool === 'select' ? ' active' : ''}${stylusTool === 'select' && tools.tool !== 'select' ? ' stylus-temp' : ''}`}
          onClick={() => setTools((s) => selectTool(s, s.tool === 'select' ? (s.previousTool === 'select' ? 'pen' : s.previousTool) : 'select'))}
          aria-pressed={tools.tool === 'select'}
          title={t('Auswahlmodus (V): Striche, Formen, Texte, Haftnotizen und Bilder antippen oder mit Rahmen auswählen, dann verschieben, skalieren, drehen oder löschen – mit Maus, Finger oder Stift')}
          data-testid="tool-select"
        >
          <MousePointer2 size={17} strokeWidth={1.8} />
          <span>{t('Auswählen')}</span>
        </button>
        <div className="toolbar-sep" />
        <ToolPalette
          tools={tools}
          setTools={setTools}
          stylusTool={stylusTool}
          actions={{
            onClearPage: () => setClearIndex(current),
            onSelectAll: selectAll,
            onInsertImage: () => fileInput.current?.click(),
            onInsertSticker: (emoji) => {
              const c = visibleCenter();
              insertImageObj(makeImageObj(renderSticker(emoji), 256, 256, pageSizeAt(c.pageIndex), c, true), c.pageIndex);
            },
            onCrop: () => selectionActions?.onCrop?.(),
            canCrop: !!selectionActions?.onCrop,
            onTextStyle,
            commentsOpen: ui.commentsOpen,
            openComments,
            onToggleComments: () => store.set((s) => ({ commentsOpen: !s.commentsOpen })),
            onEngraveText: engraveEditedText,
            canEngraveText: !!ui.textEdit,
          }}
        />
        <DualChips tools={tools} setTools={setTools} />

        <div className="toolbar-spacer" />

        <div className="toolbar-group">
          <button
            className={touchButtonClass(tools)}
            onClick={(e) => setTouchPop(e.currentTarget.getBoundingClientRect())}
            title={t('Touch & großes Display: Finger/IR-Stift zeichnen, Zwei-Seiten-Modus, Spitzen-Erkennung, Touch-Monitor')}
            data-testid="touch-settings"
          >
            <Presentation size={18} strokeWidth={1.7} />
          </button>
          <div className="toolbar-sep" />
          <button className="icon-btn" onClick={() => stage.current?.zoomBy(1 / 1.2)} title={t('Verkleinern (Strg+−)')} data-testid="zoom-out">
            <ZoomOut size={18} strokeWidth={1.7} />
          </button>
          <button className="zoom-label" onClick={(e) => zoomMenu.openBelow(e.currentTarget)} data-testid="zoom-label" title={t('Zoomstufe')}>
            {zoomPct}%
          </button>
          <button className="icon-btn" onClick={() => stage.current?.zoomBy(1.2)} title={t('Vergrößern (Strg++)')} data-testid="zoom-in">
            <ZoomIn size={18} strokeWidth={1.7} />
          </button>
          <button className="icon-btn" onClick={() => stage.current?.fit('width')} title={t('Seitenbreite (Strg+0)')} data-testid="zoom-fit">
            <Maximize size={17} strokeWidth={1.7} />
          </button>
          <div className="toolbar-sep" />
          <button className="icon-btn" onClick={() => addPage(current + 1)} title={t('Seite hinzufügen')} data-testid="toolbar-add-page">
            <FilePlus2 size={18} strokeWidth={1.7} />
          </button>
          <button className="icon-btn" onClick={(e) => moreMenu.openBelow(e.currentTarget, 'end')} title={t('Mehr')} data-testid="more-menu">
            <MoreHorizontal size={18} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="editor-body">
        {showThumbs && pages && (
          <Thumbnails
            pages={pages}
            defaultSize={size}
            paperColor={meta.paperColor}
            current={current}
            onSelect={(i) => stage.current?.scrollToPage(i)}
            onMenu={(i, x, y) => {
              setPageMenuIndex(i);
              pageMenu.openAt(x, y);
            }}
            onAdd={() => addPage(pages.length)}
            onMove={(from, to) => apply((p) => P.movePage(p, from, to))}
          />
        )}
        {pages ? (
          <PageStage
            ref={stage}
            pages={pages}
            sizes={sizes}
            paperColor={meta.paperColor}
            direction={direction}
            onView={onView}
            ink={engine}
            onViewport={onViewport}
            cursor={cursorFor(shownTools, view.zoom)}
            overlay={
              <>
                <InkLayer ref={inkLayer} pages={pages} hidden={hidden} darkPaper={meta.paperColor === 'dark'} />
                <UiLayer ref={uiLayer} pages={pages} store={store} laser={laser.current} laserColor={tools.laser.color} />
              </>
            }
            renderOverlay={renderOverlay}
          />
        ) : (
          <div className="stage stage-loading" />
        )}
        {ui.commentsOpen && pages && (
          <CommentsPanel
            pages={pages}
            active={ui.activeThread}
            pending={ui.pendingComment}
            showResolved={showResolved}
            onShowResolved={setShowResolved}
            actions={commentActions}
          />
        )}
      </div>

      <input ref={fileInput} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => (void onFile(e.target.files?.[0]), (e.target.value = ''))} data-testid="image-file" />

      {moreMenu.menu && (
        <Menu
          {...moreMenu.menu}
          onClose={moreMenu.close}
          items={[
            { id: 'dir-vertical', label: t('Vertikal scrollen'), icon: <ArrowUpDown size={16} />, checked: direction === 'vertical', onSelect: () => setDir('vertical') },
            { id: 'dir-horizontal', label: t('Horizontal scrollen'), icon: <ArrowLeftRight size={16} />, checked: direction === 'horizontal', onSelect: () => setDir('horizontal') },
            'separator',
            { id: 'goto-page', label: t('Gehe zu Seite …'), icon: <Hash size={16} />, onSelect: () => setGoto(true) },
            { id: 'fit-page', label: t('Ganze Seite anzeigen'), icon: <ChevronsDownUp size={16} />, onSelect: () => stage.current?.fit('page') },
            'separator',
            { id: 'insert-pdf', label: t('PDF-Seiten einfügen …'), icon: <FileUp size={16} />, onSelect: () => pdfInput.current?.click() },
            { id: 'export', label: t('Exportieren (PDF, PNG, .pnotes) …'), icon: <Download size={16} />, shortcut: t('Strg+E'), onSelect: () => setExporting(true) },
            { id: 'settings', label: t('Einstellungen (Sprache) …'), icon: <Settings size={16} />, onSelect: openSettings },
            'separator',
            ...pageItems(current).filter(
              (i) => i === 'separator' || i.id.startsWith('template-') || ['page-duplicate', 'page-copy', 'page-paste', 'page-rotate', 'page-clear', 'page-delete'].includes(i.id),
            ),
          ]}
        />
      )}
      {zoomMenu.menu && (
        <Menu
          {...zoomMenu.menu}
          onClose={zoomMenu.close}
          items={[
            ...[50, 75, 100, 150, 200, 300].map((z): MenuItem => ({ id: `zoom-${z}`, label: `${z} %`, checked: zoomPct === z, onSelect: () => stage.current?.zoomTo(z / 100) })),
            'separator',
            { id: 'zoom-width', label: t('Seitenbreite'), onSelect: () => stage.current?.fit('width') },
            { id: 'zoom-page', label: t('Ganze Seite'), onSelect: () => stage.current?.fit('page') },
          ]}
        />
      )}
      {pageMenu.menu && <Menu {...pageMenu.menu} onClose={pageMenu.close} items={pageItems(pageMenuIndex)} />}

      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) setPdfFile(f);
        }}
        data-testid="pdf-file"
      />
      {pdfFile && (
        <PdfImportDialog
          file={pdfFile}
          mode="pages"
          onImport={(r) => {
            const at = r.position === 'end' ? (pages?.length ?? 0) : current + 1;
            apply((p) => P.insertPages(p, at, r.pages.map((x) => P.pdfPage(x.ref, x.size))));
            toast(tn(r.pages.length, '{n} PDF-Seite eingefügt', '{n} PDF-Seiten eingefügt'));
            window.setTimeout(() => stage.current?.scrollToPage(at), 60);
          }}
          onClose={() => setPdfFile(null)}
        />
      )}

      {touchPop && (
        <TouchSettingsPopover
          tools={tools}
          setTools={setTools}
          anchor={touchPop}
          onClose={() => setTouchPop(null)}
          onCalibrate={() => {
            setTouchPop(null);
            setCalibrating(true);
          }}
        />
      )}
      {calibrating && <CalibrateDialog tools={tools} setTools={setTools} onClose={() => setCalibrating(false)} />}
      {tools.touch.monitor && (
        <TouchMonitor
          tools={tools}
          docAt={(x, y) => stage.current?.docAt(x, y) ?? null}
          gestures={engine.gestures}
          stageRect={() => document.querySelector('[data-testid=stage]')?.getBoundingClientRect() ?? null}
          onClose={() => setTools((s) => ({ ...s, touch: { ...s.touch, monitor: false } }))}
        />
      )}

      {exporting && pages && (
        <ExportDialog
          meta={{ ...meta, title: titleNow }}
          pages={pages}
          defaultSize={size}
          current={current}
          onClose={() => setExporting(false)}
          onDone={(m) => toast(m)}
        />
      )}

      {cropTarget && ui.cropImage && (
        <CropDialog
          image={cropTarget}
          onApply={(crop) => {
            const ci = store.get().cropImage!;
            apply((p) => D.updateObject<ImageObj>(p, ci.pageIndex, ci.id, (o) => applyCrop(o, crop)));
            window.setTimeout(() => {
              const pg = histRef.current?.present[ci.pageIndex];
              if (pg) store.set({ selection: selectionFor(pg, ci.pageIndex, { strokeIds: [], objectIds: [ci.id] }) });
            });
          }}
          onClose={() => store.set({ cropImage: null })}
        />
      )}
      {renaming && (
        <PromptDialog
          title={t('Notizbuch umbenennen')}
          label={t('Titel')}
          initial={titleNow}
          confirmLabel={t('Umbenennen')}
          validate={(v) => (isTitleTaken(lib, meta.folderId, v, meta.id) ? t('Name bereits vergeben') : null)}
          onConfirm={(v) => update((l) => rename(l, 'notebook', meta.id, v, Date.now()))}
          onClose={() => setRenaming(false)}
        />
      )}
      {clearIndex !== null && pages?.[clearIndex] && (
        <ClearPageDialog
          page={pages[clearIndex]}
          pageIndex={clearIndex}
          onConfirm={(cats) => {
            const i = clearIndex;
            // offene Bearbeitungen auf entfernten Inhalten beenden
            store.set({ selection: null, shapeEdit: null, textEdit: null, cropImage: null, ...(cats.includes('comments') ? { activeThread: null, pendingComment: null } : {}) });
            apply((p) => P.clearPage(p, i, cats));
            toast(t('Seite {n} geleert', { n: i + 1 }), { label: t('Rückgängig'), run: undo });
          }}
          onClose={() => setClearIndex(null)}
        />
      )}
      {goto && pages && (
        <PromptDialog
          title={t('Gehe zu Seite')}
          label={t('Seitenzahl (1–{total})', { total: pages.length })}
          initial={String(current + 1)}
          confirmLabel={t('Springen')}
          validate={(v) => {
            const n = Number(v);
            return Number.isInteger(n) && n >= 1 && n <= pages.length ? null : tn(pages.length, 'Dieses Notizbuch hat nur {n} Seite', 'Dieses Notizbuch hat nur {n} Seiten');
          }}
          onConfirm={(v) => stage.current?.scrollToPage(Number(v) - 1)}
          onClose={() => setGoto(false)}
        />
      )}
    </div>
  );
}
