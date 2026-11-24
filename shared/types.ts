// Gemeinsame Datentypen für Main-Prozess und Renderer.

export type PaperTemplate = 'blank' | 'ruled' | 'squared' | 'dotted';
export type PaperColor = 'white' | 'yellow' | 'dark';
/** ISO 216 (A3–A6, B4, B5) und nordamerikanische Formate */
export type PageFormat = 'A3' | 'A4' | 'A5' | 'A6' | 'B4' | 'B5' | 'Letter' | 'Legal' | 'Tabloid' | 'Executive' | 'Statement';
export type Orientation = 'portrait' | 'landscape';

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  trashedAt: number | null;
}

export interface NotebookMeta {
  id: string;
  title: string;
  folderId: string | null;
  /** Umschlagfarbe; null = „Kein Umschlag“ (erste Seite als Vorschau). */
  coverColor: string | null;
  template: PaperTemplate;
  paperColor: PaperColor;
  format: PageFormat;
  orientation: Orientation;
  favorite: boolean;
  pageCount: number;
  createdAt: number;
  updatedAt: number;
  openedAt: number | null;
  trashedAt: number | null;
  /** Bei „Kein Umschlag“ aus PDF importierter Notizbücher: erste PDF-Seite als Vorschau */
  coverPdf?: PdfPageRef;
}

export interface LibraryData {
  version: 1;
  folders: Folder[];
  notebooks: NotebookMeta[];
}

// ------------------------------------------------------------------ Seiteninhalt

export type InkTool = 'pen' | 'highlighter';
export type PenStyle = 'ballpoint' | 'fountain' | 'brush';
export type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface Stroke {
  id: string;
  tool: InkTool;
  penStyle?: PenStyle;
  color: string;
  /** Grundbreite in Seiteneinheiten (pt). */
  width: number;
  /** Flach gespeichert: [x, y, pressure, x, y, pressure, …] in pt, pressure 0..1 */
  points: number[];
  /** Linienstil; fehlt = durchgezogen. */
  dash?: LineStyle;
  /** Strichmuster in pt (Canvas setLineDash), null/fehlt = durchgezogen. */
  dashArray?: number[] | null;
  /** „Eingraviert“: fest in der Seitenebene – nicht auswählbar, nicht radierbar (nur „Seite leeren“ / Rückgängig). */
  engraved?: boolean;
}

export type PageRotation = 0 | 90 | 180 | 270;

export type ShapeKind = 'line' | 'arrow' | 'ellipse' | 'rect' | 'triangle' | 'polygon';

/**
 * Geometrische Form. `points` (absolute Seitenkoordinaten):
 *   line/arrow: [x1, y1, x2, y2] (Pfeilspitze am Ende)
 *   ellipse:    [cx, cy, ux, uy, vx, vy] – Mittelpunkt und zwei konjugierte Halbachsen-Endpunkte
 *   rect/triangle/polygon: geschlossener Eckpunktzug [x1, y1, x2, y2, …]
 */
export interface ShapeObj {
  id: string;
  type: 'shape';
  kind: ShapeKind;
  points: number[];
  color: string;
  width: number;
  dash?: LineStyle;
  dashArray?: number[] | null;
  /** Füllfarbe für geschlossene Formen (null = keine Füllung). */
  fill: string | null;
  engraved?: boolean;
}

export type FontId = 'sans' | 'serif' | 'mono' | 'hand';
export type TextAlign = 'left' | 'center' | 'right';

/** Textbox; Position über Mittelpunkt + Drehung (Grad), Maße in pt. */
export interface TextObj {
  id: string;
  type: 'text';
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
  text: string;
  font: FontId;
  size: number;
  color: string;
  background: string | null;
  align: TextAlign;
  /** Haftnotiz (Sticky Note): `background` = Notizfarbe, feste Mindestgröße, Schatten. */
  sticky?: boolean;
  engraved?: boolean;
}

/** Bild/Sticker; Bilddaten als Data-URL, Zuschnitt normiert (0..1). */
export interface ImageObj {
  id: string;
  type: 'image';
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
  src: string;
  naturalW: number;
  naturalH: number;
  crop: { x: number; y: number; w: number; h: number };
  sticker?: boolean;
  /** Animiertes GIF: `src` ist die Original-GIF (nicht neu kodiert), Wiedergabe auf der Seite. */
  animated?: boolean;
  engraved?: boolean;
}

