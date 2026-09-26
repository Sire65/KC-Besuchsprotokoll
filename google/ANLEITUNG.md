# Google-Kalender verbinden (einmalig, ca. 5 Minuten)

Das kleine Google-Skript läuft kostenlos in deinem eigenen Google-Konto. Alle 5 Minuten holt es die
Änderungen aus dem KC Besuchsprotokoll und trägt sie in deinen Google-Kalender ein:

| Farbe  | Bedeutung |
|--------|-----------|
| grau   | 🗓 Geplant – Termin angeboten, noch frei |
| gelb   | ⏳ Vorgemerkt – ein Mitglied hat gewählt, du musst noch freigeben |
| grün   | ✅ Gebucht – von dir bestätigt |
| orange | 💬 Vorschlag – Gegenvorschlag eines Mitglieds, bitte entscheiden |
| rot    | ❌ Abgesagt |

Ändert sich etwas (jemand wählt, du bestätigst, ein Termin fällt aus), wird der Kalendereintrag
beim nächsten Lauf angepasst. Gelöschte Termine und erledigte Vorschläge verschwinden wieder.

## Schritte

1. **App öffnen** → Reiter **Termine** → ganz unten **Google-Kalender verbinden**.
   Es erscheint ein Schlüssel (beginnt mit `kal_`). Er ist nur jetzt sichtbar.
2. Am PC **https://script.google.com** öffnen (mit deinem Google-Konto) → **Neues Projekt**.
3. Den Beispielcode im Editor löschen. In der App auf **Skript kopieren** tippen (oder den Inhalt von
   `google/KalenderAbgleich.gs` kopieren) und einfügen. Oben links den Namen **KC Termine** vergeben, 💾 speichern.
4. Links auf ⚙️ **Projekteinstellungen** → ganz unten **Skripteigenschaft hinzufügen**:
   - Eigenschaft: `KC_KALENDER_SCHLUESSEL`
   - Wert: der Schlüssel aus Schritt 1

   → **Skripteigenschaften speichern**.
   (Optional: `KC_KALENDER_ID` = ID eines anderen Kalenders, falls nicht der Hauptkalender benutzt werden soll.)
5. Zurück zum **Editor** (links `< >`), oben in der Auswahl die Funktion **einrichten** wählen → **▶ Ausführen**.
6. Google fragt nach Berechtigungen (Kalender verwalten, externe Dienste aufrufen) → dein Konto wählen →
   „Erweitert“ → „KC Termine öffnen (unsicher)“ → **Zulassen**. Das ist normal bei eigenen Skripten.
7. Fertig. Im Ausführungsprotokoll steht „Eingerichtet“. In der App wird die Anzeige „Google-Kalender“ grün.

## Wenn es nicht läuft

- **App zeigt rot „Abgleich läuft nicht“**: script.google.com → Projekt **KC Termine** → links ⏰ **Trigger**:
  Es muss ein Trigger für `abgleichen` („Zeitgesteuert, alle 5 Minuten“) da sein. Sonst Schritt 5 wiederholen.
- **„Schlüssel ungültig“**: In der App einen neuen Schlüssel erzeugen und in den Skripteigenschaften ersetzen.
- Das Skript hat nur Zugriff auf die Termine im KC Besuchsprotokoll – mit dem Schlüssel kann man sonst nichts
  lesen oder ändern.
