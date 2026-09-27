# Versionen – KC Besuchsprotokoll

Neue Version herausgeben (alle drei Stellen gleich setzen):
1. `index.html` → `const APP_VERSION = "x.y.z"`
2. `sw.js` → `const VERSION = "x.y.z"`
3. `version.json` → `version`, `datum`, `neu` (kurze Sätze, erscheinen auf dem Handy)
Dann hier eintragen, committen, Tag `vx.y.z` setzen und pushen.
Beim nächsten Start (oder Zurückwechseln zur App) meldet das Handy „Neue Version“ mit Knopf „Jetzt aktualisieren“.

## 1.3.7 – 27.09.2026 (Server: kc-termine v11)
- Klickbare Chronologie je Einladung/Person bzw. Gruppe
- Name in der Einladungsliste öffnet den Ablauf; zusätzlicher Knopf „📜 Ablauf“
- Chronologie lädt bei Bedarf und kombiniert Terminprotokoll mit KC-Communicator-Versanddaten
- Mail- und Push-Versand werden mit Datum/Uhrzeit angezeigt; Provider-Ereignisse wie zugestellt, Mail geöffnet oder Push angezeigt erscheinen separat, soweit vorhanden
- Technische Linkprüfungen werden ausdrücklich als technische Prüfung gekennzeichnet
- Keine Termin-Token, Mailadressen oder Nachrichtentexte werden über die Chronologie an die Oberfläche gegeben

## 1.3.6 – 27.09.2026 (Server: kc-termine v10)
- Automatische Mail-Link-Prüfung: der letzte direkt über das KC-System versandte Termin-Link wird per SHA-256 mit dem aktuell gültigen Token-Hash verglichen
- Übersicht kennzeichnet aktuelle und veraltete KC-Mail-Links
- „Link teilen“ wurde zu „Link erneuern & teilen“ präzisiert; Link-Erneuerung macht den bisherigen Link bewusst ungültig
- Bei vorhandener E-Mail-Adresse verschickt das System den erneuerten Link automatisch und protokolliert ihn
- Neue bzw. wiedereröffnete Links setzen den Öffnungsstatus zurück; Wiedereröffnungen setzen auch den alten Antwortzeitpunkt zurück
- Erfolgreicher Einladungs-Mailversand aktualisiert `gesendet_am` zentral

## 1.3.5 – 27.09.2026 (Server: kc-termine v9)
- Terminübersicht zeigt Mailversand und tatsächliches Öffnen des Termin-Links getrennt und jeweils mit Uhrzeit
- Protokolltext präzisiert: „Termin-Link geöffnet“
- `m_laden` setzt `geoeffnet_am` nur noch bei Aufruf durch die echte Mitgliederseite (`client=termin_html`, `page_open=true`); direkte API-/Technikprüfungen bleiben schreibfrei
- Funktionstest ergänzt: technischer Abruf verändert den Öffnungsstatus nicht, echter Seitenaufruf schon

## 1.3.4 – 27.09.2026 (Server: kc-termine v8)
- Tablet-Hinweis (Schulungsversion) in allen Mitglieder-Mails: Einladung (alle Anlässe), Terminbestätigung, Erinnerung am Vortag – je nach Ort „bring … mit“ / „leg … bereit“, Einzahl/Mehrzahl (`tabletHinweis` in `kc-termine`)
- Gleicher Hinweis auf `termin.html` (Einladung offen, Termin gewählt, Termin bestätigt)
- Repo an den Serverstand angeglichen: interner Admin-Zugang `x-kc-termine-admin-token` (Vault `kc_termine_admin_token`) aus kc-termine v7 war nur deployt, jetzt auch im Repo

## 1.3.3 – 26.09.2026 (Server: kc-besuche v8, kc-termine v6, KC Communicator Router v17 / Dispatch v16)
- Echtes BCC statt eigener Kopie-Mail: Einladung, Bestätigung, Absage, Erinnerung und Besuchs-Zusammenfassung gehen mit BCC an Hansi (Feature KC-COMM-CCBCC im KC Communicator, Brevo/Mailjet/Resend)
- Ist Hansi selbst Empfänger, entfällt die BCC (keine doppelte Mail)
- „Kopie nachsenden“ (`t_kopie_nachsenden`) für ältere Mails bleibt; zählt BCC-Adressen nicht als Empfänger
- App-Texte: „Mail (BCC an dich)“

## 1.3.2 – 26.09.2026 (Server: kc-besuche v7)
- Zusammenfassung nach dem Besuch geht jetzt direkt über Supabase (KC Communicator, Brevo, gleicher Absender) an das Mitglied – ohne Outlook-PC (Ereignis `besuch_zusammenfassung`, nur E-Mail)
- Kopie jeder Zusammenfassung an Hansi mit Hinweis, an wen sie ging (Ereignis `besuch_kopie_hansi`)
- `mail_gesendet_am`/`mail_empfaenger` werden bei Erfolg gesetzt; nur bei Fehler bleibt der Besuch für die Outlook-Automatik offen (Rückfallebene)
- App meldet beim Speichern „Push/Mail gesendet (Kopie an dich)“ bzw. Mail-Fehler
- Echter Versandtest: Push, Zusammenfassung und Kopie zugestellt

## Server 26.09.2026 (kc-termine v5, App unverändert 1.3.1)
- Jede Mail an Mitglieder (Einladung, Bestätigung, Absage, Erinnerung) geht als Kopie – wie BCC – an Hansi: gleicher Betreff, gleicher Anhang, oben der Hinweis, an wen sie ging (Ereignis `termin_kopie_hansi`, nur E-Mail)
- Aktion `t_kopie_nachsenden` für Mails von vor der Umstellung

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