export type PageObject = ShapeObj | TextObj | ImageObj;

export interface CommentMessage {
  id: string;
  text: string;
  createdAt: number;
  editedAt: number | null;
}

/** Kommentar-Thread mit Pin auf der Seite (x, y in pt). */
export interface CommentThread {
  id: string;
  x: number;
  y: number;
  createdAt: number;
  resolved: boolean;
  messages: CommentMessage[];
}

/** Verweis auf eine Seite einer importierten PDF-Datei (Datei liegt einmalig als Asset vor). */
export interface PdfPageRef {
  /** Asset-ID = SHA-1 des PDF-Inhalts (40 Hex-Zeichen) */
  asset: string;
  /** Seitennummer in der PDF, 1-basiert */
  page: number;
}

export interface Page {
  id: string;
  template: PaperTemplate;
  /** Eigene Seitengröße in pt (z. B. PDF-Seite, gedrehte Seite) – immer die *angezeigte* Größe; fehlt = Format des Notizbuchs */
  size?: { w: number; h: number };
  /** PDF-Seite als Hintergrund (statt Papiervorlage) */
  pdf?: PdfPageRef;
  /** PDF-Hintergrund, der per Vorlagenwechsel ausgeblendet wurde (kann wiederhergestellt werden) */
  hiddenPdf?: PdfPageRef;
  /**
   * Drehung im Uhrzeigersinn. Inhalte (Striche, Objekte, Kommentare) werden beim Drehen in die
   * neue Lage umgerechnet; nur der Hintergrund (Vorlage/PDF) wird mit diesem Winkel gezeichnet.
   */
  rotation?: PageRotation;
  strokes: Stroke[];
  /** Formen, Textboxen, Bilder in Zeichenreihenfolge. */
  objects: PageObject[];
  comments: CommentThread[];
}

export interface NotebookContent {
  version: 1;
  id: string;
  pages: Page[];
}

// ------------------------------------------------------------------ Sync (Nextcloud, WebDAV, Google Drive, iCloud, Ordner)

/**
 * Sync-Ziel:
 *  - nextcloud: Nextcloud-Server (WebDAV, Browser-Anmeldung/SSO oder App-Passwort)
 *  - webdav:    beliebiger WebDAV-Server (volle WebDAV-URL + Benutzer + Passwort) – benutzerdefiniert
 *  - gdrive:    Ordner von „Google Drive für Desktop“ (die Google-App lädt hoch)
 *  - icloud:    Ordner von „iCloud für Windows“ (iCloud Drive)
 *  - folder:    beliebiger Ordner (OneDrive, Dropbox, NAS, USB-Stick …) – benutzerdefiniert
 */
export type SyncProvider = 'nextcloud' | 'webdav' | 'gdrive' | 'icloud' | 'folder';
export const FOLDER_PROVIDERS: SyncProvider[] = ['gdrive', 'icloud', 'folder'];

/** Gefundener Cloud-Ordner auf diesem PC (Vorschlag im Einstellungsdialog). */
export interface SyncFolderSuggestion {
  provider: 'gdrive' | 'icloud' | 'folder';
  /** z. B. „Google Drive (G:)“, „OneDrive“, „Dropbox“ */
  label: string;
  path: string;
}

/** Öffentliche Sync-Konfiguration (das Passwort verlässt den Main-Prozess nie). */
export interface SyncConfigPublic {
  provider: SyncProvider;
  /** Ordner-Anbieter: lokaler Wurzelordner (z. B. G:\Meine Ablage); der Sync liegt darin im Unterordner `folder` */
  localPath: string;
  configured: boolean;
  serverUrl: string;
  username: string;
  folder: string;
  autoSync: boolean;
  hasPassword: boolean;
  /** 'sso' = per Browser-Anmeldung (Login Flow v2) verbunden, 'password' = App-Passwort manuell eingegeben */
  authMethod: 'password' | 'sso';
  /** Ob das Betriebssystem sichere Speicherung anbietet (Windows: DPAPI). */
  encryptionAvailable: boolean;
  lastSyncAt: number | null;
}

export interface SyncSsoInput {
  serverUrl: string;
  folder: string;
  autoSync: boolean;
}

export interface SyncConfigInput {
  /** fehlt = nextcloud (ältere Aufrufer) */
  provider?: SyncProvider;
  /** nur Ordner-Anbieter */
  localPath?: string;
  serverUrl: string;
  username: string;
  folder: string;
  autoSync: boolean;
  /** leer/undefiniert = gespeichertes Passwort behalten */
  password?: string;
}

