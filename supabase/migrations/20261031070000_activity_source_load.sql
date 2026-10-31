-- Charge d'entraînement calculée par la source de l'activité, et historique d'un an reçu d'intervals.icu.
--
-- La courbe de condition de TriCoach reprend, pour chaque activité transmise par intervals.icu, la
-- charge qu'intervals.icu a calculée (icu_training_load, avec ses propres seuils) : les deux courbes
-- concordent. Les autres activités (fichiers FIT) gardent la charge calculée par TriCoach. Un an
-- d'activités est reçu une fois, pour que la condition ne parte pas de zéro.

alter table public.activities
  add column source_load numeric(6, 1) check (source_load is null or (source_load >= 0 and source_load <= 2000));
comment on column public.activities.source_load is
  'Charge d''entraînement calculée par la source (intervals.icu), avec ses propres seuils ; null si elle n''en donne pas.';

alter table public.external_connections add column history_from date;
comment on column public.external_connections.history_from is
  'Plus ancien jour d''activités demandé à la source : l''historique d''un an est reçu une fois, ensuite seulement les jours récents.';
