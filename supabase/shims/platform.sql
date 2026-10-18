-- Couche de compatibilité « plateforme Supabase » pour un PostgreSQL ordinaire :
-- rôles de l'API, privilèges par défaut du schéma public et schéma realtime minimal.
-- Utilisée par les tests de base de données et par la pile locale sans Docker (scripts/local-stack).
-- Ce fichier n'est JAMAIS appliqué sur Supabase, qui fournit déjà tout cela.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  -- Rôle de connexion de PostgREST, qui endosse ensuite anon ou authenticated selon le jeton.
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'postgres';
  end if;
  -- Propriétaire du schéma auth, utilisé par Supabase Auth (GoTrue).
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login createrole noinherit password 'postgres';
  end if;
end;
$$;

grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Realtime : table des messages diffusés et fonctions utilisées par les déclencheurs.
-- Sur Supabase, le serveur Realtime lit cette table et applique ses politiques RLS aux abonnés.
create schema if not exists realtime;

create table if not exists realtime.messages (
  id uuid not null default gen_random_uuid(),
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default false,
  updated_at timestamp without time zone not null default now(),
  inserted_at timestamp without time zone not null default now(),
  primary key (id, inserted_at)
);
alter table realtime.messages enable row level security;

create or replace function realtime.topic()
returns text
language sql
stable
as $$
  select nullif(current_setting('realtime.topic', true), '')::text
$$;

create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void
language plpgsql
as $$
begin
  insert into realtime.messages (payload, event, topic, private, extension)
  values (payload, event, topic, private, 'broadcast');
end;
$$;

grant usage on schema realtime to anon, authenticated, service_role;
grant select, insert on realtime.messages to authenticated;
