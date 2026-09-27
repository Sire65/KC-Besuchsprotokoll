// KC Besuchsprotokoll – Terminkalender (Feature KC-BES-TERMINE, ab App-Version 1.2.0)
// Drei Zugänge in einer Funktion:
//  - Hansi (App):            Kopfzeile x-key (gleicher Schlüssel wie kc-besuche, Abdruck in kc_besuche_zugang)
//  - Mitglied (termin.html): persönlicher Link-Token t im Body (nur als SHA-256 gespeichert)
//  - Google-Skript:          Kopfzeile x-kalender-key (eigener Schlüssel, kann nur den Kalender abgleichen)
//  - Zeitplaner (pg_cron):   cronSecret aus dem Vault (Fristen, Erinnerungen)
// Versand ausschließlich über den KC Communicator (kc-communication-router, Brevo/Web-Push).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPA = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPA, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const HANSI = "KC-P-002";
const ORG = "KC_WERNE";
const TZ = "Europe/Berlin";
const APP_SEITE = "https://sire65.github.io/KC-Besuchsprotokoll/";
const MITGLIED_SEITE = APP_SEITE + "termin.html";
const FRIST_TAGE = 3;
const ANHANG_BUCKET = "kc-communication-attachments";
const AKTIV = ["vorgemerkt", "bestaetigt"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-key, x-kalender-key, x-kc-termine-admin-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

class Fehler extends Error {
  constructor(msg: string, public status = 400, public extra: Record<string, unknown> = {}) { super(msg); }
}

// ---------- Hilfen ----------
async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function zufall(bytes = 24) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const jetzt = () => new Date().toISOString();
const inTagen = (t: number) => new Date(Date.now() + t * 86400000).toISOString();

function tzOffsetMin(ms: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms) / 60000;
}
// Datum + Uhrzeit in deutscher Ortszeit → Zeitpunkt
function berlin(datum: string, zeit: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum || "") || !/^\d{2}:\d{2}$/.test(zeit || "")) throw new Fehler("Datum oder Uhrzeit fehlt.");
  const [y, m, d] = datum.split("-").map(Number), [h, mi] = zeit.split(":").map(Number);
  const lokal = Date.UTC(y, m - 1, d, h, mi);
  let ms = lokal - tzOffsetMin(lokal) * 60000;
  ms = lokal - tzOffsetMin(ms) * 60000;
  return new Date(ms);
}
function berlinTag(d: Date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function berlinStunde(d: Date) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", hour: "2-digit" }).format(d));
}
const fTag = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
const fTagLang = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
const fZeit = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const fFrist = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
function wann(beginn: string, ende: string, lang = false) {
  return `${(lang ? fTagLang : fTag).format(new Date(beginn))}, ${fZeit.format(new Date(beginn))}–${fZeit.format(new Date(ende))} Uhr`;
}
const frist = (iso: string) => fFrist.format(new Date(iso)) + " Uhr";

async function log(wer: string, aktion: string, ids: { einladung_id?: string | null; slot_id?: string | null; buchung_id?: string | null } = {}, details: Record<string, unknown> = {}) {
  await db.from("kc_termin_protokoll").insert({ wer, aktion, einladung_id: ids.einladung_id ?? null, slot_id: ids.slot_id ?? null, buchung_id: ids.buchung_id ?? null, details });
}

