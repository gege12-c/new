-- Phase 3 — Activités réalisées et rapprochement avec les séances.
--
-- Règles Strava (accord et politique API du 1er juin 2026), appliquées par la base elle-même :
--   * une activité Strava n'est visible que de son athlète, jamais de ses coachs (politique §2.3, §6.1) ;
--   * elle n'est gardée que 6 jours au plus (cache limité à 7 jours, §6.2), puis effacée ;
--   * déconnexion : connexion, jetons et activités Strava effacés en cascade (§7.4).
-- Les activités importées par l'athlète (fichiers FIT) et ses déclarations sont des données de
-- l'application : durables, visibles des coachs qu'il autorise à voir ses activités.
--
-- 1. Connexions externes et jetons OAuth (chiffrés par l'application, illisibles par l'API)
-- 2. Activités
-- 3. Rapprochements séance-activité et déclarations de l'athlète
-- 4. Rapprochement automatique (score, association ou proposition)
-- 5. Associations manuelles
-- 6. Synchronisation : file de jobs, journaux, état du fournisseur
-- 7. Temps réel, purge, privilèges et politiques

-- ---------------------------------------------------------------------------
-- Autorisations
-- ---------------------------------------------------------------------------

-- Coach actif que l'athlète autorise à voir ses activités.
create function private.coach_can_view_activities(p_athlete uuid)
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
      and l.can_view_activities
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. Connexions externes et jetons
-- ---------------------------------------------------------------------------

create table public.external_connections (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('strava')),
  -- Identifiant du compte chez le fournisseur, nécessaire pour rattacher les webhooks. Aucune autre
  -- donnée du profil Strava n'est conservée (politique Strava §6.2 : cache de 7 jours au plus).
  external_athlete_id text not null check (char_length(external_athlete_id) between 1 and 40),
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'reauth_required')),
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  -- Code d'erreur stable, traduit par l'application ; jamais une donnée du fournisseur.
  last_error text check (char_length(last_error) <= 60),
  last_error_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint external_connections_one_per_provider unique (athlete_id, provider),
  constraint external_connections_external_unique unique (provider, external_athlete_id)
);
comment on table public.external_connections is
  'Comptes externes reliés par l''athlète (Strava). Écrits uniquement par le serveur.';

create trigger external_connections_updated_at before update on public.external_connections
for each row execute function private.set_updated_at();

create table public.oauth_tokens (
  connection_id uuid primary key references public.external_connections (id) on delete cascade,
  -- Chiffrés par l'application (AES-256-GCM, clé hors de la base) : jamais stockés en clair.
  access_token text not null check (access_token like 'v1.%'),
  refresh_token text not null check (refresh_token like 'v1.%'),
  expires_at timestamptz not null,
  -- Incrémenté à chaque renouvellement : deux renouvellements simultanés ne s'écrasent pas.
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
comment on table public.oauth_tokens is
  'Jetons OAuth chiffrés. Aucun accès par l''API : seul le serveur (clé secrète) les lit.';

-- ---------------------------------------------------------------------------
-- 2. Activités
-- ---------------------------------------------------------------------------

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  source text not null check (source in ('strava', 'fit_upload')),
  -- Strava : identifiant de l'activité. FIT : empreinte SHA-256 du fichier, suivie du numéro de segment.
  external_id text not null check (char_length(external_id) between 1 and 100),
  connection_id uuid references public.external_connections (id) on delete cascade,
  -- Segments d'un même fichier multisport (triathlon, enchaînement).
  group_key text check (char_length(group_key) <= 100),
  sport text not null check (sport in ('swim', 'bike', 'run', 'strength', 'other')),
  sport_detail text check (char_length(sport_detail) <= 60),
  name text check (char_length(name) <= 200),
  -- Instant de départ (UTC), et date et heure locales de l'athlète à ce moment-là.
  start_time timestamptz not null,
  local_date date not null,
  local_start_time time,
  timezone text check (char_length(timezone) <= 64),
  elapsed_s integer check (elapsed_s between 0 and 172800),
  moving_s integer check (moving_s between 0 and 172800),
  distance_m numeric(10, 1) check (distance_m between 0 and 2000000),
  elevation_gain_m numeric(7, 1) check (elevation_gain_m >= 0),
  avg_hr smallint check (avg_hr between 20 and 260),
  max_hr smallint check (max_hr between 20 and 260),
  avg_power smallint check (avg_power between 0 and 3000),
  weighted_power smallint check (weighted_power between 0 and 3000),
  max_power smallint check (max_power between 0 and 4000),
  avg_cadence smallint check (avg_cadence between 0 and 300),
  avg_speed_mps numeric(6, 3) check (avg_speed_mps >= 0),
  trainer boolean,
  manual boolean,
  device_name text check (char_length(device_name) <= 100),
  fetched_at timestamptz not null default now(),
  -- Strava seulement : effacement programmé. La première lecture fixe la date ; une relecture ne la repousse pas.
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_external_unique unique (athlete_id, source, external_id),
  constraint activities_source_rules check (
    (source = 'strava' and connection_id is not null and expires_at is not null and expires_at <= fetched_at + interval '7 days')
    or (source <> 'strava' and connection_id is null and expires_at is null)
  )
);
comment on table public.activities is
  'Activités réalisées. Strava : cache de l''athlète seul, effacé avant 7 jours. FIT : importées par l''athlète, durables.';
