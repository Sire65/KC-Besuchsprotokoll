-- KC Besuchsprotokoll 1.3.0: mündlich abgesprochene Termine (herkunft 'direkt') direkt aus dem Besuch bestätigen.
alter table public.kc_termin_slots drop constraint if exists kc_termin_slots_herkunft_check;
alter table public.kc_termin_slots add constraint kc_termin_slots_herkunft_check
  check (herkunft in ('angebot', 'gegenvorschlag', 'direkt'));
create index if not exists kc_termin_buchungen_besuch on public.kc_termin_buchungen (besuch_id);
