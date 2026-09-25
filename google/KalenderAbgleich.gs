/**
 * KC Termine → Google-Kalender  (KC Besuchsprotokoll, Feature KC-BES-TERMINE, ab 1.2.0)
 *
 * Holt alle 5 Minuten die Änderungen aus dem KC Besuchsprotokoll und trägt sie in Hansis
 * Google-Kalender ein: geplant (grau), vorgemerkt (gelb), gebucht (grün),
 * Vorschlag eines Mitglieds (orange), abgesagt (rot).
 *
 * Einrichtung: siehe google/ANLEITUNG.md
 * Der Schlüssel steht NICHT hier im Code, sondern in den Skripteigenschaften
 * (KC_KALENDER_SCHLUESSEL). Optional: KC_KALENDER_ID für einen anderen Kalender als den Hauptkalender.
 * Der Schlüssel erlaubt nur den Kalender-Abgleich – sonst nichts.
 */
const KC_API = 'https://ptblnpiroqftcvlsrhac.supabase.co/functions/v1/kc-termine';
const KC_FARBEN = {
  geplant: CalendarApp.EventColor.GRAY,
  vorgemerkt: CalendarApp.EventColor.YELLOW,
  gebucht: CalendarApp.EventColor.GREEN,
  vorschlag: CalendarApp.EventColor.ORANGE,
  abgesagt: CalendarApp.EventColor.RED,
};

/** Einmal von Hand ausführen: legt den 5-Minuten-Zeitplan an und gleicht sofort ab. */
function einrichten() {
  schluessel_();
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'abgleichen'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('abgleichen').timeBased().everyMinutes(5).create();
  const n = abgleichen();
  Logger.log('Eingerichtet. Erster Abgleich: ' + n + ' Eintrag/Einträge. Ab jetzt alle 5 Minuten automatisch.');
}

/** Läuft automatisch alle 5 Minuten. */
function abgleichen() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return 0;
  try {
    const kal = kalender_();
    const antwort = aufruf_('kalender_abgleich', {});
    const ergebnisse = [];
    (antwort.eintraege || []).forEach(function (e) {
      try {
        let ev = e.event_id ? holen_(kal, e.event_id) : null;
        if (e.geloescht) {
          if (ev) ev.deleteEvent();
          ergebnisse.push({ uid: e.uid, event_id: null, hash: e.hash });
          return;
        }
        const beginn = new Date(e.beginn), ende = new Date(e.ende);
        if (!ev) {
          ev = kal.createEvent(e.titel, beginn, ende, { location: e.ort || '', description: e.beschreibung || '' });
        } else {
          ev.setTitle(e.titel);
          ev.setTime(beginn, ende);
          ev.setLocation(e.ort || '');
          ev.setDescription(e.beschreibung || '');
        }
        if (KC_FARBEN[e.farbe]) ev.setColor(KC_FARBEN[e.farbe]);
        ergebnisse.push({ uid: e.uid, event_id: ev.getId(), hash: e.hash });
      } catch (f) {
        ergebnisse.push({ uid: e.uid, fehler: String((f && f.message) || f) });
      }
    });
    aufruf_('kalender_gemeldet', { ergebnisse: ergebnisse });
    return ergebnisse.length;
  } finally {
    lock.releaseLock();
  }
}

function holen_(kal, id) {
  try { return kal.getEventById(id); } catch (f) { return null; }
}

function kalender_() {
  const id = PropertiesService.getScriptProperties().getProperty('KC_KALENDER_ID');
  const k = id ? CalendarApp.getCalendarById(id) : CalendarApp.getDefaultCalendar();
  if (!k) throw new Error('Kalender nicht gefunden: ' + id);
  return k;
}

function schluessel_() {
  const s = PropertiesService.getScriptProperties().getProperty('KC_KALENDER_SCHLUESSEL');
  if (!s) throw new Error('Bitte zuerst in den Projekteinstellungen die Skripteigenschaft KC_KALENDER_SCHLUESSEL mit dem Schlüssel aus der App anlegen.');
  return s.trim();
}

function aufruf_(action, daten) {
  const r = UrlFetchApp.fetch(KC_API, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-kalender-key': schluessel_() },
    payload: JSON.stringify(Object.assign({ action: action }, daten)),
    muteHttpExceptions: true,
  });
  const code = r.getResponseCode();
  if (code === 401) throw new Error('Schlüssel ungültig – in der App (Termine → Google-Kalender) einen neuen erzeugen und in den Skripteigenschaften ersetzen.');
  if (code !== 200) throw new Error('KC Besuchsprotokoll antwortet mit ' + code + ': ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText());
}
