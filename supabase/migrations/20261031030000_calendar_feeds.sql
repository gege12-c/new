-- Agenda du téléphone : adresse d'abonnement iCalendar, secrète et révocable, par athlète.
--
-- L'athlète crée une adresse (le jeton n'est montré qu'une fois et gardé sous forme d'empreinte) ;
-- son application d'agenda (Google Agenda, Apple Calendrier, Outlook) la relit d'elle-même et y
-- trouve ses séances publiées. Une nouvelle adresse remplace l'ancienne ; la retirer coupe l'accès.

create table public.calendar_feeds (
  athlete_id uuid primary key references public.profiles (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_read_at timestamptz
);
comment on table public.calendar_feeds is
  'Abonnement d''agenda d''un athlète : empreinte du jeton seulement ; lu par la fonction calendar_feed.';

alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from anon, authenticated;
-- L'athlète voit qu'il a une adresse et quand elle a été lue, jamais l'empreinte.
grant select (athlete_id, created_at, last_read_at) on public.calendar_feeds to authenticated;
create policy calendar_feeds_select_own on public.calendar_feeds for select to authenticated
using (athlete_id = (select auth.uid()));

/** Nouvelle adresse pour l'athlète connecté (remplace l'ancienne) ; le jeton n'est rendu qu'ici. */
create function public.create_calendar_feed()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  insert into public.calendar_feeds (athlete_id, token_hash)
  values (v_user, private.hash_token(v_token))
  on conflict (athlete_id) do update set token_hash = excluded.token_hash, created_at = now(), last_read_at = null;
  return v_token;
end;
$$;

/** Retire l'adresse de l'athlète connecté : l'agenda ne reçoit plus rien. */
create function public.revoke_calendar_feed()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  delete from public.calendar_feeds f where f.athlete_id = v_user;
  return found;
end;
$$;

/**
 * Contenu de l'agenda d'un jeton : séances publiées et annulées (pour les retirer de l'agenda) de 60
 * jours en arrière à 180 jours en avant, seuils (cibles en valeurs absolues), compétitions et jours
 * indisponibles ; « unauthorized » si le jeton est inconnu. Appelée sans compte par la route de l'agenda.
 */
create function public.calendar_feed(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_feed public.calendar_feeds;
  v_profile public.profiles;
  v_today date;
begin
  select * into v_feed from public.calendar_feeds f where f.token_hash = private.hash_token(coalesce(p_token, ''));
  if not found then
    return jsonb_build_object('status', 'unauthorized');
  end if;
  update public.calendar_feeds f
  set last_read_at = now()
  where f.athlete_id = v_feed.athlete_id
    and (f.last_read_at is null or f.last_read_at < now() - interval '10 minutes');

  select * into v_profile from public.profiles p where p.id = v_feed.athlete_id;
  v_today := (now() at time zone coalesce(v_profile.timezone, 'Europe/Paris'))::date;

  return jsonb_build_object(
    'status', 'ok',
    'athlete', jsonb_build_object('name', v_profile.display_name, 'timezone', v_profile.timezone),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'scheduled_date', s.scheduled_date,
          'start_time', s.start_time,
          'sport', s.sport,
          'title', s.title,
          'objective', s.objective,
          'description', s.description,
          'nutrition_notes', s.nutrition_notes,
          'content', s.content,
          'planned_duration_s', s.planned_duration_s,
          'planned_distance_m', s.planned_distance_m,
          'state', s.state,
          'version', s.version,
          'updated_at', s.updated_at
        ) order by s.scheduled_date, s.start_time nulls last, s.created_at)
      from public.planned_sessions s
      where s.athlete_id = v_feed.athlete_id
        and s.state in ('published', 'cancelled')
        and s.scheduled_date between v_today - 60 and v_today + 180
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', e.id, 'name', e.name, 'event_date', e.event_date, 'priority', e.priority, 'location', e.location, 'updated_at', e.updated_at
        ) order by e.event_date)
      from public.athlete_events e
      where e.athlete_id = v_feed.athlete_id
        and e.event_date between v_today - 60 and v_today + 400
    ), '[]'::jsonb),
    'thresholds', coalesce((
      select jsonb_agg(jsonb_build_object('sport', t.sport, 'metric', t.metric, 'value', t.value, 'effective_from', t.effective_from))
      from public.athlete_thresholds t
      where t.athlete_id = v_feed.athlete_id
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', n.id, 'kind', n.kind, 'start_date', n.start_date, 'end_date', n.end_date, 'title', n.title, 'updated_at', n.updated_at
        ) order by n.start_date)
      from public.calendar_notes n
      where n.athlete_id = v_feed.athlete_id
        and n.kind <> 'note'
        and n.end_date >= v_today - 60
        and n.start_date <= v_today + 180
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.create_calendar_feed(), public.revoke_calendar_feed(), public.calendar_feed(text) from public, anon, authenticated;
grant execute on function public.create_calendar_feed(), public.revoke_calendar_feed() to authenticated;
-- L'application d'agenda n'a pas de compte : le jeton est la seule clé.
grant execute on function public.calendar_feed(text) to anon, authenticated, service_role;
