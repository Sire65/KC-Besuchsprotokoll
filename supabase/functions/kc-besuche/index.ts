// KC Besuchsprotokoll – Handy-Seite. Zugang nur mit persönlichem Schlüssel (x-key), Abdruck in kc_besuche_zugang.
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { encodeBase64 } from "jsr:@std/encoding/base64";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BUCKET = "kc-besuche-fotos";

const FELDER = ["person_ids","mitglied","anwesende","ort","datum","zeit_von","zeit_bis","km_einfach",
  "f1_praesentation","f2_bild_spruch","f2_spruch","f3_kasse","f4_dienstplan","f5_verwaltung","f6_router",
  "f7_thema","f7_antwort","notizen","vereinbarungen","bemerkungen","status","besuchsart","zusammenfassung_senden",
  "schulung_thema","installiert_auf"];
const GERAETE: Record<string, string> = { tablet: "Tablet", pc: "PC", handy: "Handy" };
const aufzaehlen = (t: string[]) => t.length > 1 ? t.slice(0, -1).join(", ") + " und " + t[t.length - 1] : (t[0] ?? "");

// Klartext der Antworten für Push und Mail (Notizen und Bemerkungen bleiben intern)
const TEXTE: Record<string, [string, Record<string, string>]> = {
  f1_praesentation: ["Weihnachtsmarkt-Präsentation", { rathaus: "Rathaus-Version", rot: "Rote Version", offen: "noch offen" }],
  f2_bild_spruch: ["Mit Bild und Spruch in der Präsentation", { ja: "ja", nein: "nein", klaeren: "wird noch geklärt" }],
  f3_kasse: ["Kassenprogramm", { alt: "alte Oberfläche", neu: "neue Oberfläche", offen: "Entscheidung offen" }],
  f4_dienstplan: ["Dienstplanprogramm", { ja: "ja", nein: "nein", spaeter: "später entscheiden" }],
  f5_verwaltung: ["KC Verwaltung", { ja: "ja", nein: "nein", spaeter: "später entscheiden" }],
  f6_router: ["Stand-Vernetzung mit 5G-Router", { ja: "ja", nein: "nein", spaeter: "später entscheiden" }],
};
function punkte(b: any): { titel: string; wert: string }[] {
  const p: { titel: string; wert: string }[] = [];
  for (const [f, [titel, werte]] of Object.entries(TEXTE)) {
    if (!b[f]) continue;
    let wert = werte[b[f]] ?? b[f];
    if (f === "f2_bild_spruch" && b[f] === "ja" && b.f2_spruch) wert += ` – Spruch: „${b.f2_spruch}“`;
    p.push({ titel, wert });
  }
  if (b.f7_thema) p.push({ titel: b.f7_thema, wert: b.f7_antwort || "" });
  return p;
}
function datumDe(d: string) { const [y, m, t] = d.split("-"); return `${t}.${m}.${y}`; }
function wannText(b: any) {
  let t = `am ${datumDe(b.datum)}`;
  if (b.zeit_von) t += b.zeit_bis ? ` von ${b.zeit_von.slice(0, 5)} bis ${b.zeit_bis.slice(0, 5)} Uhr` : ` ab ${b.zeit_von.slice(0, 5)} Uhr`;
  return t + (b.besuchsart === "bei_hansi" ? " bei mir" : " bei dir");
}

async function empfaenger(b: any) {
  if (!b.person_ids?.length) return [];
  const { data } = await db.from("kc_core_people").select("person_id,preferred_name,given_name,display_name,email")
    .in("person_id", b.person_ids);
  return (data ?? []).map((m: any) => ({ person_id: m.person_id, vorname: m.preferred_name || m.given_name || m.display_name, email: m.email }));
}

async function anredenLaden(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const { data } = await db.from("kc_besuche_anrede").select("person_id,anrede").in("person_id", ids);
  return Object.fromEntries((data ?? []).map((a: any) => [a.person_id, a.anrede]));
}

