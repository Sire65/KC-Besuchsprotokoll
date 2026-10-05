-- KC Besuchsprotokoll 1.3.11 (Köcheclub-App 2.23.68, Wunsch Hansi): Erinnerung an Hansi – Vorabend und 1 Stunde vorher, nur Push.
-- Nur neue, leere Spalten + eine neue Versand-Regel; vorhandene Daten bleiben unverändert.
-- Rückweg: alter table kc_termin_buchungen drop column hansi_vorabend_am, drop column hansi_vorher_am;
--          delete from kc_communication_event_rules where source_program='kc-besuche' and event_key='termin_erinnerung_hansi';
alter table public.kc_termin_buchungen add column if not exists hansi_vorabend_am timestamptz;
alter table public.kc_termin_buchungen add column if not exists hansi_vorher_am timestamptz;
insert into public.kc_communication_event_rules
  (source_program, event_key, display_name, enabled, channels, channel_mode, template_id, priority, quiet_hours_mode, require_ack, recipient_rule, conditions)
values
  ('kc-besuche', 'termin_erinnerung_hansi', 'Termine – Erinnerung an Hansi (Vorabend, 1 Std. vorher)', true, array['push'], 'all', 'kc_besuche_termin_v1', 'normal', 'ignore', false, '{"type":"event"}', '{}')
on conflict (source_program, event_key) do update set enabled = true, channels = excluded.channels;
-- Termine, die heute schon vorbei oder bereits laufend sind, nicht nachträglich erinnern
update public.kc_termin_buchungen b set hansi_vorabend_am = now(), hansi_vorher_am = now()
  from public.kc_termin_slots s where s.id = b.slot_id and s.beginn <= now();
