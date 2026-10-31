-- Montres : les séances publiées partent seules vers la montre de l'athlète.
--
-- Deux voies, chacune liée à un compte que l'athlète relie lui-même :
--   * intervals.icu, partenaire officiel de Suunto, Garmin et COROS : TriCoach dépose les séances
--     dans le calendrier intervals.icu de l'athlète (sa clé API personnelle), intervals.icu les
--     transmet à la ou aux montres reliées chez lui ;
--   * Suunto en direct (guides SuuntoPlus, API Cloud de Suunto), dès que TriCoach a l'accès partenaire.
-- Chaque séance publiée à venir devient un envoi par discipline ; il est mis à jour quand la séance
-- ou les seuils changent, et retiré quand la séance est annulée, supprimée, repassée en brouillon ou
-- déplacée hors de la fenêtre. La base ne garde que l'identifiant de l'envoi chez le fournisseur et
-- son état : aucune donnée venue du fournisseur.
--
-- 1. Connexions, journaux et file de jobs : fournisseurs « suunto » et « intervals »
-- 2. Séances envoyées
-- 3. Réservation des jobs par type, bail d'envoi par compte relié
-- 4. Mise en file à chaque changement d'une séance publiée ou des seuils
-- 5. Privilèges et politiques

-- ---------------------------------------------------------------------------
-- 1. Fournisseurs et types de jobs
-- ---------------------------------------------------------------------------

alter table public.external_connections drop constraint external_connections_provider_check;
alter table public.external_connections add constraint external_connections_provider_check check (provider in ('strava', 'suunto', 'intervals'));
-- Identifiants de compte plus longs qu'un identifiant Strava (nom d'utilisateur Suunto).
alter table public.external_connections drop constraint external_connections_external_athlete_id_check;
alter table public.external_connections
  add constraint external_connections_external_athlete_id_check check (char_length(external_athlete_id) between 1 and 100);
-- Bail d'envoi : un seul envoi à la fois par compte relié (posé et levé par le serveur).
alter table public.external_connections add column sync_lease_until timestamptz;
comment on table public.external_connections is
  'Comptes externes reliés par l''athlète (Strava, intervals.icu, Suunto). Écrits uniquement par le serveur.';

alter table public.sync_logs drop constraint sync_logs_provider_check;
alter table public.sync_logs add constraint sync_logs_provider_check check (provider in ('strava', 'fit', 'suunto', 'intervals'));

alter table public.provider_state drop constraint provider_state_provider_check;
alter table public.provider_state add constraint provider_state_provider_check check (provider in ('strava', 'suunto', 'intervals'));

alter table public.sync_jobs drop constraint sync_jobs_kind_check;
alter table public.sync_jobs
  add constraint sync_jobs_kind_check check (kind in ('strava_event', 'strava_sync', 'maintenance', 'suunto_sync', 'intervals_sync'));
create index sync_jobs_kind_athlete on public.sync_jobs (kind, athlete_id) where status in ('pending', 'failed', 'running');

-- ---------------------------------------------------------------------------
-- 2. Séances envoyées
-- ---------------------------------------------------------------------------

create table public.device_workouts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.external_connections (id) on delete cascade,
  provider text not null check (provider in ('suunto', 'intervals')),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  -- Séance d'origine ; une séance supprimée laisse sa ligne jusqu'au retrait chez le fournisseur.
  session_id uuid references public.planned_sessions (id) on delete set null,
  -- Partie de la séance (un enchaînement donne un envoi par discipline).
  segment_index smallint not null check (segment_index between 0 and 5),
  -- Identifiant donné par TriCoach : unique par compte relié, il rend chaque envoi idempotent.
  external_id text not null check (external_id ~ '^tricoach-[0-9a-f-]{36}-[0-5]$'),
  -- Identifiant chez le fournisseur (guide Suunto, évènement intervals.icu), connu après l'envoi.
  remote_id text check (char_length(remote_id) between 1 and 100),
  -- Version de la séance et empreinte de ce qui a été envoyé : quand l'une change, l'envoi est refait.
  session_version integer check (session_version >= 1),
  content_hash text check (content_hash ~ '^[0-9a-f]{64}$'),
  scheduled_date date,
  status text not null check (status in ('sent', 'failed')),
  -- Contrôle de compatibilité : [{severity, message, where?}], ce que la montre ne suivra pas.
  issues jsonb not null default '[]' check (jsonb_typeof(issues) = 'array' and jsonb_array_length(issues) <= 300),
  -- Raison d'un échec, en clair ; jamais une donnée venue du fournisseur.
  last_error text check (char_length(last_error) <= 300),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_workouts_external_unique unique (connection_id, external_id),
  constraint device_workouts_outcome check (
    (status = 'sent' and remote_id is not null and sent_at is not null)
    or (status = 'failed' and last_error is not null)
  )
);
comment on table public.device_workouts is
  'Séances envoyées vers une montre (intervals.icu, Suunto) : identifiant chez le fournisseur et état d''envoi. Écrit uniquement par le serveur.';
