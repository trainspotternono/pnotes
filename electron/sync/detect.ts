/**
 * Sucht die Ordner der Cloud-Desktop-Apps auf diesem PC:
 *  - Google Drive für Desktop: virtuelles Laufwerk (Standard G:) mit „Meine Ablage“/„My Drive“,
 *    oder gespiegelter Ordner im Benutzerprofil („My Drive“, „Google Drive“)
 *  - iCloud für Windows: %USERPROFILE%\iCloudDrive
 *  - OneDrive: Umgebungsvariablen OneDrive / OneDriveConsumer / OneDriveCommercial
 *  - Dropbox: info.json der Dropbox-App, sonst %USERPROFILE%\Dropbox
 * Jede Prüfung hat ein Zeitlimit (getrennte Netzlaufwerke können sonst lange hängen).
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SyncFolderSuggestion } from '../../shared/types';

const CHECK_TIMEOUT_MS = 1500;

/** Ordner vorhanden? (mit Zeitlimit; Fehler/Zeitüberschreitung = nein) */
export async function isDir(p: string): Promise<boolean> {
  const check = fs.stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  );
  return Promise.race([check, new Promise<boolean>((r) => setTimeout(() => r(false), CHECK_TIMEOUT_MS))]);
}

export interface DetectEnv {
  home: string;
  env: NodeJS.ProcessEnv;
  isDir: (p: string) => Promise<boolean>;
  readFile: (p: string) => Promise<string | null>;
  driveLetters: string[];
}

const defaultEnv = (): DetectEnv => ({
  home: os.homedir(),
  env: process.env,
  isDir,
  readFile: (p) => fs.readFile(p, 'utf8').catch(() => null),
  driveLetters: process.platform === 'win32' ? 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('') : [],
});

export async function detectCloudFolders(e: DetectEnv = defaultEnv()): Promise<SyncFolderSuggestion[]> {
  const out: SyncFolderSuggestion[] = [];
  const seen = new Set<string>();
  const add = async (provider: SyncFolderSuggestion['provider'], label: string, p: string | undefined) => {
    if (!p) return;
    const key = path.normalize(p).toLowerCase();
    if (seen.has(key) || !(await e.isDir(p))) return;
    seen.add(key);
    out.push({ provider, label, path: p });
  };

  // ---- Google Drive für Desktop (Laufwerk) – parallel prüfen
  const drives = await Promise.all(
    e.driveLetters.flatMap((l) =>
      ['Meine Ablage', 'My Drive'].map(async (name) => {
        const p = `${l}:\\${name}`;
        return (await e.isDir(p)) ? { l, p } : null;
      }),
    ),
  );
  for (const d of drives) if (d) await add('gdrive', `Google Drive (${d.l}:)`, d.p);
  // gespiegelter Ordner im Profil
  for (const name of ['My Drive', 'Meine Ablage', path.join('Google Drive', 'My Drive'), path.join('Google Drive', 'Meine Ablage'), 'Google Drive']) {
    await add('gdrive', 'Google Drive', path.join(e.home, name));
  }

  // ---- iCloud Drive
  await add('icloud', 'iCloud Drive', path.join(e.home, 'iCloudDrive'));
  await add('icloud', 'iCloud Drive', path.join(e.home, 'iCloud Drive'));

  // ---- OneDrive
  await add('folder', 'OneDrive', e.env.OneDriveConsumer);
  await add('folder', 'OneDrive (Arbeit/Schule)', e.env.OneDriveCommercial);
  await add('folder', 'OneDrive', e.env.OneDrive);

  // ---- Dropbox (info.json nennt den tatsächlichen Pfad)
  for (const base of [e.env.APPDATA, e.env.LOCALAPPDATA]) {
    if (!base) continue;
    const raw = await e.readFile(path.join(base, 'Dropbox', 'info.json'));
    if (!raw) continue;
    try {
      const info = JSON.parse(raw) as Record<string, { path?: string }>;
      await add('folder', 'Dropbox', info.personal?.path);
      await add('folder', 'Dropbox (Business)', info.business?.path);
    } catch {
      /* ungültig */
    }
  }
  await add('folder', 'Dropbox', path.join(e.home, 'Dropbox'));
  return out;
}
