import type { NotebookContent, Page, PaperTemplate } from '../../shared/types';
import { newId } from './ids';

export function newPage(template: PaperTemplate): Page {
  return { id: newId(), template, strokes: [], objects: [], comments: [] };
}

export function newNotebookContent(id: string, template: PaperTemplate): NotebookContent {
  return { version: 1, id, pages: [newPage(template)] };
}

/** Prüft/normalisiert geladenen Inhalt; leere oder defekte Dateien ergeben eine leere Seite. */
export function normalizeContent(raw: NotebookContent | null, id: string, template: PaperTemplate): NotebookContent {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.pages) || raw.pages.length === 0) {
    return newNotebookContent(id, template);
  }
  return {
    version: 1,
    id,
    pages: raw.pages.map((p) => ({
      id: typeof p.id === 'string' ? p.id : newId(),
      template: p.template ?? template,
      ...(p.size && p.size.w > 0 && p.size.h > 0 ? { size: { w: p.size.w, h: p.size.h } } : {}),
      ...(p.pdf && /^[a-f0-9]{40}$/.test(p.pdf.asset) && p.pdf.page >= 1 ? { pdf: { asset: p.pdf.asset, page: p.pdf.page } } : {}),
      ...(p.hiddenPdf && /^[a-f0-9]{40}$/.test(p.hiddenPdf.asset) && p.hiddenPdf.page >= 1 ? { hiddenPdf: { asset: p.hiddenPdf.asset, page: p.hiddenPdf.page } } : {}),
      ...(p.rotation === 90 || p.rotation === 180 || p.rotation === 270 ? { rotation: p.rotation } : {}),
      strokes: Array.isArray(p.strokes) ? p.strokes.filter((s) => s && Array.isArray(s.points) && s.points.length >= 3) : [],
      objects: Array.isArray(p.objects) ? p.objects.filter((o) => o && typeof o.id === 'string' && typeof o.type === 'string') : [],
      comments: Array.isArray(p.comments)
        ? p.comments.filter((c) => c && Array.isArray(c.messages)).map((c) => ({ ...c, resolved: !!c.resolved }))
        : [],
    })),
  };
}