create index device_workouts_session on public.device_workouts (session_id);
create index device_workouts_athlete on public.device_workouts (athlete_id);

create trigger device_workouts_updated_at before update on public.device_workouts
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Réservation des jobs et bail d'envoi
-- ---------------------------------------------------------------------------

-- Chaque exécutant (Strava, intervals.icu, Suunto) ne réserve que les jobs qu'il sait traiter.
drop function public.claim_sync_jobs(integer);

/** Réserve les jobs à exécuter parmi les types donnés (les jobs restés bloqués plus de 10 minutes sont repris). */
create function public.claim_sync_jobs(p_limit integer, p_kinds text[])
returns setof public.sync_jobs
language sql
security definer
set search_path = ''
as $$
  update public.sync_jobs j
  set status = 'running', locked_at = now(), attempts = j.attempts + 1
  where j.id in (
    select q.id from public.sync_jobs q
    where q.kind = any (p_kinds)
      and (
        (q.status in ('pending', 'failed') and q.run_after <= now())
        or (q.status = 'running' and q.locked_at < now() - interval '10 minutes')
      )
    order by q.run_after, q.id
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  returning j.*;
$$;

/**
 * Bail d'envoi d'un compte relié : vrai si l'appelant l'obtient (personne d'autre ne l'a, ou le
 * précédent a expiré). Deux exécutants ne travaillent jamais en même temps sur le même compte.
 */
create function public.acquire_sync_lease(p_connection uuid, p_seconds integer)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with taken as (
    update public.external_connections c
    set sync_lease_until = now() + make_interval(secs => greatest(10, least(p_seconds, 600)))
    where c.id = p_connection and (c.sync_lease_until is null or c.sync_lease_until < now())
    returning c.id
  )
  select exists (select 1 from taken);
$$;

create function public.release_sync_lease(p_connection uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.external_connections set sync_lease_until = null where id = p_connection;
$$;

-- ---------------------------------------------------------------------------
-- 4. Mise en file
-- ---------------------------------------------------------------------------

/**
 * Met en file un envoi vers chaque compte de montre actif de l'athlète (intervals.icu, Suunto).
 * Un job par changement : l'exécutant traite d'un coup tous ceux d'un compte déjà visibles, et
 * relit les séances après les avoir vus ; aucun changement ne se perd entre deux envois.
 */
create function private.enqueue_device_sync(p_athlete uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.sync_jobs (kind, athlete_id)
  select c.provider || '_sync', c.athlete_id
  from public.external_connections c
  where c.athlete_id = p_athlete
    and c.provider in ('suunto', 'intervals')
    and c.status = 'active'
    -- Compte en cours de suppression : rien à envoyer.
    and exists (select 1 from public.profiles p where p.id = p_athlete);
$$;

/** Ce que la montre affiche change : publication, annulation, contenu (version), date. */
create function private.device_session_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.state = 'published' then
      perform private.enqueue_device_sync(new.athlete_id);
    end if;
  elsif tg_op = 'DELETE' then
    if old.state = 'published' then
      perform private.enqueue_device_sync(old.athlete_id);
    end if;
  elsif (old.state = 'published' or new.state = 'published')
    and (new.state, new.version, new.scheduled_date, new.athlete_id) is distinct from (old.state, old.version, old.scheduled_date, old.athlete_id) then
    perform private.enqueue_device_sync(new.athlete_id);
    if new.athlete_id <> old.athlete_id then
      perform private.enqueue_device_sync(old.athlete_id);
    end if;
  end if;
  return null;
end;
$$;

create trigger planned_sessions_devices
after insert or update or delete on public.planned_sessions
for each row execute function private.device_session_changed();

/** Les cibles envoyées en valeurs absolues (watts, bpm, allures) dépendent des seuils. */
create function private.device_thresholds_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enqueue_device_sync(coalesce(new.athlete_id, old.athlete_id));
  return null;
end;
$$;

create trigger athlete_thresholds_devices
after insert or update or delete on public.athlete_thresholds
for each row execute function private.device_thresholds_changed();

-- ---------------------------------------------------------------------------
-- 5. Privilèges et politiques
-- ---------------------------------------------------------------------------

revoke all on function
  private.enqueue_device_sync(uuid),
  private.device_session_changed(),
  private.device_thresholds_changed()
from public, anon, authenticated;

revoke all on function
  public.claim_sync_jobs(integer, text[]),
  public.acquire_sync_lease(uuid, integer),
  public.release_sync_lease(uuid)
from public, anon, authenticated;
grant execute on function
  public.claim_sync_jobs(integer, text[]),
  public.acquire_sync_lease(uuid, integer),
  public.release_sync_lease(uuid)
to service_role;

-- Envois : l'athlète et ses coachs voient leur état ; seul le serveur écrit.
alter table public.device_workouts enable row level security;
revoke all on public.device_workouts from public, anon, authenticated;
grant select on public.device_workouts to authenticated;
create policy device_workouts_select on public.device_workouts for select to authenticated
using (private.has_athlete_access(athlete_id));
