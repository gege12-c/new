-- Phase 4 : historique des exports de séances prévues (fichiers .zwo pour Zwift, FIT pour Garmin).
--
-- Chaque téléchargement (réussi ou non) laisse une ligne : fournisseur, segment, version de la
-- séance exportée, empreinte du fichier, écarts signalés par le contrôle de compatibilité.
-- Une ligne ne se modifie ni ne se supprime ; elle disparaît avec la séance.

create table public.workout_exports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.planned_sessions (id) on delete cascade,
  -- Recopié de la séance par le trigger.
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  -- Forcé à l'utilisateur connecté par le trigger.
  requested_by uuid references public.profiles (id) on delete set null default auth.uid(),
  provider text not null check (provider in ('zwift', 'garmin')),
  format text not null check (format in ('zwo', 'fit')),
  -- Segment exporté (un enchaînement donne un fichier par discipline).
  segment_index smallint not null default 0 check (segment_index between 0 and 5),
  -- Version de la séance exportée : une modification ultérieure rend le fichier périmé.
  session_version integer not null check (session_version >= 1),
  status text not null check (status in ('succeeded', 'failed')),
  file_name text check (char_length(file_name) between 1 and 120),
  byte_size integer check (byte_size between 0 and 10485760),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Écarts du contrôle de compatibilité : [{severity, message, where?}].
  issues jsonb not null default '[]' check (jsonb_typeof(issues) = 'array' and jsonb_array_length(issues) <= 300),
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  constraint workout_exports_provider_format check ((provider = 'zwift' and format = 'zwo') or (provider = 'garmin' and format = 'fit')),
  constraint workout_exports_outcome check (
    (status = 'succeeded' and file_name is not null and byte_size is not null and sha256 is not null)
    or (status = 'failed' and error is not null)
  )
);
comment on table public.workout_exports is
  'Historique des exports de séances prévues (.zwo, FIT) : qui, quand, quelle version, avec quels écarts.';
create index workout_exports_session on public.workout_exports (session_id, created_at desc);
create index workout_exports_athlete on public.workout_exports (athlete_id);
create index workout_exports_requested_by on public.workout_exports (requested_by);

create function private.prepare_workout_export()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  select s.athlete_id, s.version into new.athlete_id, v_version
  from public.planned_sessions s
  where s.id = new.session_id;
  if new.athlete_id is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if new.session_version > v_version then
    raise exception 'invalid_session_version' using errcode = '22023';
  end if;
  new.requested_by := (select auth.uid());
  new.created_at := now();
  return new;
end;
$$;

create trigger workout_exports_prepare
before insert on public.workout_exports
for each row execute function private.prepare_workout_export();

alter table public.workout_exports enable row level security;

-- L'athlète et ses coachs voient l'historique ; chacun n'ajoute que ses propres exports, et
-- seulement pour une séance qu'il peut lire (la sous-requête passe par la RLS des séances).
create policy workout_exports_select on public.workout_exports for select to authenticated
using (private.has_athlete_access(athlete_id));

create policy workout_exports_insert on public.workout_exports for insert to authenticated
with check (
  requested_by = (select auth.uid())
  and private.has_athlete_access(athlete_id)
  and exists (select 1 from public.planned_sessions s where s.id = session_id)
);

revoke all on public.workout_exports from anon, authenticated;
grant select on public.workout_exports to authenticated;
grant insert (session_id, provider, format, segment_index, session_version, status, file_name, byte_size, sha256, issues, error)
  on public.workout_exports to authenticated;