comment on column public.activities.expires_at is
  'Strava : instant d''effacement (politique API Strava §6.2). Null pour les données de l''application.';

-- Un identifiant d'activité Strava n'existe qu'une fois, tous athlètes confondus.
create unique index activities_strava_id on public.activities (external_id) where source = 'strava';
create index activities_athlete_date on public.activities (athlete_id, local_date);
create index activities_connection on public.activities (connection_id);
create index activities_expiry on public.activities (expires_at) where expires_at is not null;

create trigger activities_updated_at before update on public.activities
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Rapprochements et déclarations
-- ---------------------------------------------------------------------------

create table public.session_activity_matches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.planned_sessions (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  -- auto : associée par le rapprochement ; confirmed : associée par l'athlète (ou son coach) ;
  -- proposed : suggestion à valider ; rejected : écartée, jamais reproposée.
  status text not null check (status in ('auto', 'confirmed', 'proposed', 'rejected')),
  score numeric(4, 3) check (score between 0 and 1),
  score_details jsonb,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_activity_matches_pair unique (session_id, activity_id)
);
-- Une activité n'est rattachée qu'à une séance à la fois.
create unique index session_activity_matches_attached on public.session_activity_matches (activity_id)
where status in ('auto', 'confirmed');
create index session_activity_matches_athlete on public.session_activity_matches (athlete_id);
create index session_activity_matches_decided_by on public.session_activity_matches (decided_by);

create table public.session_completions (
  session_id uuid primary key references public.planned_sessions (id) on delete cascade,
  -- Recopié de la séance par le trigger.
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('done', 'partial', 'skipped')),
  rpe smallint check (rpe between 1 and 10),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.session_completions is
  'Déclaration de l''athlète : séance faite, partielle ou non faite, avec son ressenti (RPE de 1 à 10).';
create index session_completions_athlete on public.session_completions (athlete_id);

create function private.prepare_session_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.session_id is distinct from old.session_id then
    raise exception 'immutable_field' using errcode = '42501';
  end if;
  select s.athlete_id into new.athlete_id from public.planned_sessions s where s.id = new.session_id;
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger prepare_session_completion before insert or update on public.session_completions
for each row execute function private.prepare_session_completion();

-- ---------------------------------------------------------------------------
-- 4. Rapprochement automatique
-- ---------------------------------------------------------------------------

