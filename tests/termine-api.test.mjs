// Funktionstest KC-BES-TERMINE gegen die laufende Edge Function kc-termine (nur Testdaten, versendet nichts).
// Aufruf: KC_TERMINE_PRUEFSCHLUESSEL=<schluessel> node tests/termine-api.test.mjs   (Vorbereitung: docs/TERMINE.md)

const API="https://ptblnpiroqftcvlsrhac.supabase.co/functions/v1/kc-termine";
const KEY=(process.env.KC_TERMINE_PRUEFSCHLUESSEL||"").trim(); if(!KEY){console.error("KC_TERMINE_PRUEFSCHLUESSEL fehlt – siehe docs/TERMINE.md");process.exit(2);}
const H=(a,d={})=>fetch(API,{method:"POST",headers:{"Content-Type":"application/json","x-key":KEY},body:JSON.stringify({action:a,...d})}).then(async r=>({s:r.status,j:await r.json()}));
const M=(t,a,d={})=>fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:a,t,...d})}).then(async r=>({s:r.status,j:await r.json()}));
const tk=l=>new URL(l).searchParams.get("t");
let fehler=0; const ok=(c,msg,x)=>{console.log((c?"OK  ":"FEHL")+" "+msg+(c?"":" → "+JSON.stringify(x).slice(0,400))); if(!c) fehler++;};
const d=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
// Zugang
ok((await H("t_init").then(x=>x)).s===200,"t_init mit Prüfschlüssel");
ok((await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","x-key":"falsch"},body:'{"action":"t_init"}'})).status===401,"falscher Schlüssel → 401");
ok((await M("00","m_laden")).s===404,"ungültiger Link → 404");
// Termine
let r=await H("t_slots_anlegen",{slots:[{datum:d,von:"15:00",bis:"16:30",besuchsart:"bei_hansi",plaetze:3},{datum:d,von:"10:00",bis:"11:30",besuchsart:"beim_mitglied",plaetze:3},{datum:d,von:"18:00",bis:"19:00",besuchsart:"wahl",plaetze:2}]});
ok(r.s===200&&r.j.slots.length===3&&r.j.slots.every(s=>s.ist_test),"3 Termine angelegt (Test)",r);
const [A,B,C]=r.j.slots; ok(new Date(A.beginn).toISOString().slice(11,16)===(new Date(d+"T15:00:00+02:00").toISOString().slice(11,16)),"Ortszeit 15:00 korrekt umgerechnet",A.beginn);
ok((await H("t_slots_anlegen",{slots:[{datum:"2020-01-01",von:"10:00",bis:"11:00",besuchsart:"bei_hansi"}]})).s===400,"Vergangenheit abgelehnt");
// Einladen
r=await H("t_einladen",{gruppen:[["KC-P-TEST-BIRGIT"],["KC-P-M0001","KC-P-M0002"],["KC-P-M0003"]],nachricht:"Test"});
ok(r.s===200&&r.j.ergebnisse.length===3&&r.j.ergebnisse.every(e=>e.link),"3 Einladungen",r);
ok(r.j.ergebnisse.every(e=>e.versand[0].hinweis?.includes("Test")),"Testmodus: nichts versendet",r.j.ergebnisse);
const [EB,EG,E3]=r.j.ergebnisse; let tB=tk(EB.link), tG=tk(EG.link), t3=tk(E3.link);
ok((await H("t_einladen",{gruppen:[["KC-P-M0003"]]})).j.ergebnisse[0].fehler?.includes("offene Einladung"),"doppelte Einladung verhindert");
ok((await H("t_einladen",{gruppen:[["KC-P-M0004","KC-P-M0005","KC-P-M0006","KC-P-M0007"]]})).s===400,"mehr als 3 abgelehnt");
// Laden: technische Prüfung darf den Öffnungsstatus nicht verändern
r=await M(tG,"m_laden"); ok(r.s===200&&r.j.anzahl===2&&r.j.frei.length===3&&r.j.status==="offen","Gruppe sieht 3 freie Termine",r);
let ti=await H("t_init"); let eOpen=ti.j.einladungen.find(e=>e.id===EG.einladung_id);
ok(!eOpen.geoeffnet_am,"technischer m_laden-Aufruf markiert Link nicht als geöffnet",eOpen);
// Echte Mitgliederseite markiert den Link
r=await M(tG,"m_laden",{client:"termin_html",page_open:true}); ok(r.s===200,"echte Mitgliederseite lädt",r);
ti=await H("t_init"); eOpen=ti.j.einladungen.find(e=>e.id===EG.einladung_id);
ok(!!eOpen.geoeffnet_am,"echte Mitgliederseite markiert Link als geöffnet",eOpen);
// Gleichzeitig Hausbesuch B wählen
const [x1,x2]=await Promise.all([M(tB,"m_waehlen",{slot_id:B.id}),M(t3,"m_waehlen",{slot_id:B.id})]);
ok([x1.s,x2.s].sort().join()==="200,409","gleichzeitige Wahl: genau einer gewinnt",[x1,x2]);
const gewinnerT = x1.s===200?tB:t3, verliererT = x1.s===200?t3:tB;
const verl=(x1.s===200?x2:x1); ok(verl.j.grund==="voll"&&verl.j.stand.frei.every(s=>s.id!==B.id),"Verlierer sieht B nicht mehr",verl);
// Gruppe wählt A (bei mir), Verlierer auch A
r=await M(tG,"m_waehlen",{slot_id:A.id}); ok(r.s===200&&r.j.status==="gewaehlt"&&r.j.buchung.status==="vorgemerkt","Gruppe wählt A",r);
r=await M(verliererT,"m_waehlen",{slot_id:A.id}); ok(r.s===200,"Verlierer wählt A (3/3)",r);
// Wahl-Termin C: Ort fehlt
// Übersicht
r=await H("t_init"); const bu=r.j.buchungen.filter(b=>b.slot_id===A.id&&b.status==="vorgemerkt");
ok(r.s===200&&bu.length===2,"t_init zeigt 2 vorgemerkte Buchungen für A",r.j.buchungen);
const sa=r.j.slots.find(s=>s.id===A.id); ok(sa.belegt===3,"A belegt 3/3",sa);
ok(Array.isArray(r.j.protokoll)&&r.j.protokoll.some(p=>p.aktion==="termin_gewaehlt"),"Protokoll enthält Wahl");
const eG=r.j.einladungen.find(e=>e.id===EG.einladung_id);
const bG=bu.find(b=>b.einladung_id===EG.einladung_id), bV=bu.find(b=>b.einladung_id!==EG.einladung_id);
// Bestätigen Gruppe, Ablehnen Verlierer
r=await H("t_buchung_entscheiden",{buchung_id:bG.id,entscheidung:"bestaetigen"}); ok(r.s===200,"Gruppe bestätigt",r);
r=await M(tG,"m_laden"); ok(r.j.status==="bestaetigt"&&r.j.buchung.ort,"Gruppe sieht Bestätigung mit Ort",r.j);
ok((await M(tG,"m_aendern")).s===409,"bestätigte Buchung nicht selbst änderbar");
r=await H("t_buchung_entscheiden",{buchung_id:bV.id,entscheidung:"ablehnen",nachricht:"Da bin ich weg"}); ok(r.s===200&&r.j.link,"Verlierer abgelehnt, neuer Link",r);
ok((await M(verliererT,"m_laden")).s===404,"alter Link ungültig");
const tV2=tk(r.j.link); r=await M(tV2,"m_laden"); ok(r.j.status==="offen"&&!r.j.frei.some(s=>s.id===B.id),"neuer Link offen",r.j);
// Gegenvorschlag
r=await M(tV2,"m_gegenvorschlag",{vorschlaege:[{datum:d,von:"12:00",bis:"13:00",besuchsart:"egal"},{datum:d,von:"20:00",besuchsart:"bei_hansi"}],bemerkung:"Nur mittags"});
ok(r.s===200&&r.j.status==="gegenvorschlag"&&r.j.vorschlaege.length===2,"Gegenvorschlag mit 2 Terminen",r);
r=await H("t_init"); const ev=r.j.einladungen.find(e=>e.status==="gegenvorschlag"); const vs=r.j.vorschlaege.filter(v=>v.einladung_id===ev.id&&v.status==="offen");
ok(vs.length===2,"Hansi sieht 2 Vorschläge");
ok((await H("t_vorschlag_entscheiden",{einladung_id:ev.id,aktion:"annehmen",vorschlag_id:vs[0].id})).s===400,"egal ohne Ort → Nachfrage");
r=await H("t_vorschlag_entscheiden",{einladung_id:ev.id,aktion:"annehmen",vorschlag_id:vs[0].id,besuchsart:"beim_mitglied"}); ok(r.s===200,"Vorschlag angenommen",r);
r=await M(tV2,"m_laden"); ok(r.j.status==="bestaetigt"&&r.j.buchung.besuchsart==="beim_mitglied","Mitglied sieht bestätigten Vorschlag",r.j);
// Gewinner B: ändern, dann C (wahl) ohne/mit Ort, dann absagen
r=await M(gewinnerT,"m_aendern"); ok(r.s===200&&r.j.status==="offen"&&r.j.frei.some(s=>s.id===B.id),"Antwort zurückgenommen, B wieder frei",r);
ok((await M(gewinnerT,"m_waehlen",{slot_id:C.id})).j.grund==="ort_fehlt","Wahl-Termin ohne Ort → Nachfrage");
r=await M(gewinnerT,"m_waehlen",{slot_id:C.id,besuchsart:"bei_hansi"}); ok(r.s===200&&r.j.buchung.besuchsart==="bei_hansi","Wahl-Termin bei Hansi",r);
r=await M(gewinnerT,"m_absagen",{bemerkung:"keine Zeit"}); ok(r.s===200&&r.j.status==="abgesagt","Mitglied sagt ab",r);
// Hansi: erneut einladen, Link, Termin C absagen (keine aktive Buchung), Termin B löschen (hatte Buchung → Fehler)
let eGew=(await H("t_init")).j.einladungen.find(e=>e.status==="abgesagt");
r=await H("t_erneut_einladen",{einladung_id:eGew.id}); ok(r.s===200&&r.j.link,"erneut eingeladen",r);
r=await H("t_link",{einladung_id:eGew.id}); ok(r.s===200&&r.j.link,"Link erneuert",r);
let nachLink=await H("t_init"); let eNachLink=nachLink.j.einladungen.find(e=>e.id===eGew.id);
ok(!eNachLink.geoeffnet_am,"neuer Link setzt Öffnungsstatus zurück",eNachLink);
ok((await H("t_slot_loeschen",{slot_id:B.id})).s===400,"Termin mit Buchungshistorie nicht löschbar");
r=await H("t_slot_absagen",{slot_id:A.id,nachricht:"krank"}); ok(r.s===200&&r.j.betroffen===1,"Termin A abgesagt, 1 Gruppe betroffen",r);
r=await M(tG,"m_laden"); ok(r.s===404,"Gruppe: alter Link nach Ausfall ungültig (neuer kam per Mail)");
r=await H("t_zurueckziehen",{einladung_id:eGew.id}); ok(r.s===200,"Einladung zurückgezogen");
// Neuer Termin ohne Buchung → löschbar
r=await H("t_slots_anlegen",{slots:[{datum:d,von:"08:00",bis:"09:00",besuchsart:"bei_hansi",plaetze:1}]}); r=await H("t_slot_loeschen",{slot_id:r.j.slots[0].id}); ok(r.s===200,"leerer Termin gelöscht");
// Kalender-Zugang ohne Schlüssel
ok((await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","x-kalender-key":"x"},body:'{"action":"kalender_abgleich"}'})).status===401,"Kalender ohne gültigen Schlüssel → 401");
ok((await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:'{"action":"wartung","cronSecret":"x"}'})).status===401,"Wartung ohne Geheimnis → 401");
console.log(fehler?`\n${fehler} FEHLER`:"\nALLE TESTS OK"); process.exit(fehler?1:0);
