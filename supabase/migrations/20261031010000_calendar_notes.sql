-- Notes de calendrier et jours indisponibles (rotation, déplacement, maladie, blessure, vacances).
--
-- Posées par l'athlète sur son calendrier, ou par un coach qui planifie pour lui ; visibles de
-- l'athlète et de ses coachs actifs, comme les compétitions. Une note couvre un jour ou une période.

create table public.calendar_notes (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('unavailable', 'travel', 'sick', 'injured', 'holiday', 'note')),
  start_date date not null,
  end_date date not null,
  title text check (char_length(title) <= 80),
  note text check (char_length(note) <= 500),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Une période d'un an au plus : au-delà, c'est une erreur de saisie.
  constraint calendar_notes_range check (end_date >= start_date and end_date <= start_date + 366)
);
comment on table public.calendar_notes is
  'Jours indisponibles et notes du calendrier d''un athlète, visibles de lui et de ses coachs.';
create index calendar_notes_athlete_range on public.calendar_notes (athlete_id, start_date, end_date);
create index calendar_notes_created_by on public.calendar_notes (created_by);

create trigger calendar_notes_updated_at before update on public.calendar_notes
for each row execute function private.set_updated_at();
create trigger audit_calendar_notes after insert or update or delete on public.calendar_notes
for each row execute function private.audit_row();

-- Temps réel : le calendrier ouvert (athlète, coachs) se met à jour, sans transporter la note.
create function private.broadcast_calendar_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_athlete uuid := coalesce(new.athlete_id, old.athlete_id);
begin
  perform realtime.send(
    jsonb_build_object('table', 'calendar_notes', 'op', lower(tg_op)),
    'planning_changed',
    'athlete:' || v_athlete,
    true
  );
  return null;
end;
$$;
create trigger broadcast_calendar_notes after insert or update or delete on public.calendar_notes
for each row execute function private.broadcast_calendar_note();

revoke all on function private.broadcast_calendar_note() from public, anon, authenticated;

alter table public.calendar_notes enable row level security;
revoke all on public.calendar_notes from anon, authenticated;
grant select, delete on public.calendar_notes to authenticated;
grant insert (athlete_id, kind, start_date, end_date, title, note) on public.calendar_notes to authenticated;
grant update (kind, start_date, end_date, title, note) on public.calendar_notes to authenticated;

create policy calendar_notes_select on public.calendar_notes for select to authenticated
using (private.has_athlete_access(athlete_id));
create policy calendar_notes_insert on public.calendar_notes for insert to authenticated
with check (private.can_plan_for(athlete_id) and created_by = (select auth.uid()));
-- L'auteur modifie sa note ; l'athlète peut aussi modifier ou retirer toute note de son calendrier.
create policy calendar_notes_update on public.calendar_notes for update to authenticated
using (private.can_plan_for(athlete_id) and (created_by = (select auth.uid()) or athlete_id = (select auth.uid())))
with check (private.can_plan_for(athlete_id));
create policy calendar_notes_delete on public.calendar_notes for delete to authenticated
using (private.can_plan_for(athlete_id) and (created_by = (select auth.uid()) or athlete_id = (select auth.uid())));
