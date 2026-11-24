/**
 * PDF-Import: Seiten auswählen (Raster mit Häkchen oder Bereich wie „1-3, 5“) und als neues
 * Notizbuch oder als Seiten in das geöffnete Notizbuch übernehmen. Die PDF wird einmalig
 * inhaltsadressiert gespeichert; Seiten verweisen nur darauf.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, FileText, Loader2, Square } from 'lucide-react';
import type { PdfPageRef } from '../../shared/types';
import { Modal, Segmented } from '../components/ui';
import { api } from '../lib/api';
import { aliasPdf, closePdf, openPdfBytes, pageSizes } from './pdf';
import { PdfCanvas } from './PdfCanvas';
import { formatPageRange, parsePageRange } from './range';

import { t } from '../i18n';
export interface PdfImportResult {
  title: string;
  asset: string;
  pages: { ref: PdfPageRef; size: { w: number; h: number } }[];
  position: 'after' | 'end';
}

const THUMB_W = 92;

export function PdfImportDialog({ file, mode, onImport, onClose }: { file: File; mode: 'notebook' | 'pages'; onImport: (r: PdfImportResult) => void; onClose: () => void }) {
  const key = useMemo(() => `preview-${Math.random().toString(36).slice(2)}`, []);
  const bytes = useRef<Uint8Array | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [range, setRange] = useState('');
  const [title, setTitle] = useState(file.name.replace(/\.pdf$/i, '') || t('PDF-Dokument'));
  const [position, setPosition] = useState<'after' | 'end'>('after');
  const [busy, setBusy] = useState(false);
  const imported = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        if (!new TextDecoder('latin1').decode(data.subarray(0, 1024)).includes('%PDF-')) throw new Error(t('Das ist keine gültige PDF-Datei.'));
        bytes.current = data;
        const doc = await openPdfBytes(key, data);
        const s = await pageSizes(doc);
        if (!alive) return;
        setSizes(s);
        setSelected(new Set(s.map((_, i) => i + 1)));
      } catch (e) {
        const msg = (e as Error).message;
        if (alive) setError(/password/i.test(msg) ? t('Die PDF ist passwortgeschützt und kann nicht importiert werden.') : t('PDF konnte nicht gelesen werden: {error}', { error: msg }));
      }
    })();
    return () => {
      alive = false;
      if (!imported.current) closePdf(key);
    };
  }, [file, key]);

  const count = sizes?.length ?? 0;
  const rangeResult = range.trim() ? parsePageRange(range, count) : null;
  const rangeError = rangeResult && 'error' in rangeResult ? rangeResult.error : null;

  const toggle = (n: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      setRange(formatPageRange([...next].sort((a, b) => a - b)));
      return next;
    });

  const applyRange = (text: string) => {
    setRange(text);
    const r = parsePageRange(text, count);
    if ('pages' in r) setSelected(new Set(r.pages));
  };

  const doImport = async () => {
    if (!bytes.current || !sizes || selected.size === 0) return;
    setBusy(true);
    try {
      const asset = await api.assetPut(bytes.current, 'pdf');
      aliasPdf(key, asset);
      imported.current = true;
      const pages = [...selected].sort((a, b) => a - b).map((n) => ({ ref: { asset, page: n }, size: sizes[n - 1] }));
      onImport({ title: title.trim() || t('PDF-Dokument'), asset, pages, position });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === 'notebook' ? t('PDF als neues Notizbuch importieren') : t('PDF-Seiten einfügen')}
      onClose={onClose}
      width={760}
      testId="pdf-import-dialog"
      footer={
        <>
          <span className="pdf-import-count">{sizes ? t('{n} von {total} Seiten ausgewählt', { n: selected.size, total: count }) : ''}</span>
          <button className="btn" onClick={onClose} data-testid="dialog-cancel">
            {t('Abbrechen')}
          </button>
          <button className="btn btn-primary" disabled={!sizes || selected.size === 0 || busy || !!rangeError} onClick={() => void doImport()} data-testid="pdf-import-confirm">
            {busy ? <Loader2 size={15} className="spin" /> : <FileText size={15} />} {mode === 'notebook' ? t('Notizbuch erstellen') : t('Seiten einfügen')}
          </button>
        </>
      }
    >
      <div className="pdf-import-head">
        <div className="pdf-file">
          <FileText size={18} /> <span title={file.name}>{file.name}</span>
          <span className="pdf-file-size">{file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}</span>
        </div>
        {mode === 'notebook' ? (
          <label className="field pdf-title">
            <span className="field-label">{t('Titel')}</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="pdf-title" />
          </label>
        ) : (
          <div className="field">
            <span className="field-label">{t('Einfügen')}</span>
            <Segmented
              value={position}
              options={[
                { id: 'after', label: t('Nach aktueller Seite') },
                { id: 'end', label: t('Am Ende') },
              ]}
              onChange={setPosition}
              testId="pdf-position"
            />
          </div>
        )}
      </div>

      {error && <div className="banner-error">{error}</div>}
      {!sizes && !error && (
        <div className="pdf-loading">
          <Loader2 size={18} className="spin" /> {t('PDF wird gelesen …')}
        </div>
      )}

      {sizes && (
        <>
          <div className="pdf-range-row">
            <label className="field pdf-range">
              <span className="field-label">{t('Seiten (leer = alle)')}</span>
              <input className="input" placeholder={t('z. B. 1-3, 5, 8-')} value={range} onChange={(e) => applyRange(e.target.value)} data-testid="pdf-range" />
              {rangeError && <span className="field-error">{rangeError}</span>}
            </label>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSelected(new Set(sizes.map((_, i) => i + 1)));
                setRange('');
              }}
              data-testid="pdf-select-all"
            >
              <CheckSquare size={15} /> {t('Alle')}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSelected(new Set());
                setRange('');
              }}
            >
              <Square size={15} /> {t('Keine')}
            </button>
          </div>
          <div className="pdf-grid" data-testid="pdf-grid">
            {sizes.map((s, i) => {
              const n = i + 1;
              const on = selected.has(n);
              return (
                <button key={n} className={`pdf-cell${on ? ' on' : ''}`} onClick={() => toggle(n)} aria-pressed={on} data-testid="pdf-cell">
                  <div className="pdf-cell-page" style={{ width: THUMB_W, height: Math.round((THUMB_W * s.h) / s.w) }}>
                    <PdfCanvas pdf={{ asset: key, page: n }} pageW={s.w} pageH={s.h} cssWidth={THUMB_W} observe />
                  </div>
                  <span className="pdf-cell-label">
                    <span className={`pdf-check${on ? ' on' : ''}`}>{on ? '✓' : ''}</span> {n}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
