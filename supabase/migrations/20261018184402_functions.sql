-- Phase 1 — Fonctions d'autorisation, triggers et procédures (RPC).
-- Toutes les fonctions SECURITY DEFINER fixent search_path = '' et qualifient chaque objet.
-- Les erreurs métier sont levées avec un code stable (message) que l'application traduit.

-- ---------------------------------------------------------------------------
-- Fonctions d'autorisation (schéma privé, non exposé par l'API)
-- ---------------------------------------------------------------------------

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()));
$$;

-- Coach actif de l'athlète (lecture).
create function private.is_coach_of(p_athlete uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.coach_athlete_links l
    where l.athlete_id = p_athlete
      and l.coach_id = (select auth.uid())
      and l.status = 'active'
  );
$$;

-- Coach actif autorisé à planifier pour l'athlète.
create function private.coach_can_plan(p_athlete uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.coach_athlete_links l
    where l.athlete_id = p_athlete
      and l.coach_id = (select auth.uid())
      and l.status = 'active'
      and l.can_edit_plan
  );
$$;

-- L'athlète lui-même ou l'un de ses coachs actifs.
create function private.has_athlete_access(p_athlete uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_athlete = (select auth.uid()) or private.is_coach_of(p_athlete);
$$;

-- L'athlète lui-même ou un coach autorisé à planifier.
create function private.can_plan_for(p_athlete uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_athlete = (select auth.uid()) or private.coach_can_plan(p_athlete);
$$;

-- Deux comptes liés par une relation active, dans un sens ou dans l'autre.
create function private.is_linked_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.coach_athlete_links l
    where l.status = 'active'
      and (
        (l.coach_id = (select auth.uid()) and l.athlete_id = p_other)
        or (l.athlete_id = (select auth.uid()) and l.coach_id = p_other)
      )
  );
$$;

create function private.hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- Triggers génériques
-- ---------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = new.timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Crée le profil à l'inscription, à partir des métadonnées fournies (jamais bloquant).
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := left(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 80);
  v_tz text := new.raw_user_meta_data ->> 'timezone';
  v_coach boolean := lower(coalesce(new.raw_user_meta_data ->> 'is_coach', '')) in ('true', 't', '1');
begin
  if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = v_tz) then
    v_tz := 'Europe/Paris';
  end if;
  insert into public.profiles (id, display_name, timezone, is_coach)
  values (
    new.id,
    coalesce(v_name, left(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 80), 'Athlète'),
    v_tz,
    v_coach
  )
  on conflict (id) do nothing;
  -- Tout compte peut s'entraîner : le profil sportif existe dès l'inscription.
  insert into public.athlete_profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Journal d'audit : qui a changé quoi, et quand.
-- Le contenu structuré d'une séance est noté « modifié » sans être recopié (l'autosave le réécrit souvent).
create function private.audit_row()
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
begin
  v_athlete := case tg_table_name
    when 'athlete_profiles' then (v_row ->> 'user_id')::uuid
    when 'invitations' then null
    else (v_row ->> 'athlete_id')::uuid
  end;

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

  insert into public.audit_logs (actor_id, athlete_id, entity_type, entity_id, action, changes)
  values (
    (select auth.uid()),
    v_athlete,
    tg_table_name,
    -- athlete_profiles a pour clé user_id ; les autres tables, id.
    coalesce(v_row ->> 'id', v_row ->> 'user_id')::uuid,
    lower(tg_op),
    v_changes - 'token_hash'
  );

  return coalesce(new, old);
end;
$$;

-- Séances planifiées : champs immuables, versionnement et droits de l'athlète sur les séances du coach.
create function private.guard_planned_session()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if new.state = 'published' then
      new.published_at := now();
    end if;
    new.version := 1;
    return new;
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
  new.updated_by := v_actor;
  new.version := old.version + 1;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitations (RPC exposées à l'API)
-- ---------------------------------------------------------------------------

create function public.create_invitation(p_email text default null, p_valid_hours integer default 168)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_coach uuid := (select auth.uid());
  v_email text := nullif(lower(trim(p_email)), '');
  v_token text;
  v_pending integer;
  v_id uuid;
  v_expires timestamptz;
begin
  if v_coach is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_coach and p.is_coach) then
    raise exception 'not_a_coach' using errcode = '42501';
  end if;
  if p_valid_hours is null or p_valid_hours not between 1 and 720 then
    raise exception 'invalid_validity' using errcode = '22023';
  end if;

  select count(*) into v_pending
  from public.invitations i
  where i.coach_id = v_coach and i.accepted_at is null and i.revoked_at is null and i.expires_at > now();
  if v_pending >= 20 then
    raise exception 'too_many_pending_invitations' using errcode = '54000';
  end if;

  -- 2 UUID v4 aléatoires = 244 bits d'entropie, générés par le générateur sûr de PostgreSQL.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.invitations as i (coach_id, email, token_hash, expires_at)
  values (v_coach, v_email, private.hash_token(v_token), now() + make_interval(hours => p_valid_hours))
  returning i.id, i.expires_at into v_id, v_expires;

  invitation_id := v_id;
  token := v_token;
  expires_at := v_expires;
  return next;
end;
$$;

