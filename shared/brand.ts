/**
 * App-spezifische Kennungen (einzige Stelle, an der sich pNotes und RailPaper im Code unterscheiden,
 * abgesehen von Farben und Texten). Wird von Main-Prozess und Renderer genutzt.
 */

/** Dokument-Containerformate (ZIP mit `mimetype` als erstem Eintrag). Beide Apps lesen beide. */
export const DOC_TYPES = {
  pnotes: { ext: 'pnotes', mime: 'application/vnd.pnotes.document+zip', manifest: 'pnotes', label: 'pNotes' },
  noahpalle: { ext: 'noahpalle', mime: 'application/vnd.papierwerk.noahpalle+zip', manifest: 'noahpalle', label: 'RailPaper' },
} as const;

export type DocTypeId = keyof typeof DOC_TYPES;
export type DocType = (typeof DOC_TYPES)[DocTypeId];

export const BRAND = {
  name: 'pNotes',
  /** eigenes Format: so wird gespeichert/exportiert, dafür registriert der Installer den Doppelklick */
  doc: DOC_TYPES.pnotes as DocType,
  /** Windows-ProgID der Dateizuordnung */
  progId: 'pNotes.Dokument',
  /** Standardname des Sync-Ordners (Nextcloud/WebDAV-Pfad bzw. Unterordner im Cloud-Ordner) */
  syncFolder: 'pNotes-Sync',
} as const;

/** Alle lesbaren Dokumenttypen, eigenes Format zuerst. */
export const READABLE_DOCS: DocType[] = [BRAND.doc, ...Object.values(DOC_TYPES).filter((d) => d.ext !== BRAND.doc.ext)];
export const READABLE_EXTS = READABLE_DOCS.map((d) => d.ext);

/** Endet der Dateiname auf ein lesbares Dokumentformat? */
export const isDocName = (name: string) => READABLE_EXTS.some((e) => name.toLowerCase().endsWith(`.${e}`));
/** Dateiname ohne Dokument-Endung */
export const stripDocExt = (name: string) => name.replace(new RegExp(`\\.(${READABLE_EXTS.join('|')})$`, 'i'), '');