export interface SyncTestResult {
  ok: boolean;
  message: string;
  details: string[];
}

export interface PendingDeletion {
  key: string;
  kind: 'folder' | 'notebook';
  title: string;
  /** 'remote' = lokal gelöscht → auch auf Nextcloud löschen; 'local' = auf Nextcloud gelöscht → auch lokal löschen */
  where: 'remote' | 'local';
}

export interface DeletionDecision {
  key: string;
  delete: boolean;
}

export interface SyncResult {
  ok: boolean;
  offline: boolean;
  uploaded: number;
  downloaded: number;
  deletedRemote: number;
  deletedLocal: number;
  conflicts: string[];
  notices: string[];
  errors: string[];
  pendingDeletions: PendingDeletion[];
  /** Lokale Dateien wurden verändert → Renderer muss die Bibliothek neu laden */
  changedLocal: boolean;
  finishedAt: number;
}

/** API, die das Preload-Skript im Renderer als window.papierwerk bereitstellt. */
export interface PapierwerkApi {
  loadLibrary(): Promise<LibraryData | null>;
  saveLibrary(data: LibraryData): Promise<void>;
  loadNotebook(id: string): Promise<NotebookContent | null>;
  saveNotebook(content: NotebookContent): Promise<void>;
  saveNotebookSync(content: NotebookContent): void;
  deleteNotebook(id: string): Promise<void>;
  getDataPath(): Promise<string>;
  openDataFolder(): Promise<void>;
  setTheme(theme: 'system' | 'light' | 'dark'): Promise<'light' | 'dark'>;
  onSystemThemeChanged(cb: (theme: 'light' | 'dark') => void): () => void;
  /** Speichert eine Datei (PDF) inhaltsadressiert und liefert die Asset-ID. */
  assetPut(data: Uint8Array, ext: 'pdf'): Promise<string>;
  assetGet(id: string, ext: 'pdf'): Promise<Uint8Array | null>;
  syncGetConfig(): Promise<SyncConfigPublic>;
  syncSaveConfig(input: SyncConfigInput): Promise<SyncConfigPublic>;
  syncClearConfig(): Promise<SyncConfigPublic>;
  syncTest(input: SyncConfigInput): Promise<SyncTestResult>;
  /** Browser-Anmeldung (SSO): öffnet die Nextcloud-Anmeldeseite und wartet, bis sie abgeschlossen ist. */
  syncSsoLogin(input: SyncSsoInput): Promise<SyncConfigPublic>;
  syncSsoCancel(): Promise<void>;
  syncRun(): Promise<SyncResult>;
  /** Google-Drive-, iCloud-, OneDrive- und Dropbox-Ordner auf diesem PC suchen */
  syncDetectFolders(): Promise<SyncFolderSuggestion[]>;
  /** Ordnerauswahl-Dialog; liefert den Pfad oder null */
  syncPickFolder(start?: string): Promise<string | null>;
  syncResolveDeletions(decisions: DeletionDecision[]): Promise<SyncResult>;
  /** Speichern-Dialog; liefert den Pfad oder null (abgebrochen). */
  fileSave(opts: { defaultName: string; filters: FileFilter[]; data: Uint8Array }): Promise<string | null>;
  /** Ordner wählen und mehrere Dateien hineinschreiben; liefert den Ordner oder null. */
  fileSaveMany(opts: { title: string; files: { name: string; data: Uint8Array }[] }): Promise<string | null>;
  /** Öffnen-Dialog für .noahpalle-Dokumente. */
  fileOpenDocument(): Promise<OpenedFile | null>;
  /** Per Doppelklick/Kommandozeile übergebene Dokumente, die vor dem App-Start anstanden. */
  takePendingDocuments(): Promise<OpenedFile[]>;
  onOpenDocument(cb: (f: OpenedFile) => void): () => void;
  /** .noahpalle-Dateien für den aktuellen Windows-Benutzer mit pNotes verknüpfen (Portable-EXE). */
  registerFileAssociation(): Promise<{ ok: boolean; message: string }>;
  /** Aktuelle UI-Sprache an den Main-Prozess melden (Dialogtitel, Meldungen) */
  setLanguage(lang: string): void;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenedFile {
  name: string;
  data: Uint8Array;
}
