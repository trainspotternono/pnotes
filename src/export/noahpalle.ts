/**
 * Bearbeitbares Dokumentformat: `.pnotes` bzw. `.noahpalle` (Schwester-App) – gleicher Aufbau,
 * nur Endung, mimetype und Formatkennung unterscheiden sich (siehe shared/brand.ts). Gespeichert wird
 * im eigenen Format, gelesen werden beide.
 *
 * ZIP-Container (wie ODF/EPUB):
 *   mimetype                     z. B. „application/vnd.pnotes.document+zip“ (erster Eintrag, unkomprimiert)
 *   manifest.json                Format + Version, Generator, Metadaten, Seitenanzahl, Asset-Liste mit SHA-1
 *   document.json                Seiten (Vorlage, Größe, Drehung, PDF-Verweis, Striche, Formen, Texte,
 *                                Haftnotizen, Bilder/GIFs als Asset-Verweis, eingravierte Elemente, Kommentare)
 *   assets/pdf/<sha1>.pdf        importierte PDF-Originale
 *   assets/images/<sha1>.<ext>   Bilder, Sticker, animierte GIFs (unverändert)
 *   preview.png                  Vorschau der ersten Seite
 *
 * Bilder stehen in document.json als „asset:assets/images/…“ statt als Data-URL; beim Öffnen werden
 * sie wiederhergestellt. Unbekannte Felder bleiben erhalten (vorwärtskompatibel innerhalb einer Hauptversion).
 */
import { strToU8, strFromU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { NotebookMeta, Page, PdfPageRef } from '../../shared/types';
import { normalizeContent } from '../lib/notebook';
import { t } from '../i18n';
import { BRAND, READABLE_DOCS } from '../../shared/brand';

/** Eigenes Format dieser App (Endung + mimetype) */
export const NOAHPALLE_MIME = BRAND.doc.mime;
export const NOAHPALLE_EXT = BRAND.doc.ext;
export const FORMAT_VERSION = 1;

export interface NoahpalleManifest {
  /** 'pnotes' oder 'noahpalle' */
  format: string;
  formatVersion: number;
  generator: string;
  createdAt: string;
  title: string;
  notebook: Pick<NotebookMeta, 'format' | 'orientation' | 'paperColor' | 'template' | 'coverColor'> & { coverPdf?: PdfPageRef };
  pageCount: number;
  assets: { path: string; sha1: string; type: string; bytes: number }[];
}

export interface AssetIo {
  getPdf(id: string): Promise<Uint8Array | null>;
  /** Speichert eine PDF und liefert ihre (Inhalts-)ID */
  putPdf(data: Uint8Array): Promise<string>;
}

const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif' };
const EXT_MIME: Record<string, string> = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));

async function sha1(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', data as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeDataUrl(src: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (m[2]) {
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime, bytes };
  }
  return { mime, bytes: strToU8(decodeURIComponent(m[3])) };
}

