# Feature KC-BES-TERMINE – Terminkalender (ab Version 1.2.0)

## Ablauf

1. **Hansi stellt Termine ein** (App → Reiter „Termine“): Datum, Von/Bis, Ort
   (`bei_hansi` = bei mir, `beim_mitglied` = ich fahre hin, `wahl` = Mitglied entscheidet), 1–3 Plätze.
2. **Hansi lädt Mitglieder ein**: einzeln (jeder eine eigene Einladung) oder gemeinsam (max. 3 Personen, z. B. Ehepaar).
   Supabase schickt eine Mail mit persönlichem Link (`termin.html?t=…`) über den KC Communicator
   (Brevo, gleicher Absender wie die WM-Umfrage). Mitglieder mit freigeschaltetem Push bekommen zusätzlich Push.
   Antwortfrist: **3 Tage**.
3. **Mitglied wählt** auf `termin.html`. Alle Eingeladenen sehen dieselben Termine; wer zuerst wählt, bekommt ihn.
   Die Wahl ist atomar (`kc_termin_waehlen`, Zeilensperre) – ein Platz wird nie doppelt vergeben.
   Hausbesuch (`beim_mitglied`) blockiert den Termin für genau eine Einladung; „bei mir“ erlaubt mehrere Einladungen bis zur Platzzahl.
   Alternativ: „Kein Termin passt“ mit bis zu 2 Gegenvorschlägen, oder „zurzeit kein Besuch“.
4. **Hansi bekommt Push + Mail** bei jeder Antwort (Wahl, Gegenvorschlag, Absage, Wahl zurückgenommen, Frist abgelaufen).
5. **Hansi gibt frei**: Bestätigen → Mitglied bekommt Bestätigungsmail mit Kalenderdatei (.ics).
   Ablehnen → Termin wird frei, Mitglied bekommt neuen Link und wieder 3 Tage.
   Gegenvorschlag annehmen → Termin wird angelegt und direkt bestätigt; „neue Termine anbieten“ → neuer Link.
6. **Erinnerung** an das Mitglied am Vortag (ab 9 Uhr).
7. **Google-Kalender**: Google-Apps-Skript in Hansis Konto (`google/KalenderAbgleich.gs`) gleicht alle 5 Minuten ab.
   Farben: grau geplant, gelb vorgemerkt, grün gebucht, orange Vorschlag, rot abgesagt. Einrichtung: `google/ANLEITUNG.md`.

## Mündlich abgesprochene Termine (ab 1.3.0)

1. Im Besuch „📅 Geplant“ + „📅 Terminbestätigung per Push + Mail senden“ (oder Reiter Termine → „➕ Abgesprochenen Termin eintragen“).
2. Beim Speichern ruft die App `t_besuch_termin` auf: Termin (`herkunft = 'direkt'`, Plätze = Personenzahl), Einladung (gleich `bestaetigt`) und Buchung mit `besuch_id` werden angelegt, die Bestätigung geht per Push + Mail mit .ics raus, der Google-Kalender zeigt „Gebucht“.
3. Datum/Uhrzeit/Ort am geplanten Besuch ändern → beim Speichern wird der Termin nachgezogen; mit Häkchen „Geänderten Termin erneut bestätigen“ geht eine neue Bestätigung raus.
4. Auch Termine aus Einladungen legen beim Bestätigen automatisch einen geplanten Besuch an (Mitglied, Datum, Zeit, Ort, Anwesende).
5. „📝 Protokoll öffnen“ im Reiter Termine und im Google-Kalender (`…/#besuch=B-…`) öffnet den vorausgefüllten Besuch.
6. Nach dem Besuch: Häkchen „Geplant“ entfernen, Papierprotokoll fotografieren, „✨ Foto auswerten“ – das Erkannte wird sofort in `kc_besuche` gespeichert (ohne Versand), danach „Speichern & senden“ für die Zusammenfassung.
   Voraussetzung: Secret `ANTHROPIC_API_KEY` für die Edge Function `kc-besuche` (kostenpflichtig pro Foto).
