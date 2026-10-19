-- Phase 5 : notifications dans l'application, sobres et réglables.
--
-- Créées uniquement par la base (triggers, fonction quotidienne), jamais par l'API : séance publiée,
-- modifiée ou annulée par quelqu'un d'autre, commentaire partagé, reconnexion Strava nécessaire,
-- échec d'export d'un athlète (pour ses coachs), séance passée sans retour. Chacun peut couper
-- chaque type dans ses réglages. Une notification ne contient que des identifiants et des libellés
-- de TriCoach (titre et date de séance), jamais de donnée Strava.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('session_published', 'session_updated', 'session_cancelled', 'comment', 'reconnect', 'export_failed', 'missing_feedback')),
  -- L'athlète concerné (pour un coach, l'athlète suivi ; pour un athlète, lui-même).
  athlete_id uuid references public.profiles (id) on delete cascade,
  session_id uuid references public.planned_sessions (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  -- Libellés figés au moment de la notification (titre, date, fournisseur…).
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
comment on table public.notifications is
  'Notifications dans l''application, écrites par la base seule ; le destinataire les lit et les marque comme lues.';
create index notifications_recipient on public.notifications (recipient_id, created_at desc);
create index notifications_unread on public.notifications (recipient_id) where read_at is null;
create index notifications_session on public.notifications (session_id);
create index notifications_athlete on public.notifications (athlete_id);
create index notifications_actor on public.notifications (actor_id);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade default auth.uid(),
  -- Types coupés par l'utilisateur ; tout est actif par défaut.
  disabled_kinds text[] not null default '{}' check (disabled_kinds <@ array['session_published', 'session_updated', 'session_cancelled', 'comment', 'reconnect', 'export_failed', 'missing_feedback']),
  updated_at timestamptz not null default now()
);

create trigger notification_preferences_updated_at before update on public.notification_preferences
for each row execute function private.set_updated_at();

