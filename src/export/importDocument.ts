/** .pnotes/.noahpalle öffnen: Dokument entpacken, als neues Notizbuch in die Bibliothek übernehmen. */
import type { LibraryData, NotebookMeta, OpenedFile } from '../../shared/types';
import { api } from '../lib/api';
import { newId } from '../lib/ids';
import * as L from '../lib/library';
import { unpackNoahpalle } from './noahpalle';
import { t } from '../i18n';
import { stripDocExt } from '../../shared/brand';
import { isPageFormat } from '../lib/formats';

/** Liefert die ID des neuen Notizbuchs. */
export async function importNoahpalle(file: OpenedFile, update: (fn: (l: LibraryData) => LibraryData) => void, folderId: string | null): Promise<string> {
  const doc = await unpackNoahpalle(file.data, { getPdf: (id) => api.assetGet(id, 'pdf'), putPdf: (d) => api.assetPut(d, 'pdf') });
  const id = newId();
  const now = Date.now();
  await api.saveNotebook({ version: 1, id, pages: doc.pages });
  const n = doc.manifest.notebook ?? ({} as Partial<NotebookMeta>);
  const baseTitle = (doc.manifest.title || stripDocExt(file.name) || t('Importiertes Dokument')).slice(0, 120);
  update((l) =>
    L.addNotebook(l, {
      id,
      title: L.uniqueName(baseTitle, (t) => L.isTitleTaken(l, folderId, t)),
      folderId,
      coverColor: n.coverColor === undefined ? '#305BB0' : n.coverColor,
      ...(n.coverPdf ? { coverPdf: n.coverPdf } : {}),
      template: n.template ?? 'blank',
      paperColor: n.paperColor ?? 'white',
      format: isPageFormat(n.format) ? n.format : 'A4',
      orientation: n.orientation ?? 'portrait',
      favorite: false,
      pageCount: doc.pages.length,
      createdAt: now,
      updatedAt: now,
      openedAt: now,
      trashedAt: null,
    }),
  );
  return id;
}
