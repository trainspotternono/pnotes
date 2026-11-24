import { useState } from 'react';
import { useSync } from '../state/sync';
import { ChevronRight, Clock, Cloud, FolderClosed, FolderOpen, FolderPlus, HardDrive, Library, Monitor, Moon, MoreHorizontal, Settings, Star, Sun, Trash2 } from 'lucide-react';
import type { Folder, LibraryData } from '../../shared/types';

/** gleicher Typ wie die Karten in der Bibliothek (LibraryView.ITEM_DRAG_TYPE) */
const ITEM_DRAG = 'application/x-papierwerk-item';
const ROOT = '__root__';
import { api } from '../lib/api';
import { folderPath, sortItems } from '../lib/library';
import type { ThemeSetting } from '../App';

import { t, tk } from '../i18n';
import { openSettings } from '../settings/SettingsDialog';
export type Section = 'documents' | 'recent' | 'favorites' | 'trash';

const NAV: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'documents', label: tk('Dokumente'), icon: <Library size={18} strokeWidth={1.6} /> },
  { id: 'recent', label: tk('Zuletzt'), icon: <Clock size={18} strokeWidth={1.6} /> },
  { id: 'favorites', label: tk('Favoriten'), icon: <Star size={18} strokeWidth={1.6} /> },
  { id: 'trash', label: tk('Papierkorb'), icon: <Trash2 size={18} strokeWidth={1.6} /> },
];