// ---------- Personen & Sprache ----------
type Person = { person_id: string; display_name: string; given_name?: string; preferred_name?: string; family_name?: string; email?: string; street?: string; postal_code?: string; city?: string };
async function personen(ids: string[]): Promise<Person[]> {
  if (!ids.length) return [];
  const { data } = await db.from("kc_core_people")
    .select("person_id,display_name,given_name,preferred_name,family_name,email,street,postal_code,city").in("person_id", ids);
  const map = new Map((data ?? []).map((p: Person) => [p.person_id, p]));
  return ids.map((id) => map.get(id)).filter(Boolean) as Person[];
}
const vorname = (p: Person) => p.preferred_name || p.given_name || p.display_name;
const adresse = (p?: Person) => p ? [p.street, [p.postal_code, p.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
const aufzaehlen = (t: string[]) => t.length > 1 ? t.slice(0, -1).join(", ") + " und " + t[t.length - 1] : (t[0] ?? "");
function namenKurz(leute: Person[]) {
  const nach = [...new Set(leute.map((p) => p.family_name).filter(Boolean))];
  if (leute.length > 1 && nach.length === 1) return aufzaehlen(leute.map(vorname)) + " " + nach[0];
  return aufzaehlen(leute.map((p) => p.display_name));
}
async function anredeZeile(leute: Person[]) {
  const { data } = await db.from("kc_besuche_anrede").select("person_id,anrede").in("person_id", leute.map((l) => l.person_id));
  const a = Object.fromEntries((data ?? []).map((x: any) => [x.person_id, x.anrede]));
  if (leute.length && leute.every((l) => a[l.person_id])) {
    return leute.map((l, i) => (i === 0 ? a[l.person_id] : String(a[l.person_id]).toLowerCase()) + " " + vorname(l)).join(", ") + ",";
  }
  return `Hallo ${aufzaehlen(leute.map(vorname)) || "zusammen"},`;
}
function sprache(n: number) {
  return n > 1
    ? { du: "ihr", dir: "euch", dich: "euch", dein: "euer", deinen: "euren", deinem: "eurem", kannst: "könnt", kommst: "kommt", entscheidest: "entscheidet", antworte: "antwortet", such: "sucht euch", gib: "gebt" }
    : { du: "du", dir: "dir", dich: "dich", dein: "dein", deinen: "deinen", deinem: "deinem", kannst: "kannst", kommst: "kommst", entscheidest: "entscheidest", antworte: "antworte", such: "such dir", gib: "gib" };
}
function artText(art: string, n: number) {
  const w = sprache(n);
  if (art === "bei_hansi") return `bei mir – ${w.du} ${w.kommst} zu mir`;
  if (art === "beim_mitglied") return `ich komme zu ${w.dir}`;
  return `bei ${w.dir} oder bei mir – ${w.du} ${w.entscheidest}`;
}
// Hinweis Schulungsversion (ab 1.3.4): steht in Einladung, Bestätigung und Erinnerung
function tabletHinweis(n: number, art?: string) {
  const ihr = n > 1;
  const was = art === "beim_mitglied" ? (ihr ? "Legt gerne ein Tablet bereit" : "Leg gerne ein Tablet bereit")
    : art === "bei_hansi" ? (ihr ? "Bringt gerne ein Tablet mit" : "Bring gerne ein Tablet mit")
    : (ihr ? "Wenn ihr ein Tablet habt, bringt es gerne mit bzw. legt es bereit" : "Wenn du ein Tablet hast, bring es gerne mit bzw. leg es bereit");
  return `📱 ${was} – dann installiere ich ${ihr ? "euch" : "dir"} die Schulungsversion unserer Programme direkt darauf, und ${ihr ? "ihr könnt" : "du kannst"} zu Hause in Ruhe weiter üben.`;
}
function artKurz(art: string) {
  return art === "bei_hansi" ? "bei mir" : art === "beim_mitglied" ? "ich fahre hin" : art === "wahl" ? "Ort nach Wahl" : "Ort egal";
}

// ---------- Versand über den KC Communicator ----------
type Versand = { name: string; mail: boolean; push: boolean; hinweis?: string };
async function senden(eventKey: string, personIds: string[], vars: Record<string, unknown>, korrelation: string, test = false): Promise<Versand[]> {
  if (test) return [{ name: "Test", mail: false, push: false, hinweis: "Testlauf – nichts versendet" }];
  // Jede Mail an Mitglieder geht als echtes BCC auch an Hansi (KC-COMM-CCBCC im Communicator) – das Mitglied sieht davon nichts
  const bcc = MITGLIED_EREIGNISSE.includes(eventKey) && !personIds.includes(HANSI) ? [{ personId: HANSI }] : undefined;
  const r = await fetch(`${SUPA}/functions/v1/kc-communication-router`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    body: JSON.stringify({ sourceProgram: "kc-besuche", eventKey, recipients: personIds.map((personId) => ({ personId })), bcc, variables: vars, correlationId: korrelation }),
  });
  const out = await r.json().catch(() => ({}));
  if (!Array.isArray(out?.results)) return [{ name: "Versand", mail: false, push: false, hinweis: String(out?.error || out?.code || `HTTP ${r.status}`) }];
  return out.results.map((x: any) => {
    const ok = (k: string) => (x.attempts ?? []).some((a: any) => a.channel === k && ["sent", "deduplicated"].includes(a.result));
    const fehl = (x.attempts ?? []).filter((a: any) => !["sent", "deduplicated"].includes(a.result)).map((a: any) => `${a.channel}: ${a.reason || a.result}`);
    return { name: x.displayName || x.personId, mail: ok("email"), push: ok("push"), hinweis: fehl.join(", ") || undefined };
  });
}
const MITGLIED_EREIGNISSE = ["termin_einladung", "termin_bestaetigung", "termin_info_mitglied"];
const versandText = (v: Versand[]) => v.map((x) => `${x.name}: ${[x.mail && "Mail", x.push && "Push"].filter(Boolean).join(" + ") || "nicht zugestellt"}${x.hinweis ? ` (${x.hinweis})` : ""}`).join("; ");

async function meldeHansi(betreff: string, text: string, kurz: string, test = false) {
  return senden("termin_meldung_hansi", [HANSI], {
    betreff: "KC Termine – " + betreff,
    text: `Hallo Hansi,\n\n${text}\n\nZur App: ${APP_SEITE}#termine\n\nKC Besuchsprotokoll`,
    titel: "KC Termine", kurz, url: APP_SEITE + "#termine",
  }, `termin-hansi:${crypto.randomUUID()}`, test);
}

// ---------- Kalenderdatei (.ics) für die Bestätigung ----------
function icsText(s: string) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function icsZeit(iso: string) { return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
function icsFalten(z: string) { const out = []; let r = z; while (r.length > 74) { out.push(r.slice(0, 74)); r = " " + r.slice(74); } out.push(r); return out.join("\r\n"); }
function icsBauen(uid: string, beginn: string, ende: string, titel: string, ort: string, beschreibung: string) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Koecheclub Werne//KC Besuchsprotokoll//DE", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${uid}@kc-besuchsprotokoll`, `DTSTAMP:${icsZeit(jetzt())}`, `DTSTART:${icsZeit(beginn)}`, `DTEND:${icsZeit(ende)}`,
    `SUMMARY:${icsText(titel)}`, `LOCATION:${icsText(ort)}`, `DESCRIPTION:${icsText(beschreibung)}`,
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", `DESCRIPTION:${icsText(titel)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].map(icsFalten).join("\r\n") + "\r\n";
}
async function icsAnhang(buchungId: string, inhalt: string) {
  const bytes = new TextEncoder().encode(inhalt);
  const pfad = `kc-besuche/termine/${buchungId}.ics`;
  const up = await db.storage.from(ANHANG_BUCKET).upload(pfad, bytes, { contentType: "text/calendar", upsert: true });
  if (up.error) return null;
  const { data: link } = await db.from("kc_core_user_links").select("user_id").eq("person_id", HANSI).eq("active", true).limit(1).maybeSingle();
  if (!link?.user_id) return null;
  const { data } = await db.from("kc_communication_attachments").insert({
    org_id: ORG, uploaded_by: link.user_id, bucket: ANHANG_BUCKET, object_path: pfad, file_name: "Termin-Koecheclub.ics",
    mime_type: "text/calendar", size_bytes: bytes.length, expires_at: inTagen(30),
  }).select("id").single();
  return data?.id ?? null;
}

// ---------- Termine & Belegung ----------
function verfuegbar(s: any, n: number) {
  return s.status === "offen" && new Date(s.beginn) > new Date() && !s.hat_hausbesuch && s.belegt + n <= s.plaetze &&
    !(s.besuchsart === "beim_mitglied" && s.buchungen > 0);
}
const artEffektiv = (s: any) => (s.besuchsart === "wahl" && s.buchungen > 0 ? "bei_hansi" : s.besuchsart);
async function freieTermine(n: number, test: boolean) {
  const { data } = await db.from("kc_termin_slot_stand").select("*").eq("status", "offen").eq("ist_test", test)
    .gt("beginn", jetzt()).order("beginn");
  return (data ?? []).filter((s: any) => verfuegbar(s, n))
    .map((s: any) => ({ id: s.id, beginn: s.beginn, ende: s.ende, besuchsart: artEffektiv(s), frei: s.plaetze - s.belegt, notiz: s.notiz }));
}
async function hansiOrt() {
  const [h] = await personen([HANSI]);
  return adresse(h) || "bei Hansi";
}
async function ortFuer(art: string, leute: Person[]) {
  return art === "bei_hansi" ? `bei Hansi, ${await hansiOrt()}` : adresse(leute[0]) || "bei dir";
}

// Neuer Link (alter wird ungültig) und neue Antwortfrist
async function neuOeffnen(einladungId: string) {
  const token = zufall();
  const gueltig = inTagen(FRIST_TAGE);
  const { error } = await db.from("kc_termin_einladungen").update({
    token_hash: await sha256(token), gueltig_bis: gueltig, status: "offen", ablauf_gemeldet_am: null,
    geoeffnet_am: null, beantwortet_am: null, geaendert_am: jetzt(),
  }).eq("id", einladungId);
  if (error) throw new Fehler(error.message, 500);
  return { link: `${MITGLIED_SEITE}?t=${token}`, gueltig };
}

// ---------- Besuchsprotokoll zum Termin (ab 1.3.0) ----------
// Jeder bestätigte Termin bekommt einen geplanten Besuch in kc_besuche mit den bekannten Daten.
const hhmm = (iso: string) => fZeit.format(new Date(iso));
async function besuchZumTermin(buchungId: string, e: any, leute: Person[], slot: any, art: string) {
  if (e.ist_test) return null;
  const { data: b } = await db.from("kc_termin_buchungen").select("besuch_id").eq("id", buchungId).single();
  const zeile = {
    person_ids: leute.map((l) => l.person_id), mitglied: namenKurz(leute),
    anwesende: [...leute.map(vorname), "Hansi"].join(", "),
    ort: art === "bei_hansi" ? "bei Hansi" : adresse(leute[0]) || null,
    datum: berlinTag(new Date(slot.beginn)), zeit_von: hhmm(slot.beginn), zeit_bis: hhmm(slot.ende),
    besuchsart: art, geaendert_am: jetzt(),
  };
  if (b?.besuch_id) {
    // Nur Termindaten nachziehen, solange der Besuch noch geplant ist – Inhalte nie überschreiben
    await db.from("kc_besuche").update(zeile).eq("besuch_id", b.besuch_id).eq("status", "geplant");
    return b.besuch_id;
  }
  const { data: neu, error } = await db.from("kc_besuche").insert({ ...zeile, status: "geplant", zusammenfassung_senden: false }).select("besuch_id").single();
  if (error || !neu) return null;
  await db.from("kc_termin_buchungen").update({ besuch_id: neu.besuch_id }).eq("id", buchungId);
  return neu.besuch_id;
}
// Termin fällt weg: noch leeren, geplanten Besuch wieder entfernen (ausgefüllte Besuche bleiben)
async function besuchEntfernen(besuchId: string | null) {
  if (!besuchId) return;
  await db.from("kc_besuche").delete().eq("besuch_id", besuchId).eq("status", "geplant")
    .is("notizen", null).is("vereinbarungen", null).eq("fotos", "{}");
}

// ---------- Mails an Mitglieder ----------
async function einladungSenden(e: any, leute: Person[], link: string, gueltig: string, anlass: "neu" | "erneut" | "neue_termine" | "abgelehnt" | "ausfall", extra = "") {
  const n = leute.length, w = sprache(n);
  const frei = await freieTermine(n, e.ist_test);
  const liste = frei.length
    ? frei.slice(0, 12).map((s) => `• ${wann(s.beginn, s.ende)} – ${artText(s.besuchsart, n)}`).join("\n")
    : "(Gerade ist kein Termin frei – über den Link " + (n > 1 ? "könnt ihr" : "kannst du") + " mir eigene Vorschläge schicken.)";
  const einstieg: Record<string, string> = {
    neu: `ich würde ${w.dich} gerne treffen, um ${w.dir} unsere Programme zu zeigen. Dafür habe ich ein paar Termine vorbereitet.`,
    erneut: `ich möchte ${w.dich} noch einmal fragen, ob wir uns treffen können. Hier sind die aktuellen Termine.`,
    neue_termine: `danke für ${w.deinen === "euren" ? "eure" : "deine"} Vorschläge. Leider passen sie bei mir nicht. Ich habe neue Termine eingestellt.`,
    abgelehnt: `leider klappt der gewählte Termin bei mir doch nicht. Bitte ${w.such} einen anderen aus.`,
    ausfall: `leider muss ich unseren Termin absagen. Das tut mir leid! Bitte ${w.such} einen neuen Termin aus.`,
  };
  const text = [
    await anredeZeile(leute), "",
    einstieg[anlass] + (extra ? "\n\n" + extra : "") + (e.nachricht && anlass === "neu" ? "\n\n" + e.nachricht : ""), "",
    `Über diesen Link ${w.kannst} ${w.du} ${n > 1 ? "euch" : "dir"} einen Termin aussuchen:`, link, "",
    "Zurzeit frei:", liste, "",
    tabletHinweis(n), "",
    `Wer zuerst wählt, bekommt den Termin – der Link zeigt immer den aktuellen Stand. Passt keiner, ${w.kannst} ${w.du} dort „Kein Termin passt“ ankreuzen und mir zwei eigene Vorschläge schicken.`, "",
    `${w.antworte === "antwortet" ? "Bitte antwortet" : "Bitte antworte"} bis ${frist(gueltig)}.`, "",
    "Viele Grüße", "Hansi", "Köcheclub Werne",
  ].join("\n");
  const betreff = anlass === "ausfall" ? "Köcheclub Werne – Termin fällt aus, bitte neu wählen"
    : anlass === "abgelehnt" ? "Köcheclub Werne – bitte einen anderen Termin wählen"
    : "Köcheclub Werne – Terminvorschläge für unser Treffen";
  const v = await senden(anlass === "neu" || anlass === "erneut" ? "termin_einladung" : "termin_info_mitglied", leute.map((l) => l.person_id), {
    betreff, text, titel: "Köcheclub Werne", kurz: `Neue Terminvorschläge von Hansi – bitte bis ${frist(gueltig)} wählen.`, url: link,
  }, `termin-mitglied:${e.id}:${anlass}:${Date.now()}`, e.ist_test);
  if (v.some((x) => x.mail)) await db.from("kc_termin_einladungen").update({ gesendet_am: jetzt() }).eq("id", e.id);
  return v;
}

async function linkUpdateSenden(e: any, leute: Person[], link: string) {
  const text = [
    await anredeZeile(leute), "",
    "der bisherige Termin-Link wurde ersetzt. Bitte verwende nur noch diesen aktuellen Link:", link, "",
    "Der frühere Link funktioniert nicht mehr.", "",
    "Viele Grüße", "Hansi", "Köcheclub Werne",
  ].join("\n");
  const v = await senden("termin_einladung", leute.map((l) => l.person_id), {
    betreff: "Köcheclub Werne – aktueller Termin-Link", text, titel: "Köcheclub Werne",
    kurz: "Dein Termin-Link wurde aktualisiert. Bitte verwende den Link aus dieser Nachricht.", url: link,
  }, `termin-mitglied:${e.id}:link_update:${Date.now()}`, e.ist_test);
  if (v.some((x) => x.mail)) await db.from("kc_termin_einladungen").update({ gesendet_am: jetzt() }).eq("id", e.id);
  return v;
}

async function bestaetigungSenden(e: any, leute: Person[], slot: any, buchung: any) {
  const n = leute.length, w = sprache(n);
  const ort = await ortFuer(buchung.besuchsart, leute);
  const titel = "Köcheclub Werne – Treffen mit Hansi";
  const beschr = `Treffen mit Hansi (Köcheclub Werne): Schulung in unseren Programmen. ${artText(buchung.besuchsart, n)}.`;
  const anhangId = e.ist_test ? null : await icsAnhang(buchung.id, icsBauen(`termin-${buchung.id}`, slot.beginn, slot.ende, titel, ort, beschr));
  const text = [
    await anredeZeile(leute), "",
    `hiermit bestätige ich ${w.deinen} Termin:`, "",
    `📅 ${wann(slot.beginn, slot.ende, true)}`,
    `📍 ${buchung.besuchsart === "bei_hansi" ? `bei mir: ${await hansiOrt()}` : `ich komme zu ${w.dir}${adresse(leute[0]) ? ": " + adresse(leute[0]) : ""}`}`, "",
    tabletHinweis(n, buchung.besuchsart), "",
    anhangId ? `Im Anhang ist der Termin als Kalenderdatei – einfach antippen, dann steht er in ${w.deinem} Kalender.` : "",
    `Falls etwas dazwischenkommt, ${w.gib} mir bitte kurz Bescheid.`, "",
    `Ich freue mich auf ${w.dich}!`, "",
    "Viele Grüße", "Hansi", "Köcheclub Werne",
  ].filter((z, i, a) => !(z === "" && a[i - 1] === "")).join("\n");
  return senden("termin_bestaetigung", leute.map((l) => l.person_id), {
    betreff: `Köcheclub Werne – Termin bestätigt: ${wann(slot.beginn, slot.ende)}`, text,
    titel: "Termin bestätigt", kurz: `Unser Treffen: ${wann(slot.beginn, slot.ende)} – ${artText(buchung.besuchsart, n)}. Die Bestätigung kommt auch per Mail.`,
    ...(anhangId ? { attachmentIds: [anhangId] } : {}),
  }, `termin-bestaetigung:${buchung.id}:${Date.now()}`, e.ist_test);
}

// ---------- Fristen & Erinnerungen ----------
async function ablaufPruefen() {
  const { data } = await db.from("kc_termin_einladungen").select("*").eq("status", "offen").lt("gueltig_bis", jetzt());
  if (!data?.length) return 0;
  const echte: string[] = [];
  for (const e of data) {
    const { data: ok } = await db.from("kc_termin_einladungen").update({ status: "abgelaufen", ablauf_gemeldet_am: jetzt(), geaendert_am: jetzt() })
      .eq("id", e.id).eq("status", "offen").select("id");
    if (!ok?.length) continue;
    const leute = await personen(e.person_ids);
    await log("system", "frist_abgelaufen", { einladung_id: e.id }, { namen: namenKurz(leute) });
    if (!e.ist_test) echte.push(namenKurz(leute));
  }
  if (echte.length) {
    const v = await meldeHansi(`Keine Antwort: ${aufzaehlen(echte)}`,
      `Die Antwortfrist ist abgelaufen, ohne dass ein Termin gewählt wurde:\n\n${echte.map((x) => "• " + x).join("\n")}\n\nIn der App kannst du erneut einladen.`,
      `Keine Antwort (Frist abgelaufen): ${aufzaehlen(echte)}`);
    await log("system", "hansi_benachrichtigt", {}, { anlass: "frist_abgelaufen", versand: versandText(v) });
  }
  return data.length;
}

async function erinnerungen() {
  const morgen = berlinTag(new Date(Date.now() + 86400000));
  if (berlinStunde(new Date()) < 9) return 0;
  const { data } = await db.from("kc_termin_buchungen").select("*, slot:kc_termin_slots(*), einladung:kc_termin_einladungen(*)")
    .eq("status", "bestaetigt").is("erinnerung_gesendet_am", null);
  let n = 0;
  for (const b of data ?? []) {
    if (b.slot?.status !== "offen" || berlinTag(new Date(b.slot.beginn)) !== morgen) continue;
    if (b.entschieden_am && Date.now() - new Date(b.entschieden_am).getTime() < 2 * 3600000) continue;
    const { data: ok } = await db.from("kc_termin_buchungen").update({ erinnerung_gesendet_am: jetzt() }).eq("id", b.id).is("erinnerung_gesendet_am", null).select("id");
    if (!ok?.length) continue;
    const leute = await personen(b.einladung.person_ids), k = leute.length, w = sprache(k);
    const text = [await anredeZeile(leute), "", `kurze Erinnerung an unser Treffen morgen:`, "",
      `📅 ${wann(b.slot.beginn, b.slot.ende, true)}`, `📍 ${await ortFuer(b.besuchsart, leute)}`, "",
      tabletHinweis(k, b.besuchsart), "",
      `Falls etwas dazwischenkommt, ${w.gib} mir bitte kurz Bescheid.`, "", "Bis morgen!", "Hansi", "Köcheclub Werne"].join("\n");
    const v = await senden("termin_info_mitglied", leute.map((l) => l.person_id), {
      betreff: `Köcheclub Werne – Erinnerung: morgen, ${fZeit.format(new Date(b.slot.beginn))} Uhr`, text,
      titel: "Erinnerung", kurz: `Morgen ${fZeit.format(new Date(b.slot.beginn))} Uhr: Treffen mit Hansi (${artText(b.besuchsart, k)}).`,
    }, `termin-erinnerung:${b.id}`, b.einladung.ist_test);
    await log("system", "erinnerung_gesendet", { einladung_id: b.einladung_id, slot_id: b.slot_id, buchung_id: b.id }, { versand: versandText(v) });
    n++;
  }
  return n;
}

// ---------- Google-Kalender (Hansi) ----------
async function kalenderEintraege() {
  const seit = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: slots } = await db.from("kc_termin_slot_stand").select("*").eq("ist_test", false).gte("beginn", seit);
  const ids = (slots ?? []).map((s: any) => s.id);
  const { data: buch } = ids.length
    ? await db.from("kc_termin_buchungen").select("*, einladung:kc_termin_einladungen(person_ids)").in("slot_id", ids).in("status", AKTIV)
    : { data: [] as any[] };
  const { data: vor } = await db.from("kc_termin_vorschlaege").select("*, einladung:kc_termin_einladungen(person_ids,ist_test,bemerkung)").eq("status", "offen");
  const alleIds = [...new Set([...(buch ?? []).flatMap((b: any) => b.einladung.person_ids), ...(vor ?? []).flatMap((v: any) => v.einladung.person_ids)])];
  const pmap = new Map((await personen(alleIds)).map((p) => [p.person_id, p]));
  const leuteVon = (pids: string[]) => pids.map((id) => pmap.get(id)).filter(Boolean) as Person[];
  const hOrt = await hansiOrt();

  const eintraege: any[] = [];
  for (const s of slots ?? []) {
    const bs = (buch ?? []).filter((b: any) => b.slot_id === s.id);
    const best = bs.filter((b: any) => b.status === "bestaetigt"), vorg = bs.filter((b: any) => b.status === "vorgemerkt");
    const namen = (l: any[]) => l.map((b: any) => namenKurz(leuteVon(b.einladung.person_ids))).join(", ");
    const art = bs[0]?.besuchsart || artEffektiv(s);
    const frei = s.plaetze - s.belegt;
    let titel: string, farbe: string;
    if (s.status === "abgesagt") { titel = "❌ Abgesagt: KC-Besuchstermin"; farbe = "abgesagt"; }
    else if (best.length) { titel = `✅ Gebucht: KC-Besuch ${namen(best)}` + (vorg.length ? ` (+ vorgemerkt: ${namen(vorg)})` : ""); farbe = "gebucht"; }
    else if (vorg.length) { titel = `⏳ Vorgemerkt: KC-Besuch ${namen(vorg)} – bitte freigeben`; farbe = "vorgemerkt"; }
    else { titel = `🗓 Geplant: KC-Besuchstermin (${s.plaetze} ${s.plaetze === 1 ? "Platz" : "Plätze"} frei)`; farbe = "geplant"; }
    const ort = art === "bei_hansi" ? `bei mir (${hOrt})` : art === "beim_mitglied" && bs[0] ? adresse(leuteVon(bs[0].einladung.person_ids)[0]) : "";
    const beschreibung = [
      `Status: ${titel.replace(/^\S+\s/, "")}`, `Ort: ${artKurz(art)}`,
      s.status !== "abgesagt" ? `Plätze: ${s.belegt} von ${s.plaetze} belegt${frei > 0 && !s.hat_hausbesuch ? ` (${frei} frei)` : ""}` : "",
      ...bs.map((b: any) => `• ${namenKurz(leuteVon(b.einladung.person_ids))} – ${b.status === "bestaetigt" ? "gebucht" : "vorgemerkt, wartet auf Freigabe"}${b.besuch_id ? `\n  Protokoll öffnen: ${APP_SEITE}#besuch=${b.besuch_id}` : ""}`),
      s.notiz ? `Notiz: ${s.notiz}` : "", s.herkunft === "gegenvorschlag" ? "Aus einem Gegenvorschlag des Mitglieds." : s.herkunft === "direkt" ? "Mündlich abgesprochen." : "",
    ].filter(Boolean).join("\n") + `\n\nVerwaltet im KC Besuchsprotokoll: ${APP_SEITE}#termine`;
    eintraege.push({ uid: `slot-${s.id}`, titel, beginn: s.beginn, ende: s.ende, ort, beschreibung, farbe, geloescht: false });
  }
  for (const v of vor ?? []) {
    if (v.einladung.ist_test) continue;
    const leute = leuteVon(v.einladung.person_ids);
    eintraege.push({
      uid: `vorschlag-${v.id}`, titel: `💬 Vorschlag von ${namenKurz(leute)} – bitte entscheiden`, beginn: v.beginn, ende: v.ende,
      ort: v.besuchsart === "bei_hansi" ? `bei mir (${hOrt})` : v.besuchsart === "beim_mitglied" ? adresse(leute[0]) : "",
      beschreibung: `Gegenvorschlag von ${namenKurz(leute)} (${artKurz(v.besuchsart)}).${v.einladung.bemerkung ? "\nBemerkung: " + v.einladung.bemerkung : ""}\n\nIn der App annehmen oder neue Termine anbieten: ${APP_SEITE}#termine`,
      farbe: "vorschlag", geloescht: false,
    });
  }

  // Einträge, deren Termin gelöscht wurde oder deren Vorschlag erledigt ist, aus dem Kalender nehmen
  const { data: stand } = await db.from("kc_termin_kalender").select("*");
  const smap = new Map((stand ?? []).map((r: any) => [r.uid, r]));
  const gebaut = new Set(eintraege.map((x) => x.uid));
  const kandidaten = (stand ?? []).filter((r: any) => r.google_event_id && !gebaut.has(r.uid));
  const slotIds = kandidaten.filter((r: any) => r.uid.startsWith("slot-")).map((r: any) => r.uid.slice(5));
  const { data: nochDa } = slotIds.length ? await db.from("kc_termin_slots").select("id").in("id", slotIds) : { data: [] as any[] };
  const da = new Set((nochDa ?? []).map((x: any) => x.id));
  for (const r of kandidaten) {
    if (r.uid.startsWith("slot-") && da.has(r.uid.slice(5))) continue; // alter Termin (> 30 Tage) – bleibt stehen
    eintraege.push({ uid: r.uid, geloescht: true });
  }

  const offen: any[] = [];
  for (const x of eintraege) {
    x.hash = await sha256(JSON.stringify([x.titel, x.beginn, x.ende, x.ort, x.beschreibung, x.farbe, x.geloescht]));
    const r: any = smap.get(x.uid);
    x.event_id = r?.google_event_id ?? null;
    if (x.geloescht ? !!x.event_id : r?.stand_hash !== x.hash) offen.push(x);
  }
  return offen;
}

// ---------- Übersicht für Hansi ----------
function tokenAusTerminLink(link: unknown) {
  try {
    const t = new URL(String(link || "")).searchParams.get("t") || "";
    return /^[0-9a-f]{32,64}$/.test(t) ? t : null;
  } catch { return null; }
}
async function mailLinkStaende(einladungen: any[]) {
  const ids = new Set(einladungen.map((e: any) => e.id));
  const out = new Map<string, any>();
  if (!ids.size) return out;
  const { data: mails } = await db.from("kc_communication_requests")
    .select("id,created_at,sent_at,status,variables,correlation_id,audit_meta")
    .eq("source_program", "kc-besuche").eq("channel", "email")
    .gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString())
    .order("created_at", { ascending: false }).limit(1000);
  for (const m of mails ?? []) {
    if (m.status !== "sent" || !["termin_einladung", "termin_info_mitglied"].includes(m.audit_meta?.eventKey)) continue;
    const x = /^termin-mitglied:([0-9a-f-]{36}):/.exec(String(m.correlation_id || ""));
    const eid = x?.[1];
    if (!eid || !ids.has(eid) || out.has(eid)) continue;
    const token = tokenAusTerminLink(m.variables?.url);
    const e = einladungen.find((z: any) => z.id === eid);
    const aktuell = !!token && (await sha256(token)) === e?.token_hash;
    out.set(eid, {
      mail_link_status: aktuell ? "aktuell" : token ? "veraltet" : "kein_link",
      mail_link_gesendet_am: m.sent_at || m.created_at,
      mail_link_request_id: m.id,
    });
  }
  return out;
}
async function uebersicht() {
  const seit = new Date(Date.now() - 14 * 86400000).toISOString();
  const [{ data: slots }, { data: einl }, { data: prot }, { data: kal }, { data: leute }] = await Promise.all([
    db.from("kc_termin_slot_stand").select("*").gte("beginn", seit).order("beginn"),
    db.from("kc_termin_einladungen").select("id,person_ids,status,gueltig_bis,nachricht,bemerkung,ist_test,erstellt_am,gesendet_am,geoeffnet_am,beantwortet_am,token_hash")
      .or(`status.in.(offen,gewaehlt,gegenvorschlag),erstellt_am.gte."${new Date(Date.now() - 60 * 86400000).toISOString()}"`)
      .order("erstellt_am", { ascending: false }).limit(200),
    db.from("kc_termin_protokoll").select("*").order("zeit", { ascending: false }).limit(80),
    db.from("kc_termin_kalender_status").select("schluessel_erstellt_am,letzter_abruf,letzte_meldung,letzter_fehler").eq("id", 1).maybeSingle(),
    db.from("kc_core_people").select("person_id,display_name,given_name,family_name,email,street,postal_code,city").eq("active", true).order("display_name"),
  ]);
  const eIds = (einl ?? []).map((e: any) => e.id);
  const [{ data: buch }, { data: vor }] = await Promise.all([
    eIds.length ? db.from("kc_termin_buchungen").select("*").in("einladung_id", eIds).order("erstellt_am", { ascending: false }) : Promise.resolve({ data: [] as any[] }),
    eIds.length ? db.from("kc_termin_vorschlaege").select("*").in("einladung_id", eIds).order("beginn") : Promise.resolve({ data: [] as any[] }),
  ]);
  // Buchungen zu Terminen, deren Einladung schon älter ist, trotzdem zeigen
  const sIds = (slots ?? []).map((s: any) => s.id);
  const { data: buchSlots } = sIds.length ? await db.from("kc_termin_buchungen").select("*").in("slot_id", sIds) : { data: [] as any[] };
  const alleBuch = new Map([...(buch ?? []), ...(buchSlots ?? [])].map((b: any) => [b.id, b]));
  const fehlendeE = [...alleBuch.values()].map((b: any) => b.einladung_id).filter((id) => !eIds.includes(id));
  const { data: einl2 } = fehlendeE.length
    ? await db.from("kc_termin_einladungen").select("id,person_ids,status,gueltig_bis,nachricht,bemerkung,ist_test,erstellt_am,gesendet_am,geoeffnet_am,beantwortet_am,token_hash").in("id", fehlendeE)
    : { data: [] as any[] };
  const offenKal = await kalenderEintraege().then((x) => x.length).catch(() => null);
  const alleEinlIntern = [...(einl ?? []), ...(einl2 ?? [])];
  const mailStaende = await mailLinkStaende(alleEinlIntern);
  const sichereEinl = alleEinlIntern.map((e: any) => {
    const { token_hash: _tokenHash, ...safe } = e;
    return { ...safe, ...(mailStaende.get(e.id) ?? { mail_link_status: "keine_mail", mail_link_gesendet_am: null, mail_link_request_id: null }) };
  });
  return {
    jetzt: jetzt(),
    slots: slots ?? [], einladungen: sichereEinl, buchungen: [...alleBuch.values()], vorschlaege: vor ?? [],
    protokoll: prot ?? [],
    mitglieder: (leute ?? []).map((p: any) => ({ person_id: p.person_id, display_name: p.display_name, given_name: p.given_name, family_name: p.family_name, hat_email: !!p.email, adresse: adresse(p), test: p.person_id.startsWith("KC-P-TEST") })),
    kalender: { ...(kal ?? {}), verbunden: !!kal?.schluessel_erstellt_am, offen: offenKal },
    frist_tage: FRIST_TAGE,
  };
}

