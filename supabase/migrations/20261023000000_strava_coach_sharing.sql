-- Partage des activités Strava avec un coach, sur autorisation expresse de l'athlète.
--
-- Politique API de Strava (1er juin 2026) : §5.13, personne d'autre que l'athlète ne voit ses
-- données sans son consentement exprès préalable ; §6.1, règle d'affichage propre aux
-- applications de 9 999 athlètes au plus. Strava a confirmé ce partage à l'exploitant le
-- 19 octobre 2026. Restent en vigueur : cache de 7 jours au plus (§6.2, effacement à 6 jours),
-- aucune agrégation ni statistique, même dérivée (§5.4), aucune IA (§5.3).
--
-- 1. Consentement : par coach, désactivé par défaut, donné et retiré par l'athlète seul, remis à
--    zéro quand la relation est retirée ou rétablie (un nouveau consentement est alors demandé).
-- 2. Lecture : le coach autorisé lit les activités Strava de l'athlète jusqu'à leur expiration,
--    et leurs rapprochements (la politique des rapprochements suit celle des activités). Il ne les
--    rattache ni ne les détache : seul l'athlète décide pour ses activités Strava.
-- 3. Temps réel : canal « strava:<id> » pour l'athlète et ses coachs autorisés, signal sans contenu.

-- ---------------------------------------------------------------------------
-- 1. Consentement
-- ---------------------------------------------------------------------------

alter table public.coach_athlete_links
  add column share_strava boolean not null default false,
  add column strava_shared_at timestamptz,
  add constraint coach_athlete_links_strava_consent check (share_strava = (strava_shared_at is not null));

comment on column public.coach_athlete_links.share_strava is
  'L''athlète autorise expressément ce coach à voir ses activités Strava (politique API Strava §5.13).';
comment on column public.coach_athlete_links.strava_shared_at is
  'Date du consentement en cours ; null sans partage.';

/** Relation retirée ou rétablie : le partage Strava repart de zéro, l'athlète doit le redonner. */
create function private.reset_strava_sharing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.share_strava := false;
    new.strava_shared_at := null;
  end if;
  return new;
end;
$$;

create trigger coach_athlete_links_reset_strava before update of status on public.coach_athlete_links
for each row execute function private.reset_strava_sharing();

/** Coach actif que l'athlète autorise expressément à voir ses activités Strava. */
create function private.coach_can_view_strava(p_athlete uuid)
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
      and l.share_strava
  );
$$;

/** L'athlète, et lui seul, donne ou retire à l'un de ses coachs l'accès à ses activités Strava. */
create function public.set_strava_sharing(p_link_id uuid, p_share boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_athlete uuid;
begin
  if p_share is null then
    raise exception 'invalid_permissions' using errcode = '22023';
  end if;
  update public.coach_athlete_links
  set share_strava = p_share,
      strava_shared_at = case when p_share then coalesce(strava_shared_at, now()) end
  where id = p_link_id
    and athlete_id = (select auth.uid())
    and status = 'active'
  returning athlete_id into v_athlete;
  if v_athlete is null then
    raise exception 'link_not_found' using errcode = '22023';
  end if;
  -- Le calendrier ouvert chez le coach se relit (signal sans contenu).
  perform realtime.send(
    jsonb_build_object('table', 'coach_athlete_links', 'op', 'update'),
    'planning_changed',
    'athlete:' || v_athlete,
    true
  );
  return p_share;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Lecture des activités
-- ---------------------------------------------------------------------------

-- Strava : l'athlète, et les coachs qu'il autorise expressément, jusqu'à l'expiration.
-- FIT : l'athlète et les coachs qu'il autorise à voir ses activités importées.
drop policy activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated
using (
  (athlete_id = (select auth.uid()) and (expires_at is null or expires_at > now()))
  or (source <> 'strava' and private.coach_can_view_activities(athlete_id))
  or (source = 'strava' and expires_at > now() and private.coach_can_view_strava(athlete_id))
);

-- ---------------------------------------------------------------------------
-- 3. Temps réel
-- ---------------------------------------------------------------------------

/**
 * Canaux privés : « athlete:<id> » pour l'athlète et ses coachs actifs ; « self:<id> » pour
 * l'athlète seul ; « strava:<id> » pour l'athlète et les coachs qu'il autorise à voir ses
 * activités Strava.
 */
create or replace function private.can_receive_athlete_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_topic ~ '^self:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return substring(p_topic from 6)::uuid = (select auth.uid());
  end if;
  if p_topic ~ '^strava:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return substring(p_topic from 8)::uuid = (select auth.uid()) or private.coach_can_view_strava(substring(p_topic from 8)::uuid);
  end if;
  if p_topic ~ '^athlete:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return private.has_athlete_access(substring(p_topic from 9)::uuid);
  end if;
  return false;
end;
$$;

/**
 * Signal sans contenu. Ce qui vient de Strava part sur le canal de l'athlète seul, et sur celui
 * des coachs qu'il autorise quand il en a.
 */
create or replace function private.broadcast_activity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_athlete uuid := (v_row ->> 'athlete_id')::uuid;
  v_private boolean;
  v_payload jsonb;
begin
  if tg_table_name = 'activities' then
    v_private := v_row ->> 'source' = 'strava';
  elsif tg_table_name = 'session_activity_matches' then
    select a.source = 'strava' into v_private from public.activities a where a.id = (v_row ->> 'activity_id')::uuid;
    -- Activité déjà effacée : seuls l'athlète et ses coachs autorisés à voir Strava sont prévenus.
    v_private := coalesce(v_private, true);
  else
    v_private := false;
  end if;

  v_payload := jsonb_build_object('table', tg_table_name, 'op', lower(tg_op), 'session_id', v_row ->> 'session_id');
  perform realtime.send(v_payload, 'planning_changed', case when v_private then 'self:' else 'athlete:' end || v_athlete, true);
  if v_private and exists (
    select 1 from public.coach_athlete_links l where l.athlete_id = v_athlete and l.status = 'active' and l.share_strava
  ) then
    perform realtime.send(v_payload, 'planning_changed', 'strava:' || v_athlete, true);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilèges
-- ---------------------------------------------------------------------------

revoke all on function private.reset_strava_sharing(), private.coach_can_view_strava(uuid) from public, anon, authenticated;
grant execute on function private.coach_can_view_strava(uuid) to authenticated, service_role;

revoke all on function public.set_strava_sharing(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_strava_sharing(uuid, boolean) to authenticated;
