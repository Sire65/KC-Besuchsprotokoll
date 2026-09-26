-- KC Besuchsprotokoll 1.2.0 – Terminkalender (Feature KC-BES-TERMINE)
-- Hansi bietet Termine an, Mitglieder wählen über einen persönlichen Link (max. 3 Personen je Termin),
-- Gegenvorschläge, Freigabe durch Hansi, lückenloses Protokoll, Abgleich mit Google-Kalender.
-- Alle Tabellen nur für den Server (RLS an, keine Policies) – Zugriff ausschließlich über Edge Function kc-termine.

create table if not exists public.kc_termin_slots (
  id uuid primary key default gen_random_uuid(),
  beginn timestamptz not null,
  ende timestamptz not null,
  besuchsart text not null check (besuchsart in ('bei_hansi', 'beim_mitglied', 'wahl')),
  plaetze int not null default 3 check (plaetze between 1 and 3),
  notiz text,
  status text not null default 'offen' check (status in ('offen', 'abgesagt')),
  herkunft text not null default 'angebot' check (herkunft in ('angebot', 'gegenvorschlag')),
  ist_test boolean not null default false,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  check (ende > beginn)
);
create index if not exists kc_termin_slots_beginn on public.kc_termin_slots (beginn);

create table if not exists public.kc_termin_einladungen (
  id uuid primary key default gen_random_uuid(),
  person_ids text[] not null check (cardinality(person_ids) between 1 and 3),
  token_hash text not null unique,
  gueltig_bis timestamptz not null,
  status text not null default 'offen'
    check (status in ('offen', 'gewaehlt', 'gegenvorschlag', 'bestaetigt', 'abgesagt', 'abgelaufen', 'zurueckgezogen')),
  nachricht text,
  bemerkung text,
  ist_test boolean not null default false,
  erstellt_am timestamptz not null default now(),
  gesendet_am timestamptz,
  geoeffnet_am timestamptz,
  beantwortet_am timestamptz,
  ablauf_gemeldet_am timestamptz,
  geaendert_am timestamptz not null default now()
);
create index if not exists kc_termin_einladungen_status on public.kc_termin_einladungen (status, gueltig_bis);

create table if not exists public.kc_termin_buchungen (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.kc_termin_slots (id),
  einladung_id uuid not null references public.kc_termin_einladungen (id),
  personen int not null check (personen between 1 and 3),
  besuchsart text not null check (besuchsart in ('bei_hansi', 'beim_mitglied')),
  status text not null default 'vorgemerkt' check (status in ('vorgemerkt', 'bestaetigt', 'abgelehnt', 'storniert')),
  erstellt_am timestamptz not null default now(),
  entschieden_am timestamptz,
  bestaetigung_gesendet_am timestamptz,
  erinnerung_gesendet_am timestamptz,
  besuch_id text
);
create index if not exists kc_termin_buchungen_slot on public.kc_termin_buchungen (slot_id);
-- Je Einladung höchstens eine aktive Buchung
create unique index if not exists kc_termin_buchungen_eine_aktive
  on public.kc_termin_buchungen (einladung_id) where status in ('vorgemerkt', 'bestaetigt');

create table if not exists public.kc_termin_vorschlaege (
  id uuid primary key default gen_random_uuid(),
  einladung_id uuid not null references public.kc_termin_einladungen (id),
  beginn timestamptz not null,
  ende timestamptz not null,
  besuchsart text not null default 'egal' check (besuchsart in ('bei_hansi', 'beim_mitglied', 'egal')),
  status text not null default 'offen' check (status in ('offen', 'angenommen', 'abgelehnt', 'zurueckgezogen')),
  erstellt_am timestamptz not null default now(),
  check (ende > beginn)
);
create index if not exists kc_termin_vorschlaege_einladung on public.kc_termin_vorschlaege (einladung_id);

