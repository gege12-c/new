-- Phase 2 — Planification.
-- 1. Enregistrement fusionnant : une modification ne s'applique qu'aux champs réellement changés,
--    et échoue (sans rien écrire) si quelqu'un d'autre a changé ces mêmes champs entre-temps.
-- 2. Modifications en attente d'une séance publiée : invisibles pour l'athlète jusqu'à publication,
--    enregistrées elles aussi par fusion (deux éditeurs ouverts ne s'écrasent pas).
-- 3. Commentaires de séance, partagés ou privés (coach auteur uniquement).
-- 4. Duplication et copie de semaine, en une transaction.
-- 5. Diffusion temps réel (Realtime Broadcast, canaux privés « athlete:<id> »).
-- 6. Journal d'audit : les entrées d'une séance encore en brouillon restent réservées aux coachs.

-- ---------------------------------------------------------------------------
-- 6. Journal d'audit : visibilité
-- ---------------------------------------------------------------------------

alter table public.audit_logs
  add column visibility text not null default 'all' check (visibility in ('all', 'coaches'));
comment on column public.audit_logs.visibility is
  'all : athlète et coachs ; coaches : coachs et auteur seulement (séance restée en brouillon).';

create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_athlete uuid;
  v_visibility text := 'all';
begin
  v_athlete := case tg_table_name
    when 'athlete_profiles' then (v_row ->> 'user_id')::uuid
    when 'invitations' then null
    else (v_row ->> 'athlete_id')::uuid
  end;

  -- Une séance qui n'a jamais quitté l'état brouillon n'existe pas encore pour l'athlète.
  if tg_table_name = 'planned_sessions'
     and coalesce(v_old ->> 'state', 'draft') = 'draft'
     and coalesce(v_new ->> 'state', 'draft') = 'draft' then
    v_visibility := 'coaches';
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(
      jsonb_object_agg(
        o.key,
        case when o.key = 'content' then '"modifié"'::jsonb else jsonb_build_array(o.value, n.value) end
      ),
      '{}'::jsonb
    )
    into v_changes
    from jsonb_each(v_old) o
    join jsonb_each(v_new) n using (key)
    where o.value is distinct from n.value
      and o.key not in ('updated_at', 'updated_by', 'version');
    if v_changes = '{}'::jsonb then
      return new;
    end if;
  else
    v_changes := v_row - 'content' - 'token_hash';
  end if;

  insert into public.audit_logs (actor_id, athlete_id, entity_type, entity_id, action, changes, visibility)
  values (
    (select auth.uid()),
    v_athlete,
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id')::uuid,
    lower(tg_op),
    v_changes - 'token_hash',
    v_visibility
  );

  return coalesce(new, old);
end;
$$;

alter policy audit_logs_select on public.audit_logs
using (
  athlete_id is not null
  and private.has_athlete_access(athlete_id)
  and (visibility = 'all' or private.is_coach_of(athlete_id) or actor_id = (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- Droits d'édition d'une séance
-- ---------------------------------------------------------------------------

-- Modifier le contenu : un coach autorisé à planifier, ou l'athlète pour ses propres séances.
create function private.can_edit_session(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.planned_sessions s
    where s.id = p_session
      and (
        private.coach_can_plan(s.athlete_id)
        or (s.athlete_id = (select auth.uid()) and s.created_by = (select auth.uid()))
      )
  );
$$;

/** Champs modifiables depuis l'éditeur (l'état se change par des actions dédiées). */
create function private.session_editable_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'scheduled_date', 'start_time', 'sport', 'title', 'objective', 'description', 'nutrition_notes',
    'content', 'planned_duration_s', 'planned_distance_m'
  ];
$$;

-- ---------------------------------------------------------------------------
-- 1. Enregistrement fusionnant
-- ---------------------------------------------------------------------------

/**
 * Applique à une séance les champs de p_values qui diffèrent de p_base (l'état que l'éditeur a chargé).
 * Un champ changé ici ET modifié entre-temps par quelqu'un d'autre est un conflit : rien n'est écrit,
 * l'erreur 'session_conflict' liste ces champs. Les autres changements concurrents sont conservés.
 * Code PT409 : PostgREST répond HTTP 409. (Le code standard 40001 déclencherait ses relances
 * automatiques de transaction, en boucle, puisque le conflit ne disparaît pas tout seul.)
 * Exécutée avec les droits de l'appelant : RLS et trigger de garde s'appliquent.
 */
create function private.merge_session(p_session uuid, p_base jsonb, p_values jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.planned_sessions;
  v_cur jsonb;
  v_changed text[] := '{}';
  v_conflicts text[] := '{}';
  v_key text;
  v_row jsonb;
begin
  if jsonb_typeof(p_base) is distinct from 'object' or jsonb_typeof(p_values) is distinct from 'object' then
    raise exception 'invalid_session_payload' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_values) loop
    if not v_key = any (private.session_editable_fields()) then
      raise exception 'invalid_session_payload' using errcode = '22023', detail = v_key;
    end if;
  end loop;

  select * into v_current from public.planned_sessions where id = p_session for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  v_cur := to_jsonb(v_current);

  for v_key in select jsonb_object_keys(p_values) loop
    if (p_values -> v_key) is distinct from (p_base -> v_key) then
      if (v_cur -> v_key) is distinct from (p_base -> v_key) and (v_cur -> v_key) is distinct from (p_values -> v_key) then
        v_conflicts := v_conflicts || v_key;
      else
        v_changed := v_changed || v_key;
      end if;
    end if;
  end loop;

  if cardinality(v_conflicts) > 0 then
    raise exception 'session_conflict' using errcode = 'PT409', detail = array_to_string(v_conflicts, ',');
  end if;
  if cardinality(v_changed) = 0 then
    return v_cur;
  end if;

  update public.planned_sessions s set
    scheduled_date = case when 'scheduled_date' = any (v_changed) then (p_values ->> 'scheduled_date')::date else s.scheduled_date end,
    start_time = case when 'start_time' = any (v_changed) then (p_values ->> 'start_time')::time else s.start_time end,
    sport = case when 'sport' = any (v_changed) then p_values ->> 'sport' else s.sport end,
    title = case when 'title' = any (v_changed) then p_values ->> 'title' else s.title end,
    objective = case when 'objective' = any (v_changed) then p_values ->> 'objective' else s.objective end,
    description = case when 'description' = any (v_changed) then p_values ->> 'description' else s.description end,
    nutrition_notes = case when 'nutrition_notes' = any (v_changed) then p_values ->> 'nutrition_notes' else s.nutrition_notes end,
    content = case when 'content' = any (v_changed) then p_values -> 'content' else s.content end,
    planned_duration_s = case when 'planned_duration_s' = any (v_changed) then (p_values ->> 'planned_duration_s')::integer else s.planned_duration_s end,
    planned_distance_m = case when 'planned_distance_m' = any (v_changed) then (p_values ->> 'planned_distance_m')::numeric else s.planned_distance_m end
  where s.id = p_session
  returning to_jsonb(s.*) into v_row;

  if v_row is null then
    -- La ligne existe mais la politique de modification l'exclut.
    raise exception 'session_not_editable' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

/** Enregistre directement les changements d'une séance (brouillon, ou déplacement). */
create function public.save_planned_session(p_session uuid, p_base jsonb, p_values jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.merge_session(p_session, p_base, p_values);
$$;

-- ---------------------------------------------------------------------------
-- 2. Modifications en attente d'une séance publiée
-- ---------------------------------------------------------------------------

create table public.planned_session_drafts (
  session_id uuid primary key references public.planned_sessions (id) on delete cascade,
  -- Recopié de la séance par le trigger : sert aux index et aux contrôles d'accès.
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  -- Version publiée au moment où l'édition a commencé (fixée par le trigger), et état voulu.
  base jsonb not null check (jsonb_typeof(base) = 'object' and octet_length(base::text) <= 220000),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 220000),
  updated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.planned_session_drafts is
  'Modifications en cours d''une séance déjà publiée, invisibles pour l''athlète jusqu''à leur publication.';
create index planned_session_drafts_athlete on public.planned_session_drafts (athlete_id);
create index planned_session_drafts_updated_by on public.planned_session_drafts (updated_by);

/** Champs modifiables d'une ligne de séance, sous la forme que l'éditeur manipule. */
create function private.session_snapshot(p_row public.planned_sessions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_object_agg(f.key, to_jsonb(p_row) -> f.key)
  from unnest(private.session_editable_fields()) as f (key);
$$;

create function private.prepare_session_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.planned_sessions;
begin
  if tg_op = 'UPDATE' and new.session_id is distinct from old.session_id then
    raise exception 'immutable_field' using errcode = '42501';
  end if;
  select * into v_session from public.planned_sessions s where s.id = new.session_id;
  new.athlete_id := v_session.athlete_id;
  if tg_op = 'INSERT' then
    -- La base est toujours la version publiée du moment, jamais une valeur fournie par le client.
    new.base := private.session_snapshot(v_session);
    new.created_at := now();
  else
    new.base := old.base;
    new.created_at := old.created_at;
  end if;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;

create trigger prepare_session_draft before insert or update on public.planned_session_drafts
for each row execute function private.prepare_session_draft();

/**
 * Enregistre les modifications en attente d'une séance publiée (ou annulée), par fusion comme
 * merge_session : p_base est l'état que l'éditeur a chargé (modifications en attente, ou version
 * publiée). Seuls les champs changés depuis p_base s'appliquent ; un champ changé entre-temps par
 * quelqu'un d'autre (autre onglet, autre coach) est un conflit, et rien n'est écrit.
 * Si le résultat redevient identique à la version publiée, plus rien n'est en attente.
 * Renvoie { payload, pending, updated_at }.
 */
create function public.save_session_draft(p_session uuid, p_base jsonb, p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.planned_sessions;
  v_draft public.planned_session_drafts;
  v_has_draft boolean;
  v_published jsonb;
  v_current jsonb;
  v_payload jsonb;
  v_conflicts text[] := '{}';
  v_key text;
  v_updated timestamptz;
begin
  if jsonb_typeof(p_base) is distinct from 'object' or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'invalid_session_payload' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if not v_key = any (private.session_editable_fields()) then
      raise exception 'invalid_session_payload' using errcode = '22023', detail = v_key;
    end if;
  end loop;

  -- Verrous toujours dans le même ordre (séance, puis brouillon) : pas d'interblocage avec la publication.
  select * into v_session from public.planned_sessions where id = p_session for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if v_session.state = 'draft' then
    raise exception 'session_is_draft' using errcode = '22023';
  end if;
  v_published := private.session_snapshot(v_session);
  select * into v_draft from public.planned_session_drafts where session_id = p_session for update;
  v_has_draft := found;
  v_current := case when v_has_draft then v_draft.payload else v_published end;

  v_payload := v_current;
  for v_key in select jsonb_object_keys(p_payload) loop
    if (p_payload -> v_key) is distinct from (p_base -> v_key) then
      if (v_current -> v_key) is distinct from (p_base -> v_key) and (v_current -> v_key) is distinct from (p_payload -> v_key) then
        v_conflicts := v_conflicts || v_key;
      else
        v_payload := v_payload || jsonb_build_object(v_key, p_payload -> v_key);
      end if;
    end if;
  end loop;
  if cardinality(v_conflicts) > 0 then
    raise exception 'session_conflict' using errcode = 'PT409', detail = array_to_string(v_conflicts, ',');
  end if;

  if v_payload = v_published then
    if v_has_draft then
      delete from public.planned_session_drafts where session_id = p_session;
    end if;
    return jsonb_build_object('payload', v_payload, 'pending', false, 'updated_at', null);
  end if;
  if v_has_draft then
    update public.planned_session_drafts set payload = v_payload where session_id = p_session
    returning updated_at into v_updated;
  else
    insert into public.planned_session_drafts (session_id, payload) values (p_session, v_payload)
    returning updated_at into v_updated;
  end if;
  return jsonb_build_object('payload', v_payload, 'pending', true, 'updated_at', v_updated);
end;
$$;

/**
 * Recale des modifications en attente sur la version publiée actuelle : un champ que le brouillon
 * n'a pas touché suit la version publiée, un champ que seul le brouillon a changé est gardé, et
 * un champ changé des deux côtés prend la version choisie (p_prefer : 'mine' ou 'theirs').
 */
create function private.rebase_payload(p_base jsonb, p_payload jsonb, p_current jsonb, p_prefer text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_object_agg(
    f.key,
    case
      when (p_payload -> f.key) is not distinct from (p_base -> f.key) then p_current -> f.key
      when (p_current -> f.key) is not distinct from (p_base -> f.key) then p_payload -> f.key
      when p_prefer = 'mine' then p_payload -> f.key
      else p_current -> f.key
    end
  )
  from unnest(private.session_editable_fields()) as f (key);
$$;

/**
 * Publie les modifications en attente : fusion avec la version publiée actuelle (voir merge_session),
 * puis suppression du brouillon, dans la même transaction. En cas de conflit, p_prefer ('mine' ou
 * 'theirs') dit quelle version garder pour les champs changés des deux côtés.
 */
create function public.publish_session_draft(p_session uuid, p_prefer text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.planned_sessions;
  v_draft public.planned_session_drafts;
  v_current jsonb;
  v_row jsonb;
begin
  if p_prefer is not null and p_prefer not in ('mine', 'theirs') then
    raise exception 'invalid_session_payload' using errcode = '22023';
  end if;
  select * into v_session from public.planned_sessions where id = p_session for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  select * into v_draft from public.planned_session_drafts where session_id = p_session for update;
  if not found then
    raise exception 'draft_not_found' using errcode = 'P0002';
  end if;
  if p_prefer is not null then
    v_current := private.session_snapshot(v_session);
    v_draft.payload := private.rebase_payload(v_draft.base, v_draft.payload, v_current, p_prefer);
    v_draft.base := v_current;
  end if;
  v_row := private.merge_session(p_session, v_draft.base, v_draft.payload);
  delete from public.planned_session_drafts where session_id = p_session;
  return v_row;
end;
$$;

/**
 * Résout un conflit sans publier : les modifications en attente sont recalées sur la version
 * publiée actuelle (voir rebase_payload). Renvoie { payload, pending, updated_at }.
 */
create function public.rebase_session_draft(p_session uuid, p_prefer text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.planned_sessions;
  v_draft public.planned_session_drafts;
  v_published jsonb;
  v_payload jsonb;
  v_updated timestamptz;
begin
  if p_prefer is null or p_prefer not in ('mine', 'theirs') then
    raise exception 'invalid_session_payload' using errcode = '22023';
  end if;
  select * into v_session from public.planned_sessions where id = p_session for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  select * into v_draft from public.planned_session_drafts where session_id = p_session for update;
  if not found then
    raise exception 'draft_not_found' using errcode = 'P0002';
  end if;
  v_published := private.session_snapshot(v_session);
  v_payload := private.rebase_payload(v_draft.base, v_draft.payload, v_published, p_prefer);
  -- La base ne change jamais en place : le brouillon est recréé sur la version publiée actuelle.
  delete from public.planned_session_drafts where session_id = p_session;
  if v_payload = v_published then
    return jsonb_build_object('payload', v_payload, 'pending', false, 'updated_at', null);
  end if;
  insert into public.planned_session_drafts (session_id, payload) values (p_session, v_payload)
  returning updated_at into v_updated;
  return jsonb_build_object('payload', v_payload, 'pending', true, 'updated_at', v_updated);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Commentaires
-- ---------------------------------------------------------------------------

create table public.session_comments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.planned_sessions (id) on delete cascade,
  -- Recopié de la séance par le trigger.
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  -- shared : athlète et coachs ; coach_private : visible de son seul auteur, un coach.
  visibility text not null default 'shared' check (visibility in ('shared', 'coach_private')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index session_comments_session on public.session_comments (session_id, created_at);
create index session_comments_athlete on public.session_comments (athlete_id);
create index session_comments_author on public.session_comments (author_id);

create function private.prepare_session_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select s.athlete_id into new.athlete_id from public.planned_sessions s where s.id = new.session_id;
    new.author_id := (select auth.uid());
    new.created_at := now();
    new.edited_at := null;
    return new;
  end if;
  if new.session_id is distinct from old.session_id
     or new.author_id is distinct from old.author_id
     or new.visibility is distinct from old.visibility then
    raise exception 'immutable_field' using errcode = '42501';
  end if;
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger prepare_session_comment before insert or update on public.session_comments
for each row execute function private.prepare_session_comment();

-- ---------------------------------------------------------------------------
-- 4. Duplication et copie de semaine
-- ---------------------------------------------------------------------------

/** Duplique une séance à une autre date. Une séance annulée revient en brouillon. */
create function public.duplicate_planned_session(p_session uuid, p_date date)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
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
 * Copie les séances (non annulées) d'une semaine vers une autre, jour pour jour.
 * p_state : null garde l'état de chaque séance ; 'draft' ou 'published' l'impose.
 */
create function public.copy_planned_week(p_athlete uuid, p_from date, p_to date, p_state text default null)
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
  order by scheduled_date, start_time nulls last, created_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Temps réel : un signal par changement visible, sur le canal privé de l'athlète
-- ---------------------------------------------------------------------------

/** Canal « athlete:<uuid> » : l'athlète et ses coachs actifs peuvent l'écouter. */
create function private.can_receive_athlete_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_topic is null or p_topic !~ '^athlete:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.has_athlete_access(substring(p_topic from 9)::uuid);
end;
$$;

/**
 * Le message ne contient que des identifiants : chaque client relit ensuite les données
 * par l'API, sous ses propres droits. Les brouillons du coach, leurs commentaires et ses
 * notes privées ne produisent aucun signal sur ce canal.
 */
create function private.broadcast_planning_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_old_state text;
  v_new_state text;
begin
  if tg_table_name = 'planned_sessions' then
    v_old_state := case when tg_op in ('UPDATE', 'DELETE') then old.state end;
    v_new_state := case when tg_op in ('INSERT', 'UPDATE') then new.state end;
    if coalesce(v_old_state, 'draft') = 'draft' and coalesce(v_new_state, 'draft') = 'draft' then
      return null;
    end if;
  elsif tg_table_name = 'session_comments' then
    -- Note privée, ou commentaire d'une séance que l'athlète ne voit pas encore : aucun signal.
    if v_row ->> 'visibility' = 'coach_private' or not exists (
      select 1 from public.planned_sessions s where s.id = (v_row ->> 'session_id')::uuid and s.state <> 'draft'
    ) then
      return null;
    end if;
  end if;

  perform realtime.send(
    jsonb_build_object(
      'table', tg_table_name,
      'op', lower(tg_op),
      'id', v_row ->> 'id',
      'session_id', coalesce(v_row ->> 'session_id', v_row ->> 'id')
    ),
    'planning_changed',
    'athlete:' || (v_row ->> 'athlete_id'),
    true
  );
  return null;
end;
$$;

create trigger broadcast_planned_sessions after insert or update or delete on public.planned_sessions
for each row execute function private.broadcast_planning_change();
create trigger broadcast_session_comments after insert or update or delete on public.session_comments
for each row execute function private.broadcast_planning_change();

-- realtime.topic() est le canal demandé ; la ligne doit en outre appartenir à ce canal.
create policy athlete_topic_receive on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and realtime.messages.topic = (select realtime.topic())
  and private.can_receive_athlete_topic((select realtime.topic()))
);

-- ---------------------------------------------------------------------------
-- Privilèges et politiques
-- ---------------------------------------------------------------------------

revoke all on function
  private.can_edit_session(uuid),
  private.session_editable_fields(),
  private.session_snapshot(public.planned_sessions),
  private.merge_session(uuid, jsonb, jsonb),
  private.rebase_payload(jsonb, jsonb, jsonb, text),
  private.prepare_session_draft(),
  private.prepare_session_comment(),
  private.can_receive_athlete_topic(text),
  private.broadcast_planning_change()
from public, anon, authenticated;
grant execute on function
  private.can_edit_session(uuid),
  private.session_editable_fields(),
  private.session_snapshot(public.planned_sessions),
  private.merge_session(uuid, jsonb, jsonb),
  private.rebase_payload(jsonb, jsonb, jsonb, text),
  private.can_receive_athlete_topic(text)
to authenticated, service_role;

revoke all on function
  public.save_planned_session(uuid, jsonb, jsonb),
  public.save_session_draft(uuid, jsonb, jsonb),
  public.publish_session_draft(uuid, text),
  public.rebase_session_draft(uuid, text),
  public.duplicate_planned_session(uuid, date),
  public.copy_planned_week(uuid, date, date, text)
from public, anon, authenticated;
grant execute on function
  public.save_planned_session(uuid, jsonb, jsonb),
  public.save_session_draft(uuid, jsonb, jsonb),
  public.publish_session_draft(uuid, text),
  public.rebase_session_draft(uuid, text),
  public.duplicate_planned_session(uuid, date),
  public.copy_planned_week(uuid, date, date, text)
to authenticated;

alter table public.planned_session_drafts enable row level security;
alter table public.session_comments enable row level security;
revoke all on public.planned_session_drafts, public.session_comments from anon, authenticated;

-- planned_session_drafts : réservé à qui peut modifier le contenu de la séance -----------
grant select, delete on public.planned_session_drafts to authenticated;
grant insert (session_id, payload) on public.planned_session_drafts to authenticated;
grant update (payload) on public.planned_session_drafts to authenticated;
create policy planned_session_drafts_editors on public.planned_session_drafts for all to authenticated
using (private.can_edit_session(session_id))
with check (private.can_edit_session(session_id));

-- session_comments ------------------------------------------------------------------
grant select, delete on public.session_comments to authenticated;
grant insert (session_id, visibility, body) on public.session_comments to authenticated;
grant update (body) on public.session_comments to authenticated;

-- Un commentaire partagé se lit avec la séance (la sous-requête applique la RLS des séances) ;
-- une note privée ne se lit que par son auteur, tant qu'il coache l'athlète.
create policy session_comments_select on public.session_comments for select to authenticated
using (
  (
    visibility = 'shared'
    and exists (select 1 from public.planned_sessions s where s.id = session_comments.session_id)
  )
  or (
    visibility = 'coach_private'
    and author_id = (select auth.uid())
    and private.is_coach_of(athlete_id)
  )
);
create policy session_comments_insert on public.session_comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and exists (select 1 from public.planned_sessions s where s.id = session_comments.session_id)
  and (visibility = 'shared' or private.is_coach_of(athlete_id))
);
create policy session_comments_update on public.session_comments for update to authenticated
using (author_id = (select auth.uid()) and private.has_athlete_access(athlete_id))
with check (author_id = (select auth.uid()));
create policy session_comments_delete on public.session_comments for delete to authenticated
using (author_id = (select auth.uid()));
