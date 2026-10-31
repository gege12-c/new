-- Une même sortie enregistrée par deux appareils (compteur Garmin et montre Suunto, par exemple) et
-- reçue deux fois d'intervals.icu, ou importée en deux fichiers FIT : un seul original, compté et
-- rapproché ; l'autre devient un doublon. Les activités Strava entre elles restent comparées comme
-- avant (jamais fusionnées).
--
-- L'original : comme avant, la source durable (montre, fichier) avant Strava ; puis, nouveau, la plus
-- complète (avec la puissance, puis la fréquence cardiaque, puis la distance) ; puis la première arrivée.

/**
 * Même séance faite : même athlète, même discipline (renforcement et « autre » ensemble), départ à
 * 5 minutes près (heure locale comprise quand les deux la donnent), durée à 20 % près quand les deux
 * la donnent ; sources différentes, ou même source durable (deux appareils sur la même sortie).
 */
create or replace function private.same_workout(a public.activities, b public.activities)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select a.id <> b.id
    and a.athlete_id = b.athlete_id
    and (a.source <> b.source or a.source in ('intervals', 'fit_upload'))
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
 * Désigne l'original parmi les activités qui décrivent la même séance faite que p_activity (source
 * durable avant Strava, puis la plus complète, puis la première arrivée), marque les autres comme
 * doublons (décisions reportées), puis recalcule les rapprochements autour.
 */
create or replace function private.resolve_activity_duplicates(p_activity uuid)
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

  select array_agg(a.id order by private.activity_source_rank(a.source), a.avg_power is null, a.avg_hr is null, a.distance_m is null, a.created_at, a.id),
         array_agg(a.duplicate_of order by private.activity_source_rank(a.source), a.avg_power is null, a.avg_hr is null, a.distance_m is null, a.created_at, a.id),
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

create or replace function private.activities_after_change_dedupe()
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
  -- Un doublon qui le reste (date, durée et mesures inchangées) : rien à refaire.
  if tg_op = 'UPDATE' and new.duplicate_of is not null
     and (new.start_time, new.local_start_time, new.elapsed_s, new.moving_s, new.sport, new.avg_power, new.avg_hr, new.distance_m)
         is not distinct from (old.start_time, old.local_start_time, old.elapsed_s, old.moving_s, old.sport, old.avg_power, old.avg_hr, old.distance_m) then
    return null;
  end if;
  perform private.resolve_activity_duplicates(new.id);
  return null;
end;
$$;

-- Le détail d'un appareil change (analyse terminée chez intervals.icu, puissance ajoutée) : l'original
-- peut changer aussi.
create or replace trigger activities_dedupe
after insert or update of start_time, local_start_time, elapsed_s, moving_s, sport, duplicate_of, avg_power, avg_hr, distance_m
on public.activities
for each row execute function private.activities_after_change_dedupe();

-- Sorties déjà reçues deux fois (deux appareils) : résolues maintenant.
do $$
declare
  r record;
begin
  for r in
    select a.id
    from public.activities a
    where a.source in ('intervals', 'fit_upload')
      and exists (
        select 1 from public.activities b
        where b.athlete_id = a.athlete_id
          and b.source = a.source
          and b.local_date between a.local_date - 1 and a.local_date + 1
          and private.same_workout(a, b)
      )
    order by a.start_time
  loop
    perform private.resolve_activity_duplicates(r.id);
  end loop;
end;
$$;
