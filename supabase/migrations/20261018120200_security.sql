-- Phase 1 — Privilèges et politiques RLS.
-- Principe : rien n'est accessible par défaut. anon n'a aucun accès aux tables ;
-- authenticated reçoit des droits explicites, colonne par colonne quand c'est utile,
-- puis chaque ligne est filtrée par une politique RLS.

-- ---------------------------------------------------------------------------
-- Fonctions : personne ne les exécute sans autorisation explicite
-- ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
grant execute on function
  private.is_admin(),
  private.is_coach_of(uuid),
  private.coach_can_plan(uuid),
  private.has_athlete_access(uuid),
  private.can_plan_for(uuid),
  private.is_linked_with(uuid),
  private.is_workout_document(jsonb),
  private.hash_token(text)
to authenticated, service_role;

revoke all on function
  public.create_invitation(text, integer),
  public.get_invitation_preview(text),
  public.accept_invitation(text),
  public.revoke_invitation(uuid),
  public.revoke_coach_link(uuid),
  public.set_coach_permissions(uuid, boolean, boolean),
  public.athlete_thresholds_at(uuid, date),
  public.current_user_is_admin()
from public, anon, authenticated;

grant execute on function
  public.create_invitation(text, integer),
  public.accept_invitation(text),
  public.revoke_invitation(uuid),
  public.revoke_coach_link(uuid),
  public.set_coach_permissions(uuid, boolean, boolean),
  public.athlete_thresholds_at(uuid, date),
  public.current_user_is_admin()
to authenticated;

-- L'aperçu d'invitation est lisible avant connexion : le jeton (244 bits) fait office de secret.
grant execute on function public.get_invitation_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables : RLS partout, privilèges explicites
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.admin_users enable row level security;
alter table public.athlete_profiles enable row level security;
alter table public.coach_athlete_links enable row level security;
alter table public.invitations enable row level security;
alter table public.athlete_thresholds enable row level security;
alter table public.athlete_events enable row level security;
alter table public.workout_templates enable row level security;
alter table public.planned_sessions enable row level security;
alter table public.audit_logs enable row level security;

revoke all on
  public.profiles,
  public.admin_users,
  public.athlete_profiles,
  public.coach_athlete_links,
  public.invitations,
  public.athlete_thresholds,
  public.athlete_events,
  public.workout_templates,
  public.planned_sessions,
  public.audit_logs
from anon, authenticated;

revoke all on sequence public.audit_logs_id_seq from anon, authenticated;

-- profiles --------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant insert (id, display_name, timezone, is_coach) on public.profiles to authenticated;
grant update (display_name, timezone, is_coach) on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or private.is_linked_with(id)
  or (select private.is_admin())
);
create policy profiles_insert on public.profiles for insert to authenticated
with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- admin_users : lecture de sa propre ligne seulement ; écriture réservée à la clé de service.
grant select on public.admin_users to authenticated;
create policy admin_users_select_self on public.admin_users for select to authenticated
using (user_id = (select auth.uid()));

-- athlete_profiles ------------------------------------------------------------
grant select on public.athlete_profiles to authenticated;
grant insert (user_id, main_goal, experience_level, weekly_hours_target, notes) on public.athlete_profiles to authenticated;
grant update (main_goal, experience_level, weekly_hours_target, notes) on public.athlete_profiles to authenticated;

create policy athlete_profiles_select on public.athlete_profiles for select to authenticated
using (private.has_athlete_access(user_id));
create policy athlete_profiles_insert on public.athlete_profiles for insert to authenticated
with check (user_id = (select auth.uid()));
create policy athlete_profiles_update on public.athlete_profiles for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- coach_athlete_links : lecture par les deux parties ; écriture uniquement via les RPC.
grant select on public.coach_athlete_links to authenticated;
create policy coach_athlete_links_select on public.coach_athlete_links for select to authenticated
using (
  coach_id = (select auth.uid())
  or athlete_id = (select auth.uid())
  or (select private.is_admin())
);

-- invitations : le coach voit les siennes, sans l'empreinte du jeton ; écriture via les RPC.
grant select (id, coach_id, email, created_at, expires_at, accepted_at, accepted_by, revoked_at)
  on public.invitations to authenticated;
