# Umgezogen (KC-TERMINE-UMZUG, 07.10.2026)

Die Edge Function `kc-termine` (Quellcode, Tests, Migrationen) liegt jetzt im Repo **KC-Clubapp**
(`supabase/functions/kc-termine`) und wird nur noch von dort hochgeladen. Hier nichts mehr ändern.

`kc-besuche` wurde nur vom alten Besuchsprotokoll-Bildschirm benutzt; die Köcheclub-App liest und schreibt die Besuche selbst.
Die Funktion bleibt vorerst unverändert in Supabase (Zugang nur mit Schlüssel) und kann später nach Rückfrage entfernt werden.
