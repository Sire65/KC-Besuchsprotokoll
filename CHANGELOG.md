# Versionen – KC Besuchsprotokoll

Neue Version herausgeben (alle drei Stellen gleich setzen):
1. `index.html` → `const APP_VERSION = "x.y.z"`
2. `sw.js` → `const VERSION = "x.y.z"`
3. `version.json` → `version`, `datum`, `neu` (kurze Sätze, erscheinen auf dem Handy)
Dann hier eintragen, committen, Tag `vx.y.z` setzen und pushen.
Beim nächsten Start (oder Zurückwechseln zur App) meldet das Handy „Neue Version“ mit Knopf „Jetzt aktualisieren“.

## 1.3.1 – 26.09.2026
- Geplanter Besuch kompakt: Gesprächspunkte und Notizen ausgeblendet, Terminbestätigung direkt unter Datum/Uhrzeit
- Foto-Bereich per Schalter `FOTO_AKTIV` ausgeblendet, bis `ANTHROPIC_API_KEY` für `kc-besuche` gesetzt ist
- Echter Versandtest der Terminbestätigung: Brevo-Mail mit .ics-Anhang und Push zugestellt

## 1.3.0 – 26.09.2026
- Mündlich abgesprochener Termin: im Besuch „Geplant“ + „📅 Terminbestätigung per Push + Mail senden“ → bestätigter Termin (Herkunft `direkt`), Mail mit .ics, Google-Kalender „Gebucht“
- Reiter Termine: Knopf „➕ Abgesprochenen Termin eintragen“
- Jeder bestätigte Termin (auch aus Einladungen) legt automatisch einen geplanten Besuch mit Mitglied, Datum, Zeit und Ort an; „📝 Protokoll öffnen“ im Termin und im Google-Kalender (`#besuch=B-…`)
- Datum/Uhrzeit eines geplanten Besuchs ändern → Termin wird nachgezogen, auf Wunsch erneut bestätigt
- Termin abgesagt / zurückgezogen → noch leerer geplanter Besuch wird entfernt
- „Foto auswerten“ speichert das Erkannte sofort in der Datenbank (ohne Versand); „Speichern & senden“ schickt danach die Zusammenfassung

## 1.2.1 – 26.09.2026
- Häkchen „📅 Geplant“ im Besuch (Status `geplant`): für die Vorplanung, zählt nicht in Stunden/km/Anzahl, verschickt nichts
- Wird automatisch gesetzt, wenn das Datum in der Zukunft liegt (abwählbar); „Besuch eintragen“ aus einem künftigen Termin legt ihn als geplant an
- Liste zeigt „📅 geplant“ und die Zahl der geplanten Besuche; nach „Foto auswerten“ gilt der Besuch als stattgefunden

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
