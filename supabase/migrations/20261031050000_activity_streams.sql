-- Courbes et intervalles des activités : puissance, fréquence cardiaque, vitesse, cadence et
-- altitude au fil de la séance (quelques centaines de points), intervalles détectés par
-- intervals.icu ou tours enregistrés par l'appareil, meilleures puissances.
--
-- Sources : activités reçues d'intervals.icu (écrites par la file de jobs) et fichiers FIT importés
-- par l'athlète (écrites par lui). Jamais de trace GPS, jamais de courbe Strava.
-- Visibilité : celle de l'activité (la sous-requête applique sa politique) ; effacées avec elle.

create table public.activity_streams (
  activity_id uuid primary key references public.activities (id) on delete cascade,
  -- Un point toutes les « sample_s » secondes ; séries alignées sur « time » (secondes depuis le départ).
  sample_s smallint not null check (sample_s between 1 and 3600),
  series jsonb not null check (jsonb_typeof(series) = 'object' and octet_length(series::text) <= 400000),
  laps jsonb not null default '[]'::jsonb check (jsonb_typeof(laps) = 'array' and jsonb_array_length(laps) <= 300),
  -- « detected » : intervalles détectés par intervals.icu ; « device » : tours de l'appareil.
  laps_origin text check (laps_origin in ('detected', 'device')),
  -- Meilleures puissances moyennes (W) sur 5 s, 1, 5, 20 et 60 min, calculées seconde par seconde.
  bests jsonb not null default '{}'::jsonb check (jsonb_typeof(bests) = 'object'),
  created_at timestamptz not null default now()
);
comment on table public.activity_streams is
  'Courbes réduites et intervalles d''une activité (intervals.icu ou fichier FIT), visibles comme l''activité.';

alter table public.activity_streams enable row level security;
revoke all on public.activity_streams from anon, authenticated;

grant select on public.activity_streams to authenticated;
create policy activity_streams_select on public.activity_streams for select to authenticated
using (exists (select 1 from public.activities a where a.id = activity_id));

-- Fichiers FIT : l'athlète enregistre les courbes de ses propres imports, une fois.
grant insert (activity_id, sample_s, series, laps, laps_origin, bests) on public.activity_streams to authenticated;
create policy activity_streams_insert_own_files on public.activity_streams for insert to authenticated
with check (
  exists (
    select 1 from public.activities a
    where a.id = activity_id and a.athlete_id = (select auth.uid()) and a.source = 'fit_upload'
  )
);
