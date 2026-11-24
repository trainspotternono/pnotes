; pNotes – Ergänzungen zum electron-builder-NSIS-Installer
!include "LogicLib.nsh"

; Deinstallation: Dateizuordnung .pnotes sauber entfernen (electron-builder lässt sie stehen).
; SHCTX = HKCU bei „Nur für mich“, HKLM bei „Für alle Benutzer“.
; Die Endung wird nur gelöscht, wenn sie noch auf pNotes zeigt (keine fremde Zuordnung zerstören).
; Notizen (%APPDATA%\pNotes) bleiben bewusst erhalten.
!macro customUnInstall
  ReadRegStr $0 SHCTX "Software\Classes\.pnotes" ""
  ${If} $0 == "pNotes.Dokument"
    DeleteRegKey SHCTX "Software\Classes\.pnotes"
  ${Else}
    DeleteRegValue SHCTX "Software\Classes\.pnotes\OpenWithProgids" "pNotes.Dokument"
  ${EndIf}
  DeleteRegKey SHCTX "Software\Classes\pNotes.Dokument"
  ; Explorer über die geänderte Zuordnung informieren (SHCNE_ASSOCCHANGED)
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