function encodeDataUrl(mime: string, bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Erzeugt eine .pnotes-Datei. */
export async function packNoahpalle(
  meta: Pick<NotebookMeta, 'title' | 'format' | 'orientation' | 'paperColor' | 'template' | 'coverColor' | 'coverPdf'>,
  pages: Page[],
  io: AssetIo,
  extra: { preview?: Uint8Array; generator?: string } = {},
): Promise<Uint8Array> {
  const files: Zippable = {};
  const assets: NoahpalleManifest['assets'] = [];
  const imagePaths = new Map<string, string>(); // Data-URL → Pfad (Duplikate nur einmal)
  const pdfIds = new Set<string>();

  const addPdf = (r?: PdfPageRef) => r && pdfIds.add(r.asset);
  const docPages: Page[] = [];
  for (const p of pages) {
    addPdf(p.pdf);
    addPdf(p.hiddenPdf);
    const objects = [];
    for (const o of p.objects) {
      if (o.type === 'image' && o.src.startsWith('data:')) {
        let path = imagePaths.get(o.src);
        if (!path) {
          const d = decodeDataUrl(o.src);
          if (d) {
            const id = await sha1(d.bytes);
            path = `assets/images/${id}.${MIME_EXT[d.mime] ?? 'bin'}`;
            if (!files[path]) {
              files[path] = [d.bytes, { level: 0 }]; // Bilder sind schon komprimiert
              assets.push({ path, sha1: id, type: d.mime, bytes: d.bytes.length });
            }
            imagePaths.set(o.src, path);
          }
        }
        objects.push(path ? { ...o, src: `asset:${path}` } : o);
      } else objects.push(o);
    }
    docPages.push({ ...p, objects });
  }
  addPdf(meta.coverPdf);
  for (const id of pdfIds) {
    const bytes = await io.getPdf(id);
    if (!bytes) continue; // fehlende PDF (z. B. noch nicht synchronisiert): Seite bleibt mit Verweis erhalten
    const path = `assets/pdf/${id}.pdf`;
    files[path] = [bytes, { level: 6 }];
    assets.push({ path, sha1: id, type: 'application/pdf', bytes: bytes.length });
  }

  const manifest: NoahpalleManifest = {
    format: BRAND.doc.manifest,
    formatVersion: FORMAT_VERSION,
    generator: extra.generator ?? 'pNotes',
    createdAt: new Date().toISOString(),
    title: meta.title,
    notebook: {
      format: meta.format,
      orientation: meta.orientation,
      paperColor: meta.paperColor,
      template: meta.template,
      coverColor: meta.coverColor,
      ...(meta.coverPdf ? { coverPdf: meta.coverPdf } : {}),
    },
    pageCount: pages.length,
    assets,
  };
  if (extra.preview) files['preview.png'] = [extra.preview, { level: 0 }];
  files['document.json'] = [strToU8(JSON.stringify({ version: 1, pages: docPages })), { level: 6 }];
  files['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }];
  // mimetype zuerst und unkomprimiert → per Signatur erkennbar
  return zipSync({ mimetype: [strToU8(NOAHPALLE_MIME), { level: 0 }], ...files });
}

export interface UnpackedDocument {
  manifest: NoahpalleManifest;
  pages: Page[];
}

/** Liest eine .pnotes-Datei; PDFs werden über `io.putPdf` in den Speicherort übernommen. */
export async function unpackNoahpalle(data: Uint8Array, io: AssetIo): Promise<UnpackedDocument> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    throw new Error(t('Keine gültige .pnotes-Datei (Container beschädigt).'));
  }
  const mime = entries.mimetype ? strFromU8(entries.mimetype).trim() : '';
  const type = READABLE_DOCS.find((d) => d.mime === mime);
  if (!type || !entries['manifest.json'] || !entries['document.json']) {
    throw new Error(t('Keine gültige .pnotes-Datei.'));
  }
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as NoahpalleManifest;
  if (manifest.format !== type.manifest) throw new Error(t('Keine gültige .pnotes-Datei.'));
  if (!(manifest.formatVersion >= 1) || manifest.formatVersion > FORMAT_VERSION) {
    throw new Error(t('Diese Datei wurde mit einer neueren pNotes-Version erstellt (Format {v}). Bitte pNotes aktualisieren.', { v: manifest.formatVersion }));
  }
  const doc = JSON.parse(strFromU8(entries['document.json'])) as { version: number; pages: Page[] };

  // PDFs übernehmen (ID = SHA-1 des Inhalts; bei Abweichung wird umgeschrieben)
  const pdfMap = new Map<string, string>();
  for (const [path, bytes] of Object.entries(entries)) {
    const m = /^assets\/pdf\/([a-f0-9]{40})\.pdf$/.exec(path);
    if (m) pdfMap.set(m[1], await io.putPdf(bytes));
  }
  const remap = (r?: PdfPageRef) => (r ? { ...r, asset: pdfMap.get(r.asset) ?? r.asset } : undefined);
  const images = new Map<string, string>();
  const imageSrc = (src: string) => {
    if (!src.startsWith('asset:')) return src;
    const path = src.slice(6);
    let url = images.get(path);
    if (!url) {
      const bytes = entries[path];
      if (!bytes) return '';
      const ext = path.split('.').pop() ?? '';
      url = encodeDataUrl(EXT_MIME[ext] ?? 'application/octet-stream', bytes);
      images.set(path, url);
    }
    return url;
  };
  const pages: Page[] = (Array.isArray(doc.pages) ? doc.pages : []).map((p) => {
    const next: Page = {
      ...p,
      objects: (p.objects ?? []).map((o) => (o.type === 'image' ? { ...o, src: imageSrc(o.src) } : o)).filter((o) => o.type !== 'image' || !!o.src),
    };
    const pdf = remap(p.pdf);
    const hiddenPdf = remap(p.hiddenPdf);
    if (pdf) next.pdf = pdf;
    if (hiddenPdf) next.hiddenPdf = hiddenPdf;
    return next;
  });
  const content = normalizeContent({ version: 1, id: 'import', pages }, 'import', manifest.notebook?.template ?? 'blank');
  if (manifest.notebook?.coverPdf) manifest.notebook.coverPdf = remap(manifest.notebook.coverPdf);
  return { manifest, pages: content.pages };
}

/** Schnelle Prüfung, ob Bytes ein lesbarer Dokument-Container sind (.pnotes oder .pnotes, mimetype als erster Eintrag). */
export function looksLikeNoahpalle(data: Uint8Array): boolean {
  if (data.length < 60 || data[0] !== 0x50 || data[1] !== 0x4b) return false;
  return READABLE_DOCS.some((d) => {
    const head = strFromU8(data.subarray(30, 30 + 8 + d.mime.length));
    return head.startsWith('mimetype') && head.endsWith(d.mime);
  });
}
