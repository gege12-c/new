-- Phase 1 — Socle : tables, contraintes et index.
-- Conventions : instants en timestamptz (UTC) ; une séance sans heure est une date locale (date) ;
-- valeurs énumérées en text + CHECK (plus simples à faire évoluer que des types enum).

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Comptes
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  timezone text not null default 'Europe/Paris' check (char_length(timezone) between 1 and 64),
  is_coach boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Un profil par compte. is_coach est déclaratif : l''accès aux athlètes passe toujours par leur autorisation.';

-- Administrateurs : gérés uniquement par la clé de service ou l'éditeur SQL.
create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.athlete_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  main_goal text check (char_length(main_goal) <= 300),
  experience_level text check (experience_level in ('beginner', 'intermediate', 'advanced', 'elite')),
  weekly_hours_target numeric(4, 1) check (weekly_hours_target between 0 and 40),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Relations coach-athlète et invitations
-- ---------------------------------------------------------------------------

create table public.coach_athlete_links (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  -- Permissions accordées par l'athlète.
  can_edit_plan boolean not null default true,
  can_view_activities boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  constraint coach_athlete_links_not_self check (coach_id <> athlete_id),
  constraint coach_athlete_links_revoked check ((status = 'revoked') = (revoked_at is not null)),
  constraint coach_athlete_links_unique unique (coach_id, athlete_id)
);
create index coach_athlete_links_athlete_active on public.coach_athlete_links (athlete_id) where status = 'active';
create index coach_athlete_links_coach_active on public.coach_athlete_links (coach_id) where status = 'active';

-- Le jeton n'est jamais stocké : seule son empreinte SHA-256 l'est.
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  email text check (
    email is null
    or (char_length(email) <= 254 and email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  constraint invitations_expiry check (expires_at > created_at),
  constraint invitations_accepted check (accepted_by is null or accepted_at is not null),
  constraint invitations_final_state check (not (accepted_at is not null and revoked_at is not null))
);
create index invitations_coach on public.invitations (coach_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Profil sportif : seuils historisés et compétitions
-- ---------------------------------------------------------------------------

create table public.athlete_thresholds (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  sport text not null check (sport in ('bike', 'run', 'swim', 'general')),
  metric text not null,
  value numeric(7, 2) not null,
  -- Date locale à partir de laquelle la valeur s'applique.
  effective_from date not null,
  source text not null default 'manual' check (source in ('manual', 'test', 'import')),
  notes text check (char_length(notes) <= 500),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint athlete_thresholds_metric check (
    (sport = 'bike' and metric in ('ftp_w', 'lthr_bpm'))
    or (sport = 'run' and metric in ('threshold_pace_s_per_km', 'lthr_bpm'))
    or (sport = 'swim' and metric = 'css_s_per_100m')
    or (sport = 'general' and metric in ('max_hr_bpm', 'resting_hr_bpm', 'weight_kg'))
  ),
  constraint athlete_thresholds_value check (
    case metric
      when 'ftp_w' then value between 30 and 700
      when 'lthr_bpm' then value between 80 and 220
      when 'max_hr_bpm' then value between 100 and 230
      when 'resting_hr_bpm' then value between 25 and 120
      when 'threshold_pace_s_per_km' then value between 150 and 900
      when 'css_s_per_100m' then value between 50 and 300
      when 'weight_kg' then value between 25 and 250
      else false
    end
  ),
  constraint athlete_thresholds_unique unique (athlete_id, sport, metric, effective_from)
);
create index athlete_thresholds_lookup on public.athlete_thresholds (athlete_id, sport, metric, effective_from desc);

create table public.athlete_events (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  event_date date not null,
  priority text not null default 'B' check (priority in ('A', 'B', 'C')),
  sport text not null default 'triathlon' check (sport in ('triathlon', 'duathlon', 'run', 'bike', 'swim', 'other')),
  distance_label text check (char_length(distance_label) <= 60),
  location text check (char_length(location) <= 120),
  notes text check (char_length(notes) <= 1000),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index athlete_events_athlete_date on public.athlete_events (athlete_id, event_date);

-- ---------------------------------------------------------------------------
-- Séances : modèles (bibliothèque du coach) et séances planifiées
-- Le contenu structuré suit le format v1 décrit dans docs/WORKOUT_FORMAT.md,
-- validé intégralement par l'application ; la base vérifie sa forme générale.
-- ---------------------------------------------------------------------------

create function private.is_workout_document(doc jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(doc) = 'object'
    and doc ->> 'schemaVersion' = '1'
    and jsonb_typeof(doc -> 'segments') = 'array'
    and jsonb_array_length(doc -> 'segments') between 1 and 6
    and octet_length(doc::text) <= 200000;
$$;

create table public.workout_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 120),
  sport text not null check (sport in ('swim', 'bike', 'run', 'strength', 'other', 'brick')),
  objective text check (objective in ('recovery', 'endurance', 'tempo', 'threshold', 'vo2max', 'anaerobic', 'sprint', 'technique', 'race_pace', 'strength', 'test', 'race', 'other')),
  description text check (char_length(description) <= 4000),
  content jsonb not null check (private.is_workout_document(content)),
  planned_duration_s integer check (planned_duration_s >= 0),
  planned_distance_m numeric(9, 1) check (planned_distance_m >= 0),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workout_templates_owner on public.workout_templates (owner_id, archived_at, name);

create table public.planned_sessions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles (id) on delete set null,
  -- Date locale de l'athlète ; heure facultative, locale elle aussi.
  scheduled_date date not null,
  start_time time,
  sport text not null check (sport in ('swim', 'bike', 'run', 'strength', 'other', 'brick')),
  title text not null check (char_length(title) between 1 and 120),
  objective text check (objective in ('recovery', 'endurance', 'tempo', 'threshold', 'vo2max', 'anaerobic', 'sprint', 'technique', 'race_pace', 'strength', 'test', 'race', 'other')),
  description text check (char_length(description) <= 4000),
  nutrition_notes text check (char_length(nutrition_notes) <= 2000),
  content jsonb not null check (private.is_workout_document(content)),
  -- Totaux calculés par l'application à l'enregistrement (null = inconnu).
  planned_duration_s integer check (planned_duration_s >= 0),
  planned_distance_m numeric(9, 1) check (planned_distance_m >= 0),
  state text not null default 'draft' check (state in ('draft', 'published', 'cancelled')),
  published_at timestamptz,
  template_id uuid references public.workout_templates (id) on delete set null,
  -- Incrémentée à chaque modification : sert au contrôle de concurrence optimiste.
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index planned_sessions_athlete_date on public.planned_sessions (athlete_id, scheduled_date);
create index planned_sessions_created_by on public.planned_sessions (created_by);

-- ---------------------------------------------------------------------------
-- Journal d'audit (alimenté uniquement par des triggers, jamais modifiable)
-- ---------------------------------------------------------------------------

create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  -- Athlète concerné : détermine qui peut lire l'entrée (null = entrée technique).
  athlete_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  changes jsonb not null default '{}'::jsonb
);
create index audit_logs_athlete on public.audit_logs (athlete_id, occurred_at desc);
create index audit_logs_entity on public.audit_logs (entity_type, entity_id, occurred_at desc);
