-- Activités reçues d'intervals.icu, doublons entre sources, version du schéma pour le contrôle de production.
--
-- intervals.icu reçoit les activités des montres Suunto, Garmin et COROS (partenaire officiel) et les
-- transmet par son API à l'athlète qui a relié sa clé ; celles qu'il tient de Strava ne sont jamais
-- transmises (règles de Strava). Une même séance faite peut donc arriver par Strava, par intervals.icu
-- et par un fichier FIT : la base n'en garde qu'un original, les autres sont marquées « doublon ».

-- ---------------------------------------------------------------------------
-- 1. Source « intervals » et doublons
-- ---------------------------------------------------------------------------

alter table public.activities drop constraint activities_source_check;
alter table public.activities add constraint activities_source_check check (source in ('strava', 'fit_upload', 'intervals'));

alter table public.activities add column duplicate_of uuid references public.activities (id) on delete set null;
alter table public.activities add constraint activities_not_own_duplicate check (duplicate_of is distinct from id);
comment on column public.activities.duplicate_of is
  'Même séance faite, arrivée par une autre source : l''original. Un doublon n''est ni rapproché, ni compté, ni affiché.';
create index activities_duplicate_of on public.activities (duplicate_of) where duplicate_of is not null;

-- Réception des activités par intervals.icu : dernière réception, et activités qu'intervals.icu ne
-- transmet pas (reçues de Strava) lors de la dernière réception.
alter table public.external_connections add column activities_synced_at timestamptz;
alter table public.external_connections add column activities_skipped integer not null default 0 check (activities_skipped >= 0);

-- ---------------------------------------------------------------------------
-- 2. Reconnaître une même séance faite, arrivée par deux sources
-- ---------------------------------------------------------------------------

