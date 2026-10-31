-- Plans d'entraînement : plusieurs semaines de séances, enregistrées depuis le calendrier d'un
-- athlète et réutilisables pour n'importe quel athlète, à partir d'un lundi.
--
-- Bibliothèque personnelle du coach (comme les modèles de séance) ; l'enregistrement et
-- l'application passent par des fonctions « security invoker » : la RLS et les déclencheurs des
-- séances s'appliquent comme pour toute création de séance.

create table public.training_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 1000),
  weeks smallint not null check (weeks between 1 and 26),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index training_plans_owner on public.training_plans (owner_id, name);

create table public.training_plan_sessions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.training_plans (id) on delete cascade,
  -- Jour dans le plan : 0 = lundi de la première semaine.
  day_offset smallint not null check (day_offset between 0 and 181),
  start_time time,
  sport text not null check (sport in ('swim', 'bike', 'run', 'strength', 'other', 'brick')),
  title text not null check (char_length(title) between 1 and 120),
  objective text check (objective in ('recovery', 'endurance', 'tempo', 'threshold', 'vo2max', 'anaerobic', 'sprint', 'technique', 'race_pace', 'strength', 'test', 'race', 'other')),
  description text check (char_length(description) <= 4000),
  nutrition_notes text check (char_length(nutrition_notes) <= 2000),
  content jsonb not null check (private.is_workout_document(content)),
  planned_duration_s integer check (planned_duration_s >= 0),
  planned_distance_m numeric(9, 1) check (planned_distance_m >= 0),
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
create index training_plan_sessions_plan on public.training_plan_sessions (plan_id, day_offset, position);

create trigger training_plans_updated_at before update on public.training_plans
for each row execute function private.set_updated_at();

alter table public.training_plans enable row level security;
alter table public.training_plan_sessions enable row level security;
revoke all on public.training_plans, public.training_plan_sessions from anon, authenticated;

grant select, delete on public.training_plans to authenticated;
grant insert (name, description, weeks) on public.training_plans to authenticated;
grant update (name, description) on public.training_plans to authenticated;
create policy training_plans_owner on public.training_plans for all to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

grant select, delete on public.training_plan_sessions to authenticated;
grant insert (plan_id, day_offset, start_time, sport, title, objective, description, nutrition_notes, content, planned_duration_s, planned_distance_m, position)
  on public.training_plan_sessions to authenticated;
create policy training_plan_sessions_owner on public.training_plan_sessions for all to authenticated
using (exists (select 1 from public.training_plans p where p.id = plan_id and p.owner_id = (select auth.uid())))
with check (exists (select 1 from public.training_plans p where p.id = plan_id and p.owner_id = (select auth.uid())));

/**
 * Enregistre en plan les semaines d'un athlète (du lundi p_from, p_weeks semaines) : ses séances
 * publiées et brouillons visibles de l'appelant, sans les séances annulées. Rend l'identifiant du plan.
 */
create function public.save_training_plan(p_athlete uuid, p_from date, p_weeks integer, p_name text, p_description text default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan uuid;
  v_count integer;
begin
  if extract(isodow from p_from) <> 1 then
    raise exception 'week_must_start_monday' using errcode = '22023';
  end if;
  if p_weeks is null or p_weeks < 1 or p_weeks > 26 then
    raise exception 'invalid_plan_weeks' using errcode = '22023';
  end if;
  if not private.has_athlete_access(p_athlete) then
    raise exception 'athlete_not_found' using errcode = '42501';
  end if;
  insert into public.training_plans (name, description, weeks)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_weeks)
  returning id into v_plan;

  insert into public.training_plan_sessions (
    plan_id, day_offset, start_time, sport, title, objective, description, nutrition_notes,
    content, planned_duration_s, planned_distance_m, position
  )
  select v_plan, s.scheduled_date - p_from, s.start_time, s.sport, s.title, s.objective, s.description, s.nutrition_notes,
         s.content, s.planned_duration_s, s.planned_distance_m,
         (row_number() over (partition by s.scheduled_date order by s.start_time nulls last, s.created_at))::smallint
  from public.planned_sessions s
  where s.athlete_id = p_athlete
    and s.scheduled_date >= p_from
    and s.scheduled_date < p_from + 7 * p_weeks
    and s.state <> 'cancelled';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'empty_plan' using errcode = '22023';
  end if;
  return v_plan;
end;
$$;

/**
 * Applique un plan de l'appelant à un athlète, à partir du lundi p_start : une séance par séance du
 * plan, en brouillon (par défaut) ou publiée. Les droits de planification sont ceux de l'appelant.
 */
create function public.apply_training_plan(p_plan uuid, p_athlete uuid, p_start date, p_publish boolean default false)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if extract(isodow from p_start) <> 1 then
    raise exception 'week_must_start_monday' using errcode = '22023';
  end if;
  if not exists (select 1 from public.training_plans p where p.id = p_plan) then
    raise exception 'plan_not_found' using errcode = '42501';
  end if;
  if not private.can_plan_for(p_athlete) then
    raise exception 'session_not_editable' using errcode = '42501';
  end if;
  insert into public.planned_sessions (
    athlete_id, scheduled_date, start_time, sport, title, objective, description, nutrition_notes,
    content, planned_duration_s, planned_distance_m, state
  )
  select p_athlete, p_start + ps.day_offset, ps.start_time, ps.sport, ps.title, ps.objective, ps.description, ps.nutrition_notes,
         ps.content, ps.planned_duration_s, ps.planned_distance_m, case when coalesce(p_publish, false) then 'published' else 'draft' end
  from public.training_plan_sessions ps
  where ps.plan_id = p_plan
  order by ps.day_offset, ps.position;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.save_training_plan(uuid, date, integer, text, text), public.apply_training_plan(uuid, uuid, date, boolean) from public, anon;
grant execute on function public.save_training_plan(uuid, date, integer, text, text), public.apply_training_plan(uuid, uuid, date, boolean) to authenticated;
