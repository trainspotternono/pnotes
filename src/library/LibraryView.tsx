import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp, BookOpen, ChevronRight, Copy, Download, FileArchive, FileUp, FolderInput, FolderOpen, FolderPlus, MoreHorizontal, MousePointerClick,
  NotebookPen, Palette, Pencil, Plus, RotateCcw, Search, Star, StarOff, Trash2, X,
} from 'lucide-react';
import type { Folder, NotebookMeta, OpenedFile } from '../../shared/types';
import { buildNoahpalle } from '../export/ExportDialog';
import { importNoahpalle } from '../export/importDocument';
import { NOAHPALLE_EXT } from '../export/noahpalle';
import { isDocName } from '../../shared/brand';
import { nearestFormat, pageSize } from '../lib/formats';
import { normalizeContent } from '../lib/notebook';
import { ConfirmDialog, Menu, PromptDialog, useMenu, useToast, type MenuItem } from '../components/ui';
import { api } from '../lib/api';
import { DEFAULT_FOLDER_COLOR } from '../lib/colors';
import { newId } from '../lib/ids';
import * as L from '../lib/library';
import { newNotebookContent } from '../lib/notebook';
import { useLibrary } from '../state/library';
import type { ThemeSetting } from '../App';
import { FolderGraphic, NotebookCover } from './Covers';
import { NewNotebookDialog, type NewNotebookValues } from './NewNotebookDialog';
import { ColorDialog, MoveDialog } from './PickerDialogs';
import { Sidebar, type Section } from './Sidebar';
import { PdfImportDialog, type PdfImportResult } from '../pdf/PdfImportDialog';
import { pdfPage } from '../editor/pages';
import { SyncIndicator } from '../sync/SyncUi';

import { formatDate, t, tk } from '../i18n';

const tGeloescht = (date: string) => t('Gelöscht {date}', { date });
export interface LibraryLocation {
  section: Section;
  folderId: string | null;
}

type DialogState =
  | { type: 'new-folder'; parentId?: string | null }
  | { type: 'new-notebook' }
  | { type: 'rename'; item: L.Item }
  | { type: 'move'; item: L.Item }
  | { type: 'color'; folder: Folder }
  | { type: 'cover'; notebook: NotebookMeta }
  | { type: 'delete-forever'; item: L.Item }
  | { type: 'empty-trash' }
  | null;

const SECTION_TITLES: Record<Section, string> = {
  documents: tk('Dokumente'),
  recent: tk('Zuletzt geöffnet'),
  favorites: tk('Favoriten'),
  trash: tk('Papierkorb'),
};

const dateFmt = { format: (ts: number) => formatDate(ts) };

