-- KC Besuchsprotokoll 1.3.2: Jede Termin-Mail an Mitglieder geht als Kopie (wie BCC) an Hansi – nur E-Mail, kein Push.
insert into public.kc_communication_event_rules
  (source_program, event_key, display_name, enabled, channels, channel_mode, template_id, priority, quiet_hours_mode, require_ack, recipient_rule, conditions)
values
  ('kc-besuche', 'termin_kopie_hansi', 'Termine – Kopie der Mitglieder-Mail an Hansi', true, array['email'], 'all', 'kc_besuche_termin_v1', 'normal', 'ignore', false, '{"type":"event"}', '{}')
on conflict (source_program, event_key) do update set enabled = true, channels = excluded.channels;