// ---------- Chronologie je Einladung / Person ----------
function sichereProtDetails(d: any) {
  if (!d || typeof d !== "object") return {};
  const erlaubt = ["namen","wann","vorschlaege","bemerkung","versand","anlass","vorher","neue_frist","frist","grund","hinweis","test"];
  return Object.fromEntries(erlaubt.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));
}
async function chronologie(einladungId: string) {
  const { data: e } = await db.from("kc_termin_einladungen")
    .select("id,person_ids,status,erstellt_am,gesendet_am,geoeffnet_am,beantwortet_am,gueltig_bis")
    .eq("id", einladungId).maybeSingle();
  if (!e) throw new Fehler("Einladung nicht gefunden.", 404);
  const leute = await personen(e.person_ids);
  const { data: buch } = await db.from("kc_termin_buchungen")
    .select("id,slot_id,status,erstellt_am,entschieden_am,bestaetigung_gesendet_am,erinnerung_gesendet_am")
    .eq("einladung_id", e.id).order("erstellt_am");
  const buchIds = (buch ?? []).map((b: any) => b.id);
  const { data: prot } = await db.from("kc_termin_protokoll").select("*").eq("einladung_id", e.id).order("zeit");

  const seit = new Date(new Date(e.erstellt_am).getTime() - 86400000).toISOString();
  const { data: alleReq } = await db.from("kc_communication_requests")
    .select("id,channel,status,provider_id,error_code,error_message,created_at,sent_at,correlation_id,audit_meta,variables")
    .eq("source_program", "kc-besuche").gte("created_at", seit)
    .order("created_at").limit(2000);

  const relevant = (alleReq ?? []).filter((r: any) => {
    const c = String(r.correlation_id || "");
    if (c.startsWith(`termin-mitglied:${e.id}:`)) return true;
    return buchIds.some((id: string) =>
      c.startsWith(`termin-bestaetigung:${id}:`) ||
      c === `termin-erinnerung:${id}` || c.startsWith(`termin-erinnerung:${id}:`) ||
      c === `termin-absage:${id}` || c.startsWith(`termin-absage:${id}:`)
    );
  });
  const reqIds = relevant.map((r: any) => r.id);
  const { data: delivery } = reqIds.length
    ? await db.from("kc_communication_delivery_events").select("id,request_id,event_type,provider,detail,created_at").in("request_id", reqIds).order("created_at")
    : { data: [] as any[] };

  const pName = new Map(leute.map((p: any) => [p.person_id, p.display_name || [p.given_name,p.family_name].filter(Boolean).join(" ") || p.person_id]));
  const reqById = new Map(relevant.map((r: any) => [r.id, r]));
  const ereignisse: any[] = [];

  for (const p of prot ?? []) {
    ereignisse.push({
      typ: "aktion", zeit: p.zeit, wer: p.wer, aktion: p.aktion,
      details: sichereProtDetails(p.details), slot_id: p.slot_id || null, buchung_id: p.buchung_id || null,
    });
  }
  for (const r of relevant) {
    const pid = r.audit_meta?.personId;
    const person = pName.get(pid) || (leute.length === 1 ? namenKurz(leute) : "Mitglied");
    ereignisse.push({
      typ: "versand", zeit: r.sent_at || r.created_at, channel: r.channel, status: r.status,
      event_key: r.audit_meta?.eventKey || "", person,
      betreff: r.variables?.subject || r.variables?.betreff || r.variables?.title || "",
      provider: r.provider_id || "", fehler: r.error_message || r.error_code || "",
    });
  }
  for (const d of delivery ?? []) {
    if (["processing","sent"].includes(d.event_type)) continue;
    const r: any = reqById.get(d.request_id);
    if (!r) continue;
    const pid = r.audit_meta?.personId;
    const person = pName.get(pid) || (leute.length === 1 ? namenKurz(leute) : "Mitglied");
    const detailText = d.event_type === "opened" ? "Der Mail-Provider hat ein Öffnungsereignis gemeldet."
      : d.event_type === "displayed" ? "Das Push-System hat die Anzeige auf einem Gerät gemeldet."
      : d.event_type === "delivered" ? "Der Provider hat die Zustellung bestätigt."
      : d.detail?.reason ? String(d.detail.reason).slice(0,300)
      : d.detail?.error ? String(d.detail.error).slice(0,300) : "";
    ereignisse.push({
      typ: "zustellung", zeit: d.created_at, channel: r.channel, event_type: d.event_type,
      person, provider: d.provider || r.provider_id || "", detail_text: detailText,
    });
  }
  ereignisse.sort((a, b) => new Date(a.zeit).getTime() - new Date(b.zeit).getTime());
  return { namen: namenKurz(leute), status: e.status, ereignisse };
}