export function LibraryView({
  location,
  onLocation,
  onOpenNotebook,
  theme,
  onTheme,
}: {
  location: LibraryLocation;
  onLocation: (l: LibraryLocation) => void;
  onOpenNotebook: (id: string) => void;
  theme: ThemeSetting;
  onTheme: (t: ThemeSetting) => void;
}) {
  const { lib, update, deleteNotebookFiles, error } = useLibrary();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<L.SortKey>(() => (localStorage.getItem('pw.sort') as L.SortKey) || 'date-desc');
  const [dialog, setDialog] = useState<DialogState>(null);
  const itemMenu = useMenu();
  const [menuItem, setMenuItem] = useState<L.Item | null>(null);
  const newMenu = useMenu();
  const sortMenu = useMenu();
  const searchRef = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const openDocRef = useRef<(f: OpenedFile) => void>(() => undefined);
  const folderMenu = useMenu();
  const [menuFolder, setMenuFolder] = useState<Folder | null>(null);

  // PDF per Drag & Drop auf die Bibliothek ziehen
  useEffect(() => {
    if (location.section === 'trash') return;
    const hasFile = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const over = (e: DragEvent) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      setDragOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      setDragOver(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      const doc = files.find((x) => isDocName(x.name));
      if (doc) {
        void doc.arrayBuffer().then((b) => openDocRef.current({ name: doc.name, data: new Uint8Array(b) }));
        return;
      }
      const f = files.find((x) => x.type === 'application/pdf' || /\.pdf$/i.test(x.name));
      if (f) setPdfFile(f);
      else toast(t('Bitte eine PDF- oder .pnotes-Datei ablegen.'));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [location.section, toast]);

  const { section, folderId } = location;
  const isTrash = section === 'trash';

  useEffect(() => {
    try {
      localStorage.setItem('pw.sort', sort);
    } catch {
      /* optional */
    }
  }, [sort]);

  // Ordner existiert nicht mehr (z. B. gelöscht) → zurück zum Stamm.
  useEffect(() => {
    if (folderId && (!L.getFolder(lib, folderId) || L.isTrashed(lib, 'folder', folderId))) onLocation({ section: 'documents', folderId: null });
  }, [lib, folderId, onLocation]);

  const items = useMemo(() => {
    switch (section) {
      case 'documents':
        return L.listFolder(lib, folderId, sort, search);
      case 'recent':
        return L.listRecent(lib).filter((i) => !search || L.itemName(i).toLowerCase().includes(search.toLowerCase()));
      case 'favorites':
        return L.listFavorites(lib, sort).filter((i) => !search || L.itemName(i).toLowerCase().includes(search.toLowerCase()));
      case 'trash':
        return L.listTrash(lib, sort);
    }
  }, [lib, section, folderId, sort, search]);

  const trashCount = useMemo(() => L.listTrash(lib, 'date-desc').length, [lib]);
  const crumbs = section === 'documents' ? L.folderPath(lib, folderId) : [];

  const navigate = useCallback(
    (s: Section, f: string | null = null) => {
      setSearch('');
      onLocation({ section: s, folderId: s === 'documents' ? f : null });
    },
    [onLocation],
  );

  const targetFolder = section === 'documents' && !search ? folderId : null;

  const createFolder = (name: string, parentId: string | null = targetFolder) => {
    const now = Date.now();
    update((l) => L.addFolder(l, { id: newId(), name, parentId, color: DEFAULT_FOLDER_COLOR, favorite: false, createdAt: now, updatedAt: now, trashedAt: null }));
  };

  /** Element per Drag & Drop in einen Ordner (oder in den Stamm) verschieben. */
  const dropOnFolder = (raw: string, target: string | null) => {
    try {
      const { kind, id } = JSON.parse(raw) as { kind: L.ItemKind; id: string };
      if (kind === 'folder' && (id === target || (target && L.isWithin(lib, target, id)))) {
        toast(t('Ein Ordner kann nicht in sich selbst verschoben werden.'));
        return;
      }
      const name = kind === 'folder' ? L.getFolder(lib, id)?.name : L.getNotebook(lib, id)?.title;
      update((l) => L.move(l, kind, id, target, Date.now()));
      toast(t('„{name}“ nach „{target}“ bewegt', { name: name ?? '', target: target ? (L.getFolder(lib, target)?.name ?? '') : t('Dokumente') }));
    } catch {
      /* fremde Daten */
    }
  };

  // ---- .pnotes
  const openDocument = async (file?: OpenedFile | null) => {
    const f = file ?? (await api.fileOpenDocument());
    if (!f) return;
    try {
      const id = await importNoahpalle(f, update, targetFolder);
      toast(t('„{name}“ geöffnet', { name: f.name }));
      onOpenNotebook(id);
    } catch (e) {
      toast(t('„{name}“ konnte nicht geöffnet werden: {error}', { name: f.name, error: (e as Error).message }));
    }
  };

  const exportNoahpalle = async (nb: NotebookMeta) => {
    try {
      const content = normalizeContent(await api.loadNotebook(nb.id), nb.id, nb.template);
      const bytes = await buildNoahpalle(nb, content.pages, pageSize(nb.format, nb.orientation));
      const file = await api.fileSave({ defaultName: `${nb.title.replace(/[\\/:*?"<>|]/g, '_')}.${NOAHPALLE_EXT}`, filters: [{ name: t('pNotes-Dokument'), extensions: [NOAHPALLE_EXT] }], data: bytes });
      if (file) toast(t('Dokument gespeichert: {file}', { file }));
    } catch (e) {
      toast(t('Export fehlgeschlagen: {error}', { error: (e as Error).message }));
    }
  };

  const createNotebook = async (v: NewNotebookValues) => {
    const id = newId();
    const now = Date.now();
    try {
      await api.saveNotebook(newNotebookContent(id, v.template));
    } catch (e) {
      toast(t('Notizbuch konnte nicht erstellt werden: {error}', { error: (e as Error).message }));
      return;
    }
    update((l) =>
      L.addNotebook(l, { id, ...v, folderId: targetFolder, favorite: false, pageCount: 1, createdAt: now, updatedAt: now, openedAt: now, trashedAt: null }),
    );
    onOpenNotebook(id);
  };

  /** PDF als neues Notizbuch: jede ausgewählte PDF-Seite wird eine Notizbuchseite (eigene Größe). */
  const createFromPdf = async (r: PdfImportResult) => {
    const id = newId();
    const now = Date.now();
    const first = r.pages[0].size;
    const orientation: NotebookMeta['orientation'] = first.w > first.h ? 'landscape' : 'portrait';
    // Notizbuchformat = nächstliegendes bekanntes Format (Seiten behalten trotzdem ihre exakte PDF-Größe)
    const format: NotebookMeta['format'] = nearestFormat(first.w, first.h);
    try {
      await api.saveNotebook({ version: 1, id, pages: r.pages.map((x) => pdfPage(x.ref, x.size)) });
    } catch (e) {
      toast(t('Import fehlgeschlagen: {error}', { error: (e as Error).message }));
      return;
    }
    update((l) =>
      L.addNotebook(l, {
        id,
        title: L.uniqueName(r.title, (t) => L.isTitleTaken(l, targetFolder, t)),
        folderId: targetFolder,
        coverColor: null,
        coverPdf: r.pages[0].ref,
        template: 'blank',
        paperColor: 'white',
        format,
        orientation,
        favorite: false,
        pageCount: r.pages.length,
        createdAt: now,
        updatedAt: now,
        openedAt: now,
        trashedAt: null,
      }),
    );
    onOpenNotebook(id);
  };

  const duplicateNotebook = async (nb: NotebookMeta) => {
    const content = await api.loadNotebook(nb.id);
    const id = newId();
    const now = Date.now();
    await api.saveNotebook({ ...(content ?? newNotebookContent(id, nb.template)), id });
    update((l) => {
      const title = L.uniqueName(nb.title, (t) => L.isTitleTaken(l, nb.folderId, t));
      return L.addNotebook(l, { ...nb, id, title, favorite: false, createdAt: now, updatedAt: now, openedAt: null });
    });
    toast(t('„{name}“ dupliziert', { name: nb.title }));
  };

  openDocRef.current = (f) => void openDocument(f);

  const openItem = (item: L.Item) => {
    if (isTrash) return;
    if (item.kind === 'folder') navigate('documents', item.folder.id);
    else onOpenNotebook(item.notebook.id);
  };

  const trashItem = (item: L.Item) => {
    const id = L.itemId(item);
    update((l) => L.trash(l, item.kind, id, Date.now()));
    toast(t('„{name}“ in den Papierkorb gelegt', { name: L.itemName(item) }), { label: t('Rückgängig'), run: () => update((l) => L.restore(l, item.kind, id)) });
  };

  const menuItems = (item: L.Item): MenuItem[] => {
    const id = L.itemId(item);
    if (isTrash) {
      return [
        { id: 'restore', label: t('Wiederherstellen'), icon: <RotateCcw size={16} />, onSelect: () => update((l) => L.restore(l, item.kind, id)) },
        'separator',
        { id: 'delete-forever', label: t('Endgültig löschen'), icon: <Trash2 size={16} />, danger: true, onSelect: () => setDialog({ type: 'delete-forever', item }) },
      ];
    }
    const fav = item.kind === 'folder' ? item.folder.favorite : item.notebook.favorite;
    return [
      { id: 'open', label: t('Öffnen'), icon: item.kind === 'folder' ? <FolderOpen size={16} /> : <BookOpen size={16} />, onSelect: () => openItem(item) },
      'separator',
      { id: 'rename', label: t('Umbenennen'), icon: <Pencil size={16} />, onSelect: () => setDialog({ type: 'rename', item }) },
      item.kind === 'folder'
        ? { id: 'color', label: t('Farbe ändern'), icon: <Palette size={16} />, onSelect: () => setDialog({ type: 'color', folder: item.folder }) }
        : { id: 'cover', label: t('Umschlag ändern'), icon: <Palette size={16} />, onSelect: () => setDialog({ type: 'cover', notebook: item.notebook }) },
      { id: 'move', label: t('Bewegen …'), icon: <FolderInput size={16} />, onSelect: () => setDialog({ type: 'move', item }) },
      ...(item.kind === 'notebook'
        ? [
            { id: 'duplicate', label: t('Duplizieren'), icon: <Copy size={16} />, onSelect: () => void duplicateNotebook(item.notebook) } as MenuItem,
            { id: 'export-noahpalle', label: t('Als .pnotes exportieren …'), icon: <Download size={16} />, onSelect: () => void exportNoahpalle(item.notebook) } as MenuItem,
          ]
        : [{ id: 'new-subfolder', label: t('Neuer Unterordner …'), icon: <FolderPlus size={16} />, onSelect: () => setDialog({ type: 'new-folder', parentId: item.folder.id }) } as MenuItem]),
      {
        id: 'favorite',
        label: fav ? t('Aus Favoriten entfernen') : t('Zu Favoriten'),
        icon: fav ? <StarOff size={16} /> : <Star size={16} />,
        onSelect: () => update((l) => L.toggleFavorite(l, item.kind, id)),
      },
      'separator',
      { id: 'trash', label: t('In den Papierkorb'), icon: <Trash2 size={16} />, danger: true, onSelect: () => trashItem(item) },
    ];
  };

  // Tastenkürzel der Bibliothek
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog) return;
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'n' && !isTrash) {
        e.preventDefault();
        setDialog({ type: 'new-notebook' });
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n' && !isTrash) {
        e.preventDefault();
        setDialog({ type: 'new-folder' });
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'i' && !isTrash) {
        e.preventDefault();
        pdfInput.current?.click();
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'o' && !isTrash) {
        e.preventDefault();
        void api.fileOpenDocument().then((f) => f && openDocRef.current(f));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, isTrash]);

  const defaultTitle = L.uniqueName(t('Unbenanntes Notizbuch'), (t) => L.isTitleTaken(lib, targetFolder, t));
  const title = section === 'documents' && crumbs.length ? crumbs[crumbs.length - 1].name : t(SECTION_TITLES[section]);

  return (
    <div className="app-shell" data-testid="library">
      <Sidebar
        lib={lib}
        section={section}
        folderId={folderId}
        onNavigate={navigate}
        theme={theme}
        onTheme={onTheme}
        trashCount={trashCount}
        onNewFolder={() => setDialog({ type: 'new-folder', parentId: null })}
        onFolderMenu={(f, x, y) => {
          setMenuFolder(f);
          folderMenu.openAt(x, y);
        }}
        onDropItem={dropOnFolder}
      />

      <main className="library-main">
        <header className="topbar drag">
          <nav className="breadcrumb no-drag" data-testid="breadcrumb" aria-label={t('Pfad')}>
            {section === 'documents' ? (
              <>
                <button className={`crumb${crumbs.length === 0 ? ' current' : ''}`} onClick={() => navigate('documents', null)} data-testid="crumb-root">
                  {t('Dokumente')}
                </button>
                {crumbs.map((f, i) => (
                  <span key={f.id} className="crumb-wrap">
                    <ChevronRight size={14} className="crumb-sep" />
                    <button className={`crumb${i === crumbs.length - 1 ? ' current' : ''}`} onClick={() => navigate('documents', f.id)}>
                      {f.name}
                    </button>
                  </span>
                ))}
              </>
            ) : (
              <span className="crumb current">{t(SECTION_TITLES[section])}</span>
            )}
          </nav>

          <div className="topbar-actions no-drag">
            <SyncIndicator />
            {!isTrash && (
              <div className="search">
                <Search size={16} strokeWidth={1.7} />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
                  placeholder={t('Suchen (Strg+F)')}
                  data-testid="search"
                />
                {search && (
                  <button className="search-clear" onClick={() => setSearch('')} aria-label={t('Suche löschen')}>
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
            {section !== 'recent' && (
              <button className="btn btn-ghost" onClick={(e) => sortMenu.openBelow(e.currentTarget, 'end')} title={t('Sortieren')} data-testid="sort">
                <ArrowDownUp size={16} strokeWidth={1.7} />
                <span>{t(L.SORT_OPTIONS.find((o) => o.id === sort)?.label ?? '')}</span>
              </button>
            )}
            {isTrash ? (
              <button className="btn btn-danger-soft" disabled={items.length === 0} onClick={() => setDialog({ type: 'empty-trash' })} data-testid="empty-trash">
                <Trash2 size={16} strokeWidth={1.7} />
                <span>{t('Papierkorb leeren')}</span>
              </button>
            ) : (
              <button className="btn btn-primary" onClick={(e) => newMenu.openBelow(e.currentTarget, 'end')} data-testid="new-menu">
                <Plus size={17} strokeWidth={2} />
                <span>{t('Neu')}</span>
              </button>
            )}
          </div>
        </header>

        <div className="library-scroll">
          {error && <div className="banner-error">{error}</div>}
          <div className="library-heading">
            <h1>{search ? t('Suchergebnisse für „{q}“', { q: search }) : title}</h1>
            <span className="library-count">{items.length === 1 ? t('1 Objekt') : t('{n} Objekte', { n: items.length })}</span>
          </div>

          {items.length === 0 ? (
            <EmptyState section={section} searching={!!search} onNewNotebook={() => setDialog({ type: 'new-notebook' })} onNewFolder={() => setDialog({ type: 'new-folder' })} />
          ) : (
            <div className="grid" data-testid="grid">
              {items.map((item) => (
                <ItemCard
                  key={L.itemId(item)}
                  item={item}
                  subtitle={subtitleFor(lib, item, isTrash)}
                  onOpen={() => openItem(item)}
                  onMenu={(x, y) => {
                    setMenuItem(item);
                    itemMenu.openAt(x, y);
                  }}
                  draggable={!isTrash}
                  onDropItem={item.kind === 'folder' && !isTrash ? (raw) => dropOnFolder(raw, item.folder.id) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {itemMenu.menu && menuItem && <Menu {...itemMenu.menu} items={menuItems(menuItem)} onClose={itemMenu.close} />}
      {folderMenu.menu && menuFolder && (
        <Menu
          {...folderMenu.menu}
          onClose={folderMenu.close}
          items={[
            { id: 'side-open', label: t('Öffnen'), icon: <FolderOpen size={16} />, onSelect: () => navigate('documents', menuFolder.id) },
            { id: 'side-new-subfolder', label: t('Neuer Unterordner …'), icon: <FolderPlus size={16} />, onSelect: () => setDialog({ type: 'new-folder', parentId: menuFolder.id }) },
            'separator',
            { id: 'side-rename', label: t('Umbenennen'), icon: <Pencil size={16} />, onSelect: () => setDialog({ type: 'rename', item: { kind: 'folder', folder: menuFolder } }) },
            { id: 'side-color', label: t('Farbe ändern'), icon: <Palette size={16} />, onSelect: () => setDialog({ type: 'color', folder: menuFolder }) },
            { id: 'side-move', label: t('Bewegen …'), icon: <FolderInput size={16} />, onSelect: () => setDialog({ type: 'move', item: { kind: 'folder', folder: menuFolder } }) },
            'separator',
            { id: 'side-trash', label: t('Löschen (Papierkorb)'), icon: <Trash2 size={16} />, danger: true, onSelect: () => trashItem({ kind: 'folder', folder: menuFolder }) },
          ]}
        />
      )}
      {newMenu.menu && (
        <Menu
          {...newMenu.menu}
          onClose={newMenu.close}
          items={[
            { id: 'new-notebook', label: t('Notizbuch'), icon: <NotebookPen size={16} />, shortcut: t('Strg+N'), onSelect: () => setDialog({ type: 'new-notebook' }) },
            { id: 'new-folder', label: t('Ordner'), icon: <FolderPlus size={16} />, shortcut: t('Strg+Umschalt+N'), onSelect: () => setDialog({ type: 'new-folder' }) },
            'separator',
            { id: 'new-pdf', label: t('PDF importieren …'), icon: <FileUp size={16} />, shortcut: t('Strg+I'), onSelect: () => pdfInput.current?.click() },
            { id: 'open-doc', label: t('Dokument öffnen (.pnotes) …'), icon: <FileArchive size={16} />, shortcut: t('Strg+O'), onSelect: () => void openDocument() },
            'separator',
            {
              id: 'register-assoc',
              label: t('Doppelklick auf .pnotes aktivieren'),
              icon: <MousePointerClick size={16} />,
              onSelect: () => void api.registerFileAssociation().then((r) => toast(r.message)),
            },
          ]}
        />
      )}
      {sortMenu.menu && (
        <Menu
          {...sortMenu.menu}
          onClose={sortMenu.close}
          items={L.SORT_OPTIONS.map((o) => ({ id: `sort-${o.id}`, label: t(o.label), checked: sort === o.id, onSelect: () => setSort(o.id) }))}
        />
      )}

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
        data-testid="library-pdf-file"
      />
      {pdfFile && <PdfImportDialog file={pdfFile} mode="notebook" onImport={(r) => void createFromPdf(r)} onClose={() => setPdfFile(null)} />}
      {dragOver && (
        <div className="drop-overlay">
          <FileUp size={32} />
          <span>{t('PDF hier ablegen, um sie als Notizbuch zu importieren')}</span>
        </div>
      )}

      {dialog?.type === 'new-folder' && (
        <PromptDialog
          title={dialog.parentId ? t('Neuer Ordner in „{name}“', { name: L.getFolder(lib, dialog.parentId)?.name ?? '' }) : t('Neuer Ordner')}
          label={t('Name')}
          initial={t('Neuer Ordner')}
          confirmLabel={t('Erstellen')}
          onConfirm={(name) => createFolder(name, dialog.parentId === undefined ? targetFolder : dialog.parentId)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'new-notebook' && (
        <NewNotebookDialog defaultTitle={defaultTitle} isTaken={(t) => L.isTitleTaken(lib, targetFolder, t)} onCreate={(v) => void createNotebook(v)} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'rename' && (
        <PromptDialog
          title={dialog.item.kind === 'folder' ? t('Ordner umbenennen') : t('Notizbuch umbenennen')}
          label={t('Name')}
          initial={L.itemName(dialog.item)}
          confirmLabel={t('Umbenennen')}
          validate={(v) =>
            dialog.item.kind === 'notebook' && L.isTitleTaken(lib, dialog.item.notebook.folderId, v, dialog.item.notebook.id) ? t('Name bereits vergeben') : null
          }
          onConfirm={(v) => {
            const it = dialog.item;
            update((l) => L.rename(l, it.kind, L.itemId(it), v, Date.now()));
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'move' && (
        <MoveDialog
          lib={lib}
          movingFolderId={dialog.item.kind === 'folder' ? dialog.item.folder.id : null}
          currentParent={dialog.item.kind === 'folder' ? dialog.item.folder.parentId : dialog.item.notebook.folderId}
          onMove={(target) => {
            const it = dialog.item;
            update((l) => L.move(l, it.kind, L.itemId(it), target, Date.now()));
            toast(t('„{name}“ bewegt', { name: L.itemName(it) }));
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'color' && (
        <ColorDialog
          title={t('Ordnerfarbe')}
          value={dialog.folder.color}
          onPick={(c) => update((l) => L.setColor(l, 'folder', dialog.folder.id, c, Date.now()))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'cover' && (
        <NewNotebookDialog
          mode="cover"
          initial={dialog.notebook}
          defaultTitle={dialog.notebook.title}
          isTaken={() => false}
          onCreate={(v) => update((l) => L.setColor(l, 'notebook', dialog.notebook.id, v.coverColor, Date.now()))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'delete-forever' && (
        <ConfirmDialog
          title={dialog.item.kind === 'folder' ? t('Ordner endgültig löschen?') : t('Notizbuch endgültig löschen?')}
          message={dialog.item.kind === 'folder' ? t('„{name}“ und sein Inhalt werden unwiderruflich gelöscht.', { name: L.itemName(dialog.item) }) : t('„{name}“ wird unwiderruflich gelöscht.', { name: L.itemName(dialog.item) })}
          confirmLabel={t('Endgültig löschen')}
          danger
          onConfirm={() => {
            const it = dialog.item;
            let removed: string[] = [];
            update((l) => {
              const r = L.removeForever(l, it.kind, L.itemId(it));
              removed = r.deletedNotebookIds;
              return r.lib;
            });
            deleteNotebookFiles(removed);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'empty-trash' && (
        <ConfirmDialog
          title={t('Papierkorb leeren?')}
          message={t('Alle Objekte im Papierkorb werden unwiderruflich gelöscht.')}
          confirmLabel={t('Papierkorb leeren')}
          danger
          onConfirm={() => {
            let removed: string[] = [];
            update((l) => {
              const r = L.emptyTrash(l);
              removed = r.deletedNotebookIds;
              return r.lib;
            });
            deleteNotebookFiles(removed);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function subtitleFor(lib: ReturnType<typeof useLibrary>['lib'], item: L.Item, trash: boolean): string {
  if (trash) {
    const t = item.kind === 'folder' ? item.folder.trashedAt : item.notebook.trashedAt;
    return t ? tGeloescht(dateFmt.format(t)) : '';
  }
  if (item.kind === 'folder') {
    const c = L.countInside(lib, item.folder.id);
    const n = c.folders + c.notebooks;
    return n === 0 ? t('Leer') : n === 1 ? t('1 Objekt') : t('{n} Objekte', { n });
  }
  return dateFmt.format(item.notebook.updatedAt);
}

export const ITEM_DRAG_TYPE = 'application/x-papierwerk-item';

function ItemCard({
  item,
  subtitle,
  onOpen,
  onMenu,
  draggable,
  onDropItem,
}: {
  item: L.Item;
  subtitle: string;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
  draggable?: boolean;
  /** Ordner-Karte: Notizbuch/Ordner hierher ziehen = verschieben */
  onDropItem?: (raw: string) => void;
}) {
  const name = L.itemName(item);
  const fav = item.kind === 'folder' ? item.folder.favorite : item.notebook.favorite;
  const [over, setOver] = useState(false);
  return (
    <div
      className={`card card-${item.kind}${over ? ' drop-target' : ''}`}
      data-testid={`item-${item.kind}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(ITEM_DRAG_TYPE, JSON.stringify({ kind: item.kind, id: L.itemId(item) }));
      }}
      onDragOver={(e) => {
        if (!onDropItem || ![...e.dataTransfer.types].includes(ITEM_DRAG_TYPE)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const raw = e.dataTransfer.getData(ITEM_DRAG_TYPE);
        if (onDropItem && raw) {
          e.preventDefault();
          e.stopPropagation();
          onDropItem(raw);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
    >
      <button className="card-visual" onClick={onOpen} data-testid="item-open" title={name}>
        {item.kind === 'folder' ? <FolderGraphic color={item.folder.color} width={128} /> : <NotebookCover nb={item.notebook} width={item.notebook.orientation === 'portrait' ? 116 : 150} />}
      </button>
      <div className="card-meta">
        <div className="card-title-row">
          <span className="card-title" title={name}>
            {name}
          </span>
          <button
            className="icon-btn card-more"
            aria-label={t('Weitere Aktionen')}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onMenu(r.left, r.bottom + 4);
            }}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
        <span className="card-subtitle">
          {fav && <Star size={11} fill="currentColor" className="card-fav" />}
          {subtitle}
        </span>
      </div>
    </div>
  );
}

function EmptyState({ section, searching, onNewNotebook, onNewFolder }: { section: Section; searching: boolean; onNewNotebook: () => void; onNewFolder: () => void }) {
  if (searching) return <div className="empty">{t('Keine Treffer.')}</div>;
  if (section === 'trash') return <div className="empty">{t('Der Papierkorb ist leer.')}</div>;
  if (section === 'favorites') return <div className="empty">{t('Markiere Ordner oder Notizbücher mit einem Stern, um sie hier zu sehen.')}</div>;
  if (section === 'recent') return <div className="empty">{t('Zuletzt geöffnete Notizbücher erscheinen hier.')}</div>;
  return (
    <div className="empty empty-hero" data-testid="empty-library">
      <svg width="120" height="96" viewBox="0 0 120 96" aria-hidden>
        <rect x="22" y="10" width="62" height="80" rx="6" fill="var(--bg-layer)" stroke="var(--border)" />
        <rect x="34" y="4" width="62" height="80" rx="6" fill="var(--bg-layer)" stroke="var(--border)" />
        {[22, 32, 42, 52, 62].map((y) => (
          <line key={y} x1="42" x2="88" y1={y} y2={y} stroke="var(--border)" />
        ))}
        <path d="M58 70 L86 38 a3 3 0 0 1 4.5 4 L62 74 l-6 1.5 z" fill="var(--accent)" />
      </svg>
      <h2>{t('Bereit für deine ersten Notizen?')}</h2>
      <p>{t('Erstelle ein Notizbuch oder einen Ordner, um loszulegen.')}</p>
      <div className="empty-actions">
        <button className="btn btn-primary" onClick={onNewNotebook} data-testid="empty-new-notebook">
          <NotebookPen size={16} /> {t('Notizbuch erstellen')}
        </button>
        <button className="btn" onClick={onNewFolder}>
          <FolderPlus size={16} /> {t('Ordner erstellen')}
        </button>
      </div>
    </div>
  );
}