create policy invitations_select on public.invitations for select to authenticated
using (coach_id = (select auth.uid()));

-- athlete_thresholds ----------------------------------------------------------
grant select on public.athlete_thresholds to authenticated;
grant insert (athlete_id, sport, metric, value, effective_from, source, notes) on public.athlete_thresholds to authenticated;
grant update (value, effective_from, source, notes) on public.athlete_thresholds to authenticated;
grant delete on public.athlete_thresholds to authenticated;

create policy athlete_thresholds_select on public.athlete_thresholds for select to authenticated
using (private.has_athlete_access(athlete_id));
create policy athlete_thresholds_insert on public.athlete_thresholds for insert to authenticated
with check (private.can_plan_for(athlete_id) and created_by = (select auth.uid()));
create policy athlete_thresholds_update on public.athlete_thresholds for update to authenticated
using (private.can_plan_for(athlete_id))
with check (private.can_plan_for(athlete_id));
create policy athlete_thresholds_delete on public.athlete_thresholds for delete to authenticated
using (private.can_plan_for(athlete_id));

-- athlete_events --------------------------------------------------------------
grant select on public.athlete_events to authenticated;
grant insert (athlete_id, name, event_date, priority, sport, distance_label, location, notes)
  on public.athlete_events to authenticated;
grant update (name, event_date, priority, sport, distance_label, location, notes) on public.athlete_events to authenticated;
grant delete on public.athlete_events to authenticated;

create policy athlete_events_select on public.athlete_events for select to authenticated
using (private.has_athlete_access(athlete_id));
create policy athlete_events_insert on public.athlete_events for insert to authenticated
with check (private.can_plan_for(athlete_id) and created_by = (select auth.uid()));
create policy athlete_events_update on public.athlete_events for update to authenticated
using (private.can_plan_for(athlete_id))
with check (private.can_plan_for(athlete_id));
create policy athlete_events_delete on public.athlete_events for delete to authenticated
using (private.can_plan_for(athlete_id));

-- workout_templates : bibliothèque personnelle ----------------------------------
grant select, delete on public.workout_templates to authenticated;
grant insert (name, sport, objective, description, content, planned_duration_s, planned_distance_m, tags)
  on public.workout_templates to authenticated;
grant update (name, sport, objective, description, content, planned_duration_s, planned_distance_m, tags, archived_at)
  on public.workout_templates to authenticated;

create policy workout_templates_owner on public.workout_templates for all to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

-- planned_sessions ------------------------------------------------------------
grant select, delete on public.planned_sessions to authenticated;
grant insert (
  athlete_id, scheduled_date, start_time, sport, title, objective, description, nutrition_notes,
  content, planned_duration_s, planned_distance_m, state, template_id
) on public.planned_sessions to authenticated;
grant update (
  scheduled_date, start_time, sport, title, objective, description, nutrition_notes,
  content, planned_duration_s, planned_distance_m, state, template_id
) on public.planned_sessions to authenticated;

-- L'athlète ne voit pas les brouillons de son coach.
create policy planned_sessions_select on public.planned_sessions for select to authenticated
using (
  (athlete_id = (select auth.uid()) and (state <> 'draft' or created_by = (select auth.uid())))
  or private.is_coach_of(athlete_id)
);
create policy planned_sessions_insert on public.planned_sessions for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (athlete_id = (select auth.uid()) or private.coach_can_plan(athlete_id))
);
-- L'athlète peut déplacer les séances de son coach : le trigger guard_planned_session limite ce qu'il change.
create policy planned_sessions_update on public.planned_sessions for update to authenticated
using (
  (athlete_id = (select auth.uid()) and (state <> 'draft' or created_by = (select auth.uid())))
  or private.coach_can_plan(athlete_id)
)
with check (athlete_id = (select auth.uid()) or private.coach_can_plan(athlete_id));
create policy planned_sessions_delete on public.planned_sessions for delete to authenticated
using (
  private.coach_can_plan(athlete_id)
  or (athlete_id = (select auth.uid()) and created_by = (select auth.uid()))
);

-- audit_logs : lecture seule, pour l'athlète et ses coachs ----------------------
grant select on public.audit_logs to authenticated;
create policy audit_logs_select on public.audit_logs for select to authenticated
using (athlete_id is not null and private.has_athlete_access(athlete_id));
