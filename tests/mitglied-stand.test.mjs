// Feature KC-BES-STAND: Stand je Mitglied in „Mitglieder einladen“ (index.html → mitgliedStand). Offline, ohne Server.
// Aufruf: node tests/mitglied-stand.test.mjs
import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const code = html.slice(html.indexOf("const fTagKurz"), html.indexOf("function mListeZeigen()"));
assert.ok(code.includes("function mitgliedStand("), "mitgliedStand fehlt");
assert.ok(html.includes("${mitgliedStand(m.person_id)}"), "Stand wird in der Liste nicht angezeigt");
const TZ = "Europe/Berlin";
const tfDatum = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const tag = (n) => new Date(Date.now() + n * 86400000).toISOString();
const datum = (n) => tfDatum.format(new Date(Date.now() + n * 86400000));
const text = (h) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const T = { einladungen: [], buchungen: [], slots: [] };
const besuche = [];
const stand = (pid) => text(new Function("T", "besuche", "TZ", "tfDatum", code + ";return mitgliedStand;")(T, besuche, TZ, tfDatum)(pid));
const einl = (id, pids, status, extra = {}) => T.einladungen.push({ id, person_ids: pids, status, gueltig_bis: tag(2), ist_test: false, erstellt_am: tag(-1), ...extra });

assert.equal(stand("NEU"), "noch nicht eingeladen");

einl("e1", ["A"], "offen"); assert.equal(stand("A"), "✉️ eingeladen");
T.einladungen[0].geoeffnet_am = tag(0); assert.equal(stand("A"), "✉️ eingeladen · Link geöffnet");

einl("e2", ["B"], "offen", { gueltig_bis: tag(-1) }); assert.equal(stand("B"), "⌛ keine Antwort");
einl("e3", ["C"], "abgesagt"); assert.equal(stand("C"), "✖ abgesagt");
einl("e4", ["D"], "gegenvorschlag"); assert.equal(stand("D"), "💬 Gegenvorschlag");

T.slots.push({ id: "s1", beginn: tag(4) });
einl("e5", ["E"], "gewaehlt"); T.buchungen.push({ einladung_id: "e5", slot_id: "s1", status: "vorgemerkt" });
assert.match(stand("E"), /^⏳ gewählt \d\d\.\d\d\. – freigeben$/);

// Gruppe: beide sehen den Termin; Mitkommende ohne Einladung über den geplanten Besuch
einl("e6", ["F", "G"], "bestaetigt"); T.buchungen.push({ einladung_id: "e6", slot_id: "s1", status: "bestaetigt" });
assert.match(stand("F"), /^✅ Termin \d\d\.\d\d\.$/); assert.equal(stand("F"), stand("G"));
besuche.push({ person_ids: ["F", "G", "H"], status: "geplant", datum: datum(4) });
assert.equal(stand("H"), stand("F"), "Mitkommende ohne Einladung zeigen denselben Termin");

// Geschult: stattgefundener Besuch; vergangener Termin wird nicht zusätzlich angezeigt
besuche.push({ person_ids: ["I"], status: "fertig", datum: datum(-3) });
assert.match(stand("I"), /^🎓 geschult \d\d\.\d\d\.$/);
T.slots.push({ id: "s0", beginn: tag(-3) });
einl("e7", ["I"], "bestaetigt"); T.buchungen.push({ einladung_id: "e7", slot_id: "s0", status: "bestaetigt" });
assert.match(stand("I"), /^🎓 geschult \d\d\.\d\d\.$/);
// Geschult und neuer Termin: beides sichtbar
einl("e8", ["I"], "bestaetigt", { erstellt_am: tag(0) }); T.buchungen.push({ einladung_id: "e8", slot_id: "s1", status: "bestaetigt" });
assert.match(stand("I"), /^🎓 geschult \d\d\.\d\d\. ✅ Termin \d\d\.\d\d\.$/);

// Neueste Einladung zählt; Testeinladungen zählen nie
einl("e9", ["J"], "abgesagt", { erstellt_am: tag(-5) }); einl("e10", ["J"], "offen", { erstellt_am: tag(0) });
assert.equal(stand("J"), "✉️ eingeladen");
einl("e11", ["K"], "offen", { ist_test: true }); assert.equal(stand("K"), "noch nicht eingeladen");
// Nur „geplant“ gilt nicht als geschult (UNKNOWN nie als OK)
besuche.push({ person_ids: ["L"], status: "geplant", datum: datum(-1) });
assert.equal(stand("L"), "noch nicht eingeladen");

console.log("KC-BES-STAND: PASS");
