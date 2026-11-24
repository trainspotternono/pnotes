# pNotes

> Dieses Programm stellt eine kostenlose Alternative zum kommerziellen Programm "GoodNotes" dar.
> Mich hat persönlich gestört, dass in GoodNotes for Windows alles langsam war aufgrund der Webapp.
> Dann habe ich mithilfe Claude Code dieses Programm schreiben lassen.
> Ich bin kein Softwareentwickler, viel mehr ein Hardware-Guru mit Tendenzen zum nerdigen Eisenbahnwesen.
> Eventuell hilft dieses Programm Studenten, ihre Dokumente auf Windows mit einem gescheiten Programm zu schreiben.
> Eine Synchronisation mit den bekanntesten Cloud-Diensten und Nextcloud ist möglich.

Lokale Notiz-App für Windows (Electron + React + TypeScript, SVG-Papiervorlagen, Canvas-Stift-Engine).
Kein Konto nötig: Alles liegt als JSON in `%APPDATA%\pNotes\library\`, Synchronisierung ist optional.

[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-D92632.svg)](LICENSE)

## Download

Fertige Programme gibt es unter **[Releases](../../releases)**:

| Datei | Wofür |
|---|---|
| `pNotes-<Version>-Setup.exe` | Installer (Startmenü, Desktop-Verknüpfung, Doppelklick auf `.pnotes`) |
| `pNotes-<Version>-portable.exe` | Ohne Installation starten, z. B. vom USB-Stick |

**Hinweis Windows SmartScreen:** Die EXE ist nicht signiert. Beim ersten Start erscheint „Der Computer wurde durch Windows geschützt“ → **„Weitere Informationen“** → **„Trotzdem ausführen“**.

Voraussetzung: Windows 10/11, 64 Bit.

## Aus dem Quellcode bauen

Benötigt [Node.js](https://nodejs.org) 20 oder neuer.

## Einrichten (einmalig)

```powershell
git clone https://github.com/nono8lol/pnotes.git
cd pnotes
npm install
npm run setup      # lädt das Electron-Binary (npm 11 führt Install-Skripte nicht mehr automatisch aus)
```

## Starten

| Befehl | Zweck |
|---|---|
| `npm run build` then `npm start` | Gebaute App starten |
| `npm run dev` | Entwicklung mit Hot Reload (Vite + Electron) |
| `npm run preview:browser` | Nur UI im Browser (http://127.0.0.1:4173, speichert in localStorage) |
| `npm run dist` | `release\pNotes-0.1.0-portable.exe` + `release\pNotes-0.1.0-Setup.exe` |
| `npm run dist:portable` | Nur die Portable-EXE |

## Prüfen

| Befehl | Was wird geprüft |
|---|---|
| `npm run typecheck` | TypeScript (Renderer + Main) |
| `npm test` | Unit-Tests: Bibliothek, Seiten, Layout/Zoom-Anker, Undo/Redo, Stift-Geometrie, Radierer |
| `npm run smoke` | Startet die echte App mit temporärem Datenordner und klickt die Szenarien `library`, `editor`, `draw`, `shapes`, `pdf`, `sso`, `features`, `touch` durch (einzeln: `npx electron . --smoke=features`); Screenshots + `report.json` in `smoke-output\` |
| `npm run check` | Alles zusammen |

## Bedienung

- **Bibliothek:** „Neu“ → Notizbuch/Ordner (Strg+N / Strg+Umschalt+N); Rechtsklick oder „…“ auf einer Karte → Umbenennen, Farbe/Umschlag, Bewegen, Duplizieren, Favorit, Papierkorb; Suche mit Strg+F (rekursiv).
- **Editor:** Seitenleiste (Rechtsklick auf Seite: einfügen, duplizieren, verschieben, Vorlage, leeren, löschen); Zoom mit Strg+Mausrad / Touchpad-Pinch / Strg+Plus/Minus / Strg+0 (Seitenbreite); Verschieben mit Mausrad, mittlerer Maustaste, Leertaste + Ziehen oder einem Finger; Pinch mit zwei Fingern; „…“ → vertikal/horizontal scrollen, Gehe zu Seite.
- **Werkzeuge** (Werkzeugleiste, zweite Zeile; aktives Werkzeug erneut klicken = Optionen):

| Taste | Werkzeug | Kontext-Einstellungen |
|---|---|---|
| V | **Auswählen** (eigener Knopf links neben den Werkzeugen) | Antippen = Strich/Form/Text/Haftnotiz/Bild auswählen, auf freier Fläche Rahmen ziehen, Umschalt/Strg = hinzufügen, Doppeltippen auf Text = bearbeiten; ziehen/Ecken/Drehgriff; Leiste: Farbe, Kopieren, Löschen, **Eingravieren** |
| P | Stift | Füller / Kugelschreiber / Pinsel (⚙), 8 Farb-Slots (aktiven Slot erneut klicken = alle 13 Palettenfarben + eigene Farbe), 3 Stärken, Linienstil (durchgezogen/gestrichelt/gepunktet), „Zeichnen und Halten → Form“ |
| H | Textmarker | 7 Farben, 3 Stärken, Linienstil, „Gerade Linie zeichnen“; Halten begradigt |
| E | Radierer | 3 Größen, Ganzer Strich / Präzision, „Nur Marker“, „Seite leeren“, (⚙) „Automatisch abwählen“ |
| L | Lasso | Einkreisen → Rahmen: ziehen = verschieben, Ecken = skalieren, Griff oben = drehen (Umschalt = 15°-Schritte); Leiste: Farbe, Ausschneiden, Kopieren, Duplizieren, PNG speichern/kopieren, Löschen; „Alles auswählen“ |
| S | Formen | Freihand → Linie, Pfeil, Kreis/Ellipse, Rechteck/Quadrat, Dreieck, Polygon; Ankerpunkte ziehen; Füllung (⚙ oder Form-Leiste) |
| T | Text | Schriftart, Größe, Farbe, Hintergrund, Ausrichtung, **Text einbetten**; auf Seite tippen = neue Textbox, auf Textbox tippen = bearbeiten |
| N | Haftnotiz | 6 Notizfarben; auf Seite tippen = neue Notiz (Text sofort tippen), Notiz antippen = bearbeiten; verschieben/skalieren/drehen/umfärben/löschen mit „Auswählen“ |
| I | Bilder, GIFs & Sticker | Bild/GIF einfügen (PNG, JPG, WebP, GIF, BMP, AVIF, SVG; Umschalt+I öffnet direkt die Dateiauswahl), Sticker, Zuschneiden; animierte GIFs laufen auf der Seite weiter und zoomen scharf mit |
| K | Laserpointer | Punkt / Spur, Farbe; verblasst nach 2 s, wird nicht gespeichert |
| C | Kommentar | Auf Seite tippen → Pin + Seitenleiste; antworten, bearbeiten, erledigt, löschen |

- **Zeichnen und Halten:** Strich zeichnen, am Ende ~0,5 s stillhalten → Form rastet ein; weiter ziehen passt sie an (Linie/Pfeil: Endpunkt, sonst Größe); nach dem Absetzen Ankerpunkte ziehen, „Fertig“ oder Esc beendet.
- **Kürzel:** Strg+Z / Strg+Y (Strg+Umschalt+Z), Strg+C / X / V, Strg+D (duplizieren), Strg+A (alles auf der Seite auswählen), Entf/Rück (Auswahl bzw. Form löschen), Esc (Auswahl aufheben), Strg+Plus/Minus/0 (Zoom), Bild↑/Bild↓ (Seite).
- **Eingabe:** Druck vom Stift; mit Maus schätzen Füller/Pinsel den Druck aus der Geschwindigkeit; Radiertaste am Stift radiert; **Seitentaste am Stift (HP-Stift: „Rechtsklick“-Taste) = vorübergehend Auswählen**; „Mit Finger zeichnen“ (Hand-Symbol) schaltet Touch-Zeichnen ein (sonst Handballen-Erkennung). Während der Stift die Seite berührt, werden Berührungen (Handballen) ignoriert – auch im Auswahlmodus scrollt nichts unter dem Stift weg; „Stift gedrückt halten“ öffnet kein Windows-Kontextmenü.
- **Seiten drehen:** „Drehen“ oben in der Titelleiste (Taste R) oder Seitenmenü → „Seite drehen“; 90°-Schritte im Uhrzeigersinn, pro Seite gespeichert. Striche, Formen, Texte, Haftnotizen, Bilder und Kommentar-Pins werden in die neue Lage umgerechnet, der Hintergrund (Vorlage/PDF) wird mitgedreht – Stift und Pointer treffen danach exakt.
- **Einbetten / Eingravieren:** Auswahl → „Handschrift eingravieren“ / „Text einbetten“ / „Eingravieren“ (bzw. beim Texteditieren „Text einbetten“ in der Werkzeugleiste). Eingravierte Elemente gehören zur Seite: nicht mehr auswähl-, verschieb- oder radierbar; entfernen nur über Rückgängig oder „Seite leeren“.
- **Seitenverwaltung:** Seitenleiste (Seiten-Symbol oben links) mit Vorschau aller Seiten; Klick springt, Ziehen sortiert um, Rechtsklick/„…“: davor/danach einfügen, duplizieren (inkl. Kommentaren), **kopieren / kopierte Seite einfügen** (auch in ein anderes Notizbuch), drehen, verschieben, Vorlage (Blanko/Liniert/Kariert/Punkt/**PDF**), leeren, löschen.
- **Exportieren:** „Exportieren“ oben rechts (Strg+E) → **PDF** (Original-PDF-Seiten bleiben vektoriell; optional Haftnotizen und Kommentare mit Pins + Kommentarliste), **PNG** (aktuelle oder alle Seiten, 72/144/216 dpi).
- **Datenmodell:** `pages[].strokes` (inkl. `dash`/`dashArray`, `engraved`), `pages[].objects` (Formen, Textboxen, Haftnotizen = Text mit `sticky`, Bilder/GIFs als Data-URL mit Zuschnitt und `animated`), `pages[].comments` (Threads mit Nachrichten), `pages[].rotation` (0/90/180/270), `pages[].hiddenPdf` – alles Teil von Undo/Redo, Autosave und Nextcloud-Sync.

## Sprache

Automatisch die Windows-Anzeigesprache (Deutsch, Englisch, Spanisch, Italienisch, Französisch; andere Sprachen → Englisch). Umschalten: Bibliothek → Seitenleiste → **„Einstellungen“** (oder im Editor „…“ → „Einstellungen (Sprache) …“) – sofort wirksam und dauerhaft gespeichert, inkl. „Systemsprache automatisch verwenden“. Übersetzungen: `src/i18n/dict.ts` (deutscher Text = Schlüssel); `i18n.test.ts` prüft, dass jeder Text in allen Sprachen übersetzt ist.

## Farbpalette

pNotes Color Kit, zentral in `src/lib/palette.ts` und als CSS-Variablen in `src/styles/tokens.css` (`--pnotes-crimson` #D92632, `--pnotes-crimson-dark` #A81B25, `--pnotes-slate-100` … `--pnotes-slate-900` #F2F3F5 … #12161A). Dazu vier Schreibfarben (Blau #1D4ED8, Grün #15803D, Orange #D97706, Violett #6D28D9). Stift und Formen zeigen oben 8 Farbfelder, die Farbauswahl bietet alle 13 Farben; Text, Laser und Haftnotizen nutzen dieselbe Palette. **#FFFFFF wird nicht verwendet** (`palette.test.ts` prüft das); einzige Ausnahme ist die Papierfläche importierter PDF-Seiten (Dokumentinhalt).

## Formen

„Zeichnen und Halten“ bzw. Formen-Werkzeug erkennt Kreise, Quadrate und Rechtecke auch bei grober, schneller Zeichnung (Lücke/Überschießen am Ende, runde Ecken, schief): Kreis bei nahezu gleichen Halbachsen, sonst Ellipse; Quadrat bei Seitenverhältnis ≈ 1:1, sonst Rechteck. Fünf-/Sechsecke, Sterne, Trapeze, Rauten, Zickzack bleiben Freihand. **Drehen:** bearbeitete Form → Drehgriff über der Form ziehen (Umschalt = 15°) oder in der Formleiste ↺/↻ (±15°, mit Winkelanzeige); im Auswahlmodus über den Drehgriff des Rahmens. Der Winkel steckt in den Halbachsen-Vektoren der Ellipse und bleibt beim Verschieben, Skalieren, Exportieren und Laden erhalten.

## Touch-Display / großes interaktives Display

Getestet für IR-Multi-Touch-Displays (z. B. iiyama ProLite TE8615A-B2AG, 40 Punkte, passive Dual-Head-Stifte). Einstellungen: **Touch-Symbol** (Präsentationstafel) rechts in der Werkzeugleiste.

- **Wichtig:** IR-Rahmen melden Finger *und* passive Stifte als `pointerType: "touch"`; `pointerId` ist pro Berührung neu (kennzeichnet keinen Stift). Unterscheidbar ist nur die Kontaktgröße `width`/`height` – sofern der Rahmen sie meldet (prüfen mit dem Touch-Monitor).
- **Touch-Modus:** „Finger: Navigieren“ (1 Finger scrollt, 2 Finger zoomen) oder „Finger/IR-Stift: Zeichnen“. Im Zeichenmodus entsteht pro Kontakt ein eigener Strich – mehrere Personen können gleichzeitig schreiben. Zwei Finger, die fast gleichzeitig (< 160 ms) und nah beieinander (< 300 px) aufsetzen, verschieben/zoomen stattdessen (abschaltbar).
- **Trennung der Modi:** Zeichenwerkzeuge zeichnen; „Auswählen“ wählt (mit größeren Trefferzonen für Touch); Handflächen (Kontakt ≥ Schwelle) radieren wie ein Tafelschwamm oder werden ignoriert; während ein aktiver Stift (`pen`) schreibt, werden Berührungen ignoriert.
- **Zwei-Seiten-Modus:** linke und rechte Display-Hälfte mit eigener Voreinstellung (Stift/Marker/Radierer, Farbe, Stärke) – Chips „L“/„R“ in der Werkzeugleiste, gestrichelte Mittellinie auf der Bühne. Gilt in Zeichenwerkzeugen, gleichzeitig für beide Seiten.
- **Spitzen-Erkennung:** „Feine / dicke Spitze unterscheiden“ + Schwelle (px); dicke Spitze → dicker Strich (Faktor), Textmarker oder Radierer. **„Spitzen kalibrieren …“**: je 5× mit feiner und dicker Spitze tippen, Schwelle wird vorgeschlagen – oder Hinweis, dass das Gerät keine unterscheidbaren Größen meldet.
- **Touch-Monitor** (Strg+Umschalt+D oder Schalter im Touch-Menü): live `pointerId`, `pointerType`, `width × height`, Druck, Bildschirm- und Seitenkoordinaten, erkannte Spitze, Display-Hälfte, benutztes Werkzeug, Ereignisrate, Protokoll; Ringe in Kontaktgröße. Warnt, wenn das Gerät keine Kontaktgröße meldet.
- **Große Bedienelemente:** vergrößert Werkzeugleiste, Titelleiste, Seitenleiste und Auswahlleiste.

## Ordner

Seitenleiste „Ordner“: „+“ = neuer Ordner; Rechtsklick/„…“ auf einen Ordner: Öffnen, Neuer Unterordner, Umbenennen, Farbe (26 Vorgaben + eigene Farbe), Bewegen, Löschen (Papierkorb). Notizbücher und Ordner per Drag & Drop auf einen Ordner (Seitenleiste oder Karte) oder auf „Dokumente“ ziehen = verschieben.

## PDF-Import

- **Als neues Notizbuch:** Bibliothek → „Neu“ → „PDF importieren …“ (Strg+I) oder PDF-Datei auf die Bibliothek ziehen.
- **In ein Notizbuch:** Editor → „…“ (Mehr) → „PDF-Seiten einfügen …“ – nach der aktuellen Seite oder am Ende.
- **Seitenauswahl:** Vorschauen anklicken oder Bereich eingeben (`1-3, 5, 8-`; leer = alle).
- Jede PDF-Seite wird eine Notizbuchseite in Originalgröße; Stift, Textmarker, Formen, Text, Radierer, Lasso und Kommentare funktionieren darauf wie auf Papier.
- **Rendering:** pdf.js (lokal, eigener Worker). Nur sichtbare Seiten werden gerendert, Auflösung in √2-Stufen passend zum Zoom (max. 4096 px), LRU-Cache; pdf.js wird erst bei der ersten PDF geladen.
- **Speicherort:** Die PDF liegt einmalig unter `%APPDATA%\pNotes\library\assets\<SHA-1>.pdf`; die Seiten in `notebooks\<id>.json` verweisen nur darauf (`pdf: { asset, page }`) und enthalten die Anmerkungen. Gleiche Datei = gleiche ID (keine Duplikate). Der Nextcloud-Sync überträgt die PDFs nach `<Zielordner>/assets/`.

## Windows-EXE

```powershell
npm run dist        # → release\pNotes-0.1.0-portable.exe (Portable, x64, ohne Installation)
npm run test-pdf    # → release\pNotes-Testdokument.pdf (3 Seiten, verschiedene Formate)
```

Die EXE ist nicht signiert (kein Code-Signing-Zertifikat) – Windows SmartScreen zeigt beim ersten Start „Der Computer wurde durch Windows geschützt“ → „Weitere Informationen“ → „Trotzdem ausführen“. Für eine signierte Version: Zertifikat (PFX) per `CSC_LINK`/`CSC_KEY_PASSWORD` an electron-builder übergeben.

## Nextcloud-Sync

- **Einrichten:** Seitenleiste → „Nextcloud Sync“ (oder Statusanzeige oben in der Bibliothek). Server-URL (nur Basis, z. B. `https://cloud.example.com`), Zielordner (Standard `/pNotes-Sync`), dann:
  - **„Im Browser anmelden (SSO)“** (empfohlen): Nextcloud Login Flow v2. Die Anmeldeseite öffnet sich im Standardbrowser; dort greift, was der Server anbietet (Passwort, 2FA, SAML/OIDC-SSO über `user_saml`/`user_oidc`, z. B. Keycloak, Entra ID, Authentik). Nach „Zugriff gewähren“ erhält pNotes automatisch ein eigenes App-Passwort (in Nextcloud unter „Geräte & Sitzungen“ als `pNotes/<Version> (Windows)` sichtbar). Weicht der Login-Name (z. B. E-Mail) von der Benutzer-ID ab, wird die ID per OCS `cloud/user` ermittelt und für den WebDAV-Pfad verwendet. „Verbindung trennen“ widerruft dieses App-Passwort auf dem Server.
  - **„Stattdessen App-Passwort manuell eingeben“**: Benutzername + **App-Passwort** (Nextcloud → Persönliche Einstellungen → Sicherheit → „Neues App-Passwort erstellen“).
