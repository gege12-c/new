-- Montre Garmin : l'application TriCoach (Connect IQ) charge les séances de l'athlète sur sa montre.
--
-- Association par code, sur le modèle du « device flow » d'OAuth (RFC 8628) :
--   1. la montre demande un code (start_watch_pairing) et l'affiche ;
--   2. l'athlète, connecté à TriCoach, saisit ce code (confirm_watch_pairing) : la montre figure
--      aussitôt dans son profil, « en attente » ;
--   3. la montre récupère une seule fois son jeton (claim_watch_token).
-- Codes et jetons ne sont gardés que sous forme d'empreinte ; le jeton ne donne accès qu'aux
-- séances publiées des 7 prochains jours de l'athlète et à ses seuils (watch_sessions), rien
-- d'autre ; l'athlète le révoque d'un geste (revoke_watch_device). Aucune table n'est écrite
-- directement par l'API : tout passe par ces fonctions.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.watch_devices (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  device_name text not null check (char_length(device_name) between 1 and 60),
  -- Null tant que la montre n'a pas récupéré son jeton (association « en attente »).
  token_hash text unique,
  created_at timestamptz not null default now(),
  connected_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  constraint watch_devices_connected check ((connected_at is null) = (token_hash is null))
);
create index watch_devices_athlete on public.watch_devices (athlete_id) where revoked_at is null;

comment on table public.watch_devices is 'Montres associées par l''athlète, « en attente » jusqu''à la remise du jeton ; jeton gardé sous forme d''empreinte, révocable.';

create table public.watch_pairings (
  id uuid primary key default gen_random_uuid(),
  device_code_hash text not null unique,
  user_code text not null check (user_code ~ '^[A-HJKMNP-Z2-9]{8}$'),
  device_name text not null check (char_length(device_name) between 1 and 60),
  athlete_id uuid references public.profiles (id) on delete cascade,
  device_id uuid references public.watch_devices (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  claimed_at timestamptz,
  constraint watch_pairings_confirmed check ((confirmed_at is null) = (athlete_id is null) and (confirmed_at is null) = (device_id is null)),
  constraint watch_pairings_claimed check (claimed_at is null or confirmed_at is not null)
);
create unique index watch_pairings_pending_code on public.watch_pairings (user_code) where confirmed_at is null;
create index watch_pairings_expires on public.watch_pairings (expires_at);
create index watch_pairings_athlete on public.watch_pairings (athlete_id) where athlete_id is not null;
create index watch_pairings_device on public.watch_pairings (device_id) where device_id is not null;

comment on table public.watch_pairings is 'Associations de montre en cours (10 minutes), lues et écrites par les seules fonctions d''association.';

-- ---------------------------------------------------------------------------
-- Association
-- ---------------------------------------------------------------------------

/** Code de 8 caractères sans ambiguïté de lecture (ni 0, O, 1, I ni L), tiré du générateur sûr. */
create function private.watch_user_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := pg_catalog.uuid_send(gen_random_uuid());
  v_code text := '';
  v_index integer;
begin
  -- Octets entièrement aléatoires d'un UUID v4 (le 6 et le 8 portent la version et la variante).
  foreach v_index in array array[0, 1, 2, 3, 4, 5, 9, 10] loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_index) % 31) + 1, 1);
  end loop;
  return v_code;
end;
$$;

