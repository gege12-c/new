-- Forme du jour : sommeil, fatigue, courbatures, stress, motivation, FC au repos, VFC, poids.
--
-- Saisie par l'athlète en quelques secondes (une ligne par jour, date locale) ; lue par lui et par
-- les coachs qu'il autorise à voir ses activités (même autorisation que les fichiers importés).

create table public.wellness_entries (
  athlete_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  entry_date date not null,
  sleep_hours numeric(3, 1) check (sleep_hours between 0 and 24),
  -- Échelles de 1 à 5. Qualité du sommeil et motivation : 5 = au mieux ; fatigue, courbatures et
  -- stress : 5 = au pire (libellés dans l'application).
  sleep_quality smallint check (sleep_quality between 1 and 5),
  fatigue smallint check (fatigue between 1 and 5),
  soreness smallint check (soreness between 1 and 5),
  stress smallint check (stress between 1 and 5),
  motivation smallint check (motivation between 1 and 5),
  resting_hr smallint check (resting_hr between 25 and 150),
  hrv_ms smallint check (hrv_ms between 1 and 300),
  weight_kg numeric(5, 1) check (weight_kg between 25 and 250),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (athlete_id, entry_date),
  -- Une ligne vide n'a pas de sens : au moins une valeur.
  constraint wellness_entries_not_empty check (
    num_nonnulls(sleep_hours, sleep_quality, fatigue, soreness, stress, motivation, resting_hr, hrv_ms, weight_kg, note) > 0
  )
);
comment on table public.wellness_entries is
  'Forme du jour d''un athlète (une ligne par date locale), visible de lui et des coachs autorisés à voir ses activités.';

create trigger wellness_entries_updated_at before update on public.wellness_entries
for each row execute function private.set_updated_at();

alter table public.wellness_entries enable row level security;
revoke all on public.wellness_entries from anon, authenticated;
grant select, delete on public.wellness_entries to authenticated;
grant insert (entry_date, sleep_hours, sleep_quality, fatigue, soreness, stress, motivation, resting_hr, hrv_ms, weight_kg, note)
  on public.wellness_entries to authenticated;
grant update (sleep_hours, sleep_quality, fatigue, soreness, stress, motivation, resting_hr, hrv_ms, weight_kg, note)
  on public.wellness_entries to authenticated;

create policy wellness_entries_select on public.wellness_entries for select to authenticated
using (athlete_id = (select auth.uid()) or private.coach_can_view_activities(athlete_id));
create policy wellness_entries_insert on public.wellness_entries for insert to authenticated
with check (athlete_id = (select auth.uid()));
create policy wellness_entries_update on public.wellness_entries for update to authenticated
using (athlete_id = (select auth.uid()))
with check (athlete_id = (select auth.uid()));
create policy wellness_entries_delete on public.wellness_entries for delete to authenticated
using (athlete_id = (select auth.uid()));