- **Serverseitig** muss für SSO nichts an pNotes angepasst werden – SSO wird in Nextcloud selbst eingerichtet (App „SSO & SAML authentication“ oder „OpenID Connect user backend“). Login Flow v2 gibt es ab Nextcloud 16.
- **Verbindung testen** prüft `status.php`, die WebDAV-Anmeldung (`PROPFIND` auf `/remote.php/dav/files/<user>/`), `OPTIONS` und den Zielordner.
- **Ablage auf Nextcloud:** `<Zielordner>/folders/<id>.json` und `<Zielordner>/notebooks/<id>.json` (Metadaten + Seiten inkl. eingebetteter Bilder und Kommentare). Lokales Manifest: `%APPDATA%\pNotes\library\.sync-state.json`.
- **Konflikte:** beidseitig geändertes Notizbuch → Server-Stand bleibt unter dem Originalnamen, deine lokale Version wird als „Name (Konflikt JJJJ-MM-TT HH-MM)“ angelegt (und hochgeladen). Ordner: neuere Änderung gewinnt.
- **Löschen:** endgültige Löschungen (nicht Papierkorb) werden erst nach Bestätigung übertragen – in beide Richtungen; „Nichts löschen“ stellt wieder her.
- **Zugangsdaten:** App-Passwort mit Electron `safeStorage` (Windows DPAPI) verschlüsselt in `%APPDATA%\pNotes\sync-config.json`, nie im Notizbuch-Ordner.
- **Ohne Nextcloud ausprobieren:** `npm run webdav:mock` startet einen Nextcloud-kompatiblen Test-Server (`http://127.0.0.1:8088`, Benutzer `demo`, App-Passwort `demo-demo-demo-demo-demo`). Auch „Im Browser anmelden (SSO)“ funktioniert damit (simulierte Anmeldeseite mit „Zugriff gewähren“).