/** La montre demande un code à afficher ; le code secret de l'appareil ne sert qu'à récupérer le jeton. */
create function public.start_watch_pairing(p_device_name text default null)
returns table (device_code text, user_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_name text := coalesce(nullif(left(trim(coalesce(p_device_name, '')), 60), ''), 'Montre Garmin');
  v_device_code text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires timestamptz := now() + interval '10 minutes';
  v_code text;
begin
  -- Associations abandonnées : effacées au bout d'un jour, avec la montre restée « en attente ».
  delete from public.watch_devices d where d.token_hash is null and d.created_at < now() - interval '1 day';
  delete from public.watch_pairings p where p.expires_at < now() - interval '1 day';
  -- Garde-fou contre les demandes en rafale (aucun compte n'est nécessaire pour demander un code).
  if (select count(*) from public.watch_pairings p where p.created_at > now() - interval '10 minutes') >= 500 then
    raise exception 'pairing_unavailable' using errcode = '55000';
  end if;
  for attempt in 1..5 loop
    v_code := private.watch_user_code();
    begin
      insert into public.watch_pairings (device_code_hash, user_code, device_name, expires_at)
      values (private.hash_token(v_device_code), v_code, v_name, v_expires);
      device_code := v_device_code;
      user_code := v_code;
      expires_at := v_expires;
      return next;
      return;
    exception when unique_violation then
      -- Code déjà en attente pour une autre montre : on en tire un autre.
    end;
  end loop;
  raise exception 'pairing_unavailable' using errcode = '55000';
end;
$$;

/** L'athlète connecté saisit le code affiché par sa montre. */
create function public.confirm_watch_pairing(p_user_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_athlete uuid := (select auth.uid());
  v_code text := upper(regexp_replace(coalesce(p_user_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_pairing public.watch_pairings;
  v_device uuid;
begin
  if v_athlete is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if (select count(*) from public.watch_devices d where d.athlete_id = v_athlete and d.revoked_at is null) >= 5 then
    raise exception 'too_many_watches' using errcode = '54000';
  end if;
  select * into v_pairing
  from public.watch_pairings p
  where p.user_code = v_code
    and p.confirmed_at is null
    and p.expires_at > now()
  for update;
  if not found then
    raise exception 'pairing_not_found' using errcode = '22023';
  end if;
  insert into public.watch_devices (athlete_id, device_name)
  values (v_athlete, v_pairing.device_name)
  returning id into v_device;
  update public.watch_pairings p
  set athlete_id = v_athlete,
      device_id = v_device,
      confirmed_at = now(),
      -- La montre a encore 5 minutes au moins pour récupérer son jeton.
      expires_at = greatest(p.expires_at, now() + interval '5 minutes')
  where p.id = v_pairing.id;
  return v_pairing.device_name;
end;
$$;

/**
 * La montre récupère son jeton, une seule fois, après confirmation par l'athlète.
 * Statuts : pending (en attente de l'athlète), ready (jeton remis), expired, claimed (déjà remis), unknown.
 */
create function public.claim_watch_token(p_device_code text)
returns table (status text, token text, athlete_name text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_pairing public.watch_pairings;
  v_token text;
begin
  select * into v_pairing
  from public.watch_pairings p
  where p.device_code_hash = private.hash_token(coalesce(p_device_code, ''))
  for update;
  if not found then
    status := 'unknown';
  elsif v_pairing.claimed_at is not null then
    status := 'claimed';
  elsif v_pairing.expires_at <= now() then
    status := 'expired';
  elsif v_pairing.confirmed_at is null then
    status := 'pending';
  else
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update public.watch_devices d
    set token_hash = private.hash_token(v_token), connected_at = now()
    where d.id = v_pairing.device_id
      and d.revoked_at is null
      and d.token_hash is null;
    if found then
      update public.watch_pairings p set claimed_at = now() where p.id = v_pairing.id;
      status := 'ready';
      token := v_token;
      select pr.display_name into athlete_name from public.profiles pr where pr.id = v_pairing.athlete_id;
    else
      -- Montre dissociée par l'athlète avant d'avoir récupéré son jeton.
      status := 'expired';
    end if;
  end if;
  return next;
end;
$$;

/** L'athlète dissocie une de ses montres : son jeton ne vaut plus rien, aussitôt. */
create function public.revoke_watch_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.watch_devices d
  set revoked_at = now()
  where d.id = p_device_id
    and d.athlete_id = (select auth.uid())
    and d.revoked_at is null;
  if not found then
    raise exception 'watch_not_found' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Séances de la montre
-- ---------------------------------------------------------------------------

/**
 * Séances publiées de l'athlète, d'aujourd'hui (sa date locale) à J+6, avec ses seuils pour la
 * conversion en séance Garmin. Le jeton de la montre est la seule autorisation demandée.
 */
create function public.watch_sessions(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.watch_devices;
  v_profile public.profiles;
  v_today date;
begin
  select * into v_device
  from public.watch_devices d
  where d.token_hash = private.hash_token(coalesce(p_token, ''))
    and d.revoked_at is null;
  if not found then
    return jsonb_build_object('status', 'unauthorized');
  end if;
  update public.watch_devices d
  set last_seen_at = now()
  where d.id = v_device.id
    and (d.last_seen_at is null or d.last_seen_at < now() - interval '1 minute');

  select * into v_profile from public.profiles p where p.id = v_device.athlete_id;
  v_today := (now() at time zone coalesce(v_profile.timezone, 'Europe/Paris'))::date;

  return jsonb_build_object(
    'status', 'ok',
    'device', jsonb_build_object('id', v_device.id, 'name', v_device.device_name),
    'athlete', jsonb_build_object('id', v_profile.id, 'name', v_profile.display_name, 'timezone', v_profile.timezone),
    'today', v_today,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'scheduled_date', s.scheduled_date,
          'start_time', s.start_time,
          'sport', s.sport,
          'title', s.title,
          'description', s.description,
          'nutrition_notes', s.nutrition_notes,
          'content', s.content,
          'planned_duration_s', s.planned_duration_s,
          'planned_distance_m', s.planned_distance_m,
          'version', s.version
        ) order by s.scheduled_date, s.start_time nulls last, s.created_at)
      from public.planned_sessions s
      where s.athlete_id = v_device.athlete_id
        and s.state = 'published'
        and s.scheduled_date between v_today and v_today + 6
    ), '[]'::jsonb),
    'thresholds', coalesce((
      select jsonb_agg(jsonb_build_object('sport', t.sport, 'metric', t.metric, 'value', t.value, 'effective_from', t.effective_from))
      from public.athlete_thresholds t
      where t.athlete_id = v_device.athlete_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilèges et politiques
-- ---------------------------------------------------------------------------

alter table public.watch_pairings enable row level security;
alter table public.watch_devices enable row level security;
revoke all on public.watch_pairings from public, anon, authenticated;
revoke all on public.watch_devices from public, anon, authenticated;

-- L'athlète voit ses montres (jamais l'empreinte du jeton). ----------------------------------
grant select (id, athlete_id, device_name, created_at, connected_at, last_seen_at, revoked_at) on public.watch_devices to authenticated;
create policy watch_devices_select_own on public.watch_devices for select to authenticated
using (athlete_id = (select auth.uid()));

revoke all on function private.watch_user_code() from public, anon, authenticated;

revoke all on function
  public.start_watch_pairing(text),
  public.confirm_watch_pairing(text),
  public.claim_watch_token(text),
  public.revoke_watch_device(uuid),
  public.watch_sessions(text)
from public, anon, authenticated;
-- La montre n'a pas de session TriCoach : ses trois appels passent par le serveur avec la clé publique.
grant execute on function
  public.start_watch_pairing(text),
  public.claim_watch_token(text),
  public.watch_sessions(text)
to anon, authenticated;
grant execute on function
  public.confirm_watch_pairing(text),
  public.revoke_watch_device(uuid)
to authenticated;
