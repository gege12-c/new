-- Index des clés étrangères restantes (recommandation de l'analyseur Supabase) :
-- accélèrent les jointures et les mises à null en cascade à la suppression d'un compte.
create index athlete_events_created_by on public.athlete_events (created_by);
create index athlete_thresholds_created_by on public.athlete_thresholds (created_by);
create index coach_athlete_links_revoked_by on public.coach_athlete_links (revoked_by);
create index invitations_accepted_by on public.invitations (accepted_by);
create index planned_sessions_template_id on public.planned_sessions (template_id);
create index planned_sessions_updated_by on public.planned_sessions (updated_by);