7. Termin abgesagt / Einladung zurückgezogen → ein noch leerer geplanter Besuch wird entfernt; ausgefüllte Besuche bleiben.

## Bausteine

| Teil | Ort |
|---|---|
| Datenbank (Tabellen, View, atomare Wahl, Zeitplaner, Communicator-Regeln) | `supabase/migrations/20260925_kc_termine.sql` |
| Edge Function `kc-termine` (verify_jwt = false, eigene Zugangsprüfung) | `supabase/functions/kc-termine/index.ts` |
| App-Reiter „Termine“ | `index.html` |
| Mitgliederseite | `termin.html` |
| Google-Skript + Anleitung | `google/` |
| Funktionstest (42 Prüfungen) | `tests/termine-api.test.mjs` |

Die bestehende Funktion `kc-besuche` (Besuchsprotokoll) wurde **nicht** verändert.

### Tabellen
`kc_termin_slots`, `kc_termin_einladungen`, `kc_termin_buchungen`, `kc_termin_vorschlaege`,
`kc_termin_protokoll` (jede Aktion mit Zeit, wer, Details, Versandergebnis), `kc_termin_kalender`,
`kc_termin_kalender_status`, View `kc_termin_slot_stand`. RLS an, keine Policies – nur die Edge Function greift zu.

### Zugänge der Edge Function
- **Hansi**: Kopfzeile `x-key` (derselbe persönliche Schlüssel wie im Besuchsprotokoll).
- **Mitglied**: Link-Token (48 Hex-Zeichen), in der DB nur als SHA-256. Neuer Link (Ablehnen, Ausfall, erneut einladen, „Link teilen“) macht den alten ungültig.
- **Google-Skript**: eigener Schlüssel `kal_…` (App → „Google-Kalender verbinden“), kann nur den Kalender abgleichen.
- **Zeitplaner**: pg_cron-Job `kc-termine-wartung-10min` mit Geheimnis `kc_termine_cron_secret` aus dem Vault.

### Versand
Über `kc-communication-router`, Quellprogramm `kc-besuche`, Ereignisse `termin_einladung`, `termin_bestaetigung`,
`termin_info_mitglied`, `termin_meldung_hansi`, Vorlage `kc_besuche_termin_v1`. Kostenfrei (Brevo/Web-Push, Zero-Cost-Sperre des Communicators bleibt aktiv).

## Tests
Testdaten (`ist_test = true`) versenden nie etwas und sind für echte Mitglieder unsichtbar.
Für einen Testlauf befristet einen Prüfschlüssel im Vault hinterlegen (erzwingt Testmodus):

```sql
select vault.create_secret('<sha256 des Prüfschlüssels>', 'kc_termine_pruefschluessel_sha256');
```

```bash
KC_TERMINE_PRUEFSCHLUESSEL=<Prüfschlüssel> node tests/termine-api.test.mjs
```

Danach Testdaten löschen (`delete … where ist_test`) und den Vault-Eintrag wieder entfernen.

## Definition of Done
- [x] Termine anbieten, löschen, absagen (Betroffene werden benachrichtigt und bekommen neuen Link)
- [x] Einladung per Mail an ausgewählte Mitglieder, einzeln oder gemeinsam (max. 3)
- [x] Wahl blockiert den Termin sofort für die Person; nie Überbuchung (gleichzeitige Wahl getestet)
- [x] Gegenvorschlag mit 2 Terminen, Absage, Wahl ändern
- [x] Push + Mail an Hansi; Bestätigungsmail mit .ics erst nach Freigabe
- [x] Frist 3 Tage, Meldung bei Ablauf; Erinnerung am Vortag
- [x] Protokoll aller Schritte in der DB und in der App
- [x] Google-Kalender mit Status geplant / vorgemerkt / gebucht / Vorschlag / abgesagt
- [x] Kalenderstatus nie fälschlich grün: „nicht verbunden“, „läuft nicht (letzter Abruf …)“ werden sichtbar angezeigt
- [x] Funktionstest 42/42 grün gegen die laufende Funktion, Oberflächen im Browser geprüft
