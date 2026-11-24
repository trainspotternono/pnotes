/** Export-Dialog: PDF (Seiten + Anmerkungen, optional Haftnotizen/Kommentare), PNG (aktuelle/alle Seiten), .pnotes. */
import { useState } from 'react';
import { FileArchive, FileImage, FileText, Loader2 } from 'lucide-react';
import type { NotebookMeta, Page } from '../../shared/types';
import { Modal, Segmented, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { exportPdf } from './pdfExport';
import { canvasToBytes, commentNumbering, renderPageToCanvas } from './renderPage';
import { NOAHPALLE_EXT, packNoahpalle } from './noahpalle';
import { t } from '../i18n';

type Format = 'pdf' | 'png' | 'noahpalle';
type Range = 'all' | 'current';

const fileBase = (title: string) => title.replace(/[\\/:*?"<>|]/g, '_').trim() || t('Notizbuch');

/** Erzeugt die .pnotes-Bytes (auch vom Smoke-Test genutzt). */
export async function buildNoahpalle(meta: NotebookMeta, pages: Page[], defaultSize: { w: number; h: number }): Promise<Uint8Array> {
  let preview: Uint8Array | undefined;
  try {
    preview = await canvasToBytes(await renderPageToCanvas(pages[0], defaultSize, meta.paperColor, { scale: 0.6, background: true, stickies: true }));
  } catch {
    /* Vorschau ist optional */
  }
  return packNoahpalle(meta, pages, { getPdf: (id) => api.assetGet(id, 'pdf'), putPdf: (d) => api.assetPut(d, 'pdf') }, { preview, generator: 'pNotes 0.1.0' });
}

export function ExportDialog({
  meta,
  pages,
  defaultSize,
  current,
  onClose,
  onDone,
}: {
  meta: NotebookMeta;
  pages: Page[];
  defaultSize: { w: number; h: number };
  current: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [format, setFormat] = useState<Format>('pdf');
  const [range, setRange] = useState<Range>('all');
  const [stickies, setStickies] = useState(true);
  const [comments, setComments] = useState(false);
  const [pngScale, setPngScale] = useState<'1' | '2' | '3'>('2');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasComments = pages.some((p) => p.comments.length > 0);
  const selected = range === 'all' ? pages : [pages[current]];
  const base = fileBase(meta.title);

  const run = async () => {
    setError(null);
    try {
      if (format === 'pdf') {
        setBusy(t('PDF wird erstellt …'));
        const bytes = await exportPdf(selected, defaultSize, meta.paperColor, {
          title: meta.title,
          stickies,
          comments,
          onProgress: (d, total) => setBusy(t('PDF wird erstellt … Seite {n} von {total}', { n: d, total })),
        });
        const file = await api.fileSave({ defaultName: `${base}${range === 'current' ? `-${t('Seite')}-${current + 1}` : ''}.pdf`, filters: [{ name: t('PDF-Dokument'), extensions: ['pdf'] }], data: bytes });
        if (file) onDone(t('PDF gespeichert: {file}', { file }));
      } else if (format === 'png') {
        const numbers = comments ? commentNumbering(pages) : undefined;
        const files: { name: string; data: Uint8Array }[] = [];
        const indices = range === 'all' ? pages.map((_, i) => i) : [current];
        for (const i of indices) {
          setBusy(t('Bild {n} von {total} …', { n: files.length + 1, total: indices.length }));
          const c = await renderPageToCanvas(pages[i], defaultSize, meta.paperColor, { scale: Number(pngScale), background: true, stickies, commentNumbers: numbers });
          files.push({ name: `${base}-${t('Seite')}-${String(i + 1).padStart(String(pages.length).length, '0')}.png`, data: await canvasToBytes(c) });
        }
        if (files.length === 1) {
          const file = await api.fileSave({ defaultName: files[0].name, filters: [{ name: t('PNG-Bild'), extensions: ['png'] }], data: files[0].data });
          if (file) onDone(t('Bild gespeichert: {file}', { file }));
        } else {
          const dir = await api.fileSaveMany({ title: t('Ordner für die PNG-Seiten wählen'), files });
          if (dir) onDone(t('{n} Bilder gespeichert in {dir}', { n: files.length, dir }));
        }
      } else {
        setBusy(t('Dokument wird gepackt …'));
        const bytes = await buildNoahpalle(meta, pages, defaultSize);
        const file = await api.fileSave({ defaultName: `${base}.${NOAHPALLE_EXT}`, filters: [{ name: t('pNotes-Dokument'), extensions: [NOAHPALLE_EXT] }], data: bytes });
        if (file) onDone(t('Dokument gespeichert: {file}', { file }));
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title={t('Exportieren')}
      onClose={() => !busy && onClose()}
      width={500}
      testId="export-dialog"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={!!busy} data-testid="dialog-cancel">
            {t('Abbrechen')}
          </button>
          <button className="btn btn-primary" onClick={() => void run()} disabled={!!busy} data-testid="export-confirm">
            {busy ? <Loader2 size={15} className="spin" /> : null} {t('Exportieren')}
          </button>
        </>
      }
    >
      <div className="export-formats" role="radiogroup">
        {(
          [
            ['pdf', <FileText key="p" size={22} />, 'PDF', t('Zum Teilen & Drucken')],
            ['png', <FileImage key="i" size={22} />, 'PNG', t('Seiten als Bilder')],
            ['noahpalle', <FileArchive key="n" size={22} />, `.${NOAHPALLE_EXT}`, t('Bearbeitbar in pNotes')],
          ] as const
        ).map(([id, icon, label, hint]) => (
          <button key={id} role="radio" aria-checked={format === id} className={`export-format${format === id ? ' active' : ''}`} onClick={() => setFormat(id)} data-testid={`export-${id}`}>
            {icon}
            <strong>{label}</strong>
            <span>{hint}</span>
          </button>
        ))}
      </div>

      {format !== 'noahpalle' && (
        <>
          <div className="field">
            <span className="field-label">{t('Seiten')}</span>
            <Segmented
              value={range}
              options={[
                { id: 'all', label: t('Alle ({n})', { n: pages.length }) },
                { id: 'current', label: t('Aktuelle Seite ({n})', { n: current + 1 }) },
              ]}
              onChange={setRange}
              testId="export-range"
            />
          </div>
          {format === 'png' && (
            <div className="field">
              <span className="field-label">{t('Auflösung')}</span>
              <Segmented
                value={pngScale}
                options={[
                  { id: '1', label: t('Normal (72 dpi)') },
                  { id: '2', label: t('Hoch (144 dpi)') },
                  { id: '3', label: t('Sehr hoch (216 dpi)') },
                ]}
                onChange={setPngScale}
              />
            </div>
          )}
          <Toggle label={t('Haftnotizen einschließen')} checked={stickies} onChange={setStickies} testId="export-stickies" />
          <Toggle label={format === 'pdf' ? t('Kommentare einschließen (Pins + Kommentarliste am Ende)') : t('Kommentar-Pins einzeichnen')} checked={comments && hasComments} onChange={setComments} testId="export-comments" />
          {!hasComments && <p className="field-hint">{t('Dieses Notizbuch hat keine Kommentare.')}</p>}
          {format === 'pdf' && <p className="field-hint">{t('Importierte PDF-Seiten bleiben als Original (durchsuchbarer Text) erhalten; Handschrift, Formen, Texte, Bilder und eingravierte Elemente liegen darüber.')}</p>}
        </>
      )}
      {format === 'noahpalle' && (
        <p className="modal-text">
          {t('Speichert das komplette Notizbuch als eine Datei – mit allen Seiten, Vorlagen, Drehungen, PDF-Originalen, Bildern und GIFs, Haftnotizen, eingravierten Elementen und Kommentaren. Die Datei lässt sich in pNotes öffnen und weiterbearbeiten (Doppelklick oder Bibliothek → „Neu“ → „Dokument öffnen“).')}
        </p>
      )}
      {busy && (
        <div className="sync-test-result ok" data-testid="export-busy">
          <Loader2 size={14} className="spin" /> {busy}
        </div>
      )}
      {error && <div className="sync-test-result fail">{error}</div>}
    </Modal>
  );
}