export function Sidebar({
  lib,
  section,
  folderId,
  onNavigate,
  theme,
  onTheme,
  trashCount,
  onNewFolder,
  onFolderMenu,
  onDropItem,
}: {
  lib: LibraryData;
  section: Section;
  folderId: string | null;
  onNavigate: (section: Section, folderId?: string | null) => void;
  theme: ThemeSetting;
  onTheme: (t: ThemeSetting) => void;
  trashCount: number;
  onNewFolder: () => void;
  /** Rechtsklick/„…“ auf einen Ordner: Umbenennen, Farbe, Unterordner, Bewegen, Löschen */
  onFolderMenu: (folder: Folder, x: number, y: number) => void;
  /** Notizbuch/Ordner auf einen Ordner (oder „Dokumente“ = Stamm) gezogen */
  onDropItem: (raw: string, target: string | null) => void;
}) {
  const { setSettingsOpen } = useSync();
  const openPath = new Set(folderPath(lib, folderId).map((f) => f.id));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dropProps = (target: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (![...e.dataTransfer.types].includes(ITEM_DRAG)) return;
      e.preventDefault();
      setDropTarget(target ?? ROOT);
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: React.DragEvent) => {
      setDropTarget(null);
      const raw = e.dataTransfer.getData(ITEM_DRAG);
      if (raw) {
        e.preventDefault();
        onDropItem(raw, target);
      }
    },
  });

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const renderTree = (parentId: string | null, depth: number): React.ReactNode => {
    const children = sortItems(
      lib.folders.filter((f) => f.parentId === parentId && f.trashedAt === null).map((folder) => ({ kind: 'folder' as const, folder })),
      'name-asc',
    );
    return children.map((item) => {
      if (item.kind !== 'folder') return null;
      const f = item.folder;
      const hasKids = lib.folders.some((x) => x.parentId === f.id && x.trashedAt === null);
      const isOpen = expanded.has(f.id) || openPath.has(f.id);
      const active = section === 'documents' && folderId === f.id;
      return (
        <div key={f.id}>
          <div
            className={`side-tree-row${active ? ' active' : ''}${dropTarget === f.id ? ' drop-target' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            data-testid="side-folder"
            onContextMenu={(e) => {
              e.preventDefault();
              onFolderMenu(f, e.clientX, e.clientY);
            }}
            {...dropProps(f.id)}
          >
            <button className={`side-tree-toggle${hasKids ? '' : ' invisible'}`} onClick={() => toggle(f.id)} aria-label={isOpen ? t('Zuklappen') : t('Aufklappen')}>
              <ChevronRight size={14} style={{ transform: isOpen ? 'rotate(90deg)' : undefined }} />
            </button>
            <button className="side-tree-label" onClick={() => onNavigate('documents', f.id)} title={f.name}>
              {active ? (
                <FolderOpen size={16} strokeWidth={1.6} color={f.color} />
              ) : (
                <FolderClosed size={16} strokeWidth={1.6} color={f.color} fill={f.color} fillOpacity={0.3} />
              )}
              <span>{f.name}</span>
            </button>
            <button
              className="icon-btn side-tree-more"
              aria-label={t('Aktionen für {name}', { name: f.name })}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onFolderMenu(f, r.left, r.bottom + 4);
              }}
              data-testid="side-folder-more"
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
          {hasKids && isOpen && renderTree(f.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand drag">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
          {/* pNotes-Zeichen: kleines „p“ auf Crimson */}
          <rect x="3" y="3" width="26" height="26" rx="7" fill="var(--accent)" />
          <path d="M12 11 V25" stroke="var(--pnotes-slate-100)" strokeWidth="3.2" strokeLinecap="round" />
          <circle cx="17" cy="15.5" r="4.6" fill="none" stroke="var(--pnotes-slate-100)" strokeWidth="3.2" />
        </svg>
        <span>pNotes</span>
      </div>

      <nav className="side-nav">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`side-nav-item${section === n.id && !(n.id === 'documents' && folderId) ? ' active' : section === n.id ? ' active-soft' : ''}${n.id === 'documents' && dropTarget === ROOT ? ' drop-target' : ''}`}
            onClick={() => onNavigate(n.id, null)}
            data-testid={`nav-${n.id}`}
            {...(n.id === 'documents' ? dropProps(null) : {})}
          >
            {n.icon}
            <span>{t(n.label)}</span>
            {n.id === 'trash' && trashCount > 0 && <span className="side-badge">{trashCount}</span>}
          </button>
        ))}
      </nav>

      <div className="side-section-title side-section-row">
        <span>{t('Ordner')}</span>
        <button className="icon-btn side-add" onClick={onNewFolder} title={t('Neuer Ordner (Strg+Umschalt+N)')} aria-label={t('Neuer Ordner')} data-testid="side-new-folder">
          <FolderPlus size={15} strokeWidth={1.8} />
        </button>
      </div>
      <div className="side-tree">{lib.folders.some((f) => f.parentId === null && f.trashedAt === null) ? renderTree(null, 0) : <div className="side-empty">{t('Noch keine Ordner')}</div>}</div>

      <div className="sidebar-footer">
        <div className="theme-switch" role="radiogroup" aria-label={t('Darstellung')}>
          {(
            [
              ['system', <Monitor key="m" size={15} strokeWidth={1.7} />, t('System')],
              ['light', <Sun key="s" size={15} strokeWidth={1.7} />, t('Hell')],
              ['dark', <Moon key="d" size={15} strokeWidth={1.7} />, t('Dunkel')],
            ] as const
          ).map(([id, icon, label]) => (
            <button key={id} role="radio" aria-checked={theme === id} className={theme === id ? 'active' : ''} title={label} onClick={() => onTheme(id)} data-testid={`theme-${id}`}>
              {icon}
            </button>
          ))}
        </div>
        <button className="side-footer-link" onClick={() => setSettingsOpen(true)} title={t('Sync einrichten: Nextcloud, Google Drive, iCloud Drive, eigener Ordner oder WebDAV')} data-testid="open-sync-settings">
          <Cloud size={15} strokeWidth={1.7} />
          <span>{t('Synchronisierung')}</span>
        </button>
        <button className="side-footer-link" onClick={() => void api.openDataFolder()} title={t('Speicherort im Explorer öffnen')}>
          <HardDrive size={15} strokeWidth={1.7} />
          <span>{t('Speicherort öffnen')}</span>
        </button>
        <button className="side-footer-link" onClick={openSettings} title={t('Sprache und weitere Einstellungen')} data-testid="open-settings">
          <Settings size={15} strokeWidth={1.7} />
          <span>{t('Einstellungen')}</span>
        </button>
      </div>
    </aside>
  );
}
