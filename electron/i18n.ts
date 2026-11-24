/** Übersetzungen für Texte, die der Main-Prozess selbst anzeigt (Dialoge, Meldungen der Dateizuordnung). */
type Lang = 'de' | 'en' | 'es' | 'it' | 'fr';
let lang: Lang = 'de';

export function setMainLang(l: string) {
  if (l === 'de' || l === 'en' || l === 'es' || l === 'it' || l === 'fr') lang = l;
}

const DICT: Record<string, [string, string, string, string]> = {
  'pNotes-Dokument öffnen': ['Open pNotes document', 'Abrir documento de pNotes', 'Apri documento pNotes', 'Ouvrir un document pNotes'],
  'pNotes-Dokument': ['pNotes document', 'Documento de pNotes', 'Documento pNotes', 'Document pNotes'],
  'Zielordner wählen': ['Choose target folder', 'Elegir carpeta de destino', 'Scegli cartella di destinazione', 'Choisir le dossier de destination'],
  '„{name}“ konnte nicht geöffnet werden.': ['“{name}” could not be opened.', 'No se pudo abrir «{name}».', 'Impossibile aprire «{name}».', 'Impossible d’ouvrir « {name} ».'],
  'Die Datei ist zu groß.': ['The file is too large.', 'El archivo es demasiado grande.', 'Il file è troppo grande.', 'Le fichier est trop volumineux.'],
  'Keine Daten.': ['No data.', 'Sin datos.', 'Nessun dato.', 'Aucune donnée.'],
  'Nur unter Windows verfügbar.': ['Only available on Windows.', 'Solo disponible en Windows.', 'Disponibile solo su Windows.', 'Disponible uniquement sous Windows.'],
  'Nur in der gebauten App (EXE) verfügbar.': ['Only available in the built app (EXE).', 'Solo disponible en la aplicación compilada (EXE).', 'Disponibile solo nell’app compilata (EXE).', 'Disponible uniquement dans l’application compilée (EXE).'],
  '.pnotes-Dateien öffnen sich jetzt per Doppelklick mit pNotes ({exe}).': [
    '.pnotes files now open with pNotes on double-click ({exe}).',
    'Los archivos .pnotes ahora se abren con pNotes al hacer doble clic ({exe}).',
    'I file .pnotes ora si aprono con pNotes con un doppio clic ({exe}).',
    'Les fichiers .pnotes s’ouvrent désormais avec pNotes par double-clic ({exe}).',
  ],
  'Zuordnung fehlgeschlagen: {error}': ['Association failed: {error}', 'Error al asociar: {error}', 'Associazione non riuscita: {error}', 'Échec de l’association : {error}'],
};
const INDEX: Record<Exclude<Lang, 'de'>, number> = { en: 0, es: 1, it: 2, fr: 3 };

export function mt(key: string, vars?: Record<string, string | number>): string {
  const s = lang === 'de' ? key : (DICT[key]?.[INDEX[lang]] ?? key);
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