/** Disciplines d'une séance : une seule, ou celles de ses segments pour un enchaînement. */
create function private.session_slots(p_sport text, p_content jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_sport = 'brick' then coalesce(
      (
        select array_agg(distinct s.value ->> 'sport' order by s.value ->> 'sport')
        from jsonb_array_elements(p_content -> 'segments') as s (value)
        where s.value ->> 'sport' in ('swim', 'bike', 'run', 'strength', 'other')
      ),
      array['bike', 'run']
    )
    else array[p_sport]
  end;
$$;

/**
 * Note de correspondance entre une activité et une séance (ou un segment d'enchaînement), de 0 à 1 :
 * discipline (filtre), date (même jour, ou veille / lendemain), heure si les deux sont connues,
 * durée (ou distance) comparée au prévu sur une échelle logarithmique. Une valeur inconnue est neutre.
 */
create function private.match_score(
  p_activity_sport text,
  p_activity_date date,
  p_activity_time time,
  p_activity_duration_s integer,
  p_activity_distance_m numeric,
  p_slot_sport text,
  p_is_brick boolean,
  p_session_date date,
  p_session_time time,
  p_planned_duration_s integer,
  p_planned_distance_m numeric
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sport numeric;
  v_date numeric;
  v_time numeric;
  v_size numeric;
  v_ratio numeric;
begin
  v_sport := case
    when p_activity_sport = p_slot_sport then 1
    when p_activity_sport in ('strength', 'other') and p_slot_sport in ('strength', 'other') then 0.6
    else 0
  end;
  v_date := case abs(p_activity_date - p_session_date) when 0 then 1 when 1 then 0.35 else 0 end;
  if v_sport = 0 or v_date = 0 then
    return jsonb_build_object('score', 0, 'sport', v_sport, 'date', v_date);
  end if;

  v_time := case
    when p_activity_time is null or p_session_time is null then 0.6
    else greatest(0, 1 - abs(extract(epoch from (p_activity_time - p_session_time))) / (4 * 3600))
  end;

  if p_is_brick then
    v_size := 0.6;
  elsif coalesce(p_planned_duration_s, 0) > 0 and coalesce(p_activity_duration_s, 0) > 0 then
    v_ratio := p_activity_duration_s::numeric / p_planned_duration_s;
  elsif coalesce(p_planned_distance_m, 0) > 0 and coalesce(p_activity_distance_m, 0) > 0 then
    v_ratio := p_activity_distance_m / p_planned_distance_m;
  else
    v_size := 0.6;
  end if;
  if v_ratio is not null then
    v_size := greatest(0, 1 - abs(ln(v_ratio)) / ln(3));
  end if;

  return jsonb_build_object(
    'score', round(v_sport * (0.45 * v_date + 0.20 * v_time + 0.35 * v_size), 3),
    'sport', v_sport,
    'date', v_date,
    'time', round(v_time, 3),
    'size', round(v_size, 3),
    'ratio', round(v_ratio, 3)
  );
end;
$$;

/**
 * Recalcule les associations automatiques et les propositions des activités d'un athlète entre
 * deux dates. Les décisions de l'athlète ou de son coach (confirmed, rejected) ne sont jamais
 * modifiées. Une association automatique exige une note d'au moins 0,68 et l'absence d'ambiguïté :
 * aucune autre séance (ou activité) à moins de 0,12, sauf si celle-ci revient nettement à une autre.
 * Sinon, les deux meilleures séances (note d'au moins 0,45) sont proposées à l'athlète.
 */
create function private.rematch_window(p_athlete uuid, p_from date, p_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_auto constant numeric := 0.68;
  c_propose constant numeric := 0.45;
  c_margin constant numeric := 0.12;
  v_activity uuid;
  v_session uuid;
  v_slot text;
  v_score numeric;
  v_alt_session uuid;
  v_alt_slot text;
  v_alt_activity uuid;
  v_alt_score numeric;
  v_ok boolean;
begin
  if p_athlete is null or p_from is null or p_to is null then
    return;
  end if;
  -- Un seul recalcul à la fois par athlète (webhooks simultanés, imports, modification de séance).
  perform pg_advisory_xact_lock(hashtextextended('tricoach:rematch:' || p_athlete::text, 0));

  create temporary table if not exists tc_rematch_pairs (
    activity_id uuid not null,
    session_id uuid not null,
    slot text not null,
    score numeric not null,
    details jsonb not null,
    state text not null
  ) on commit drop;
  delete from pg_temp.tc_rematch_pairs;

  insert into pg_temp.tc_rematch_pairs (activity_id, session_id, slot, score, details, state)
  select a.id, s.id, slot.sport, (d.details ->> 'score')::numeric, d.details, 'open'
  from public.activities a
  join public.planned_sessions s
    on s.athlete_id = a.athlete_id
   and s.scheduled_date between a.local_date - 1 and a.local_date + 1
  cross join lateral unnest(private.session_slots(s.sport, s.content)) as slot (sport)
  cross join lateral (
    select private.match_score(
      a.sport,
      a.local_date,
      a.local_start_time,
      case when a.sport in ('swim', 'bike', 'run') then coalesce(a.moving_s, a.elapsed_s) else coalesce(a.elapsed_s, a.moving_s) end,
      a.distance_m,
      slot.sport,
      s.sport = 'brick',
      s.scheduled_date,
      s.start_time,
      s.planned_duration_s,
      s.planned_distance_m
    ) as details
  ) d
  where a.athlete_id = p_athlete
    and a.local_date between p_from and p_to
    and (a.expires_at is null or a.expires_at > now())
    -- Séances que l'athlète voit : publiées, ou ses propres brouillons.
    and (s.state = 'published' or (s.state = 'draft' and s.created_by = p_athlete))
    -- Activité déjà rattachée par une décision : on n'y touche pas.
    and not exists (
      select 1 from public.session_activity_matches m where m.activity_id = a.id and m.status = 'confirmed'
    )
    -- Paire écartée.
    and not exists (
      select 1 from public.session_activity_matches m
      where m.activity_id = a.id and m.session_id = s.id and m.status = 'rejected'
    )
    -- Créneau déjà rempli : par une décision, ou par une activité hors de la période recalculée.
    and not exists (
      select 1
      from public.session_activity_matches m
      join public.activities x on x.id = m.activity_id
      where m.session_id = s.id
        and m.status in ('auto', 'confirmed')
        and (m.status = 'confirmed' or x.local_date not between p_from and p_to)
        and (s.sport <> 'brick' or x.sport = slot.sport)
    )
    and (d.details ->> 'score')::numeric >= c_propose;

  -- Associations automatiques, de la meilleure note à la moins bonne.
  loop
    select p.activity_id, p.session_id, p.slot, p.score
    into v_activity, v_session, v_slot, v_score
    from pg_temp.tc_rematch_pairs p
    where p.state = 'open' and p.score >= c_auto
    order by p.score desc, p.activity_id, p.session_id, p.slot
    limit 1;
    exit when not found;

    -- Autre séance possible pour cette activité ? (Une paire jugée ambiguë reste une alternative.)
    v_alt_score := null;
    select p.session_id, p.slot, p.score into v_alt_session, v_alt_slot, v_alt_score
    from pg_temp.tc_rematch_pairs p
    where p.activity_id = v_activity and p.state in ('open', 'ambiguous')
      and (p.session_id, p.slot) is distinct from (v_session, v_slot)
    order by p.score desc
    limit 1;
    v_ok := v_alt_score is null
      or v_score - v_alt_score >= c_margin
      -- cette autre séance revient nettement à une autre activité
      or exists (
        select 1 from pg_temp.tc_rematch_pairs q
        where q.session_id = v_alt_session and q.slot = v_alt_slot and q.state in ('open', 'ambiguous')
          and q.activity_id <> v_activity and q.score > v_alt_score
      );

    -- Autre activité possible pour cette séance ?
    if v_ok then
      v_alt_score := null;
      select p.activity_id, p.score into v_alt_activity, v_alt_score
      from pg_temp.tc_rematch_pairs p
      where p.session_id = v_session and p.slot = v_slot and p.state in ('open', 'ambiguous')
        and p.activity_id <> v_activity
      order by p.score desc
      limit 1;
      v_ok := v_alt_score is null
        or v_score - v_alt_score >= c_margin
        -- cette autre activité revient nettement à une autre séance
        or exists (
          select 1 from pg_temp.tc_rematch_pairs q
          where q.activity_id = v_alt_activity and q.state in ('open', 'ambiguous')
            and (q.session_id, q.slot) is distinct from (v_session, v_slot)
            and q.score > v_alt_score
        );
    end if;

    if coalesce(v_ok, false) then
      update pg_temp.tc_rematch_pairs set state = 'auto'
      where activity_id = v_activity and session_id = v_session and slot = v_slot;
      update pg_temp.tc_rematch_pairs set state = 'taken'
      where state in ('open', 'ambiguous') and (activity_id = v_activity or (session_id = v_session and slot = v_slot));
    else
      update pg_temp.tc_rematch_pairs set state = 'ambiguous'
      where activity_id = v_activity and session_id = v_session and slot = v_slot;
    end if;
  end loop;

  -- Propositions : les deux meilleures séances de chaque activité restée sans association.
  update pg_temp.tc_rematch_pairs p set state = 'proposed'
  from (
    select q.activity_id, q.session_id, q.slot,
           row_number() over (partition by q.activity_id order by q.score desc, q.session_id) as rn
    from pg_temp.tc_rematch_pairs q
    where q.state in ('open', 'ambiguous')
      and not exists (
        select 1 from pg_temp.tc_rematch_pairs r where r.activity_id = q.activity_id and r.state = 'auto'
      )
  ) ranked
  where p.activity_id = ranked.activity_id and p.session_id = ranked.session_id and p.slot = ranked.slot
    and ranked.rn <= 2;

  -- Appliquer les différences : rien ne bouge si rien n'a changé.
  delete from public.session_activity_matches m
  using public.activities a
  where m.activity_id = a.id
    and a.athlete_id = p_athlete
    and a.local_date between p_from and p_to
    and m.status in ('auto', 'proposed')
    and not exists (
      select 1 from pg_temp.tc_rematch_pairs p
      where p.activity_id = m.activity_id and p.session_id = m.session_id
        and p.state = m.status
    );

  insert into public.session_activity_matches (session_id, activity_id, athlete_id, status, score, score_details)
  select distinct on (p.activity_id, p.session_id)
         p.session_id, p.activity_id, p_athlete, p.state, p.score, p.details
  from pg_temp.tc_rematch_pairs p
  where p.state in ('auto', 'proposed')
  order by p.activity_id, p.session_id, (p.state = 'auto') desc, p.score desc
  on conflict (session_id, activity_id) do update
    set status = excluded.status, score = excluded.score, score_details = excluded.score_details
    where public.session_activity_matches.status in ('auto', 'proposed')
      and (public.session_activity_matches.status, public.session_activity_matches.score)
          is distinct from (excluded.status, excluded.score);
end;
$$;

create function private.rematch_after_activity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.rematch_window(old.athlete_id, old.local_date - 1, old.local_date + 1);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.local_date is distinct from old.local_date) then
    perform private.rematch_window(new.athlete_id, new.local_date - 1, new.local_date + 1);
  end if;
  return null;
end;
$$;

create trigger activities_rematch
after insert or delete or update of sport, local_date, local_start_time, elapsed_s, moving_s, distance_m, expires_at
on public.activities
for each row execute function private.rematch_after_activity_change();

create function private.rematch_after_session_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.rematch_window(old.athlete_id, old.scheduled_date - 1, old.scheduled_date + 1);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.scheduled_date is distinct from old.scheduled_date) then
    perform private.rematch_window(new.athlete_id, new.scheduled_date - 1, new.scheduled_date + 1);
  end if;
  return null;
end;
$$;

create trigger planned_sessions_rematch
after insert or delete or update of scheduled_date, start_time, sport, state, content, planned_duration_s, planned_distance_m
on public.planned_sessions
for each row execute function private.rematch_after_session_change();

-- ---------------------------------------------------------------------------
-- 5. Associations manuelles
-- ---------------------------------------------------------------------------

-- L'athlète pour ses activités ; un coach autorisé à voir ses activités et à planifier, pour ses imports FIT.
create function private.can_manage_activity(p_activity uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.activities a
    where a.id = p_activity
      and (a.expires_at is null or a.expires_at > now())
      and (
        a.athlete_id = (select auth.uid())
        or (a.source <> 'strava' and private.coach_can_view_activities(a.athlete_id) and private.coach_can_plan(a.athlete_id))
      )
  );
$$;

/** Rattache une activité à une séance (décision confirmée) ; ses autres rattachements sont écartés. */
create function public.associate_activity(p_session uuid, p_activity uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activity public.activities;
  v_session public.planned_sessions;
begin
  if not private.can_manage_activity(p_activity) then
    raise exception 'activity_not_found' using errcode = 'P0002';
  end if;
  select * into v_activity from public.activities where id = p_activity;
  select * into v_session from public.planned_sessions where id = p_session;
  if v_session.id is null
     or v_session.athlete_id <> v_activity.athlete_id
     or not private.has_athlete_access(v_session.athlete_id)
     or (v_session.state = 'draft' and v_session.created_by <> v_session.athlete_id and not private.is_coach_of(v_session.athlete_id)) then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  update public.session_activity_matches
  set status = 'rejected', decided_by = (select auth.uid()), decided_at = now(), updated_at = now()
  where activity_id = p_activity and session_id <> p_session and status in ('auto', 'confirmed');
  delete from public.session_activity_matches where activity_id = p_activity and status = 'proposed' and session_id <> p_session;

  insert into public.session_activity_matches (session_id, activity_id, athlete_id, status, decided_by, decided_at)
  values (p_session, p_activity, v_activity.athlete_id, 'confirmed', (select auth.uid()), now())
  on conflict (session_id, activity_id) do update
    set status = 'confirmed', decided_by = excluded.decided_by, decided_at = excluded.decided_at, updated_at = now();

  perform private.rematch_window(v_activity.athlete_id, v_activity.local_date - 1, v_activity.local_date + 1);
end;
$$;

/** Détache une activité d'une séance (ou écarte une proposition) : la paire n'est plus jamais proposée. */
create function public.dissociate_activity(p_session uuid, p_activity uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activity public.activities;
begin
  if not private.can_manage_activity(p_activity) then
    raise exception 'activity_not_found' using errcode = 'P0002';
  end if;
  select * into v_activity from public.activities where id = p_activity;
  if not exists (
    select 1 from public.planned_sessions s
    where s.id = p_session and s.athlete_id = v_activity.athlete_id and private.has_athlete_access(s.athlete_id)
  ) then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  insert into public.session_activity_matches (session_id, activity_id, athlete_id, status, decided_by, decided_at)
  values (p_session, p_activity, v_activity.athlete_id, 'rejected', (select auth.uid()), now())
  on conflict (session_id, activity_id) do update
    set status = 'rejected', decided_by = excluded.decided_by, decided_at = excluded.decided_at, updated_at = now();

  perform private.rematch_window(v_activity.athlete_id, v_activity.local_date - 1, v_activity.local_date + 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Synchronisation
-- ---------------------------------------------------------------------------

create table public.sync_jobs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('strava_event', 'strava_sync', 'maintenance')),
  athlete_id uuid references public.profiles (id) on delete cascade,
  -- Paramètres du job (identifiants seulement), vidés une fois le job terminé.
  payload jsonb not null default '{}'::jsonb,
  -- Idempotence : un même évènement reçu deux fois ne crée qu'un job.
  dedupe_key text unique check (char_length(dedupe_key) <= 200),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'dead')),
  attempts integer not null default 0,
  max_attempts integer not null default 6 check (max_attempts between 1 and 20),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index sync_jobs_due on public.sync_jobs (run_after) where status in ('pending', 'failed', 'running');
create index sync_jobs_athlete on public.sync_jobs (athlete_id);

create trigger sync_jobs_updated_at before update on public.sync_jobs
for each row execute function private.set_updated_at();

create table public.sync_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  level text not null check (level in ('info', 'warn', 'error')),
  provider text check (provider in ('strava', 'fit')),
  athlete_id uuid references public.profiles (id) on delete set null,
  job_id bigint references public.sync_jobs (id) on delete set null,
  -- Évènement technique et message : jamais de donnée sportive.
  event text not null check (char_length(event) <= 80),
  message text check (char_length(message) <= 500)
);
create index sync_logs_created on public.sync_logs (created_at desc);
create index sync_logs_athlete on public.sync_logs (athlete_id);
create index sync_logs_job on public.sync_logs (job_id);