create table if not exists public.kc_termin_protokoll (
  id bigserial primary key,
  zeit timestamptz not null default now(),
  wer text not null check (wer in ('hansi', 'mitglied', 'system', 'kalender')),
  aktion text not null,
  einladung_id uuid,
  slot_id uuid,
  buchung_id uuid,
  details jsonb not null default '{}'::jsonb
);
create index if not exists kc_termin_protokoll_zeit on public.kc_termin_protokoll (zeit desc);

-- Stand je Kalendereintrag in Hansis Google-Kalender (uid = slot-<id> oder vorschlag-<id>)
create table if not exists public.kc_termin_kalender (
  uid text primary key,
  google_event_id text,
  stand_hash text,
  synchronisiert_am timestamptz,
  fehler text
);

-- Eigener Schlüssel nur für das Google-Skript (kann nur den Kalender abgleichen, sonst nichts)
create table if not exists public.kc_termin_kalender_status (
  id int primary key default 1 check (id = 1),
  key_sha256 text,
  schluessel_erstellt_am timestamptz,
  letzter_abruf timestamptz,
  letzte_meldung timestamptz,
  letzter_fehler text
);
insert into public.kc_termin_kalender_status (id) values (1) on conflict do nothing;

alter table public.kc_termin_slots enable row level security;
alter table public.kc_termin_einladungen enable row level security;
alter table public.kc_termin_buchungen enable row level security;
alter table public.kc_termin_vorschlaege enable row level security;
alter table public.kc_termin_protokoll enable row level security;
alter table public.kc_termin_kalender enable row level security;
alter table public.kc_termin_kalender_status enable row level security;

-- Belegung je Termin. Ein Hausbesuch (Hansi fährt hin) belegt den Termin für genau eine Einladung.
create or replace view public.kc_termin_slot_stand with (security_invoker = true) as
select s.*,
  coalesce(sum(b.personen) filter (where b.status in ('vorgemerkt', 'bestaetigt')), 0)::int as belegt,
  count(b.id) filter (where b.status in ('vorgemerkt', 'bestaetigt'))::int as buchungen,
  coalesce(bool_or(b.besuchsart = 'beim_mitglied') filter (where b.status in ('vorgemerkt', 'bestaetigt')), false) as hat_hausbesuch
from public.kc_termin_slots s
left join public.kc_termin_buchungen b on b.slot_id = s.id
group by s.id;

