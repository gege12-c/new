-- TriCoach : mise à jour de la base de production.
-- Généré par scripts/production-sql.mjs à partir de supabase/migrations : ne pas modifier à la main.
-- Migrations incluses : 20261031100000_intervals_planned.sql.
-- Mode d'emploi : Supabase > SQL Editor > New query, coller tout le fichier, puis Run.
-- Tout ou rien : en cas d'erreur, la transaction est annulée et la base reste inchangée.

begin;

-- Collé une seconde fois : refusé d'emblée, rien n'est modifié (même pour une migration rejouable).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version in ('20261031100000')) then
    raise exception 'TriCoach : migration already exists (déjà appliquée) : 20261031100000. Rien n''a été modifié.';
  end if;
end;
$$;

-- ===== 20261031100000_intervals_planned.sql =====

-- Séances prévues dans intervals.icu (par le coach de l'athlète, ou par l'athlète lui-même), reprises
-- dans TriCoach : calendrier, prévu contre réalisé, statistiques. intervals.icu en reste la source :
-- elles ne se modifient que là-bas (TriCoach suit à chaque réception), ne repartent pas vers la
-- montre (intervals.icu s'en charge déjà) et ne déclenchent aucune notification de TriCoach.

alter table public.planned_sessions
  add column source text not null default 'tricoach' check (source in ('tricoach', 'intervals')),
  add column external_id text check (char_length(external_id) <= 100),
  add column external_updated_at timestamptz,
  add column import_notes text[] check (cardinality(import_notes) <= 20);
alter table public.planned_sessions add constraint planned_sessions_external_rules
  check ((source = 'tricoach') = (external_id is null));
-- Index complet (et non partiel) : les séances de TriCoach, sans identifiant externe, ne s'y gênent pas.
create unique index planned_sessions_external on public.planned_sessions (athlete_id, source, external_id);

comment on column public.planned_sessions.source is
  'tricoach : séance planifiée dans TriCoach. intervals : séance reprise du calendrier intervals.icu (lecture seule, écrite par le serveur).';
comment on column public.planned_sessions.external_id is
  'Identifiant de la séance chez intervals.icu (source intervals) ; null pour une séance de TriCoach.';
comment on column public.planned_sessions.external_updated_at is
  'Dernière modification connue chez intervals.icu : la séance n''est réécrite que si elle a changé.';
comment on column public.planned_sessions.import_notes is
  'Ce qui n''a pas pu être repris tel quel du déroulé d''intervals.icu (montré à l''athlète, jamais deviné).';

/**
 * Garde des séances : comme avant (auteur et athlète immuables, l'athlète ne fait que déplacer une
 * séance planifiée par un autre), et une séance reprise d'intervals.icu ne change que par le serveur.
 */
create or replace function private.guard_planned_session()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if new.source <> 'tricoach' and v_actor is not null then
      raise exception 'imported_session_read_only' using errcode = '42501';
    end if;
    if new.state = 'published' then
      new.published_at := now();
    end if;
    new.version := 1;
    return new;
  end if;

  -- Séance d'intervals.icu : elle se modifie là-bas, TriCoach suit.
  if old.source <> 'tricoach' and v_actor is not null then
    raise exception 'imported_session_read_only' using errcode = '42501';
  end if;
  if new.source <> old.source or new.external_id is distinct from old.external_id then
    raise exception 'immutable_field' using errcode = '42501';
  end if;

  -- created_by peut seulement passer à null (suppression du compte auteur, via la clé étrangère).
  if new.athlete_id <> old.athlete_id
     or (new.created_by is not null and new.created_by is distinct from old.created_by) then
    raise exception 'immutable_field' using errcode = '42501';
  end if;

  -- L'athlète peut seulement déplacer une séance planifiée par quelqu'un d'autre.
  if v_actor = old.athlete_id and old.created_by is distinct from v_actor then
    if (to_jsonb(new) - array['scheduled_date', 'start_time', 'updated_at', 'updated_by', 'version'])
       is distinct from (to_jsonb(old) - array['scheduled_date', 'start_time', 'updated_at', 'updated_by', 'version']) then
      raise exception 'athlete_can_only_reschedule' using errcode = '42501';
    end if;
  end if;

  if new.state = 'published' and old.state is distinct from 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  new.updated_by := (select p.id from public.profiles p where p.id = v_actor);
  new.version := old.version + 1;
  return new;
end;
$$;

-- Une séance d'intervals.icu ne se supprime pas depuis TriCoach (elle disparaît quand elle est retirée
-- là-bas) ; la suppression du compte, elle, passe par la cascade, hors de ces règles.
drop policy planned_sessions_delete on public.planned_sessions;
create policy planned_sessions_delete on public.planned_sessions for delete to authenticated
using (
  source = 'tricoach'
  and (
    private.coach_can_plan(athlete_id)
    or (athlete_id = (select auth.uid()) and created_by = (select auth.uid()))
  )
);

/** Notifications de TriCoach : seulement pour ses propres séances (intervals.icu prévient déjà des siennes). */
create or replace function private.notify_session_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_kind text;
  v_payload jsonb;
  v_recipient uuid;
