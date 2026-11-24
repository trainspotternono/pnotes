/**
 * pNotes läuft parallel zu RailPaper: eigene App-ID, eigener Produktname, eigene Dateinamen,
 * eigener Datenordner, eigene ProgID, eigenes Dokumentformat .pnotes – .noahpalle bleibt lesbar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOAHPALLE_EXT, NOAHPALLE_MIME } from '../export/noahpalle';
import { BRAND, READABLE_EXTS } from '../../shared/brand';

const root = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('pNotes-Identität (keine Konflikte mit RailPaper)', () => {
  const pkg = JSON.parse(read('package.json'));

  it('Paket- und Build-Konfiguration', () => {
    expect(pkg.name).toBe('pnotes');
    expect(pkg.productName).toBe('pNotes');
    expect(pkg.build.appId).toBe('local.pnotes.app');
    expect(pkg.build.productName).toBe('pNotes');
    expect(pkg.build.nsis.shortcutName).toBe('pNotes');
    expect(pkg.build.nsis.artifactName).toMatch(/^pNotes-/);
    expect(pkg.build.portable.artifactName).toMatch(/^pNotes-/);
    expect(pkg.build.fileAssociations[0].name).toBe('pNotes.Dokument');
    expect(fs.existsSync(path.join(root, pkg.build.win.icon))).toBe(true);
  });

  it('eigenes Format .pnotes (Installer-Zuordnung), .noahpalle von RailPaper bleibt lesbar', () => {
    expect(NOAHPALLE_EXT).toBe('pnotes');
    expect(pkg.build.fileAssociations[0].ext).toBe('pnotes');
    expect(pkg.build.fileAssociations[0].mimeType).toBe(NOAHPALLE_MIME);
    expect(NOAHPALLE_MIME).toBe('application/vnd.pnotes.document+zip');
    expect(READABLE_EXTS).toEqual(['pnotes', 'noahpalle']);
  });

  it('eigener Datenordner %APPDATA%\\pNotes, nie der von RailPaper/Papierwerk', () => {
    const main = read('electron/main.ts');
    expect(main).toMatch(/setPath\('userData', path\.join\(app\.getPath\('appData'\), 'pNotes'\)\)/);
    expect(main).not.toMatch(/'Papierwerk'|'RailPaper'/);
    expect(read('electron/files.ts')).toContain('PROG_ID = BRAND.progId');
    expect(BRAND.progId).toBe('pNotes.Dokument');
    expect(BRAND.syncFolder).toBe('pNotes-Sync');
  });

  it('kein „RailPaper“ mehr in Oberfläche, Fenstertitel und Übersetzungen', () => {
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'electron')), path.join(root, 'index.html')].filter(
      (f) => /\.(tsx?|css|html)$/.test(f) && !f.endsWith('identity.test.ts'),
    );
    const hits = files.filter((f) => fs.readFileSync(f, 'utf8').includes('RailPaper')).map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
    expect(read('index.html')).toContain('<title>pNotes</title>');
  });
});