// ---------- Mitgliederseite ----------
async function einladungZuToken(t: unknown) {
  if (typeof t !== "string" || !/^[0-9a-f]{32,64}$/.test(t)) throw new Fehler("Dieser Link ist ungültig.", 404, { grund: "link" });
  const { data } = await db.from("kc_termin_einladungen").select("*").eq("token_hash", await sha256(t)).maybeSingle();
  if (!data) throw new Fehler("Dieser Link ist nicht mehr gültig. Bitte nimm den Link aus der neuesten Mail.", 404, { grund: "link" });
  return data;
}
async function mitgliedStand(e: any) {
  const leute = await personen(e.person_ids);
  const abgelaufen = e.status === "offen" && new Date(e.gueltig_bis) < new Date();
  const { data: b } = await db.from("kc_termin_buchungen").select("*, slot:kc_termin_slots(beginn,ende,status)")
    .eq("einladung_id", e.id).in("status", AKTIV).maybeSingle();
  const { data: v } = await db.from("kc_termin_vorschlaege").select("beginn,ende,besuchsart,status").eq("einladung_id", e.id).eq("status", "offen").order("beginn");
  const status = abgelaufen ? "abgelaufen" : e.status;
  return {
    namen: leute.map(vorname), anzahl: leute.length, status, gueltig_bis: e.gueltig_bis,
    frist_offen: new Date(e.gueltig_bis) > new Date(),
    frei: status === "offen" ? await freieTermine(leute.length, e.ist_test) : [],
    buchung: b ? { beginn: b.slot.beginn, ende: b.slot.ende, besuchsart: b.besuchsart, status: b.status,
      ort: b.status === "bestaetigt" ? await ortFuer(b.besuchsart, leute) : null } : null,
    vorschlaege: v ?? [], bemerkung: e.bemerkung || "",
  };
}

