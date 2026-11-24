import { useState } from 'react';
import { Check, ChevronRight, Folder as FolderIcon, Home } from 'lucide-react';
import type { LibraryData } from '../../shared/types';
import { Modal } from '../components/ui';
import { FOLDER_COLORS } from '../lib/colors';
import { inkOn } from '../lib/palette';
import { isWithin, sortItems } from '../lib/library';

import { t } from '../i18n';
/** Zielordner wählen (Ordner können nicht in sich selbst verschoben werden). */
export function MoveDialog({
  lib,
  movingFolderId,
  currentParent,
  onMove,
  onClose,
}: {
  lib: LibraryData;
  movingFolderId: string | null;
  currentParent: string | null;
  onMove: (target: string | null) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string | null>(currentParent);

  const renderLevel = (parentId: string | null, depth: number): React.ReactNode =>
    sortItems(
      lib.folders.filter((f) => f.parentId === parentId && f.trashedAt === null).map((folder) => ({ kind: 'folder' as const, folder })),
      'name-asc',
    ).map((item) => {
      if (item.kind !== 'folder') return null;
      const f = item.folder;
      const disabled = movingFolderId !== null && isWithin(lib, f.id, movingFolderId);
      return (
        <div key={f.id}>
          <button
            className={`tree-row${target === f.id ? ' selected' : ''}`}
            style={{ paddingLeft: 12 + depth * 18 }}
            disabled={disabled}
            onClick={() => setTarget(f.id)}
            data-testid="move-target"
          >
            <FolderIcon size={16} strokeWidth={1.75} color={f.color} fill={f.color} fillOpacity={0.35} />
            <span>{f.name}</span>
          </button>
          {renderLevel(f.id, depth + 1)}
        </div>
      );
    });

  return (
    <Modal
      title={t('Bewegen nach …')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} data-testid="dialog-cancel">
            {t('Abbrechen')}
          </button>
          <button
            className="btn btn-primary"
            disabled={target === currentParent}
            onClick={() => {
              onMove(target);
              onClose();
            }}
            data-testid="move-confirm"
          >
            {t('Hierher bewegen')}
          </button>
        </>
      }
    >
      <div className="tree">
        <button className={`tree-row${target === null ? ' selected' : ''}`} onClick={() => setTarget(null)}>
          <Home size={16} strokeWidth={1.75} />
          <span>{t('Dokumente')}</span>
          <ChevronRight size={14} className="tree-chevron" />
        </button>
        {renderLevel(null, 1)}
      </div>
    </Modal>
  );
}

export function ColorDialog({ title, value, onPick, onClose }: { title: string; value: string; onPick: (c: string) => void; onClose: () => void }) {
  const [custom, setCustom] = useState(value);
  return (
    <Modal title={title} onClose={onClose} width={380}>
      <div className="color-grid">
        {FOLDER_COLORS.map((c) => (
          <button
            key={c}
            className={`swatch swatch-lg${value.toLowerCase() === c.toLowerCase() ? ' selected' : ''}`}
            style={{ background: c }}
            aria-label={c}
            onClick={() => {
              onPick(c);
              onClose();
            }}
          >
            {value.toLowerCase() === c.toLowerCase() && <Check size={16} strokeWidth={2.5} color={inkOn(c)} />}
          </button>
        ))}
      </div>
      <label className="field custom-color">
        <span className="field-label">{t('Eigene Farbe')}</span>
        <div className="custom-color-row">
          <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <code>{custom.toUpperCase()}</code>
          <button
            className="btn"
            onClick={() => {
              onPick(custom);
              onClose();
            }}
          >
            {t('Übernehmen')}
          </button>
        </div>
      </label>
    </Modal>
  );
}