create table public.provider_state (
  provider text primary key check (provider in ('strava')),
  -- Abonnement webhook de l'application (un seul par application Strava).
  subscription_id bigint,
  subscription_callback text check (char_length(subscription_callback) <= 255),
  -- Derniers quotas lus dans les en-têtes de réponse (fenêtre de 15 minutes et journée UTC).
  rate_limit jsonb,
  rate_observed_at timestamptz,
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create trigger provider_state_updated_at before update on public.provider_state
for each row execute function private.set_updated_at();

/** Réserve les jobs à exécuter (les jobs restés bloqués plus de 10 minutes sont repris). */
create function public.claim_sync_jobs(p_limit integer)
returns setof public.sync_jobs
language sql
security definer
set search_path = ''
as $$
  update public.sync_jobs j
  set status = 'running', locked_at = now(), attempts = j.attempts + 1
  where j.id in (
    select q.id from public.sync_jobs q
    where (q.status in ('pending', 'failed') and q.run_after <= now())
       or (q.status = 'running' and q.locked_at < now() - interval '10 minutes')
    order by q.run_after, q.id
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  returning j.*;
$$;

/**
 * Enregistre des activités lues chez Strava pour une connexion (serveur seulement). Une relecture
 * met les valeurs à jour mais ne repousse jamais l'effacement fixé à la première lecture.
 */
create function public.upsert_strava_activities(p_connection uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.external_connections;
  v_count integer;
begin
  select * into v_connection from public.external_connections where id = p_connection;
  if not found then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'invalid_activity_payload' using errcode = '22023';
  end if;

  insert into public.activities as a (
    athlete_id, source, external_id, connection_id, sport, sport_detail, name, start_time, local_date, local_start_time,
    timezone, elapsed_s, moving_s, distance_m, elevation_gain_m, avg_hr, max_hr, avg_power, weighted_power, max_power,
    avg_cadence, avg_speed_mps, trainer, manual, device_name, fetched_at, expires_at
  )
  select v_connection.athlete_id, 'strava', i.external_id, v_connection.id, i.sport, i.sport_detail, i.name, i.start_time,
         i.local_date, i.local_start_time, i.timezone, i.elapsed_s, i.moving_s, i.distance_m, i.elevation_gain_m, i.avg_hr,
         i.max_hr, i.avg_power, i.weighted_power, i.max_power, i.avg_cadence, i.avg_speed_mps, i.trainer, i.manual,
         i.device_name, now(), now() + interval '6 days'
  from jsonb_to_recordset(p_items) as i (
    external_id text, sport text, sport_detail text, name text, start_time timestamptz, local_date date,
    local_start_time time, timezone text, elapsed_s integer, moving_s integer, distance_m numeric,
    elevation_gain_m numeric, avg_hr smallint, max_hr smallint, avg_power smallint, weighted_power smallint,
    max_power smallint, avg_cadence smallint, avg_speed_mps numeric, trainer boolean, manual boolean, device_name text
  )
  on conflict (external_id) where source = 'strava' do update set
    sport = excluded.sport,
    sport_detail = excluded.sport_detail,
    name = excluded.name,
    start_time = excluded.start_time,
    local_date = excluded.local_date,
    local_start_time = excluded.local_start_time,
    timezone = excluded.timezone,
    elapsed_s = excluded.elapsed_s,
    moving_s = excluded.moving_s,
    distance_m = excluded.distance_m,
    elevation_gain_m = excluded.elevation_gain_m,
    avg_hr = excluded.avg_hr,
    max_hr = excluded.max_hr,
    avg_power = excluded.avg_power,
    weighted_power = excluded.weighted_power,
    max_power = excluded.max_power,
    avg_cadence = excluded.avg_cadence,
    avg_speed_mps = excluded.avg_speed_mps,
    trainer = excluded.trainer,
    manual = excluded.manual,
    device_name = excluded.device_name,
    fetched_at = excluded.fetched_at,
    expires_at = least(a.expires_at, excluded.expires_at)
  -- Un identifiant Strava appartient à un seul athlète : jamais de réattribution.
  where a.connection_id = excluded.connection_id;
  get diagnostics v_count = row_count;

  update public.external_connections
  set last_sync_at = now(), last_error = null, last_error_at = null
  where id = p_connection;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Temps réel
-- ---------------------------------------------------------------------------

/**
 * Canaux privés : « athlete:<id> » pour l'athlète et ses coachs actifs ; « self:<id> » pour
 * l'athlète seul (tout ce qui vient de Strava, que ses coachs ne doivent pas voir).
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
  if p_topic ~ '^athlete:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return private.has_athlete_access(substring(p_topic from 9)::uuid);
  end if;
  return false;
end;
$$;

/** Signal sans contenu ; ce qui vient de Strava part sur le canal de l'athlète seul. */
create function private.broadcast_activity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_private boolean;
begin
  if tg_table_name = 'activities' then
    v_private := v_row ->> 'source' = 'strava';
  elsif tg_table_name = 'session_activity_matches' then
    select a.source = 'strava' into v_private from public.activities a where a.id = (v_row ->> 'activity_id')::uuid;
    -- Activité déjà effacée : seul l'athlète est prévenu.
    v_private := coalesce(v_private, true);
  else
    v_private := false;
  end if;

  perform realtime.send(
    jsonb_build_object('table', tg_table_name, 'op', lower(tg_op), 'session_id', v_row ->> 'session_id'),
    'planning_changed',
    case when v_private then 'self:' else 'athlete:' end || (v_row ->> 'athlete_id'),
    true
  );
  return null;
end;
$$;

create trigger broadcast_activities after insert or update or delete on public.activities
for each row execute function private.broadcast_activity_change();
create trigger broadcast_session_activity_matches after insert or update or delete on public.session_activity_matches
for each row execute function private.broadcast_activity_change();
create trigger broadcast_session_completions after insert or update or delete on public.session_completions
for each row execute function private.broadcast_activity_change();

-- ---------------------------------------------------------------------------
-- Purge et état des synchronisations
-- ---------------------------------------------------------------------------

/** Effacements périodiques : activités Strava expirées, jobs terminés, journaux anciens. */
create function public.run_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activities integer;
  v_jobs integer;
  v_logs integer;
begin
  delete from public.activities where expires_at <= now();
  get diagnostics v_activities = row_count;
  delete from public.sync_jobs where status in ('done', 'dead') and updated_at < now() - interval '7 days';
  get diagnostics v_jobs = row_count;
  delete from public.sync_logs where created_at < now() - interval '30 days';
  get diagnostics v_logs = row_count;
  return jsonb_build_object('activities', v_activities, 'jobs', v_jobs, 'logs', v_logs);
end;
$$;

/** L'athlète efface ses propres activités Strava expirées (appelé à l'affichage, en plus de la purge). */
create function public.purge_my_expired_activities()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.activities where athlete_id = (select auth.uid()) and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/**
 * État des connexions d'athlètes, pour eux-mêmes et leurs coachs (statut seulement, aucune donnée
 * du fournisseur). Les athlètes auxquels l'appelant n'a pas accès sont ignorés.
 */
create function public.athlete_sync_status(p_athletes uuid[])
returns table (athlete_id uuid, provider text, status text, last_sync_at timestamptz, last_error text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.athlete_id, c.provider, c.status, c.last_sync_at, c.last_error
  from public.external_connections c
  where c.athlete_id = any (p_athletes) and private.has_athlete_access(c.athlete_id);
$$;

/** Nombre de comptes reliés par fournisseur et statut, pour l'administration (capacité Strava). */
create function public.admin_connection_counts()
returns table (provider text, status text, connections bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select c.provider, c.status, count(*)
    from public.external_connections c
    group by c.provider, c.status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilèges et politiques
-- ---------------------------------------------------------------------------

revoke all on function
  private.coach_can_view_activities(uuid),
  private.prepare_session_completion(),
  private.session_slots(text, jsonb),
  private.match_score(text, date, time, integer, numeric, text, boolean, date, time, integer, numeric),
  private.rematch_window(uuid, date, date),
  private.rematch_after_activity_change(),
  private.rematch_after_session_change(),
  private.can_manage_activity(uuid),
  private.broadcast_activity_change()
from public, anon, authenticated;
grant execute on function
  private.coach_can_view_activities(uuid),
  private.can_manage_activity(uuid)
to authenticated, service_role;

revoke all on function
  public.associate_activity(uuid, uuid),
  public.dissociate_activity(uuid, uuid),
  public.upsert_strava_activities(uuid, jsonb),
  public.claim_sync_jobs(integer),
  public.run_maintenance(),
  public.purge_my_expired_activities(),
  public.athlete_sync_status(uuid[]),
  public.admin_connection_counts()
from public, anon, authenticated;
grant execute on function
  public.associate_activity(uuid, uuid),
  public.dissociate_activity(uuid, uuid),
  public.purge_my_expired_activities(),
  public.athlete_sync_status(uuid[]),
  public.admin_connection_counts()
to authenticated;
grant execute on function
  public.upsert_strava_activities(uuid, jsonb),
  public.claim_sync_jobs(integer),
  public.run_maintenance()
to service_role;

alter table public.external_connections enable row level security;
alter table public.oauth_tokens enable row level security;
alter table public.activities enable row level security;
alter table public.session_activity_matches enable row level security;
alter table public.session_completions enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.sync_logs enable row level security;
alter table public.provider_state enable row level security;

revoke all on
  public.external_connections, public.oauth_tokens, public.activities, public.session_activity_matches,
  public.session_completions, public.sync_jobs, public.sync_logs, public.provider_state
from anon, authenticated;

-- Connexions : l'athlète voit les siennes ; le serveur seul les écrit. -----------------------
grant select on public.external_connections to authenticated;
create policy external_connections_select_own on public.external_connections for select to authenticated
using (athlete_id = (select auth.uid()));

-- Jetons : aucune politique, aucun privilège : invisibles pour l'API. -----------------------

-- Activités ------------------------------------------------------------------------------
grant select, delete on public.activities to authenticated;
grant insert (
  source, external_id, group_key, sport, sport_detail, name, start_time, local_date, local_start_time, timezone,
  elapsed_s, moving_s, distance_m, elevation_gain_m, avg_hr, max_hr, avg_power, weighted_power, max_power,
  avg_cadence, avg_speed_mps, trainer, manual, device_name
) on public.activities to authenticated;

-- Strava : l'athlète seul, et jusqu'à l'expiration. FIT : l'athlète et les coachs qu'il autorise.
create policy activities_select on public.activities for select to authenticated
using (
  (athlete_id = (select auth.uid()) and (expires_at is null or expires_at > now()))
  or (source <> 'strava' and private.coach_can_view_activities(athlete_id))
);
create policy activities_insert_own_files on public.activities for insert to authenticated
with check (athlete_id = (select auth.uid()) and source = 'fit_upload');
create policy activities_delete_own_files on public.activities for delete to authenticated
using (athlete_id = (select auth.uid()) and source = 'fit_upload');

-- Rapprochements : comme l'activité concernée (la sous-requête applique sa politique). -------
grant select on public.session_activity_matches to authenticated;
create policy session_activity_matches_select on public.session_activity_matches for select to authenticated
using (
  exists (select 1 from public.activities a where a.id = session_activity_matches.activity_id)
  and exists (select 1 from public.planned_sessions s where s.id = session_activity_matches.session_id)
);

-- Déclarations : écrites par l'athlète, lues par lui et ses coachs. --------------------------
grant select, delete on public.session_completions to authenticated;
grant insert (session_id, status, rpe, note) on public.session_completions to authenticated;
-- session_id figure dans la mise à jour d'un « upsert » ; le trigger interdit d'en changer la valeur.
grant update (session_id, status, rpe, note) on public.session_completions to authenticated;
create policy session_completions_select on public.session_completions for select to authenticated
using (private.has_athlete_access(athlete_id));
create policy session_completions_insert on public.session_completions for insert to authenticated
with check (
  athlete_id = (select auth.uid())
  and exists (select 1 from public.planned_sessions s where s.id = session_completions.session_id)
);
create policy session_completions_update on public.session_completions for update to authenticated
using (athlete_id = (select auth.uid()))
with check (athlete_id = (select auth.uid()));
create policy session_completions_delete on public.session_completions for delete to authenticated
using (athlete_id = (select auth.uid()));

-- Synchronisation : lecture par les administrateurs, sans les paramètres des jobs. ------------
grant select (id, kind, status, attempts, max_attempts, run_after, last_error, created_at, updated_at, finished_at)
on public.sync_jobs to authenticated;
create policy sync_jobs_select_admin on public.sync_jobs for select to authenticated
using (private.is_admin());

grant select on public.sync_logs to authenticated;
create policy sync_logs_select_admin on public.sync_logs for select to authenticated
using (private.is_admin());

grant select on public.provider_state to authenticated;
create policy provider_state_select_admin on public.provider_state for select to authenticated
using (private.is_admin());
