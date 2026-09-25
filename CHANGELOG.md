# Versionen – KC Besuchsprotokoll

Neue Version herausgeben (alle drei Stellen gleich setzen):
1. `index.html` → `const APP_VERSION = "x.y.z"`
2. `sw.js` → `const VERSION = "x.y.z"`
3. `version.json` → `version`, `datum`, `neu` (kurze Sätze, erscheinen auf dem Handy)
Dann hier eintragen, committen, Tag `vx.y.z` setzen und pushen.
Beim nächsten Start (oder Zurückwechseln zur App) meldet das Handy „Neue Version“ mit Knopf „Jetzt aktualisieren“.

## 1.0.0 – 25.09.2026
- Erste Version: Besuch eintragen (Mitglied, Ort, Zeit, km), Gesprächspunkte 1–7, Notizen
- Foto vom Papierprotokoll (Claude wertet aus)
- Liste „Meine Besuche“ mit Summe Stunden und km
- Installierbar auf dem Home-Bildschirm, Update-Prüfung beim Start