// Text der Dankes-Mail: passt sich an (ein/mehrere Mitglieder, bei ihnen/bei Hansi, Thema, Installation)
function mailText(b: any, leute: { person_id: string; vorname: string }[], anreden: Record<string, string>) {
  const mehr = leute.length > 1;
  const w = mehr
    ? { du: "ihr", dir: "euch", dich: "euch", dein: "eurem", hast: "habt", bist: "seid", scheue: "scheut euch" }
    : { du: "du", dir: "dir", dich: "dich", dein: "deinem", hast: "hast", bist: "bist", scheue: "scheue dich" };
  const namen = leute.map((l) => l.vorname);
  const anrede = leute.length && leute.every((l) => anreden[l.person_id])
    ? leute.map((l, i) => (i === 0 ? anreden[l.person_id] : anreden[l.person_id].toLowerCase()) + " " + l.vorname).join(", ") + ","
    : `Hallo ${aufzaehlen(namen) || "zusammen"},`;
  const thema = (b.schulung_thema || "").trim();
  const absaetze = [
    `ich danke ${w.dir}, dass ${w.du} ${b.besuchsart === "bei_hansi" ? `zu mir gekommen ${w.bist}` : `mich empfangen ${w.hast}`}. ` +
    `Es war eine angenehme Atmosphäre und mir hat es Spaß gemacht, ${w.dich} in ${thema || "unsere Programme"} einzuführen. ` +
    `Ich hoffe, ${w.dir} hat es auch gefallen.`,
  ];
  const pk = punkte(b);
  if (pk.length || b.vereinbarungen) absaetze.push("Im Anschluss haben wir noch ein paar Punkte besprochen. Deren Auswertung steht weiter unten.");
  const geraete = (b.installiert_auf ?? []).map((g: string) => GERAETE[g]).filter(Boolean);
  absaetze.push((geraete.length ? `Ich konnte die Schulungsversion auf ${w.dein} ${aufzaehlen(geraete)} installieren. ` : "") +
    `Wenn etwas nicht klappt, ${w.scheue} nicht, mich zu kontaktieren. Gerne stehe ich ${w.dir} bei Fragen zur Verfügung.`);
  return {
    betreff: `Köcheclub Werne – Danke für das Treffen am ${datumDe(b.datum)}`,
    anrede, absaetze, punkte: pk, vereinbarungen: b.vereinbarungen || "",
  };
}

// Push über den KC Communicator an alle Mitglieder des Besuchs, die Push freigeschaltet haben
async function pushSenden(b: any) {
  const leute = await empfaenger(b);
  const { data: geraete } = await db.from("kc_member_push_subscriptions").select("person_id")
    .in("person_id", leute.map((l) => l.person_id)).eq("active", true);
  const mitPush = new Set((geraete ?? []).map((g: any) => g.person_id));
  const kurz = punkte(b).slice(0, 4).map((p) => `${p.titel}: ${p.wert}`).join(" · ");
  const ergebnis: string[] = [];
  for (const l of leute) {
    if (!mitPush.has(l.person_id)) { ergebnis.push(`${l.vorname}: kein Push`); continue; }
    const body = `Hallo ${l.vorname}, danke für die Zeit ${wannText(b)}!` +
      (kurz ? ` Besprochen: ${kurz}.` : "") + (b.vereinbarungen ? ` Vereinbart: ${b.vereinbarungen}` : "") +
      (l.email ? " Die Zusammenfassung kommt auch per Mail." : "") + " Gruß Hansi";
    // idempotency_key ist je source_program eindeutig → pro Besuch und Person höchstens ein Push
    const { data: req, error } = await db.from("kc_communication_requests").insert({
      source_program: "kc-besuche", channel: "push", recipient_refs: [{ personId: l.person_id }],
      variables: { title: "Köcheclub Werne – Zusammenfassung Schulung", body, text: body },
      audit_meta: { besuchId: b.besuch_id, targetPersonId: l.person_id },
      idempotency_key: `besuch:${b.besuch_id}:${l.person_id}`,
    }).select("id").single();
    if (error) { ergebnis.push(`${l.vorname}: ${error.code === "23505" ? "schon gesendet" : error.message}`); continue; }
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/kc-communication-dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify({ requestId: req.id }),
    });
    ergebnis.push(`${l.vorname}: ${r.ok ? "Push gesendet" : "Push-Fehler " + r.status}`);
  }
  // Bei echten Fehlern push_gesendet_am leer lassen → die PC-Automatik versucht es beim nächsten Lauf erneut
  const fehler = ergebnis.some((e) => !/Push gesendet|kein Push|schon gesendet/.test(e));
  await db.from("kc_besuche").update({ ...(fehler ? {} : { push_gesendet_am: new Date().toISOString() }), versand_fehler: ergebnis.join("; ") || null })
    .eq("besuch_id", b.besuch_id);
  return ergebnis;
}
const versandBereit = (b: any) => b.zusammenfassung_senden && b.status === "fertig";