begin
  if new.source <> 'tricoach' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'published' then
      return null;
    end if;
    v_kind := 'session_published';
  elsif new.state = 'published' and old.state <> 'published' then
    v_kind := 'session_published';
  elsif new.state = 'cancelled' and old.state = 'published' then
    v_kind := 'session_cancelled';
  elsif new.state = 'published' and old.state = 'published'
    and (new.scheduled_date, new.start_time, new.title, new.content, new.description, new.nutrition_notes, new.sport)
      is distinct from (old.scheduled_date, old.start_time, old.title, old.content, old.description, old.nutrition_notes, old.sport) then
    v_kind := 'session_updated';
  else
    return null;
  end if;
  v_payload := jsonb_build_object(
    'title', new.title,
    'date', new.scheduled_date,
    'previous_date', case when tg_op = 'UPDATE' and new.scheduled_date <> old.scheduled_date then old.scheduled_date end
  );
  for v_recipient in select private.session_audience(new.athlete_id) loop
    perform private.notify(v_recipient, v_kind, new.athlete_id, new.id, v_actor, v_payload);
  end loop;
  return null;
end;
$$;

/** Ce que la montre affiche change ; une séance d'intervals.icu y est déjà, par intervals.icu. */
create or replace function private.device_session_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.state = 'published' and new.source = 'tricoach' then
      perform private.enqueue_device_sync(new.athlete_id);
    end if;
  elsif tg_op = 'DELETE' then
    if old.state = 'published' and old.source = 'tricoach' then
      perform private.enqueue_device_sync(old.athlete_id);
    end if;
  elsif new.source = 'tricoach'
    and (old.state = 'published' or new.state = 'published')
    and (new.state, new.version, new.scheduled_date, new.athlete_id) is distinct from (old.state, old.version, old.scheduled_date, old.athlete_id) then
    perform private.enqueue_device_sync(new.athlete_id);
    if new.athlete_id <> old.athlete_id then
      perform private.enqueue_device_sync(old.athlete_id);
    end if;
  end if;
  return null;
end;
$$;

/** Duplique une séance, comme avant ; une séance d'intervals.icu se duplique là-bas. */
create or replace function public.duplicate_planned_session(p_session uuid, p_date date)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if exists (select 1 from public.planned_sessions where id = p_session and source <> 'tricoach') then
    raise exception 'imported_session_read_only' using errcode = '42501';
  end if;
  insert into public.planned_sessions (
    athlete_id, scheduled_date, start_time, sport, title, objective, description, nutrition_notes,
    content, planned_duration_s, planned_distance_m, state, template_id
  )
  select athlete_id, p_date, start_time, sport, title, objective, description, nutrition_notes,
         content, planned_duration_s, planned_distance_m,
         case when state = 'cancelled' then 'draft' else state end, template_id
  from public.planned_sessions
  where id = p_session
  returning id into v_id;
  if v_id is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;

/**
 * Copie les séances (non annulées) d'une semaine vers une autre, jour pour jour, comme avant ; les
 * séances prévues dans intervals.icu n'en font pas partie (elles se copient là-bas).
 * p_state : null garde l'état de chaque séance ; 'draft' ou 'published' l'impose.
 */
create or replace function public.copy_planned_week(p_athlete uuid, p_from date, p_to date, p_state text default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if extract(isodow from p_from) <> 1 or extract(isodow from p_to) <> 1 then
    raise exception 'week_must_start_monday' using errcode = '22023';
  end if;
  if p_from = p_to then
    raise exception 'same_week' using errcode = '22023';
  end if;
  if p_state is not null and p_state not in ('draft', 'published') then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  insert into public.planned_sessions (
    athlete_id, scheduled_date, start_time, sport, title, objective, description, nutrition_notes,
    content, planned_duration_s, planned_distance_m, state, template_id
  )
  select athlete_id, scheduled_date + (p_to - p_from), start_time, sport, title, objective, description, nutrition_notes,
         content, planned_duration_s, planned_distance_m, coalesce(p_state, state), template_id
  from public.planned_sessions
  where athlete_id = p_athlete
    and scheduled_date >= p_from
    and scheduled_date < p_from + 7
    and state <> 'cancelled'
    and source = 'tricoach'
  order by scheduled_date, start_time nulls last, created_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/**
 * Enregistre en plan les semaines d'un athlète, comme avant, avec les seules séances de TriCoach :
 * un plan sert à planifier dans TriCoach, les séances d'intervals.icu restent à leur auteur.
 */
create or replace function public.save_training_plan(p_athlete uuid, p_from date, p_weeks integer, p_name text, p_description text default null)
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
    and s.state <> 'cancelled'
    and s.source = 'tricoach';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'empty_plan' using errcode = '22023';
  end if;
  return v_plan;
end;
$$;

-- ===== Inscription des migrations appliquées =====

insert into supabase_migrations.schema_migrations (version, name)
values ('20261031100000', 'intervals_planned')
on conflict (version) do nothing;

commit;
