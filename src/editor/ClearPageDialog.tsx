/**
 * „Seite leeren“: auswählen, welche Inhalte von der Seite entfernt werden – Handschrift, Formen,
 * Texte, Haftnotizen, Bilder, Kommentare. Standard: alles. Die letzte Auswahl wird gemerkt.
 * Hintergrund (Vorlage/PDF) bleibt; Rückgängig stellt alles wieder her.
 */
import { useState } from 'react';
import { Check, Image as ImageIcon, MessageSquare, PenLine, Shapes, StickyNote, Type } from 'lucide-react';
import type { Page } from '../../shared/types';
import { Modal } from '../components/ui';
import { t, tk } from '../i18n';
import { CLEAR_CATEGORIES, countPageContent, type ClearCategory } from './pages';

const PREF = 'pw.clearCats';

const LABELS: Record<ClearCategory, { label: string; hint: string; icon: React.ReactNode }> = {
  ink: { label: tk('Handschrift'), hint: tk('Stift und Textmarker'), icon: <PenLine size={16} /> },
  shapes: { label: tk('Formen'), hint: tk('Linien, Pfeile, Kreise, Rechtecke …'), icon: <Shapes size={16} /> },
  texts: { label: tk('Texte'), hint: tk('Textfelder'), icon: <Type size={16} /> },
  stickies: { label: tk('Haftnotizen'), hint: tk('Notizzettel'), icon: <StickyNote size={16} /> },
  images: { label: tk('Bilder'), hint: tk('Bilder, Sticker und GIFs'), icon: <ImageIcon size={16} /> },
  comments: { label: tk('Kommentare'), hint: tk('inkl. aller Antworten'), icon: <MessageSquare size={16} /> },
};

function loadPref(): Set<ClearCategory> {
  try {
    const raw = localStorage.getItem(PREF);
    if (raw) {
      const arr = (JSON.parse(raw) as string[]).filter((c): c is ClearCategory => CLEAR_CATEGORIES.includes(c as ClearCategory));
      return new Set(arr);
    }
  } catch {
    /* ignorieren */
  }
  return new Set(CLEAR_CATEGORIES);
}

function savePref(s: Set<ClearCategory>) {
  try {
    localStorage.setItem(PREF, JSON.stringify([...s]));
  } catch {
    /* ignorieren */
  }
}

export function ClearPageDialog({
  page,
  pageIndex,
  onConfirm,
  onClose,
}: {
  page: Page;
  pageIndex: number;
  onConfirm: (cats: ClearCategory[]) => void;
  onClose: () => void;
}) {
  const counts = countPageContent(page);
  const [sel, setSel] = useState<Set<ClearCategory>>(loadPref);
  const available = CLEAR_CATEGORIES.filter((c) => counts[c] > 0);
  const chosen = available.filter((c) => sel.has(c));
  const total = chosen.reduce((n, c) => n + counts[c], 0);
  const allOn = available.every((c) => sel.has(c));

  const toggle = (c: ClearCategory) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });

  return (
    <Modal
      title={t('Seite {n} leeren', { n: pageIndex + 1 })}
      onClose={onClose}
      width={440}
      testId="clear-page-dialog"
      footer={
        <>
          <button className="btn" onClick={onClose} data-testid="dialog-cancel">
            {t('Abbrechen')}
          </button>
          <button
            className="btn btn-danger"
            disabled={total === 0}
            onClick={() => {
              savePref(sel);
              onConfirm(chosen);
              onClose();
            }}
            data-testid="clear-page-confirm"
            autoFocus
          >
            {total === 1 ? t('1 Element entfernen') : t('{n} Elemente entfernen', { n: total })}
          </button>
        </>
      }
    >
      {available.length === 0 ? (
        <p className="modal-text">{t('Diese Seite ist bereits leer.')}</p>
      ) : (
        <>
          <div className="clear-head">
            <span>{t('Was soll entfernt werden?')}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSel(allOn ? new Set() : new Set(CLEAR_CATEGORIES))}
              data-testid="clear-toggle-all"
            >
              {allOn ? t('Keine') : t('Alle')}
            </button>
          </div>
          <div className="lang-list" role="group">
            {CLEAR_CATEGORIES.map((c) => {
              const on = sel.has(c) && counts[c] > 0;
              const L = LABELS[c];
              return (
                <button
                  key={c}
                  role="checkbox"
                  aria-checked={on}
                  disabled={counts[c] === 0}
                  className={`lang-row clear-row${on ? ' selected' : ''}`}
                  onClick={() => toggle(c)}
                  data-testid={`clear-${c}`}
                >
                  <span className={`clear-check${on ? ' on' : ''}`}>{on && <Check size={13} strokeWidth={3} />}</span>
                  <span className="lang-icon">{L.icon}</span>
                  <span className="lang-label">
                    {t(L.label)}
                    <small>{t(L.hint)}</small>
                  </span>
                  <span className="clear-count">{counts[c]}</span>
                </button>
              );
            })}
          </div>
          <p className="field-hint">{t('Hintergrund und PDF bleiben erhalten. Mit „Rückgängig“ (Strg+Z) lässt sich alles wiederherstellen.')}</p>
        </>
      )}
    </Modal>
  );
}
