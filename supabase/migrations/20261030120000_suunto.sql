-- Suunto : envoi automatique des séances prévues sur la montre, sous forme de guides SuuntoPlus.
--
-- L'athlète relie son compte Suunto (OAuth 2.0, jetons chiffrés dans oauth_tokens comme Strava).
-- Chaque séance publiée des 14 prochains jours devient un guide sur son compte Suunto ; l'appli
-- Suunto du téléphone le transmet à la montre à la synchronisation. Une modification de la séance
-- met le guide à jour, une annulation ou une suppression le retire. Le serveur seul écrit ici.

-- ---------------------------------------------------------------------------
-- 1. Suunto parmi les fournisseurs
-- ---------------------------------------------------------------------------

alter table public.external_connections drop constraint external_connections_provider_check;
alter table public.external_connections add constraint external_connections_provider_check check (provider in ('strava', 'suunto'));
comment on table public.external_connections is
  'Comptes externes reliés par l''athlète (Strava, Suunto). Écrits uniquement par le serveur.';

alter table public.sync_jobs drop constraint sync_jobs_kind_check;
alter table public.sync_jobs add constraint sync_jobs_kind_check
  check (kind in ('strava_event', 'strava_sync', 'maintenance', 'suunto_push', 'suunto_remove'));

alter table public.sync_logs drop constraint sync_logs_provider_check;
alter table public.sync_logs add constraint sync_logs_provider_check check (provider in ('strava', 'fit', 'suunto'));

alter table public.provider_state drop constraint provider_state_provider_check;
alter table public.provider_state add constraint provider_state_provider_check check (provider in ('strava', 'suunto'));

-- ---------------------------------------------------------------------------
-- 2. Guides envoyés : un par partie de séance (un enchaînement donne un guide par discipline)
-- ---------------------------------------------------------------------------

create table public.suunto_guides (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.planned_sessions (id) on delete cascade,
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  segment_index smallint not null default 0 check (segment_index between 0 and 5),
  -- Identifiant du guide chez Suunto ; null tant que le premier envoi n'a pas abouti.
  guide_id text check (char_length(guide_id) between 1 and 120),
  -- Version de la séance envoyée : une version plus récente est à renvoyer.
  session_version integer not null check (session_version >= 1),
  status text not null check (status in ('sent', 'failed', 'removed')),
  -- Écarts du contrôle de compatibilité au dernier envoi : [{severity, message, where?}].
  issues jsonb not null default '[]' check (jsonb_typeof(issues) = 'array' and jsonb_array_length(issues) <= 300),
  -- Code d'erreur stable ou message court, jamais une donnée du fournisseur.
  last_error text check (char_length(last_error) <= 300),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint suunto_guides_one_per_segment unique (session_id, segment_index)
);
comment on table public.suunto_guides is
  'Guides SuuntoPlus envoyés pour les séances prévues : état du dernier envoi, par partie de séance. Écrits par le serveur.';
create index suunto_guides_athlete on public.suunto_guides (athlete_id);

create trigger suunto_guides_updated_at before update on public.suunto_guides
for each row execute function private.set_updated_at();

alter table public.suunto_guides enable row level security;

-- L'athlète et ses coachs lisent l'état des envois ; personne n'écrit par l'API.
create policy suunto_guides_select on public.suunto_guides for select to authenticated
using (private.has_athlete_access(athlete_id));

-- ---------------------------------------------------------------------------
-- 3. Mise en file automatique : toute séance d'un athlète relié à Suunto est (re)envoyée
-- ---------------------------------------------------------------------------

create function private.suunto_connected(p_athlete uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.external_connections c
    where c.athlete_id = p_athlete and c.provider = 'suunto' and c.status = 'active'
  );
$$;

/**
 * Après chaque écriture d'une séance : un job « suunto_push » (idempotent par version). Le serveur
 * décide ensuite d'envoyer, de mettre à jour ou de retirer le guide selon l'état et la date.
 */
create function private.enqueue_suunto_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.suunto_connected(new.athlete_id) then
    return new;
  end if;
  insert into public.sync_jobs (kind, athlete_id, payload, dedupe_key)
  values ('suunto_push', new.athlete_id, jsonb_build_object('session_id', new.id), 'suunto:push:' || new.id || ':v' || new.version)
  on conflict (dedupe_key) do nothing;
  return new;
end;
$$;

create trigger planned_sessions_suunto_push
after insert or update of content, title, description, nutrition_notes, scheduled_date, state on public.planned_sessions
for each row execute function private.enqueue_suunto_push();

/**
 * Avant la suppression d'une séance : les guides déjà envoyés sont à retirer de la montre ; la ligne
 * suunto_guides disparaît avec la séance, d'où les identifiants recopiés dans le job.
 */
create function private.enqueue_suunto_remove()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids text[];
begin
  select array_agg(g.guide_id) into v_ids
  from public.suunto_guides g
  where g.session_id = old.id and g.guide_id is not null and g.status <> 'removed';
  if v_ids is null or cardinality(v_ids) = 0 then
    return old;
  end if;
  insert into public.sync_jobs (kind, athlete_id, payload, dedupe_key)
  values ('suunto_remove', old.athlete_id, jsonb_build_object('guide_ids', to_jsonb(v_ids)), 'suunto:remove:' || old.id)
  on conflict (dedupe_key) do nothing;
  return old;
end;
$$;

create trigger planned_sessions_suunto_remove
before delete on public.planned_sessions
for each row execute function private.enqueue_suunto_remove();

-- ---------------------------------------------------------------------------
-- 4. Lecture serveur : séances à envoyer pour une connexion (fenêtre glissante)
-- ---------------------------------------------------------------------------

/**
 * Séances publiées d'un athlète entre aujourd'hui et p_days jours, avec l'état du guide de chaque
 * partie. Appelée par le serveur (clé secrète) à la connexion et chaque jour, pour rattraper les
 * séances entrées dans la fenêtre sans avoir été modifiées.
 */
create function public.suunto_sessions_to_push(p_athlete uuid, p_today date, p_days integer)
returns table (session_id uuid, session_version integer, sent_version integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.version, min(g.session_version)
  from public.planned_sessions s
  left join public.suunto_guides g on g.session_id = s.id and g.status = 'sent'
  where s.athlete_id = p_athlete
    and s.state = 'published'
    and s.scheduled_date between p_today and p_today + greatest(1, least(p_days, 60))
  group by s.id, s.version;
$$;

revoke execute on function public.suunto_sessions_to_push(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.suunto_sessions_to_push(uuid, date, integer) to service_role;