/** Crée une notification, sauf si le destinataire a coupé ce type ; regroupe les modifications rapprochées. */
create function private.notify(
  p_recipient uuid,
  p_kind text,
  p_athlete uuid,
  p_session uuid,
  p_actor uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
begin
  if p_recipient is null or p_recipient is not distinct from p_actor then
    return;
  end if;
  if exists (
    select 1 from public.notification_preferences p
    where p.user_id = p_recipient and p_kind = any (p.disabled_kinds)
  ) then
    return;
  end if;
  -- Plusieurs séances publiées d'un coup (copie de semaine…) : une seule notification groupée.
  if p_kind = 'session_published' then
    select n.id into v_existing
    from public.notifications n
    where n.recipient_id = p_recipient and n.kind = 'session_published' and n.actor_id is not distinct from p_actor
      and n.read_at is null and n.created_at > now() - interval '10 minutes'
    order by n.created_at desc
    limit 1;
    if v_existing is not null then
      update public.notifications n
      set payload = jsonb_build_object(
            'count', coalesce((n.payload ->> 'count')::integer, 1) + 1,
            'title', n.payload ->> 'title',
            'date', least((n.payload ->> 'date')::date, (p_payload ->> 'date')::date),
            'last_date', greatest(coalesce((n.payload ->> 'last_date')::date, (n.payload ->> 'date')::date), (p_payload ->> 'date')::date)
          ),
          session_id = null,
          created_at = now()
      where n.id = v_existing;
      return;
    end if;
  end if;
  -- Une séance modifiée plusieurs fois de suite : une seule notification non lue, mise à jour.
  if p_kind = 'session_updated' and p_session is not null then
    select n.id into v_existing
    from public.notifications n
    where n.recipient_id = p_recipient and n.kind = 'session_updated' and n.session_id = p_session
      and n.read_at is null and n.created_at > now() - interval '6 hours'
    order by n.created_at desc
    limit 1;
    if v_existing is not null then
      update public.notifications
      set payload = p_payload, actor_id = p_actor, created_at = now()
      where id = v_existing;
      return;
    end if;
  end if;
  insert into public.notifications (recipient_id, kind, athlete_id, session_id, actor_id, payload)
  values (p_recipient, p_kind, p_athlete, p_session, p_actor, p_payload);
end;
$$;

/** L'athlète et ses coachs actifs, sauf l'auteur du changement. */
create function private.session_audience(p_athlete uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p_athlete
  union
  select l.coach_id from public.coach_athlete_links l where l.athlete_id = p_athlete and l.status = 'active';
$$;

create function private.notify_session_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_kind text;
  v_payload jsonb;
  v_recipient uuid;
begin
  if tg_op = 'INSERT' then
    if new.state <> 'published' then
      return null;
    end if;
    v_kind := 'session_published';
  elsif new.state = 'published' and old.state <> 'published' then
    v_kind := 'session_published';
  elsif new.state = 'cancelled' and old.state = 'published' then
    v_kind := 'session_cancelled';
  elsif new.state = 'published' and old.state = 'published'
    and (new.scheduled_date, new.start_time, new.title, new.content, new.description, new.nutrition_notes, new.sport)
      is distinct from (old.scheduled_date, old.start_time, old.title, old.content, old.description, old.nutrition_notes, old.sport) then
    v_kind := 'session_updated';
  else
    return null;
  end if;
  v_payload := jsonb_build_object(
    'title', new.title,
    'date', new.scheduled_date,
    'previous_date', case when tg_op = 'UPDATE' and new.scheduled_date <> old.scheduled_date then old.scheduled_date end
  );
  for v_recipient in select private.session_audience(new.athlete_id) loop
    perform private.notify(v_recipient, v_kind, new.athlete_id, new.id, v_actor, v_payload);
  end loop;
  return null;
end;
$$;

create trigger planned_sessions_notify
after insert or update on public.planned_sessions
for each row execute function private.notify_session_change();

create function private.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_recipient uuid;
begin
  if new.visibility <> 'shared' then
    return null;
  end if;
  select s.title, s.scheduled_date, s.state into v_session from public.planned_sessions s where s.id = new.session_id;
  for v_recipient in select private.session_audience(new.athlete_id) loop
    -- Un brouillon n'existe pas encore pour l'athlète : seuls les coachs sont prévenus.
    continue when v_session.state = 'draft' and v_recipient = new.athlete_id;
    perform private.notify(
      v_recipient, 'comment', new.athlete_id, new.session_id, new.author_id,
      jsonb_build_object('title', v_session.title, 'date', v_session.scheduled_date, 'excerpt', left(new.body, 140))
    );
  end loop;
  return null;
end;
$$;

create trigger session_comments_notify
after insert on public.session_comments
for each row execute function private.notify_comment();

create function private.notify_reconnect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'reauth_required' and old.status is distinct from 'reauth_required' then
    perform private.notify(new.athlete_id, 'reconnect', new.athlete_id, null, null, jsonb_build_object('provider', new.provider));
  end if;
  return null;
end;
$$;

create trigger external_connections_notify
after update on public.external_connections
for each row execute function private.notify_reconnect();

create function private.notify_export_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_coach uuid;
begin
  -- L'athlète voit l'échec à l'écran ; ses coachs sont prévenus pour corriger la séance.
  if new.status <> 'failed' or new.requested_by is distinct from new.athlete_id then
    return null;
  end if;
  select s.title, s.scheduled_date into v_session from public.planned_sessions s where s.id = new.session_id;
  for v_coach in
    select l.coach_id from public.coach_athlete_links l
    where l.athlete_id = new.athlete_id and l.status = 'active' and l.can_edit_plan
  loop
    perform private.notify(
      v_coach, 'export_failed', new.athlete_id, new.session_id, new.requested_by,
      jsonb_build_object('title', v_session.title, 'date', v_session.scheduled_date, 'provider', new.provider, 'error', left(new.error, 200))
    );
  end loop;
  return null;
end;
$$;

create trigger workout_exports_notify
after insert on public.workout_exports
for each row execute function private.notify_export_failure();

/**
 * Tâche quotidienne (clé de service) : séances publiées de la veille (date locale de chaque athlète,
 * ou le jour indiqué) restées sans retour ni activité rattachée. Idempotente : une seule
 * notification par séance. Purge aussi les notifications de plus de 60 jours.
 */
create function public.notify_missing_feedback(p_day date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_count integer := 0;
begin
  for v_session in
    select s.id, s.athlete_id, s.title, s.scheduled_date
    from public.planned_sessions s
    join public.profiles p on p.id = s.athlete_id
    where s.scheduled_date = coalesce(p_day, (now() at time zone p.timezone)::date - 1) and s.state = 'published'
      and not exists (select 1 from public.session_completions c where c.session_id = s.id)
      and not exists (select 1 from public.session_activity_matches m where m.session_id = s.id and m.status in ('auto', 'confirmed'))
      and not exists (select 1 from public.notifications n where n.session_id = s.id and n.kind = 'missing_feedback')
  loop
    perform private.notify(
      v_session.athlete_id, 'missing_feedback', v_session.athlete_id, v_session.id, null,
      jsonb_build_object('title', v_session.title, 'date', v_session.scheduled_date)
    );
    v_count := v_count + 1;
  end loop;
  delete from public.notifications where created_at < now() - interval '60 days';
  return v_count;
end;
$$;

/** Marque comme lues les notifications de l'utilisateur (toutes, ou celles d'une séance). */
create function public.mark_notifications_read(p_session uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notifications
  set read_at = now()
  where recipient_id = (select auth.uid()) and read_at is null and (p_session is null or session_id = p_session);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;

create policy notifications_select on public.notifications for select to authenticated
using (recipient_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

create policy notification_preferences_select on public.notification_preferences for select to authenticated
using (user_id = (select auth.uid()));
create policy notification_preferences_insert on public.notification_preferences for insert to authenticated
with check (user_id = (select auth.uid()));
create policy notification_preferences_update on public.notification_preferences for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

revoke all on public.notifications from anon, authenticated;
revoke all on public.notification_preferences from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select on public.notification_preferences to authenticated;
-- user_id figure dans la mise à jour d'un upsert (PostgREST) ; les politiques le fixent à l'utilisateur.
grant insert (user_id, disabled_kinds), update (user_id, disabled_kinds) on public.notification_preferences to authenticated;

revoke all on function public.notify_missing_feedback(date) from public, anon, authenticated;
grant execute on function public.notify_missing_feedback(date) to service_role;
revoke all on function public.mark_notifications_read(uuid) from public, anon;
grant execute on function public.mark_notifications_read(uuid) to authenticated;