## Aufbau

```
electron/   main.ts (Fenster, IPC, Theme), preload.ts (window.papierwerk), storage.ts (atomare JSON-Dateien), smoke.ts
electron/sync/  webdav.ts (WebDAV-Client + Verbindungstest), loginflow.ts (Browser-Anmeldung/SSO, Login Flow v2), engine.ts (Drei-Wege-Sync, Konflikte, Löschungen),
            index.ts (Konfiguration, safeStorage, net.fetch, IPC), mock-server.ts (Nextcloud-ähnlicher Test-Server), sync.test.ts
src/state/sync.tsx + src/sync/SyncUi.tsx  Status, Einstellungen, Lösch-Bestätigung
src/pdf/    pdf.ts (pdf.js, Render-Warteschlange, Stufen, Cache), PdfCanvas (lazy), PdfImportDialog, range.ts (Seitenbereiche)
shared/     types.ts (Datenmodell)
src/lib/    library.ts (reine Bibliotheksoperationen), formats.ts, colors.ts, api.ts
src/library LibraryView, Sidebar, NewNotebookDialog, Cover
src/paper/  PaperBackground (Blanko/Liniert/Kariert/Punkt als SVG)
src/editor/ EditorView, PageStage (Layout, Zoom/Pan, Gesten), Thumbnails, ToolPalette, UiLayer (Lasso/Griffe/Anker/Laser),
            Overlay (Pins, Texteditor, Auswahl-/Form-Leiste), CommentsPanel, media (Bilder, Sticker, PNG, Zuschneiden),
            doc.ts (reine Dokument-Operationen), store.ts (UI-Zustand), history.ts, layout.ts, pages.ts
src/tools/  Werkzeug-Engine (index.ts) + je ein Handler: draw (Stift/Marker/Formen, Hold-to-Shape), eraser, selection (Lasso/Antippen), misc (Text/Laser/Kommentar), shapeEdit (Anker)
src/ink/    geometry.ts (Druck, Glättung, Strichmuster), shapes.ts (Formenerkennung, Anker), transform.ts, hit.ts (Treffer/Lasso), erase.ts, render.ts, InkLayer, tools.ts
```

