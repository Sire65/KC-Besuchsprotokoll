# Versionen – KC Besuchsprotokoll

Neue Version herausgeben (alle drei Stellen gleich setzen):
1. `index.html` → `const APP_VERSION = "x.y.z"`
2. `sw.js` → `const VERSION = "x.y.z"`
3. `version.json` → `version`, `datum`, `neu` (kurze Sätze, erscheinen auf dem Handy)
Dann hier eintragen, committen, Tag `vx.y.z` setzen und pushen.
Beim nächsten Start (oder Zurückwechseln zur App) meldet das Handy „Neue Version“ mit Knopf „Jetzt aktualisieren“.

## 1.2.0 – 26.09.2026
- Neuer Reiter „Termine“ (Feature KC-BES-TERMINE): Termine anbieten (bei mir / ich fahre hin / Mitglied wählt, 1–3 Plätze)
- Mitglieder einzeln oder gemeinsam (max. 3) einladen – Supabase schickt die Mail mit persönlichem Link (KC Communicator, gleicher Absender wie die WM-Umfrage)
- Mitgliederseite `termin.html`: Termin wählen (sofort für die Person geblockt), „Kein Termin passt“ mit 2 Gegenvorschlägen, Absage, Wahl ändern
- Push + Mail an Hansi bei jeder Antwort; Bestätigungsmail mit Kalenderdatei (.ics) erst nach Hansis Freigabe
- Antwortfrist 3 Tage (danach Meldung an Hansi), Erinnerung am Vortag, Termin absagen / Einladung zurückziehen
- Lückenloses Protokoll aller Schritte in der Datenbank (kc_termin_protokoll), in der App einsehbar
- Google-Kalender-Abgleich über eigenes Google-Skript (google/KalenderAbgleich.gs): geplant, vorgemerkt, gebucht, Vorschlag, abgesagt
- Aus einem gebuchten Termin direkt einen Besuch eintragen

## 1.1.0 – 25.09.2026
- Besuchsart „Ich fahre hin“ / „Mitglied kommt zu mir“ (dann 0 km, nur Zeit)
- Häkchen „Zusammenfassung ans Mitglied“: Push sofort (KC Communicator), E-Mail über Outlook-Automatik am PC
- „✨ Foto auswerten“: Papierprotokoll wird gelesen und füllt alle Felder, danach prüfen und „Speichern & senden“
- Knopf „📲 Auf Startbildschirm“ (Android/Chrome)
- Liste zeigt „kam zu mir“ und „verschickt“

## 1.0.0 – 25.09.2026
- Erste Version: Besuch eintragen (Mitglied, Ort, Zeit, km), Gesprächspunkte 1–7, Notizen
- Foto vom Papierprotokoll (Claude wertet aus)
- Liste „Meine Besuche“ mit Summe Stunden und km
- Installierbar auf dem Home-Bildschirm, Update-Prüfung beim Start
