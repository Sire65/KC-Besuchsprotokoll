// Statischer Test (ohne Netz) KC-BES-TERMINE 1.3.9: Versand-Kennungen und Doppelversand-Hinweis.
// Aufruf: node tests/termine-kennung.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const src = readFileSync(new URL("../supabase/functions/kc-termine/index.ts", import.meta.url), "utf8");
// Jede Mitglieder-Mail braucht eine Kennung, die sich bei einem neuen Anlass/Termin ändert – sonst verwirft der
// Communicator sie als Doppelversand (Fall Manfred, 29.09.2026: Erinnerung nach Terminänderung nie verschickt).
const kennungen = [...src.matchAll(/\}, `(termin-[a-z-]+):([^`]*)`/g)].map((m) => ({ art: m[1], rest: m[2] }));
for (const k of kennungen.filter((k) => ["termin-erinnerung", "termin-absage", "termin-bestaetigung", "termin-mitglied"].includes(k.art)))
  assert.ok(/slot\.beginn|Date\.now\(\)/.test(k.rest), `${k.art}: Kennung ohne Termin-Beginn/Zeitpunkt → Doppelversand-Sperre nach Änderung`);
assert.ok(/termin-erinnerung:\$\{b\.id\}:\$\{b\.slot\.beginn\}/.test(src), "Erinnerung nicht je Termin-Beginn");
// Die Chronologie findet alte (ohne Beginn) und neue Kennungen
assert.ok(/c === `termin-erinnerung:\$\{id\}` \|\| c\.startsWith\(`termin-erinnerung:\$\{id\}:`\)/.test(src), "Chronologie findet Erinnerungen nicht mehr");
// Doppelversand wird im Protokoll sichtbar
assert.ok(/a\.result === "deduplicated"/.test(src) && /schon früher zugestellt – jetzt nicht erneut gesendet/.test(src), "Doppelversand wird still als gesendet gezählt");
console.log(`OK – ${kennungen.length} Versand-Kennungen geprüft`);