// ---------- Zusammenfassung per E-Mail über den KC Communicator (ab 26.09.2026) ----------
// Früher verschickte die Outlook-Automatik am PC die Mail (versand_offen/mail_erledigt – bleibt als Rückfall bestehen).
// Jetzt geht sie direkt über Supabase (Brevo, gleicher Absender), mit echtem BCC an Hansi (KC-COMM-CCBCC im Communicator).
const HANSI = "KC-P-002";
async function router(eventKey: string, personIds: string[], variables: Record<string, unknown>, correlationId: string, bcc?: string[]) {
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/kc-communication-router`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
    body: JSON.stringify({ sourceProgram: "kc-besuche", eventKey, recipients: personIds.map((personId) => ({ personId })), bcc: bcc?.map((personId) => ({ personId })), variables, correlationId }),
  });
  const out = await r.json().catch(() => ({}));
  return (Array.isArray(out?.results) ? out.results : []).map((x: any) => ({
    personId: x.personId, name: x.displayName || x.personId,
    mail: (x.attempts ?? []).some((a: any) => a.channel === "email" && ["sent", "deduplicated"].includes(a.result)),
  }));
}
function mailKlartext(m: ReturnType<typeof mailText>) {
  return [
    m.anrede, "",
    ...m.absaetze.flatMap((a) => [a, ""]),
    ...(m.punkte.length ? ["Besprochen:", ...m.punkte.map((p) => `• ${p.titel}: ${p.wert}`), ""] : []),
    ...(m.vereinbarungen ? ["Vereinbart / nächste Schritte:", m.vereinbarungen, ""] : []),
    "Viele Grüße", "Hansi", "Köcheclub Werne",
  ].join("\n");
}
async function mailSenden(b: any): Promise<string[]> {
  const leute = await empfaenger(b);
  const mitMail = leute.filter((l) => l.email);
  if (!mitMail.length) {
    await db.from("kc_besuche").update({ mail_gesendet_am: new Date().toISOString(), mail_empfaenger: "(keine E-Mail-Adresse)" }).eq("besuch_id", b.besuch_id);
    return leute.map((l) => `${l.vorname}: keine E-Mail-Adresse`);
  }
  const m = mailText(b, leute, await anredenLaden(leute.map((l) => l.person_id)));
  const text = mailKlartext(m);
  const erg = await router("besuch_zusammenfassung", mitMail.map((l) => l.person_id), {
    betreff: m.betreff, text, titel: "Köcheclub Werne", kurz: m.betreff,
  }, `besuch-mail:${b.besuch_id}`, [HANSI]);
  const ok = erg.filter((x: any) => x.mail);
  const adressen = mitMail.filter((l) => ok.some((x: any) => x.personId === l.person_id)).map((l) => l.email);
  if (ok.length) {
    await db.from("kc_besuche").update({ mail_gesendet_am: new Date().toISOString(), mail_empfaenger: adressen.join(", ") }).eq("besuch_id", b.besuch_id);
  }
  // Ohne Erfolg bleibt mail_gesendet_am leer → die Outlook-Automatik am PC kann als Rückfall senden
  return erg.map((x: any) => `${x.name}: ${x.mail ? "Mail gesendet" : "Mail-Fehler"}`);
}

// ---------- Foto vom Papierprotokoll auslesen (Claude) ----------
const ja_nein_spaeter = { type: "string", enum: ["", "ja", "nein", "spaeter"] };
const PROTOKOLL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["datum", "zeit_von", "zeit_bis", "km_einfach", "besuchsart", "mitglied", "anwesende", "ort",
    "f1_praesentation", "f2_bild_spruch", "f2_spruch", "f3_kasse", "f4_dienstplan", "f5_verwaltung", "f6_router",
    "f7_thema", "f7_antwort", "notizen", "vereinbarungen", "schulung_thema", "installiert_auf", "unsicher"],
  properties: {
    schulung_thema: { type: "string", description: "Worin geschult wurde, mit Artikel, z. B. 'das Bilderrechner-System', 'das Kassensystem', sonst leer" },
    installiert_auf: { type: "array", items: { type: "string", enum: ["tablet", "pc", "handy"] }, description: "Wo die Schulungsversion installiert wurde (angekreuzt)" },
    datum: { type: "string", description: "JJJJ-MM-TT oder leer" },
    zeit_von: { type: "string", description: "HH:MM oder leer" },
    zeit_bis: { type: "string", description: "HH:MM oder leer" },
    km_einfach: { type: "string", description: "km für EINEN Weg als Zahl (z. B. 6.5) oder leer. Steht nur Hin+Rück da: halbieren." },
    besuchsart: { type: "string", enum: ["", "beim_mitglied", "bei_hansi"] },
    mitglied: { type: "string", description: "Bei wem, z. B. 'Klaus und Dieter Zander'" },
    anwesende: { type: "string" },
    ort: { type: "string" },
    f1_praesentation: { type: "string", enum: ["", "rathaus", "rot", "offen"] },
    f2_bild_spruch: { type: "string", enum: ["", "ja", "nein", "klaeren"] },
    f2_spruch: { type: "string" },
    f3_kasse: { type: "string", enum: ["", "alt", "neu", "offen"] },
    f4_dienstplan: ja_nein_spaeter,
    f5_verwaltung: ja_nein_spaeter,
    f6_router: ja_nein_spaeter,
    f7_thema: { type: "string" },
    f7_antwort: { type: "string" },
    notizen: { type: "string", description: "Stichpunkte, je Punkt eine Zeile, sauber formuliert" },
    vereinbarungen: { type: "string", description: "Vereinbarungen/nächste Schritte, je Punkt eine Zeile" },
    unsicher: { type: "string", description: "Was schlecht lesbar oder unklar war (kurz), sonst leer" },
  },
};
const AUSWERT_PROMPT = `Du liest das Foto eines ausgefüllten, teils handschriftlichen Besuchsprotokolls des Köcheclub Werne.
Hansi besucht Mitglieder und schult sie in den Programmen. Der Bogen hat diese Punkte mit Ankreuzfeldern:
1 Weihnachtsmarktpräsentation: Rathaus-Version (rathaus) / Rote Version (rot) / Noch offen (offen)
2 Mit Bild und Spruch in der Präsentation: Ja / Nein / Noch klären (klaeren), dazu "Gewünschter Spruch oder Hinweis"
3 Kassenprogramm: Alte Oberfläche (alt) / Neue Oberfläche (neu) / Entscheidung offen (offen)
4 Dienstplanprogramm, 5 KC Verwaltung, 6 Standvernetzung mit 5G-Router: Ja / Nein / Später entscheiden (spaeter)
7 freier Punkt, dann "Notizen und Stichpunkte", "Vereinbarungen und nächste Schritte",
unten "Ein Weg ___ km. Hin und Rückweg = ___ km" und "Zeit: ___ bis ___ Uhr".
Falls vorhanden: worin geschult wurde und "Schulungsversion installiert auf: Tablet / PC / Handy".
Übertrage nur, was wirklich auf dem Blatt steht oder angekreuzt ist; nicht Angekreuztes bleibt leer ("").
Korrigiere offensichtliche Rechtschreibfehler in Freitexten, erfinde aber nichts dazu.
Wenn keine Jahreszahl lesbar ist, nimm ${new Date().getFullYear()}.`;

async function fotoAuswerten(b: any, mitglieder: string[]) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Foto-Auswertung ist noch nicht freigeschaltet (Schlüssel fehlt).");
  const bilder = [];
  for (const pfad of (b.fotos ?? []).filter((p: string) => /\.(jpe?g|png)$/i.test(p)).slice(-4)) {
    const { data, error } = await db.storage.from(BUCKET).download(pfad);
    if (error) throw new Error(error.message);
    bilder.push({
      type: "image" as const,
      source: { type: "base64" as const, media_type: pfad.endsWith(".png") ? "image/png" as const : "image/jpeg" as const,
        data: encodeBase64(new Uint8Array(await data.arrayBuffer())) },
    });
  }
  if (!bilder.length) throw new Error("Kein Foto zum Auswerten vorhanden.");
  const client = new Anthropic({ apiKey });
  const antwort: any = await client.beta.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: PROTOKOLL_SCHEMA } },
    system: AUSWERT_PROMPT,
    messages: [{ role: "user", content: [...bilder, { type: "text",
      text: `Mitglieder des Clubs (für die richtige Schreibweise der Namen): ${mitglieder.join(", ")}.\nBisher eingetragen: bei ${b.mitglied}, Datum ${b.datum}.` }] }],
  } as any);
  if (antwort.stop_reason === "refusal") throw new Error("Das Foto konnte nicht ausgewertet werden.");
  const text = antwort.content.find((c: any) => c.type === "text")?.text;
  if (!text) throw new Error("Keine Antwort bei der Auswertung.");
  return JSON.parse(text);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST erwartet" }, 405);

  const key = req.headers.get("x-key") ?? "";
  const { data: z } = await db.from("kc_besuche_zugang").select("key_sha256").eq("id", 1).single();
  if (!key || !z || (await sha256(key)) !== z.key_sha256) return json({ error: "Kein Zugang" }, 401);

  let p: any;
  try { p = await req.json(); } catch { return json({ error: "Ungültige Anfrage" }, 400); }

  try {
    switch (p.action) {
      case "init": {
        const { data: mitglieder } = await db.from("kc_core_people")
          .select("person_id,display_name,given_name,family_name,street,postal_code,city")
          .eq("active", true).not("person_id", "like", "KC-P-TEST%").order("display_name");
        const { data: besuche } = await db.from("kc_besuche").select("*")
          .order("datum", { ascending: false }).order("erstellt_am", { ascending: false }).limit(100);
        const { data: anr } = await db.from("kc_besuche_anrede").select("person_id,anrede");
        return json({ mitglieder, besuche, anreden: Object.fromEntries((anr ?? []).map((a: any) => [a.person_id, a.anrede])) });
      }
      case "anrede": {
        if (!["Lieber", "Liebe"].includes(p.anrede)) return json({ error: "Anrede ungültig" }, 400);
        const { error } = await db.from("kc_besuche_anrede")
          .upsert({ person_id: p.person_id, anrede: p.anrede, geaendert_am: new Date().toISOString() });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      case "mailvorschau": {
        const b = { ...(p.daten ?? {}) };
        if (!b.datum) b.datum = new Date().toISOString().slice(0, 10);
        const leute = await empfaenger(b);
        return json(mailText(b, leute, await anredenLaden(leute.map((l) => l.person_id))));
      }
      case "speichern": {
        const row: Record<string, unknown> = {};
        for (const f of FELDER) if (f in (p.daten ?? {})) row[f] = p.daten[f] === "" ? null : p.daten[f];
        if (!row.mitglied || !row.datum) return json({ error: "Mitglied und Datum fehlen" }, 400);
        row.geaendert_am = new Date().toISOString();
        const q = p.besuch_id
          ? db.from("kc_besuche").update(row).eq("besuch_id", p.besuch_id)
          : db.from("kc_besuche").insert(row);
        let { data, error } = await q.select().single();
        if (error) return json({ error: error.message }, 400);
        let versand: string[] | undefined;
        if (versandBereit(data) && !data.push_gesendet_am) versand = await pushSenden(data);
        if (versandBereit(data) && !data.mail_gesendet_am) versand = [...(versand ?? []), ...await mailSenden(data)];
        if (versand) ({ data } = await db.from("kc_besuche").select("*").eq("besuch_id", data.besuch_id).single());
        return json({ besuch: data, versand });
      }
      // Für die Outlook-Automatik auf Hansis PC: offene Mails holen (und verpasste Pushes nachholen)
      case "versand_offen": {
        const { data: offen } = await db.from("kc_besuche").select("*")
          .eq("zusammenfassung_senden", true).eq("status", "fertig")
          .or("mail_gesendet_am.is.null,push_gesendet_am.is.null");
        const mails = [];
        for (const b of offen ?? []) {
          if (!b.push_gesendet_am) await pushSenden(b);
          if (b.mail_gesendet_am) continue;
          const leute = await empfaenger(b);
          mails.push({ besuch_id: b.besuch_id, empfaenger: leute.filter((e) => e.email),
            ...mailText(b, leute, await anredenLaden(leute.map((l) => l.person_id))) });
        }
        return json({ mails });
      }
      case "mail_erledigt": {
        const { error } = await db.from("kc_besuche").update({
          mail_gesendet_am: new Date().toISOString(), mail_empfaenger: p.empfaenger || "(keine E-Mail-Adresse)",
        }).eq("besuch_id", p.besuch_id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      case "foto": {
        const { besuch_id, mime, data } = p;
        const { data: b } = await db.from("kc_besuche").select("fotos").eq("besuch_id", besuch_id).single();
        if (!b) return json({ error: "Besuch nicht gefunden" }, 404);
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
        const pfad = `${besuch_id}/${Date.now()}.${ext}`;
        const up = await db.storage.from(BUCKET).upload(pfad, bytes, { contentType: mime });
        if (up.error) return json({ error: up.error.message }, 400);
        const { data: neu, error } = await db.from("kc_besuche")
          .update({ fotos: [...b.fotos, pfad], geaendert_am: new Date().toISOString() })
          .eq("besuch_id", besuch_id).select().single();
        if (error) return json({ error: error.message }, 400);
        return json({ besuch: neu });
      }
      case "fotoloeschen": {
        const { besuch_id, pfad } = p;
        const { data: b } = await db.from("kc_besuche").select("fotos").eq("besuch_id", besuch_id).single();
        if (!b || !b.fotos.includes(pfad)) return json({ error: "Foto nicht gefunden" }, 404);
        const rm = await db.storage.from(BUCKET).remove([pfad]);
        if (rm.error) return json({ error: rm.error.message }, 400);
        const { data: neu, error } = await db.from("kc_besuche")
          .update({ fotos: b.fotos.filter((x: string) => x !== pfad), geaendert_am: new Date().toISOString() })
          .eq("besuch_id", besuch_id).select().single();
        if (error) return json({ error: error.message }, 400);
        return json({ besuch: neu });
      }
      case "auswerten": {
        const { data: b } = await db.from("kc_besuche").select("*").eq("besuch_id", p.besuch_id).single();
        if (!b) return json({ error: "Besuch nicht gefunden" }, 404);
        const { data: leute } = await db.from("kc_core_people").select("display_name").eq("active", true);
        try {
          return json({ vorschlag: await fotoAuswerten(b, (leute ?? []).map((l: any) => l.display_name)) });
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) }, 400);
        }
      }
      case "fotolink": {
        const { data, error } = await db.storage.from(BUCKET).createSignedUrl(p.pfad, 600);
        if (error) return json({ error: error.message }, 400);
        return json({ url: data.signedUrl });
      }
      default:
        return json({ error: "Unbekannte Aktion" }, 400);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
