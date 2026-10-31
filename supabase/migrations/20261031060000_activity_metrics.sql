-- Mesures normalisées d'une activité, tirées de sa courbe seconde par seconde : puissance
-- normalisée, vitesse normalisée ajustée à la pente (course), fréquence cardiaque quadratique
-- moyenne. Indépendantes des seuils : la charge d'entraînement (courbe de condition) en est
-- tirée à la lecture, avec les seuils en vigueur à la date de l'activité.

alter table public.activity_streams
  add column metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object' and octet_length(metrics::text) <= 1000);

comment on column public.activity_streams.metrics is
  'Mesures normalisées (np en W, ngs en m/s, hr_rms en bpm), calculées avant la réduction des courbes.';

-- Fichiers FIT : l'athlète les enregistre avec les courbes de ses imports.
grant insert (metrics) on public.activity_streams to authenticated;