-- Aperçu d'une invitation à partir de son jeton (affiché avant connexion).
create function public.get_invitation_preview(p_token text)
returns table (coach_name text, status text, expires_at timestamptz, email_bound boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.display_name,
    case
      when i.revoked_at is not null then 'revoked'
      when i.accepted_at is not null then 'used'
      when i.expires_at <= now() then 'expired'
      else 'valid'
    end,
    i.expires_at,
    i.email is not null
  from public.invitations i
  join public.profiles p on p.id = i.coach_id
  where p_token is not null
    and length(p_token) between 32 and 128
    and i.token_hash = private.hash_token(p_token);
$$;

create function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_inv public.invitations%rowtype;
  v_email text;
  v_link uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_token is null or length(p_token) not between 32 and 128 then
    raise exception 'invalid_invitation' using errcode = '22023';
  end if;

  select * into v_inv from public.invitations i where i.token_hash = private.hash_token(p_token) for update;
  if not found then
    raise exception 'invalid_invitation' using errcode = '22023';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'invitation_revoked' using errcode = '22023';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation_used' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'invitation_expired' using errcode = '22023';
  end if;
  if v_inv.coach_id = v_user then
    raise exception 'cannot_accept_own_invitation' using errcode = '22023';
  end if;
  if v_inv.email is not null then
    select lower(u.email) into v_email from auth.users u where u.id = v_user and u.email_confirmed_at is not null;
    if v_email is distinct from v_inv.email then
      raise exception 'invitation_email_mismatch' using errcode = '42501';
    end if;
  end if;

  insert into public.coach_athlete_links as l (coach_id, athlete_id)
  values (v_inv.coach_id, v_user)
  on conflict (coach_id, athlete_id) do update
    set status = 'active', revoked_at = null, revoked_by = null, can_edit_plan = true, can_view_activities = true
  returning l.id into v_link;

  update public.invitations set accepted_at = now(), accepted_by = v_user where id = v_inv.id;
  insert into public.athlete_profiles (user_id) values (v_user) on conflict (user_id) do nothing;

  return v_link;
end;
$$;

create function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invitations
  set revoked_at = now()
  where id = p_invitation_id
    and coach_id = (select auth.uid())
    and accepted_at is null
    and revoked_at is null;
  if not found then
    raise exception 'invitation_not_revocable' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Relations : révocation (coach ou athlète) et permissions (athlète seul)
-- ---------------------------------------------------------------------------

create function public.revoke_coach_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  update public.coach_athlete_links
  set status = 'revoked', revoked_at = now(), revoked_by = v_user
  where id = p_link_id
    and status = 'active'
    and (coach_id = v_user or athlete_id = v_user);
  if not found then
    raise exception 'link_not_found' using errcode = '22023';
  end if;
end;
$$;

create function public.set_coach_permissions(p_link_id uuid, p_can_edit_plan boolean, p_can_view_activities boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_can_edit_plan is null or p_can_view_activities is null then
    raise exception 'invalid_permissions' using errcode = '22023';
  end if;
  update public.coach_athlete_links
  set can_edit_plan = p_can_edit_plan, can_view_activities = p_can_view_activities
  where id = p_link_id
    and athlete_id = (select auth.uid())
    and status = 'active';
  if not found then
    raise exception 'link_not_found' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seuils applicables à une date (respecte la RLS de l'appelant)
-- ---------------------------------------------------------------------------

create function public.athlete_thresholds_at(p_athlete uuid, p_date date)
returns table (sport text, metric text, value numeric, effective_from date)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (t.sport, t.metric) t.sport, t.metric, t.value, t.effective_from
  from public.athlete_thresholds t
  where t.athlete_id = p_athlete and t.effective_from <= p_date
  order by t.sport, t.metric, t.effective_from desc;
$$;

create function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin();
$$;

-- ---------------------------------------------------------------------------
-- Branchement des triggers
-- ---------------------------------------------------------------------------

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create trigger profiles_timezone before insert or update of timezone on public.profiles
for each row execute function private.validate_timezone();

create trigger profiles_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger athlete_profiles_updated_at before update on public.athlete_profiles
for each row execute function private.set_updated_at();
create trigger coach_athlete_links_updated_at before update on public.coach_athlete_links
for each row execute function private.set_updated_at();
create trigger athlete_thresholds_updated_at before update on public.athlete_thresholds
for each row execute function private.set_updated_at();
create trigger athlete_events_updated_at before update on public.athlete_events
for each row execute function private.set_updated_at();
create trigger workout_templates_updated_at before update on public.workout_templates
for each row execute function private.set_updated_at();
create trigger planned_sessions_updated_at before update on public.planned_sessions
for each row execute function private.set_updated_at();

create trigger planned_sessions_guard before insert or update on public.planned_sessions
for each row execute function private.guard_planned_session();

create trigger audit_athlete_profiles after insert or update or delete on public.athlete_profiles
for each row execute function private.audit_row();
create trigger audit_coach_athlete_links after insert or update or delete on public.coach_athlete_links
for each row execute function private.audit_row();
create trigger audit_invitations after insert or update or delete on public.invitations
for each row execute function private.audit_row();
create trigger audit_athlete_thresholds after insert or update or delete on public.athlete_thresholds
for each row execute function private.audit_row();
create trigger audit_athlete_events after insert or update or delete on public.athlete_events
for each row execute function private.audit_row();
create trigger audit_planned_sessions after insert or update or delete on public.planned_sessions
for each row execute function private.audit_row();