-- Termin wählen – atomar: Zeile des Termins wird gesperrt, damit nie mehr als die freien Plätze vergeben werden.
create or replace function public.kc_termin_waehlen(p_einladung uuid, p_slot uuid, p_art text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.kc_termin_einladungen%rowtype;
  s public.kc_termin_slots%rowtype;
  n int;
  belegt int;
  anzahl int;
  hausbesuch boolean;
  art text;
  neu uuid;
begin
  select * into e from public.kc_termin_einladungen where id = p_einladung for update;
  if not found then return jsonb_build_object('ok', false, 'grund', 'einladung_unbekannt'); end if;
  if e.status <> 'offen' then return jsonb_build_object('ok', false, 'grund', 'schon_beantwortet'); end if;
  if e.gueltig_bis < now() then return jsonb_build_object('ok', false, 'grund', 'abgelaufen'); end if;

  select * into s from public.kc_termin_slots where id = p_slot for update;
  if not found or s.status <> 'offen' or s.beginn <= now() or s.ist_test <> e.ist_test then
    return jsonb_build_object('ok', false, 'grund', 'nicht_verfuegbar');
  end if;

  n := cardinality(e.person_ids);
  select coalesce(sum(personen), 0), count(*), coalesce(bool_or(besuchsart = 'beim_mitglied'), false)
    into belegt, anzahl, hausbesuch
    from public.kc_termin_buchungen where slot_id = p_slot and status in ('vorgemerkt', 'bestaetigt');

  if s.besuchsart = 'wahl' then
    if anzahl > 0 then art := 'bei_hansi';
    elsif p_art in ('bei_hansi', 'beim_mitglied') then art := p_art;
    else return jsonb_build_object('ok', false, 'grund', 'ort_fehlt');
    end if;
  else
    art := s.besuchsart;
  end if;

  if hausbesuch or (art = 'beim_mitglied' and anzahl > 0) or belegt + n > s.plaetze then
    return jsonb_build_object('ok', false, 'grund', 'voll');
  end if;

  insert into public.kc_termin_buchungen (slot_id, einladung_id, personen, besuchsart)
    values (p_slot, p_einladung, n, art) returning id into neu;
  update public.kc_termin_einladungen set status = 'gewaehlt', beantwortet_am = now(), geaendert_am = now()
    where id = p_einladung;
  insert into public.kc_termin_protokoll (wer, aktion, einladung_id, slot_id, buchung_id, details)
    values ('mitglied', 'termin_gewaehlt', p_einladung, p_slot, neu, jsonb_build_object('besuchsart', art, 'personen', n));
  return jsonb_build_object('ok', true, 'buchung_id', neu, 'besuchsart', art);
end;
$$;
revoke all on function public.kc_termin_waehlen(uuid, uuid, text) from public, anon, authenticated;

-- Zeitplaner: alle 10 Minuten Fristen prüfen (abgelaufene Einladungen melden, Erinnerung am Vortag)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'kc_termine_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'kc_termine_cron_secret');
  end if;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'kc-termine-wartung-10min';
select cron.schedule('kc-termine-wartung-10min', '*/10 * * * *', $cron$
  select net.http_post(
    url => 'https://ptblnpiroqftcvlsrhac.supabase.co/functions/v1/kc-termine',
    headers => '{"Content-Type":"application/json"}'::jsonb,
    body => jsonb_build_object('action', 'wartung',
      'cronSecret', (select decrypted_secret from vault.decrypted_secrets where name = 'kc_termine_cron_secret'))
  );
$cron$);

-- KC Communicator: kc-besuche darf jetzt auch E-Mail, gleiche Absenderadresse wie die WM-Umfrage (Brevo)
update public.kc_communication_programs
  set allowed_channels = array['push', 'email'], updated_at = now()
  where id = 'kc-besuche';

insert into public.kc_communication_templates (id, display_name, channel_variants, enabled, version)
values ('kc_besuche_termin_v1', 'KC Besuche – Termine (Text kommt aus kc-termine)',
  '{"email":{"subject":"{{betreff}}","text":"{{text}}"},"push":{"title":"{{titel}}","body":"{{kurz}}"}}'::jsonb, true, 1)
on conflict (id) do update set channel_variants = excluded.channel_variants, enabled = true, updated_at = now();

insert into public.kc_communication_event_rules
  (source_program, event_key, display_name, enabled, channels, channel_mode, template_id, priority, quiet_hours_mode, require_ack, recipient_rule, conditions)
values
  ('kc-besuche', 'termin_einladung', 'Termine – Einladung an Mitglieder', true, array['email','push'], 'all', 'kc_besuche_termin_v1', 'normal', 'ignore', false, '{"type":"event"}', '{}'),
  ('kc-besuche', 'termin_bestaetigung', 'Termine – Bestätigung an Mitglieder', true, array['email','push'], 'all', 'kc_besuche_termin_v1', 'normal', 'ignore', false, '{"type":"event"}', '{}'),
  ('kc-besuche', 'termin_info_mitglied', 'Termine – Absage/neue Wahl/Erinnerung an Mitglieder', true, array['email','push'], 'all', 'kc_besuche_termin_v1', 'normal', 'ignore', false, '{"type":"event"}', '{}'),
  ('kc-besuche', 'termin_meldung_hansi', 'Termine – Meldung an Hansi', true, array['push','email'], 'all', 'kc_besuche_termin_v1', 'normal', 'ignore', false, '{"type":"event"}', '{}')
on conflict do nothing;
