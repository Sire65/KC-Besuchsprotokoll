-- KC Besuchsprotokoll 1.3.12 (Köcheclub-App 2.23.69, Wunsch Hansi): Einladung nur mit ausgewählten Terminen. Leer/null = alle freien Termine.
-- Nur eine neue, leere Spalte; vorhandene Einladungen bleiben unverändert (= alle).
-- Rückweg: alter table kc_termin_einladungen drop column slot_ids;
alter table public.kc_termin_einladungen add column if not exists slot_ids uuid[];