// ---------- Hauptprogramm ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST erwartet" }, 405);
  let p: any;
  try { p = await req.json(); } catch { return json({ error: "Ungültige Anfrage" }, 400); }
  const a = String(p?.action || "");

  try {
    // ----- Zeitplaner -----
    if (a === "wartung") {
      const { data: geheim } = await db.rpc("kc_communication_get_server_secret", { p_name: "kc_termine_cron_secret" });
      if (!geheim || p.cronSecret !== geheim) return json({ error: "Kein Zugang" }, 401);
      return json({ ok: true, abgelaufen: await ablaufPruefen(), erinnerungen: await erinnerungen() });
    }

    // ----- Google-Skript -----
    if (a === "kalender_abgleich" || a === "kalender_gemeldet") {
      const key = req.headers.get("x-kalender-key") ?? "";
      const { data: ks } = await db.from("kc_termin_kalender_status").select("key_sha256").eq("id", 1).maybeSingle();
      if (!key || !ks?.key_sha256 || (await sha256(key)) !== ks.key_sha256) return json({ error: "Kein Zugang" }, 401);
      if (a === "kalender_abgleich") {
        await db.from("kc_termin_kalender_status").update({ letzter_abruf: jetzt() }).eq("id", 1);
        return json({ eintraege: (await kalenderEintraege()).slice(0, 40) });
      }
      const erg = Array.isArray(p.ergebnisse) ? p.ergebnisse.slice(0, 100) : [];
      const fehler: string[] = [];
      for (const r of erg) {
        if (typeof r?.uid !== "string" || !/^(slot|vorschlag)-[0-9a-f-]{36}$/.test(r.uid)) continue;
        if (r.fehler) { fehler.push(`${r.uid}: ${String(r.fehler).slice(0, 200)}`); await db.from("kc_termin_kalender").upsert({ uid: r.uid, fehler: String(r.fehler).slice(0, 500) }); continue; }
        await db.from("kc_termin_kalender").upsert({ uid: r.uid, google_event_id: r.event_id || null, stand_hash: String(r.hash || ""), synchronisiert_am: jetzt(), fehler: null });
      }
      await db.from("kc_termin_kalender_status").update({ letzte_meldung: jetzt(), letzter_fehler: fehler.join("; ") || null }).eq("id", 1);
      if (erg.length) await log("kalender", "google_abgeglichen", {}, { eintraege: erg.length, fehler: fehler.length });
      return json({ ok: true });
    }

    // ----- Mitglied (persönlicher Link) -----
    if (a.startsWith("m_")) {
      const e = await einladungZuToken(p.t);
      const leute = await personen(e.person_ids), wer = namenKurz(leute);
      const fristOffen = new Date(e.gueltig_bis) > new Date();
      switch (a) {
        case "m_laden": {
          // Nur die echte Mitgliederseite darf einen Link als geöffnet markieren.
          // Direkte API-/Technikprüfungen lesen den Stand, verändern aber geoeffnet_am nicht.
          const echteSeite = p.client === "termin_html" && p.page_open === true;
          if (echteSeite && !e.geoeffnet_am) {
            await db.from("kc_termin_einladungen").update({ geoeffnet_am: jetzt() }).eq("id", e.id);
            await log("mitglied", "link_geoeffnet", { einladung_id: e.id }, { quelle: "termin_html" });
          }
          return json(await mitgliedStand(e));
        }
        case "m_waehlen": {
          const { data: r, error } = await db.rpc("kc_termin_waehlen", { p_einladung: e.id, p_slot: String(p.slot_id || ""), p_art: String(p.besuchsart || "") });
          if (error) throw new Fehler(error.message, 500);
          if (!r?.ok) {
            const text: Record<string, string> = {
              voll: "Dieser Termin ist leider gerade vergeben. Bitte wähle einen anderen.",
              nicht_verfuegbar: "Dieser Termin ist nicht mehr verfügbar. Bitte wähle einen anderen.",
              abgelaufen: "Die Antwortfrist ist leider abgelaufen. Bitte melde dich direkt bei Hansi.",
              schon_beantwortet: "Du hast schon geantwortet.",
              ort_fehlt: "Bitte wähle, wo ihr euch treffen wollt.",
            };
            const aktuell = (await db.from("kc_termin_einladungen").select("*").eq("id", e.id).single()).data ?? e;
            return json({ error: text[r?.grund] || "Das hat nicht geklappt.", grund: r?.grund, stand: await mitgliedStand(aktuell) }, 409);
          }
          const { data: s } = await db.from("kc_termin_slots").select("*").eq("id", p.slot_id).single();
          const v = await meldeHansi(`${wer} hat einen Termin gewählt`,
            `${wer} hat einen Termin gewählt:\n\n📅 ${wann(s.beginn, s.ende, true)}\n📍 ${artKurz(r.besuchsart)}\n\nDer Termin ist für ${leute.length > 1 ? "sie" : wer} vorgemerkt. Bitte in der App bestätigen – erst dann bekommt ${leute.length > 1 ? "die Gruppe" : wer} die Bestätigungsmail.`,
            `${wer} hat ${wann(s.beginn, s.ende)} gewählt (${artKurz(r.besuchsart)}) – bitte freigeben.`, e.ist_test);
          await log("system", "hansi_benachrichtigt", { einladung_id: e.id, slot_id: s.id, buchung_id: r.buchung_id }, { anlass: "termin_gewaehlt", versand: versandText(v) });
          const neu = (await db.from("kc_termin_einladungen").select("*").eq("id", e.id).single()).data;
          return json(await mitgliedStand(neu));
        }
        case "m_gegenvorschlag": {
          if (e.status !== "offen" || !fristOffen) throw new Fehler(fristOffen ? "Du hast schon geantwortet." : "Die Antwortfrist ist leider abgelaufen. Bitte melde dich direkt bei Hansi.", 409);
          const liste = (Array.isArray(p.vorschlaege) ? p.vorschlaege : []).filter((x: any) => x?.datum && x?.von).slice(0, 2);
          if (!liste.length) throw new Fehler("Bitte mindestens einen Vorschlag mit Datum und Uhrzeit eintragen.");
          const zeilen = [];
          for (const x of liste) {
            const beginn = berlin(x.datum, x.von);
            const ende = x.bis ? berlin(x.datum, x.bis) : new Date(beginn.getTime() + 90 * 60000);
            if (beginn <= new Date()) throw new Fehler("Der Vorschlag liegt in der Vergangenheit.");
            if (ende <= beginn) throw new Fehler("„Bis“ muss nach „Von“ liegen.");
            const art = ["bei_hansi", "beim_mitglied"].includes(x.besuchsart) ? x.besuchsart : "egal";
            zeilen.push({ einladung_id: e.id, beginn: beginn.toISOString(), ende: ende.toISOString(), besuchsart: art });
          }
          const bem = String(p.bemerkung || "").trim().slice(0, 500) || null;
          const { data: ok } = await db.from("kc_termin_einladungen").update({ status: "gegenvorschlag", bemerkung: bem, beantwortet_am: jetzt(), geaendert_am: jetzt() })
            .eq("id", e.id).eq("status", "offen").select("id");
          if (!ok?.length) throw new Fehler("Du hast schon geantwortet.", 409);
          await db.from("kc_termin_vorschlaege").insert(zeilen);
          await log("mitglied", "gegenvorschlag", { einladung_id: e.id }, { vorschlaege: zeilen.map((z) => wann(z.beginn, z.ende) + " (" + artKurz(z.besuchsart) + ")"), bemerkung: bem });
          const v = await meldeHansi(`${wer}: kein Termin passt – Gegenvorschlag`,
            `${wer} hat keinen passenden Termin gefunden und schlägt vor:\n\n${zeilen.map((z) => `• ${wann(z.beginn, z.ende, true)} (${artKurz(z.besuchsart)})`).join("\n")}${bem ? `\n\nBemerkung: ${bem}` : ""}\n\nIn der App kannst du einen Vorschlag annehmen oder neue Termine anbieten.`,
            `${wer} schlägt vor: ${zeilen.map((z) => wann(z.beginn, z.ende)).join(" oder ")}`, e.ist_test);
          await log("system", "hansi_benachrichtigt", { einladung_id: e.id }, { anlass: "gegenvorschlag", versand: versandText(v) });
          return json(await mitgliedStand((await db.from("kc_termin_einladungen").select("*").eq("id", e.id).single()).data));
        }
        case "m_absagen": {
          if (!["offen", "gewaehlt", "gegenvorschlag", "abgelaufen"].includes(e.status)) throw new Fehler("Das geht jetzt nicht mehr – bitte melde dich direkt bei Hansi.", 409);
          const bem = String(p.bemerkung || "").trim().slice(0, 500) || null;
          await db.from("kc_termin_buchungen").update({ status: "storniert", entschieden_am: jetzt() }).eq("einladung_id", e.id).eq("status", "vorgemerkt");
          await db.from("kc_termin_vorschlaege").update({ status: "zurueckgezogen" }).eq("einladung_id", e.id).eq("status", "offen");
          await db.from("kc_termin_einladungen").update({ status: "abgesagt", bemerkung: bem, beantwortet_am: jetzt(), geaendert_am: jetzt() }).eq("id", e.id);
          await log("mitglied", "abgesagt", { einladung_id: e.id }, { bemerkung: bem });
          const v = await meldeHansi(`${wer} möchte zurzeit keinen Termin`,
            `${wer} hat angekreuzt, dass zurzeit kein Besuch gewünscht ist.${bem ? `\n\nBemerkung: ${bem}` : ""}`,
            `${wer} möchte zurzeit keinen Termin.`, e.ist_test);
          await log("system", "hansi_benachrichtigt", { einladung_id: e.id }, { anlass: "abgesagt", versand: versandText(v) });
          return json(await mitgliedStand({ ...e, status: "abgesagt", bemerkung: bem }));
        }
        case "m_aendern": {
          if (!["gewaehlt", "gegenvorschlag"].includes(e.status) || !fristOffen) throw new Fehler("Das geht jetzt nicht mehr – bitte melde dich direkt bei Hansi.", 409);
          await db.from("kc_termin_buchungen").update({ status: "storniert", entschieden_am: jetzt() }).eq("einladung_id", e.id).eq("status", "vorgemerkt");
          await db.from("kc_termin_vorschlaege").update({ status: "zurueckgezogen" }).eq("einladung_id", e.id).eq("status", "offen");
          await db.from("kc_termin_einladungen").update({ status: "offen", geaendert_am: jetzt() }).eq("id", e.id);
          await log("mitglied", "antwort_zurueckgenommen", { einladung_id: e.id }, { vorher: e.status });
          const v = await meldeHansi(`${wer} wählt neu`, `${wer} hat die bisherige Antwort zurückgenommen und wählt neu. Du bekommst eine Nachricht, sobald die neue Wahl da ist.`,
            `${wer} hat die Antwort zurückgenommen und wählt neu.`, e.ist_test);
          await log("system", "hansi_benachrichtigt", { einladung_id: e.id }, { anlass: "antwort_zurueckgenommen", versand: versandText(v) });
          return json(await mitgliedStand({ ...e, status: "offen" }));
        }
        default: return json({ error: "Unbekannte Aktion" }, 400);
      }
    }

    // ----- Hansi (App / interner Admin-Aufruf) -----
    const key = req.headers.get("x-key") ?? "";
    const internKey = req.headers.get("x-kc-termine-admin-token") ?? "";
    const { data: zug } = await db.from("kc_besuche_zugang").select("key_sha256");
    const h = key ? await sha256(key) : "";
    // Prüfschlüssel (nur für Funktionstests, liegt befristet im Vault): erzwingt Testmodus, verschickt nie etwas
    const { data: pruef } = await db.rpc("kc_communication_get_server_secret", { p_name: "kc_termine_pruefschluessel_sha256" });
    const { data: intern } = await db.rpc("kc_communication_get_server_secret", { p_name: "kc_termine_admin_token" });
    const istPruefung = !!key && !!pruef && pruef === h;
    const istIntern = !!internKey && !!intern && internKey === intern;
    if (!istIntern && (!key || !((zug ?? []).some((z: any) => z.key_sha256 === h) || istPruefung))) return json({ error: "Kein Zugang" }, 401);
    if (istPruefung) p.test = true;

    switch (a) {
      case "t_init": {
        await ablaufPruefen();
        return json(await uebersicht());
      }

      case "t_chronologie": {
        const id = String(p.einladung_id || "");
        if (!/^[0-9a-f-]{36}$/.test(id)) throw new Fehler("Einladung nicht gefunden.", 404);
        return json(await chronologie(id));
      }

      case "t_slots_anlegen": {
        const liste = Array.isArray(p.slots) ? p.slots.slice(0, 20) : [];
        if (!liste.length) throw new Fehler("Kein Termin angegeben.");
        const zeilen = liste.map((x: any) => {
          const beginn = berlin(x.datum, x.von), ende = berlin(x.datum, x.bis);
          if (ende <= beginn) throw new Fehler("„Bis“ muss nach „Von“ liegen.");
          if (beginn <= new Date()) throw new Fehler("Der Termin liegt in der Vergangenheit.");
          if (!["bei_hansi", "beim_mitglied", "wahl"].includes(x.besuchsart)) throw new Fehler("Bitte wählen, wo das Treffen ist.");
          const plaetze = Math.min(3, Math.max(1, Number(x.plaetze) || 3));
          return { beginn: beginn.toISOString(), ende: ende.toISOString(), besuchsart: x.besuchsart, plaetze, notiz: String(x.notiz || "").trim().slice(0, 300) || null, ist_test: p.test === true };
        });
        const { data, error } = await db.from("kc_termin_slots").insert(zeilen).select();
        if (error) throw new Fehler(error.message, 500);
        for (const s of data ?? []) await log("hansi", "termin_angeboten", { slot_id: s.id }, { wann: wann(s.beginn, s.ende), besuchsart: s.besuchsart, plaetze: s.plaetze, test: s.ist_test || undefined });
        return json({ ok: true, slots: data });
      }

      case "t_slot_absagen": {
        const { data: s } = await db.from("kc_termin_slots").select("*").eq("id", p.slot_id).maybeSingle();
        if (!s) throw new Fehler("Termin nicht gefunden.", 404);
        if (s.status === "abgesagt") throw new Fehler("Der Termin ist schon abgesagt.");
        const { data: bs } = await db.from("kc_termin_buchungen").select("*, einladung:kc_termin_einladungen(*)").eq("slot_id", s.id).in("status", AKTIV);
        await db.from("kc_termin_slots").update({ status: "abgesagt", geaendert_am: jetzt() }).eq("id", s.id);
        const nachricht = String(p.nachricht || "").trim().slice(0, 500);
        const ergebnis: string[] = [];
        for (const b of bs ?? []) {
          await db.from("kc_termin_buchungen").update({ status: "storniert", entschieden_am: jetzt() }).eq("id", b.id);
          await besuchEntfernen(b.besuch_id);
          const { link, gueltig } = await neuOeffnen(b.einladung_id);
          const leute = await personen(b.einladung.person_ids);
          const v = await einladungSenden(b.einladung, leute, link, gueltig, "ausfall", nachricht);
          ergebnis.push(versandText(v));
          await log("hansi", "buchung_storniert_termin_abgesagt", { einladung_id: b.einladung_id, slot_id: s.id, buchung_id: b.id }, { namen: namenKurz(leute), versand: versandText(v) });
        }
        await log("hansi", "termin_abgesagt", { slot_id: s.id }, { wann: wann(s.beginn, s.ende), betroffen: (bs ?? []).length, nachricht: nachricht || undefined });
        return json({ ok: true, betroffen: (bs ?? []).length, versand: ergebnis });
      }

      case "t_slot_loeschen": {
        const { count } = await db.from("kc_termin_buchungen").select("id", { count: "exact", head: true }).eq("slot_id", p.slot_id);
        if (count) throw new Fehler("Für diesen Termin gab es schon Buchungen – bitte „Absagen“ nehmen, damit nichts verloren geht.");
        const { data: s } = await db.from("kc_termin_slots").delete().eq("id", p.slot_id).select().maybeSingle();
        if (!s) throw new Fehler("Termin nicht gefunden.", 404);
        await log("hansi", "termin_geloescht", { slot_id: s.id }, { wann: wann(s.beginn, s.ende) });
        return json({ ok: true });
      }

      case "t_einladen": {
        const gruppen: string[][] = (Array.isArray(p.gruppen) ? p.gruppen : []).slice(0, 40)
          .map((g: any) => [...new Set((Array.isArray(g) ? g : []).map(String))]).filter((g: string[]) => g.length);
        if (!gruppen.length) throw new Fehler("Bitte Mitglieder auswählen.");
        if (gruppen.some((g) => g.length > 3)) throw new Fehler("Höchstens 3 Personen pro Termin.");
        const { data: aktiv } = await db.from("kc_termin_einladungen").select("person_ids").in("status", ["offen", "gewaehlt", "gegenvorschlag"]).gt("gueltig_bis", jetzt());
        const belegt = new Set((aktiv ?? []).flatMap((e: any) => e.person_ids));
        const ergebnisse = [];
        for (const g of gruppen) {
          const leute = await personen(g);
          if (leute.length !== g.length) { ergebnisse.push({ namen: g.join(", "), fehler: "Mitglied nicht gefunden" }); continue; }
          const doppelt = leute.filter((l) => belegt.has(l.person_id));
          if (doppelt.length) { ergebnisse.push({ namen: namenKurz(leute), fehler: `${aufzaehlen(doppelt.map(vorname))} hat schon eine offene Einladung` }); continue; }
          const token = zufall(), gueltig = inTagen(FRIST_TAGE);
          const { data: e, error } = await db.from("kc_termin_einladungen").insert({
            person_ids: g, token_hash: await sha256(token), gueltig_bis: gueltig,
            nachricht: String(p.nachricht || "").trim().slice(0, 1000) || null, ist_test: p.test === true,
          }).select().single();
          if (error) { ergebnisse.push({ namen: namenKurz(leute), fehler: error.message }); continue; }
          const link = `${MITGLIED_SEITE}?t=${token}`;
          const v = await einladungSenden(e, leute, link, gueltig, "neu");
          await db.from("kc_termin_einladungen").update({ gesendet_am: jetzt() }).eq("id", e.id);
          await log("hansi", "eingeladen", { einladung_id: e.id }, { namen: namenKurz(leute), frist: gueltig, versand: versandText(v), test: e.ist_test || undefined });
          g.forEach((id) => belegt.add(id));
          ergebnisse.push({ einladung_id: e.id, namen: namenKurz(leute), link, versand: v, mail: v.some((x) => x.mail) });
        }
        const frei = await freieTermine(1, p.test === true);
        return json({ ok: true, ergebnisse, freie_termine: frei.length });
      }

      case "t_buchung_entscheiden": {
        const { data: b } = await db.from("kc_termin_buchungen").select("*, slot:kc_termin_slots(*), einladung:kc_termin_einladungen(*)").eq("id", p.buchung_id).maybeSingle();
        if (!b) throw new Fehler("Buchung nicht gefunden.", 404);
        if (b.status !== "vorgemerkt") throw new Fehler("Das Mitglied hat die Wahl inzwischen geändert – bitte neu laden.", 409);
        const leute = await personen(b.einladung.person_ids);
        if (p.entscheidung === "bestaetigen") {
          const { data: ok } = await db.from("kc_termin_buchungen").update({ status: "bestaetigt", entschieden_am: jetzt() }).eq("id", b.id).eq("status", "vorgemerkt").select("id");
          if (!ok?.length) throw new Fehler("Das Mitglied hat die Wahl inzwischen geändert – bitte neu laden.", 409);
          await db.from("kc_termin_einladungen").update({ status: "bestaetigt", geaendert_am: jetzt() }).eq("id", b.einladung_id);
          const v = await bestaetigungSenden(b.einladung, leute, b.slot, b);
          if (v.some((x) => x.mail)) await db.from("kc_termin_buchungen").update({ bestaetigung_gesendet_am: jetzt() }).eq("id", b.id);
          const besuchId = await besuchZumTermin(b.id, b.einladung, leute, b.slot, b.besuchsart);
          await log("hansi", "buchung_bestaetigt", { einladung_id: b.einladung_id, slot_id: b.slot_id, buchung_id: b.id }, { namen: namenKurz(leute), wann: wann(b.slot.beginn, b.slot.ende), versand: versandText(v), besuch: besuchId || undefined });
          return json({ ok: true, versand: v });
        }
        if (p.entscheidung === "ablehnen") {
          await db.from("kc_termin_buchungen").update({ status: "abgelehnt", entschieden_am: jetzt() }).eq("id", b.id);
          const { link, gueltig } = await neuOeffnen(b.einladung_id);
          const v = await einladungSenden(b.einladung, leute, link, gueltig, "abgelehnt", String(p.nachricht || "").trim().slice(0, 500));
          await log("hansi", "buchung_abgelehnt", { einladung_id: b.einladung_id, slot_id: b.slot_id, buchung_id: b.id }, { namen: namenKurz(leute), versand: versandText(v), neue_frist: gueltig });
          return json({ ok: true, versand: v, link });
        }
        throw new Fehler("Unbekannte Entscheidung.");
      }

      case "t_vorschlag_entscheiden": {
        const { data: e } = await db.from("kc_termin_einladungen").select("*").eq("id", p.einladung_id).maybeSingle();
        if (!e) throw new Fehler("Einladung nicht gefunden.", 404);
        if (e.status !== "gegenvorschlag") throw new Fehler("Das Mitglied hat inzwischen anders geantwortet – bitte neu laden.", 409);
        const leute = await personen(e.person_ids);
        if (p.aktion === "annehmen") {
          const { data: v } = await db.from("kc_termin_vorschlaege").select("*").eq("id", p.vorschlag_id).eq("einladung_id", e.id).eq("status", "offen").maybeSingle();
          if (!v) throw new Fehler("Vorschlag nicht gefunden.", 404);
          const art = v.besuchsart === "egal" ? p.besuchsart : v.besuchsart;
          if (!["bei_hansi", "beim_mitglied"].includes(art)) throw new Fehler("Bitte wählen, wo das Treffen ist.");
          const { data: s, error } = await db.from("kc_termin_slots").insert({
            beginn: v.beginn, ende: v.ende, besuchsart: art, plaetze: leute.length, herkunft: "gegenvorschlag", ist_test: e.ist_test,
          }).select().single();
          if (error) throw new Fehler(error.message, 500);
          const { data: b, error: be } = await db.from("kc_termin_buchungen").insert({
            slot_id: s.id, einladung_id: e.id, personen: leute.length, besuchsart: art, status: "bestaetigt", entschieden_am: jetzt(),
          }).select().single();
          if (be) throw new Fehler(be.message, 500);
          await db.from("kc_termin_vorschlaege").update({ status: "angenommen" }).eq("id", v.id);
          await db.from("kc_termin_vorschlaege").update({ status: "abgelehnt" }).eq("einladung_id", e.id).eq("status", "offen");
          await db.from("kc_termin_einladungen").update({ status: "bestaetigt", geaendert_am: jetzt() }).eq("id", e.id);
          const vs = await bestaetigungSenden(e, leute, s, b);
          if (vs.some((x) => x.mail)) await db.from("kc_termin_buchungen").update({ bestaetigung_gesendet_am: jetzt() }).eq("id", b.id);
          const besuchId = await besuchZumTermin(b.id, e, leute, s, art);
          await log("hansi", "gegenvorschlag_angenommen", { einladung_id: e.id, slot_id: s.id, buchung_id: b.id }, { namen: namenKurz(leute), wann: wann(s.beginn, s.ende), versand: versandText(vs), besuch: besuchId || undefined });
          return json({ ok: true, versand: vs });
        }
        if (p.aktion === "neue_termine") {
          await db.from("kc_termin_vorschlaege").update({ status: "abgelehnt" }).eq("einladung_id", e.id).eq("status", "offen");
          const { link, gueltig } = await neuOeffnen(e.id);
          const v = await einladungSenden(e, leute, link, gueltig, "neue_termine", String(p.nachricht || "").trim().slice(0, 500));
          await log("hansi", "neue_termine_angeboten", { einladung_id: e.id }, { namen: namenKurz(leute), versand: versandText(v), neue_frist: gueltig });
          return json({ ok: true, versand: v, link });
        }
        throw new Fehler("Unbekannte Aktion.");
      }

      case "t_erneut_einladen": {
        const { data: e } = await db.from("kc_termin_einladungen").select("*").eq("id", p.einladung_id).maybeSingle();
        if (!e) throw new Fehler("Einladung nicht gefunden.", 404);
        if (!["offen", "abgelaufen", "abgesagt"].includes(e.status)) throw new Fehler("Diese Einladung ist gerade nicht offen.");
        const leute = await personen(e.person_ids);
        const { link, gueltig } = await neuOeffnen(e.id);
        const v = await einladungSenden({ ...e, nachricht: String(p.nachricht || "").trim() || null }, leute, link, gueltig, "erneut", String(p.nachricht || "").trim().slice(0, 500));
        await db.from("kc_termin_einladungen").update({ gesendet_am: jetzt() }).eq("id", e.id);
        await log("hansi", "erneut_eingeladen", { einladung_id: e.id }, { namen: namenKurz(leute), versand: versandText(v), neue_frist: gueltig });
        return json({ ok: true, versand: v, link });
      }

      case "t_link": {
        const { data: e } = await db.from("kc_termin_einladungen").select("*").eq("id", p.einladung_id).maybeSingle();
        if (!e) throw new Fehler("Einladung nicht gefunden.", 404);
        if (e.status === "zurueckgezogen") throw new Fehler("Diese Einladung ist zurückgezogen.");
        // Neuer Link: alter Link wird ungültig, der Öffnungsstatus gehört ab jetzt wieder zum neuen Link.
        const token = zufall(), link = `${MITGLIED_SEITE}?t=${token}`;
        await db.from("kc_termin_einladungen").update({
          token_hash: await sha256(token), geoeffnet_am: null, geaendert_am: jetzt(),
        }).eq("id", e.id);
        const leute = await personen(e.person_ids);
        const v = leute.some((l) => !!l.email) ? await linkUpdateSenden(e, leute, link) : [];
        await log("hansi", "link_erneuert", { einladung_id: e.id }, {
          namen: namenKurz(leute), automatisch_gesendet: v.some((x) => x.mail), versand: versandText(v) || undefined,
        });
        return json({ ok: true, link, versand: v, mail_gesendet: v.some((x) => x.mail) });
      }

      case "t_zurueckziehen": {
        const { data: e } = await db.from("kc_termin_einladungen").select("*").eq("id", p.einladung_id).maybeSingle();
        if (!e) throw new Fehler("Einladung nicht gefunden.", 404);
        const { data: bs } = await db.from("kc_termin_buchungen").select("*, slot:kc_termin_slots(*)").eq("einladung_id", e.id).in("status", AKTIV);
        await db.from("kc_termin_buchungen").update({ status: "storniert", entschieden_am: jetzt() }).eq("einladung_id", e.id).in("status", AKTIV);
        for (const b of bs ?? []) await besuchEntfernen(b.besuch_id);
        await db.from("kc_termin_vorschlaege").update({ status: "zurueckgezogen" }).eq("einladung_id", e.id).eq("status", "offen");
        await db.from("kc_termin_einladungen").update({ status: "zurueckgezogen", geaendert_am: jetzt() }).eq("id", e.id);
        const leute = await personen(e.person_ids);
        let versand = "";
        const bestaetigt = (bs ?? []).find((b: any) => b.status === "bestaetigt");
        if (bestaetigt && p.benachrichtigen !== false) {
          const w = sprache(leute.length);
          const v = await senden("termin_info_mitglied", leute.map((l) => l.person_id), {
            betreff: `Köcheclub Werne – Termin abgesagt: ${wann(bestaetigt.slot.beginn, bestaetigt.slot.ende)}`,
            text: [await anredeZeile(leute), "", `leider muss ich unseren Termin am ${wann(bestaetigt.slot.beginn, bestaetigt.slot.ende, true)} absagen.`,
              String(p.nachricht || "").trim(), "", `Ich melde mich bei ${w.dir} wegen eines neuen Termins.`, "", "Viele Grüße", "Hansi", "Köcheclub Werne"]
              .filter((z, i, arr) => !(z === "" && arr[i - 1] === "")).join("\n"),
            titel: "Termin abgesagt", kurz: `Hansi muss den Termin ${wann(bestaetigt.slot.beginn, bestaetigt.slot.ende)} leider absagen.`,
          }, `termin-absage:${bestaetigt.id}`, e.ist_test);
          versand = versandText(v);
        }
        await log("hansi", "einladung_zurueckgezogen", { einladung_id: e.id }, { namen: namenKurz(leute), vorher: e.status, versand: versand || undefined });
        return json({ ok: true });
      }

      // Mündlich abgesprochener Termin: geplanter Besuch → bestätigter Termin (+ Push/Mail mit .ics)
      case "t_besuch_termin": {
        const { data: bes } = await db.from("kc_besuche").select("*").eq("besuch_id", p.besuch_id).maybeSingle();
        if (!bes) throw new Fehler("Besuch nicht gefunden.", 404);
        const pids: string[] = bes.person_ids ?? [];
        if (!pids.length) throw new Fehler("Für die Bestätigung bitte oben ein Mitglied auswählen.");
        if (pids.length > 3) throw new Fehler("Höchstens 3 Personen pro Termin.");
        if (!bes.zeit_von) throw new Fehler("Für die Bestätigung bitte die Uhrzeit „Von“ eintragen.");
        const beginn = berlin(bes.datum, String(bes.zeit_von).slice(0, 5));
        const ende = bes.zeit_bis ? berlin(bes.datum, String(bes.zeit_bis).slice(0, 5)) : new Date(beginn.getTime() + 90 * 60000);
        const art = bes.besuchsart === "bei_hansi" ? "bei_hansi" : "beim_mitglied";
        const leute = await personen(pids);
        const { data: alt } = await db.from("kc_termin_buchungen").select("*, slot:kc_termin_slots(*), einladung:kc_termin_einladungen(*)")
          .eq("besuch_id", bes.besuch_id).eq("status", "bestaetigt").maybeSingle();
        let buchung: any, slot: any, einl: any, aktion: string;
        if (alt) {
          const geaendert = new Date(alt.slot.beginn).getTime() !== beginn.getTime() || new Date(alt.slot.ende).getTime() !== ende.getTime() || alt.besuchsart !== art;
          if (geaendert) {
            const { count } = await db.from("kc_termin_buchungen").select("id", { count: "exact", head: true }).eq("slot_id", alt.slot_id).in("status", AKTIV);
            if ((count ?? 0) > 1) throw new Fehler("Zu diesem Termin kommen noch andere Mitglieder – bitte Uhrzeit/Ort im Reiter „Termine“ ändern (Termin absagen und neu anbieten).");
          }
          ({ data: slot } = await db.from("kc_termin_slots").update({ beginn: beginn.toISOString(), ende: ende.toISOString(), besuchsart: art, geaendert_am: jetzt() }).eq("id", alt.slot_id).select().single());
          ({ data: buchung } = await db.from("kc_termin_buchungen").update({ besuchsart: art }).eq("id", alt.id).select().single());
          einl = alt.einladung; aktion = geaendert ? "termin_geaendert" : "termin_unveraendert";
          if (!p.senden) {
            if (geaendert) await log("hansi", aktion, { einladung_id: einl.id, slot_id: slot.id, buchung_id: buchung.id }, { namen: namenKurz(leute), wann: wann(slot.beginn, slot.ende) });
            return json({ ok: true, verknuepft: true, gesendet: false });
          }
        } else {
          if (!p.senden) return json({ ok: true, verknuepft: false, gesendet: false });
          if (beginn <= new Date()) throw new Fehler("Der Termin liegt in der Vergangenheit – eine Bestätigung ist nicht mehr nötig.");
          ({ data: slot } = await db.from("kc_termin_slots").insert({ beginn: beginn.toISOString(), ende: ende.toISOString(), besuchsart: art, plaetze: pids.length, herkunft: "direkt", ist_test: p.test === true }).select().single());
          ({ data: einl } = await db.from("kc_termin_einladungen").insert({ person_ids: pids, token_hash: await sha256(zufall()), gueltig_bis: beginn.toISOString(), status: "bestaetigt", beantwortet_am: jetzt(), ist_test: p.test === true }).select().single());
          const r = await db.from("kc_termin_buchungen").insert({ slot_id: slot.id, einladung_id: einl.id, personen: pids.length, besuchsart: art, status: "bestaetigt", entschieden_am: jetzt(), besuch_id: bes.besuch_id }).select().single();
          if (r.error) throw new Fehler(r.error.message, 500);
          buchung = r.data; aktion = "termin_direkt_bestaetigt";
        }
        const v = await bestaetigungSenden(einl, leute, slot, buchung);
        if (v.some((x) => x.mail)) await db.from("kc_termin_buchungen").update({ bestaetigung_gesendet_am: jetzt() }).eq("id", buchung.id);
        await log("hansi", aktion, { einladung_id: einl.id, slot_id: slot.id, buchung_id: buchung.id }, { namen: namenKurz(leute), wann: wann(slot.beginn, slot.ende), versand: versandText(v), besuch: bes.besuch_id });
        return json({ ok: true, verknuepft: true, gesendet: true, versand: v });
      }

      // Kopie einer schon verschickten Mitglieder-Mail nachträglich an Hansi (z. B. Mails vor Einführung der Kopie)
      case "t_kopie_nachsenden": {
        const { data: r } = await db.from("kc_communication_requests").select("id,channel,status,source_program,variables,recipient_refs,audit_meta")
          .eq("id", p.request_id).maybeSingle();
        if (!r || r.source_program !== "kc-besuche" || r.channel !== "email" || !MITGLIED_EREIGNISSE.includes(r.audit_meta?.eventKey)) throw new Fehler("Mail nicht gefunden.", 404);
        const an = (r.recipient_refs ?? []).filter((x: any) => !x.role).map((x: any) => x.email).filter(Boolean).join(", ");
        const v = await senden("termin_kopie_hansi", [HANSI], {
          ...r.variables, text: `[Kopie für dich – diese Mail ging an ${an || "das Mitglied"}]\n\n${r.variables?.text ?? ""}`,
        }, `kopie-nachgesendet:${r.id}`);
        await log("hansi", "kopie_nachgesendet", {}, { mail: r.variables?.subject, an, versand: versandText(v) });
        return json({ ok: true, versand: v });
      }

      case "t_kalender_schluessel": {
        const neu = "kal_" + zufall(20);
        await db.from("kc_termin_kalender_status").update({ key_sha256: await sha256(neu), schluessel_erstellt_am: jetzt(), letzter_fehler: null }).eq("id", 1);
        await log("hansi", "kalender_schluessel_neu");
        return json({ ok: true, schluessel: neu });
      }

      default:
        return json({ error: "Unbekannte Aktion" }, 400);
    }
  } catch (e) {
    if (e instanceof Fehler) return json({ error: e.message, ...e.extra }, e.status);
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