/** Source préférée pour l'original : les données durables (fichier, montre) avant le cache Strava. */
create function private.activity_source_rank(p_source text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_source when 'strava' then 2 else 1 end;
$$;

/**
 * Même séance faite : même athlète, sources différentes, même discipline (renforcement et « autre »
 * ensemble), départ à 5 minutes près (heure locale comprise quand les deux la donnent), durée à 20 %
 * près quand les deux la donnent.
 */
create function private.same_workout(a public.activities, b public.activities)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select a.id <> b.id
    and a.athlete_id = b.athlete_id
    and a.source <> b.source
    and (a.sport = b.sport or (a.sport in ('strength', 'other') and b.sport in ('strength', 'other')))
    and abs(extract(epoch from (a.start_time - b.start_time))) <= 300
    and (
      a.local_start_time is null or b.local_start_time is null or a.local_date <> b.local_date
      or abs(extract(epoch from (a.local_start_time - b.local_start_time))) <= 300
    )
    and (
      coalesce(a.elapsed_s, a.moving_s) is null or coalesce(b.elapsed_s, b.moving_s) is null
      or coalesce(a.elapsed_s, a.moving_s) between 0.8 * coalesce(b.elapsed_s, b.moving_s) and 1.25 * coalesce(b.elapsed_s, b.moving_s)
    );
$$;

/**
 * Reporte sur l'original les décisions prises sur un doublon : un rattachement confirmé (si
 * l'original n'en a pas déjà un) et les séances écartées. Le reste est recalculé.
 */
create function private.transfer_activity_decisions(p_from uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
begin
  select m.session_id into v_session
  from public.session_activity_matches m
  where m.activity_id = p_from and m.status = 'confirmed';
  if v_session is not null
     and not exists (select 1 from public.session_activity_matches m where m.activity_id = p_to and m.status = 'confirmed') then
    delete from public.session_activity_matches m
    where m.activity_id = p_to and (m.status in ('auto', 'proposed') or m.session_id = v_session);
    update public.session_activity_matches m set activity_id = p_to
    where m.activity_id = p_from and m.status = 'confirmed';
  end if;
  update public.session_activity_matches m set activity_id = p_to
  where m.activity_id = p_from
    and m.status = 'rejected'
    and not exists (select 1 from public.session_activity_matches x where x.activity_id = p_to and x.session_id = m.session_id);
  delete from public.session_activity_matches m where m.activity_id = p_from;
end;
$$;

/**
 * Désigne l'original parmi les activités qui décrivent la même séance faite que p_activity, marque
 * les autres comme doublons (décisions reportées), puis recalcule les rapprochements autour.
 */
create function private.resolve_activity_duplicates(p_activity uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_self public.activities;
  v_ids uuid[];
  v_current uuid[];
  v_primary uuid;
  v_member uuid;
  v_from date;
  v_to date;
  i integer;
begin
  select * into v_self from public.activities where id = p_activity;
  if not found then
    return;
  end if;
  -- Même verrou que le rapprochement : un seul recalcul à la fois par athlète.
  perform pg_advisory_xact_lock(hashtextextended('tricoach:rematch:' || v_self.athlete_id::text, 0));
  perform set_config('tricoach.resolving_duplicates', 'on', true);

  select array_agg(a.id order by private.activity_source_rank(a.source), a.created_at, a.id),
         array_agg(a.duplicate_of order by private.activity_source_rank(a.source), a.created_at, a.id),
         min(a.local_date), max(a.local_date)
  into v_ids, v_current, v_from, v_to
  from public.activities a
  where a.athlete_id = v_self.athlete_id
    and a.local_date between v_self.local_date - 1 and v_self.local_date + 1
    and (a.expires_at is null or a.expires_at > now())
    and (a.id = v_self.id or private.same_workout(a, v_self));

  v_primary := v_ids[1];
  for i in 2 .. coalesce(array_length(v_ids, 1), 1) loop
    v_member := v_ids[i];
    if v_current[i] is distinct from v_primary then
      perform private.transfer_activity_decisions(v_member, v_primary);
      update public.activities set duplicate_of = v_primary where id = v_member;
    end if;
  end loop;
  update public.activities set duplicate_of = null where id = v_primary and duplicate_of is not null;

  perform set_config('tricoach.resolving_duplicates', 'off', true);
  perform private.rematch_window(v_self.athlete_id, v_from - 1, v_to + 1);
end;
$$;

create function private.activities_after_change_dedupe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Changements faits par la résolution elle-même : rien à refaire.
  if coalesce(current_setting('tricoach.resolving_duplicates', true), 'off') = 'on' then
    return null;
  end if;
  -- Un doublon qui le reste (sa date et sa durée n'ont pas bougé) : rien à refaire.
  if tg_op = 'UPDATE' and new.duplicate_of is not null
     and (new.start_time, new.local_start_time, new.elapsed_s, new.moving_s, new.sport)
         is not distinct from (old.start_time, old.local_start_time, old.elapsed_s, old.moving_s, old.sport) then
    return null;
  end if;
  perform private.resolve_activity_duplicates(new.id);
  return null;
end;
$$;

-- Avant « activities_rematch » (ordre alphabétique des déclencheurs) : le rapprochement ne voit
-- jamais un doublon. Un original effacé libère ses doublons (« on delete set null ») : l'un d'eux
-- devient l'original.
create trigger activities_dedupe
after insert or update of start_time, local_start_time, elapsed_s, moving_s, sport, duplicate_of
on public.activities
for each row execute function private.activities_after_change_dedupe();

-- ---------------------------------------------------------------------------
-- 3. Le rapprochement ignore les doublons
-- ---------------------------------------------------------------------------

create or replace function private.rematch_window(p_athlete uuid, p_from date, p_to date)
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
  -- « where true » : l'extension pg_safeupdate de Supabase refuse tout DELETE sans WHERE, y compris
  -- dans une fonction appelée par l'API (la table peut déjà exister si un trigger précédent l'a créée).
  delete from pg_temp.tc_rematch_pairs where true;

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
    -- Doublon d'une activité d'une autre source (même séance faite) : seul l'original compte.
    and a.duplicate_of is null
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

-- ---------------------------------------------------------------------------
-- 4. Version du schéma, pour le contrôle de production (sans compte ni secret)
-- ---------------------------------------------------------------------------

/** Dernière migration inscrite dans l'historique Supabase, ou null hors de Supabase. */
create function public.schema_version()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    return null;
  end if;
  execute 'select max(version) from supabase_migrations.schema_migrations' into v_version;
  return v_version;
end;
$$;

revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to anon, authenticated, service_role;

revoke all on function
  private.activity_source_rank(text),
  private.same_workout(public.activities, public.activities),
  private.transfer_activity_decisions(uuid, uuid),
  private.resolve_activity_duplicates(uuid),
  private.activities_after_change_dedupe()
from public, anon, authenticated;