## Neu: Sync-Anbieter, Papierformate, .pnotes, Installer

- **Synchronisierung** (Seitenleiste → „Synchronisierung“): Nextcloud (SSO/App-Passwort), **Google Drive** (Ordner von „Google Drive für Desktop“, z. B. `G:\Meine Ablage`), **iCloud Drive** (`%USERPROFILE%\iCloudDrive` von „iCloud für Windows“), **eigener Ordner** (OneDrive, Dropbox, NAS, USB) oder **eigener WebDAV-Server**. Cloud-Ordner werden automatisch gefunden. Ablage im Unterordner `pNotes-Sync`; Konflikterkennung über Änderungszeit/Größe, atomares Schreiben (`electron/sync/folder.ts`).
- **Papierformate:** A3, A4, A5, A6, B4, B5, Letter, Legal, Tabloid, Executive, Statement (hoch/quer). PDF-Import in jeder Seitengröße; das Notizbuch erhält das nächstliegende Format.
- **Dokumentformat:** pNotes speichert `.pnotes` (`application/vnd.pnotes.document+zip`). App-spezifische Kennungen stehen in `shared/brand.ts`.
- **Installer:** `npm run dist` → `release\pNotes-0.1.0-Setup.exe` (Deutsch/Englisch, Installationsort wählbar, Startmenü + Desktop, `.pnotes`-Zuordnung, Deinstallation über „Apps“, Notizen bleiben erhalten) und `release\pNotes-0.1.0-portable.exe`. Grafiken: `npm run assets` (erzeugt `build\icon.ico`, `build\installerSidebar.bmp`); Deinstallations-Ergänzung in `build\installer.nsh`.

## Lizenz

pNotes steht unter der [MIT-Lizenz](LICENSE): Du darfst den Code frei nutzen, ändern und weitergeben, auch kommerziell, solange der Copyright-Hinweis erhalten bleibt. Die Software wird ohne Gewährleistung bereitgestellt.

Verwendete Bibliotheken (u. a. Electron, React, pdf.js) behalten ihre eigenen Lizenzen; siehe `node_modules/<paket>/LICENSE`.
