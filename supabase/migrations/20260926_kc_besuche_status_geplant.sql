-- KC Besuchsprotokoll 1.2.1: Status "geplant" für die Vorplanung eines Besuchs.
-- Geplante Besuche werden nie verschickt (Versand nur bei status = 'fertig') und zählen in der App nicht mit.
alter table public.kc_besuche drop constraint if exists kc_besuche_status_check;
alter table public.kc_besuche add constraint kc_besuche_status_check
  check (status = any (array['fertig'::text, 'foto_auswerten'::text, 'geplant'::text]));
