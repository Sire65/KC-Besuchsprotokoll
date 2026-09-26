-- KC Besuchsprotokoll: Zusammenfassung nach dem Besuch per E-Mail über Supabase (statt Outlook am PC) + Kopie an Hansi.
insert into public.kc_communication_event_rules
  (source_program, event_key, display_name, enabled, channels, channel_mode, template_id, priority, quiet_hours_mode, require_ack, recipient_rule, conditions)
values
  ('kc-besuche', 'besuch_zusammenfassung', 'Besuch – Zusammenfassung an Mitglieder', true, array['email'], 'all', 'kc_besuche_termin_v1', 'normal', 'ignore', false, '{"type":"event"}', '{}'),
  ('kc-besuche', 'besuch_kopie_hansi', 'Besuch – Kopie der Zusammenfassung an Hansi', true, array['email'], 'all', 'kc_besuche_termin_v1', 'normal', 'ignore', false, '{"type":"event"}', '{}')
on conflict (source_program, event_key) do update set enabled = true, channels = excluded.channels;
